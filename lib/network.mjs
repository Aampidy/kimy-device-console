import { randomUUID } from "node:crypto";
import { createSocket } from "node:dgram";
import { isIP, Socket } from "node:net";

const sessions = new Map();

function streamSocket(kind, { host, port, localPort }, response) {
  const tcp = kind === "tcp";
  return new Promise((resolve, reject) => {
    const socket = tcp ? new Socket() : createSocket(isIP(host) === 6 ? "udp6" : "udp4");
    let id;
    let closed = false;
    const timer = setTimeout(() => disconnect(new Error("连接设备超时。")), 5000);

    function disconnect(error) {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      if (tcp) socket.destroy();
      else socket.close();
      if (id) {
        sessions.delete(id);
        if (!response.destroyed) response.end();
      } else if (response.destroyed) {
        resolve();
      } else {
        reject(error ?? new Error("连接设备失败。"));
      }
    }

    function ready() {
      if (closed) return;
      if (response.destroyed) {
        disconnect();
        return;
      }
      clearTimeout(timer);
      id = randomUUID();
      sessions.set(id, (bytes) => new Promise((sent, failed) => {
        if (closed) throw new Error("连接已关闭。");
        const done = (error) => error ? failed(error) : sent();
        if (tcp) socket.write(bytes, done);
        else socket.send(bytes, done);
      }));
      response.writeHead(200, { "Content-Type": "application/octet-stream", "X-PID-Connection": id });
      response.flushHeaders();
      resolve();
    }

    response.once("close", () => disconnect());
    socket.on("error", disconnect);
    if (tcp) socket.once("close", () => disconnect());
    socket.on(tcp ? "data" : "message", (bytes) => {
      if (!id || closed || (!tcp && response.writableNeedDrain)) return;
      // HTTP 响应可能合并或拆开数据块，用长度前缀保留 UDP 报文边界。
      const frame = Buffer.allocUnsafe(4 + bytes.length);
      frame.writeUInt32BE(bytes.length);
      bytes.copy(frame, 4);
      if (!response.write(frame) && tcp) {
        socket.pause();
        response.once("drain", () => socket.resume());
      }
    });

    try {
      if (tcp) socket.connect({ host, port, noDelay: true }, ready);
      else if (localPort === undefined) socket.connect(port, host, ready);
      else socket.bind(localPort, () => { if (!closed) socket.connect(port, host, ready); });
    } catch (error) {
      disconnect(error);
    }
  });
}

export async function serveNetwork(request, response, url, adapters, json) {
  const kindOrId = url.pathname.slice("/api/transports/".length);
  if (kindOrId === "tcp" || kindOrId === "udp") {
    const params = url.searchParams;
    const id = params.get("adapter");
    if (!Object.hasOwn(adapters, id)) return json(response, 404, { error: "找不到项目适配器。" });
    const preset = adapters[id].transports?.[kindOrId];
    if (preset?.open) return json(response, 404, { error: "此适配器使用自定义连接。" });
    const hasEndpoint = ["host", "port", "localPort"].some((key) => params.has(key));
    const { host, port, localPort } = hasEndpoint ? {
      host: params.get("host"), port: Number(params.get("port")),
      localPort: params.has("localPort") ? Number(params.get("localPort")) : undefined,
    } : (preset ?? {});
    if (typeof host !== "string" || !host.trim() || !Number.isInteger(port) || port < 1 || port > 65535) {
      return json(response, 400, { error: "请填写有效的设备地址和端口。" });
    }
    if (kindOrId === "udp" && localPort !== undefined &&
        (!Number.isInteger(localPort) || localPort < 0 || localPort > 65535)) {
      return json(response, 400, { error: "UDP 本地端口必须在 0 到 65535 之间。" });
    }
    return await streamSocket(kindOrId, { host: host.trim(), port, localPort }, response);
  }

  const write = sessions.get(kindOrId);
  if (!write) return json(response, 404, { error: "网络连接已关闭。" });
  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 1024 * 1024) {
      request.resume();
      return json(response, 413, { error: "单次发送超过 1 MiB。" });
    }
    chunks.push(chunk);
  }
  await write(Buffer.concat(chunks, size));
  response.writeHead(204).end();
}
