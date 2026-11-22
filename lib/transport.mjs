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

async function openBle(config, receive, lost) {
  if (!navigator.bluetooth) throw new Error("当前浏览器无法访问 BLE。请用桌面版 Chrome 或 Edge 打开本地网址。");
  const chunkSize = config.chunkSize ?? 20;
  if (!Number.isInteger(chunkSize) || chunkSize < 1) throw new Error("适配器的 BLE 分包长度必须为正整数。");
  const device = await navigator.bluetooth.requestDevice({
    ...(config.filters?.length ? { filters: config.filters } : { acceptAllDevices: true }),
    optionalServices: [config.service],
  });
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
    const service = await gatt.getPrimaryService(config.service);
    const write = await service.getCharacteristic(config.write);
    notify = await service.getCharacteristic(config.notify);
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

const openers = { ble: openBle, serial: openSerial };

export async function connectDevice(kind, config, codec = textLines, { onReceive, onSend, onLost }) {
  let link;
  let closing;
  let pending;
  let closed = false;
  const format = codec.format ?? String;
  const receive = codec.decoder((frame) => {
    if (closed) return;
    onReceive(format(frame), frame);
    if (!pending?.accept) return;
    try {
      const result = pending.accept(frame);
      if (result !== undefined) {
        pending.accept = null;
        pending.resolve(result);
      }
    } catch (error) {
      pending.accept = null;
      pending.reject(error);
    }
  });
  async function close(message = "设备已断开。") {
    closed = true;
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
    link = await config.open({ receive, lost });
  } else {
    if (!Object.hasOwn(openers, kind)) throw new Error("连接方式缺少 open 回调。");
    link = await openers[kind](config, receive, lost);
  }
  if (closed) {
    await close();
    throw new Error("连接建立时设备已断开。");
  }

  async function send(command) {
    if (closed) throw new Error("设备已断开。");
    onSend(format(command).trim());
    await link.write(codec.encode(command));
  }

  return {
    name: link.name,
    send,
    async ask(command, accept, signal, timeout = 1100) {
      if (pending) throw new Error("上一条命令仍在等待回执。");
      signal.throwIfAborted();
      let timer;
      const answer = new Promise((resolve, reject) => { pending = { accept, resolve, reject }; });
      void answer.catch(() => {});
      const abort = () => {
        pending.accept = null;
        pending.reject(signal.reason);
      };
      signal.addEventListener("abort", abort, { once: true });
      try {
        if (command != null) await send(command);
        timer = setTimeout(() => pending?.reject(new Error("等待回执超时。")), timeout);
        const result = await answer;
        signal.throwIfAborted();
        return result;
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        pending = undefined;
      }
    },
    close,
  };
}
