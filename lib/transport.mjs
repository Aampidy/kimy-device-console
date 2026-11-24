const encoder = new TextEncoder();
export const textLines = {
  encode: (command) => encoder.encode(command + "\r\n"),
  decoder(emit) {
    const decoder = new TextDecoder();
    let tail = "";
    return (bytes) => {
      const lines = (tail + decoder.decode(bytes, { stream: true })).split(/\r\n|\r|\n/);
      tail = lines.pop();
      for (const line of lines) if (line) emit(line);
      if (tail.length > 8192) tail = "";
    };
  },
};

const bleUartProfiles = [
  {
    service: "6e400001-b5a3-f393-e0a9-e50e24dcca9e",
    write: "6e400002-b5a3-f393-e0a9-e50e24dcca9e",
    notify: "6e400003-b5a3-f393-e0a9-e50e24dcca9e",
  },
  { service: 0xffe0, write: 0xffe1, notify: 0xffe1 },
];

async function openBle(config, receive, lost, signal) {
  if (!navigator.bluetooth) throw new Error("当前浏览器无法访问 BLE。请用桌面版 Chrome 或 Edge 打开本地网址。");
  const chunkSize = config.chunkSize ?? 20;
  if (!Number.isInteger(chunkSize) || chunkSize < 1) throw new Error("适配器的 BLE 分包长度必须为正整数。");
  const uuidCount = [config.service, config.write, config.notify].filter((uuid) => uuid != null && uuid !== "").length;
  const automatic = uuidCount === 0;
  if (!automatic && uuidCount !== 3) throw new Error("请填齐三个蓝牙 UUID，或全部留空以自动匹配。");
  const profiles = automatic ? bleUartProfiles : [config];
  const device = await navigator.bluetooth.requestDevice({
    ...(config.filters?.length ? { filters: config.filters } : { acceptAllDevices: true }),
    optionalServices: profiles.map(({ service }) => service),
  });
  signal?.throwIfAborted();
  const disconnected = () => lost("蓝牙连接已断开。");
  device.addEventListener("gattserverdisconnected", disconnected);
  let notify;
  const notification = ({ target: { value } }) =>
    receive(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));

  function close() {
    device.removeEventListener("gattserverdisconnected", disconnected);
    notify?.removeEventListener("characteristicvaluechanged", notification);
    device.gatt.disconnect();
  }

  try {
    const gatt = await device.gatt.connect();
    signal?.throwIfAborted();
    let write;
    for (const profile of profiles) {
      try {
        const service = await gatt.getPrimaryService(profile.service);
        const writer = await service.getCharacteristic(profile.write);
        const notifier = profile.notify === profile.write ? writer : await service.getCharacteristic(profile.notify);
        if (automatic && ((!writer.properties.write && !writer.properties.writeWithoutResponse) ||
            (!notifier.properties.notify && !notifier.properties.indicate))) continue;
        write = writer;
        notify = notifier;
        break;
      } catch (error) {
        if (!automatic || error.name !== "NotFoundError") throw error;
      }
    }
    if (!notify) throw new Error("未识别此设备的蓝牙收发服务。可在高级设置中填写设备的 UUID。");
    notify.addEventListener("characteristicvaluechanged", notification);
    await notify.startNotifications();
    return {
      name: device.name || "BLE 设备",
      close,
      async write(bytes) {
        for (let start = 0; start < bytes.length; start += chunkSize) {
          const chunk = bytes.subarray(start, start + chunkSize);
          if (write.properties.writeWithoutResponse) await write.writeValueWithoutResponse(chunk);
          else await write.writeValueWithResponse(chunk);
        }
      },
    };
  } catch (error) {
    close();
    throw error;
  }
}

async function openSerial(config, receive, lost) {
  if (!navigator.serial) throw new Error("当前浏览器无法访问串口。请用桌面版 Chrome 或 Edge 打开本地网址。");
  const { chooser, label, ...settings } = config;
  const port = await navigator.serial.requestPort(chooser);
  await port.open(settings);
  let reader;
  let writer;
  try {
    reader = port.readable.getReader();
    writer = port.writable.getWriter();
  } catch (error) {
    reader?.releaseLock();
    await port.close().catch(() => {});
    throw error;
  }
  let closing;
  const reading = (async () => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) return "串口已断开。";
        receive(value);
      }
    } catch (error) {
      return "串口读取失败。 " + error.message;
    } finally {
      reader.releaseLock();
    }
  })();

  function close() {
    closing ??= (async () => {
      try { await reader.cancel(); } catch { /* 读取已经结束。 */ }
      await reading;
      writer.releaseLock();
      await port.close();
    })();
    return closing;
  }

  void reading.then((reason) => {
    if (!closing) {
      void close().catch(() => {});
      lost(reason);
    }
  });
  const info = port.getInfo();
  return {
    name: info.bluetoothServiceClassId ? "蓝牙串口" : "串口设备",
    write: (bytes) => writer.write(bytes),
    close,
  };
}

async function openWebSocket({ url, protocols, binary = false }, receive, lost, signal) {
  if (typeof url !== "string" || !url.trim()) throw new Error("请填写 WebSocket 地址。");
  const socket = new WebSocket(url, protocols);
  socket.binaryType = "arraybuffer";
  const opening = new AbortController();
  try {
    await new Promise((resolve, reject) => {
      const once = { once: true, signal: opening.signal };
      const failed = () => reject(new Error("WebSocket 连接失败。"));
      socket.addEventListener("open", resolve, once);
      socket.addEventListener("error", failed, once);
      socket.addEventListener("close", failed, once);
      signal?.addEventListener("abort", () => reject(signal.reason), once);
      AbortSignal.timeout(5000).addEventListener("abort", () => reject(new Error("WebSocket 连接超时。")), once);
    });
  } catch (error) {
    socket.close();
    throw error;
  } finally {
    opening.abort();
  }
  const decoder = new TextDecoder();
  socket.addEventListener("message", ({ data }) => {
    receive(typeof data === "string" ? encoder.encode(data) : new Uint8Array(data));
  });
  socket.addEventListener("close", () => lost("WebSocket 连接已断开。"), { once: true });
  return {
    name: "WebSocket " + new URL(socket.url).host,
    write(bytes) {
      if (socket.readyState !== WebSocket.OPEN) throw new Error("WebSocket 连接已断开。");
      socket.send(binary ? bytes : decoder.decode(bytes));
    },
    close: () => socket.close(),
  };
}

async function receiveNetwork(stream, receive) {
  const reader = stream.getReader();
  let tail = new Uint8Array();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        if (tail.length) throw new Error("网络报文未接收完整。");
        return;
      }
      let bytes = value;
      if (tail.length) {
        bytes = new Uint8Array(tail.length + value.length);
        bytes.set(tail);
        bytes.set(value, tail.length);
      }
      const frame = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      let offset = 0;
      while (offset + 4 <= bytes.length) {
        const start = offset + 4;
        const end = start + frame.getUint32(offset);
        if (end > bytes.length) break;
        receive(bytes.subarray(start, end));
        offset = end;
      }
      tail = bytes.subarray(offset);
    }
  } finally {
    reader.releaseLock();
  }
}

export async function openNetworkTransport(adapterId, kind, { host, port, localPort }, { receive, lost, signal }) {
  const controller = new AbortController();
  const connectionSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const base = "/api/transports/";
  const name = kind.toUpperCase();
  async function post(path, body) {
    const response = await fetch(base + path, {
      method: "POST", headers: { "Content-Type": "application/octet-stream" }, body, signal: connectionSignal,
    });
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      throw new Error(result?.error ?? "本地网络服务返回 " + response.status);
    }
    return response;
  }
  try {
    const params = new URLSearchParams({ adapter: adapterId });
    if (host != null) params.set("host", host);
    if (port != null) params.set("port", port);
    if (kind === "udp" && localPort != null) params.set("localPort", localPort);
    const response = await post(kind + "?" + params);
    const id = response.headers.get("X-PID-Connection");
    if (!id || !response.body) throw new Error("本地服务未建立网络连接。");
    void receiveNetwork(response.body, receive).then(
      () => { if (!connectionSignal.aborted) lost(name + " 连接已断开。"); },
      (error) => { if (!connectionSignal.aborted) lost(name + " 读取失败。 " + error.message); },
    );
    return {
      name: name + " " + host + ":" + port,
      async write(bytes) { await post(id, bytes); },
      close: () => controller.abort(),
    };
  } catch (error) {
    controller.abort();
    throw error;
  }
}

const openers = { ble: openBle, serial: openSerial, websocket: openWebSocket };

export async function connectDevice(kind, config, codec = textLines, {
  onReceive, onResponse, onSend, onLost, onStats, signal, openNetwork, adapterId,
}) {
  signal?.throwIfAborted();
  let link;
  let closing;
  let pending;
  let writeQueue = Promise.resolve();
  let closed = false;
  const metrics = {
    txBytes: 0, rxBytes: 0, txFrames: 0, rxFrames: 0,
    timeouts: 0, parseErrors: 0, writeErrors: 0,
    responses: 0, lastResponseMs: undefined, averageResponseMs: undefined,
  };
  const stats = () => ({ ...metrics, connected: Boolean(link) && !closed });
  const updateStats = () => onStats?.(stats());
  const format = codec.format ?? String;
  const decode = codec.decoder((frame) => {
    if (closed) return;
    metrics.rxFrames++;
    onReceive(format(frame), frame);
    let response;
    if (pending?.accept) {
      const request = pending;
      try {
        const result = request.accept(frame);
        if (result !== undefined) response = { request, result };
      } catch (error) {
        response = { request, error };
      }
      if (response) request.accept = null;
    }
    if (!response) return;
    onResponse?.(format(frame), frame, { commandId: response.request.commandId });
    if (response.error) {
      response.request.reject(response.error);
      return;
    }
    const elapsed = performance.now() - response.request.startedAt;
    metrics.lastResponseMs = elapsed;
    metrics.averageResponseMs = ((metrics.averageResponseMs ?? 0) * metrics.responses + elapsed) /
      (metrics.responses + 1);
    metrics.responses++;
    response.request.resolve(response.result);
    updateStats();
  });
  const receive = (bytes) => {
    if (closed) return;
    metrics.rxBytes += bytes.byteLength;
    updateStats();
    try {
      decode(bytes);
    } catch (error) {
      metrics.parseErrors++;
      updateStats();
      throw error;
    }
  };
  async function close(message = "设备已断开。") {
    closed = true;
    updateStats();
    if (pending) {
      pending.accept = null;
      pending.reject(new Error(message));
    }
    if (link) {
      closing ??= Promise.resolve().then(() => link.close());
      await closing;
    }
  }

  const lost = (message = "设备已断开。") => {
    if (closed) return;
    void close(message).catch(() => {});
    onLost(message);
  };
  if (config.open) {
    link = await config.open({ receive, lost, signal });
  } else if (kind === "tcp" || kind === "udp") {
    if (!openNetwork) throw new Error("当前页面未提供 TCP / UDP 连接服务。");
    link = await openNetwork(adapterId, kind, config, { receive, lost, signal });
  } else {
    if (!Object.hasOwn(openers, kind)) throw new Error("连接方式缺少 open 回调。");
    link = await openers[kind](config, receive, lost, signal);
  }
  if (closed || signal?.aborted) {
    await close();
    signal?.throwIfAborted();
    throw new Error("连接建立时设备已断开。");
  }
  updateStats();

  function write(bytes, text, active, metadata) {
    const operation = writeQueue.then(async () => {
      if (closed) throw new Error("设备已断开。");
      if (active && !active()) return;
      onSend(text, metadata);
      try {
        await link.write(bytes);
        metrics.txBytes += bytes.byteLength;
        metrics.txFrames++;
        updateStats();
      } catch (error) {
        metrics.writeErrors++;
        updateStats();
        throw error;
      }
    });
    writeQueue = operation.catch(() => {});
    return operation;
  }

  async function send(command, active, metadata) {
    await write(codec.encode(command), format(command).trim(), active, metadata);
  }

  async function sendRaw(bytes, label, metadata) {
    if (!(bytes instanceof Uint8Array)) throw new TypeError("原始报文必须是 Uint8Array。");
    const display = label ?? Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join(" ");
    await write(bytes, display, undefined, metadata);
  }

  return {
    name: link.name,
    stats,
    noteParseError() {
      metrics.parseErrors++;
      updateStats();
    },
    send,
    sendRaw,
    async ask(command, accept, signal, timeout = 1100, metadata) {
      if (pending) throw new Error("上一条命令仍在等待回执。");
      signal.throwIfAborted();
      let timer;
      const request = { accept, startedAt: performance.now(), ...metadata };
      const answer = new Promise((resolve, reject) => {
        Object.assign(request, { resolve, reject });
        pending = request;
      });
      void answer.catch(() => {});
      const abort = () => {
        if (pending !== request) return;
        request.accept = null;
        request.reject(signal.reason);
      };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      try {
        timer = setTimeout(() => {
          if (pending !== request || !request.accept) return;
          request.accept = null;
          metrics.timeouts++;
          updateStats();
          request.reject(new Error("等待回执超时。"));
        }, timeout);
        if (command != null) {
          void send(command, () => pending === request && Boolean(request.accept) && !signal.aborted, metadata).catch((error) => {
            if (pending !== request || !request.accept) return;
            request.accept = null;
            request.reject(error);
          });
        }
        const result = await answer;
        signal.throwIfAborted();
        return result;
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        if (pending === request) pending = undefined;
      }
    },
    close,
  };
}
