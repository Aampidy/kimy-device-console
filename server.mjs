import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { adapters } from "./adapters/example.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const configuredPort = process.env.PID_VISUALIZER_PORT ?? process.env.BLUETOOTH_CONSOLE_PORT;
const defaultPort = 8765;
let port = Number(configuredPort ?? defaultPort);
let address = "http://127.0.0.1:" + port;
const logsDir = process.env.PID_VISUALIZER_LOGS ?? process.env.BLUETOOTH_CONSOLE_LOGS ?? join(root, "logs");
const serverId = "5-" + createHash("sha256").update(JSON.stringify([root, resolve(logsDir)])).digest("hex");
const moduleType = "text/javascript; charset=utf-8";
const staticFiles = {
  "index.html": "text/html; charset=utf-8",
  "lib/style.css": "text/css; charset=utf-8",
  "lib/visualizer.mjs": moduleType,
  "lib/modules.mjs": moduleType,
  "lib/graphics.mjs": moduleType,
  "lib/transport.mjs": moduleType,
  "lib/telemetry.mjs": moduleType,
};
const assetPrefix = "/adapters/assets/";
const assetsDir = join(root, "adapters", "assets");
const assetTypes = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

function json(response, status, data) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}

async function serveAsset(pathname, response) {
  let name;
  try {
    name = decodeURIComponent(pathname.slice(assetPrefix.length));
  } catch {
    return json(response, 400, { error: "素材路径无效。" });
  }
  const type = assetTypes[extname(name).toLowerCase()];
  const segments = name.split("/");
  if (!type || segments.some((part) => !part || part === "." || part === ".." || /[\\:\x00-\x1f]/.test(part))) {
    return json(response, 404, { error: "找不到该素材。" });
  }
  const file = await realpath(join(assetsDir, ...segments));
  const fromAssets = relative(assetsDir, file);
  if (isAbsolute(fromAssets) || fromAssets === ".." || fromAssets.startsWith(".." + sep)) {
    return json(response, 404, { error: "找不到该素材。" });
  }
  const content = await readFile(file);
  if (type === "image/svg+xml") response.setHeader("Content-Security-Policy", "sandbox");
  response.writeHead(200, { "Content-Type": type });
  response.end(content);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024 * 1024) throw new Error("单次保存超过 64 MiB。");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function saveLogs(data) {
  if (typeof data?.log !== "string" || typeof data.csv !== "string") throw new Error("缺少日志内容。");
  await mkdir(logsDir, { recursive: true });
  const now = new Date();
  const localTime = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  const prefix = localTime.toISOString().slice(0, 19).replace("T", "-").replaceAll(":", "");
  const temporary = await mkdtemp(join(logsDir, ".capture-"));
  const name = prefix + "-" + basename(temporary).slice(-6);
  try {
    await writeFile(join(temporary, "status.log"), data.log, "utf8");
    if (data.csv) await writeFile(join(temporary, "pid.csv"), "\ufeff" + data.csv, "utf8");
    await rename(temporary, join(logsDir, name));
  } catch (error) {
    await Promise.allSettled(["status.log", "pid.csv"].map((file) => unlink(join(temporary, file))));
    await rmdir(temporary).catch(() => {});
    throw error;
  }
  return { log: "/logs/" + name + "/status.log", csv: data.csv ? "/logs/" + name + "/pid.csv" : null };
}

const server = createServer(async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-PID-Visualizer", serverId);
  if (!["127.0.0.1:" + port, "localhost:" + port].includes(request.headers.host)) {
    return json(response, 403, { error: "请通过本机网址打开。" });
  }
  try {
    const pathname = new URL(request.url, address).pathname;
    if (request.method === "GET" && pathname.startsWith(assetPrefix)) return await serveAsset(pathname, response);
    const file = pathname === "/" ? "index.html" : pathname.slice(1);
    const type = Object.hasOwn(staticFiles, file) ? staticFiles[file] :
      /^adapters\/[a-z0-9][a-z0-9_.-]*\.mjs$/i.test(file) ? moduleType : undefined;
    if (request.method === "GET" && type) {
      const content = await readFile(join(root, file));
      response.writeHead(200, { "Content-Type": type });
      return response.end(content);
    }
    const source = /^\/api\/sources\/([\w-]+)$/.exec(pathname);
    if (request.method === "GET" && source && Object.hasOwn(adapters, source[1])) {
      const sources = Object.entries(adapters[source[1]].files ?? {});
      const values = await Promise.all(sources.map(async ([key, path]) => [key, await readFile(resolve(root, path), "utf8")]));
      return json(response, 200, Object.fromEntries(values));
    }
    if (request.method === "POST" && pathname === "/api/logs") {
      if (![address, "http://localhost:" + port].includes(request.headers.origin) ||
          request.headers["content-type"] !== "application/json") {
        return json(response, 403, { error: "请从控制台保存。" });
      }
      return json(response, 201, await saveLogs(await readJson(request)));
    }
    const log = /^\/logs\/(\d{4}-\d\d-\d\d-\d{6}-[a-z0-9]{6})\/(status\.log|pid\.csv)$/i.exec(pathname);
    if (request.method === "GET" && log) {
      const [, name, fileName] = log;
      const csv = fileName === "pid.csv";
      const content = await readFile(join(logsDir, name, fileName));
      response.writeHead(200, {
        "Content-Type": csv ? "text/csv; charset=utf-8" : "text/plain; charset=utf-8",
        "Content-Disposition": 'attachment; filename="' + (csv ? "pid-" : "status-") + name + (csv ? '.csv"' : '.log"'),
      });
      return response.end(content);
    }
    return json(response, 404, { error: "找不到该资源。" });
  } catch (error) {
    return json(response, error.code === "ENOENT" ? 404 : 500, {
      error: error.code === "ENOENT" ? "找不到请求的文件。" : error.message,
    });
  }
});

const shouldOpen = process.argv.includes("--open") && process.platform === "win32";
function openBrowser() {
  const browser = spawn("explorer.exe", [address], { stdio: "ignore", detached: true, windowsHide: true });
  browser.on("error", () => console.log("请用 Chrome 或 Edge 打开 " + address));
  browser.unref();
}

server.on("error", async (error) => {
  if (error.code === "EADDRINUSE") {
    const active = await fetch(address, { signal: AbortSignal.timeout(1500) }).catch(() => null);
    const activeId = active?.headers.get("x-pid-visualizer") ?? active?.headers.get("x-bluetooth-console");
    if (activeId === serverId) {
      console.log("PID Visualizer 已运行  " + address);
      if (shouldOpen) openBrowser();
      return;
    }
    if (configuredPort === undefined && port === defaultPort) {
      port++;
      address = "http://127.0.0.1:" + port;
      server.listen(port, "127.0.0.1");
      return;
    }
  }
  console.error("启动失败。 " + error.message);
  process.exitCode = 1;
});
server.on("listening", () => {
  port = server.address().port;
  address = "http://127.0.0.1:" + port;
  console.log("PID Visualizer 已启动  " + address);
  if (shouldOpen) openBrowser();
});
server.listen(port, "127.0.0.1");
