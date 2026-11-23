import { textLines } from "../lib/transport.mjs";

const speedRange = { min: 0, max: 3000, step: 50, initial: 1200 };
const loadRange = { min: 0, max: 100, step: 5, initial: 30 };
const currentLimitRange = { min: 0.5, max: 4, step: 0.1, initial: 1.8 };
const temperatureLimitRange = { min: 25, max: 80, step: 1, initial: 35 };
const released = { loadPulse: false, interlock: true, jog: false };
const within = (value, { min, max, step }) =>
  Number.isInteger(value) && value >= min && value <= max && (value - min) % step === 0;
const withinDecimal = (value, { min, max, step }) =>
  Number.isFinite(value) && value >= min && value <= max &&
  Math.abs((value - min) / step - Math.round((value - min) / step)) < 1e-8;
const isSwitch = (value) => typeof value === "boolean";
const settings = {
  speedSetpoint: (value) => within(value, speedRange),
  loadSetpoint: (value) => within(value, loadRange),
  currentLimit: (value) => withinDecimal(value, currentLimitRange),
  temperatureLimit: (value) => within(value, temperatureLimitRange),
  loadPulse: isSwitch, interlock: isSwitch, jog: isSwitch, fan: isSwitch,
};

// 模拟设备和控制台共用同一套 JSON 行协议。
const codec = {
  encode: (frame) => textLines.encode(JSON.stringify(frame)),
  decoder: (emit) => textLines.decoder((line) => {
    let frame;
    try {
      frame = JSON.parse(line);
    } catch {
      frame = { error: "JSON 报文格式错误。", malformed: true };
    }
    emit(frame);
  }),
  format: (frame) => JSON.stringify(frame),
};

function openSimulation({ receive }) {
  const state = {
    speedSetpoint: speedRange.initial, loadSetpoint: loadRange.initial,
    currentLimit: currentLimitRange.initial, temperatureLimit: temperatureLimitRange.initial,
    running: false, fan: false, ...released,
  };
  const startedAt = performance.now();
  let updatedAt = startedAt;
  let speed = 0;
  let current = 0;
  let load = state.loadSetpoint;
  let temperature = 24;
  const reply = (frame) => receive(codec.encode(frame));

  function advance() {
    const now = performance.now();
    const elapsed = (now - updatedAt) / 1000;
    updatedAt = now;
    const follow = (value, target, seconds) => value + (target - value) * (1 - Math.exp(-elapsed / seconds));
    const targetSpeed = state.jog ? 400 : state.running ? state.speedSetpoint : 0;
    const targetLoad = Math.min(loadRange.max, state.loadSetpoint + (state.loadPulse ? 25 : 0));
    load = follow(load, targetLoad, 0.25);
    const targetCurrent = targetSpeed > 0 ? 0.2 + targetSpeed / speedRange.max + targetLoad * 0.025 : 0;
    speed = follow(speed, targetSpeed, 0.45);
    current = follow(current, targetCurrent, 0.2);
    temperature = follow(temperature, 24 + current * (state.fan ? 2.5 : 6), 5);
    return {
      tick: Math.round(now - startedAt) >>> 0,
      points: {
        speed: { target: targetSpeed, actual: Number(speed.toFixed(1)) },
        current: { target: Number(targetCurrent.toFixed(3)), actual: Number(current.toFixed(3)) },
        load: { value: Number(load.toFixed(1)) },
        temperature: { value: Number(temperature.toFixed(2)) },
      },
    };
  }

  function handle({ op, key, value, speed, load, values: changes }) {
    // 先按上一条指令推进模型，再修改设定。
    const sample = advance();
    switch (op) {
      case "ping": return { message: "PONG" };
      case "status": return { state };
      case "read": return { sample };
      case "read-param":
        if (!Object.hasOwn(settings, key)) throw new Error("未知设备参数。");
        return { values: { [key]: state[key] } };
      case "ack-alarm": return { acknowledged: key };
      case "start":
        if (!state.interlock || state.jog) throw new Error("请闭合联锁并松开点动按键。");
        state.running = true;
        break;
      case "stop":
        Object.assign(state, released, { running: false });
        break;
      case "set":
        if (!Object.hasOwn(settings, key) || !settings[key](value)) throw new Error("设置值无效。");
        if (key === "jog" && value && (state.running || !state.interlock)) {
          throw new Error("点动需要先停止电机并闭合联锁。");
        }
        state[key] = value;
        if (!state.interlock) Object.assign(state, { running: false, jog: false });
        break;
      case "configure":
        if (!changes || typeof changes !== "object" || Array.isArray(changes) || !Object.keys(changes).length) {
          throw new Error("配置写入内容无效。");
        }
        for (const [name, next] of Object.entries(changes)) {
          if (!Object.hasOwn(settings, name) || !settings[name](next)) throw new Error("设置值无效。");
        }
        if (changes.jog && (state.running || !state.interlock || changes.interlock === false)) {
          throw new Error("点动需要先停止电机并闭合联锁。");
        }
        Object.assign(state, changes);
        if (!state.interlock) Object.assign(state, { running: false, jog: false });
        return { values: changes };
      case "setpoint":
        if (!settings.speedSetpoint(speed) || !settings.loadSetpoint(load)) throw new Error("工况超出设定范围。");
        const values = { speedSetpoint: speed, loadSetpoint: load };
        Object.assign(state, values);
        return { values };
      default:
        throw new Error("未知命令。可输入 PING、STATUS 或 READ。");
    }
    reply({ state });
    return { value: state[key] };
  }

  const write = codec.decoder((command) => {
    const id = command?.id;
    let response;
    try {
      if (typeof command?.op !== "string") throw new Error("命令缺少 op 字段。");
      response = handle(command);
    } catch (error) {
      response = { error: error.message };
    }
    reply({ id, ...response });
  });
  return { name: "模拟电机台架", write, close() {} };
}

function request({ ask, memory }, command) {
  // 请求编号使被取消操作的迟到回执不会匹配下一条请求。
  const id = memory.requestId = (memory.requestId ?? 0) + 1;
  return ask({ ...command, id }, (frame) => {
    if (frame?.id !== id) return;
    if (frame.error) throw new Error(frame.error);
    return frame;
  });
}

function describeState(state) {
  return {
    values: state,
    running: state.running || state.jog,
    rows: [
      ["电机", state.jog ? "点动" : state.running ? "运行" : "停止"],
      ["常开触点", state.loadPulse ? "闭合" : "断开"],
      ["常闭联锁", state.interlock ? "闭合" : "断开"],
      ["冷却风扇", state.fan ? "开启" : "关闭"],
    ],
  };
}

const setValue = (key) => (api, value) => api.configure({ [key]: value });
async function writeSettings(api, values) {
  await request(api, { op: "configure", values });
}

async function acknowledgeAlarm(api, alarm) {
  await request(api, { op: "ack-alarm", key: alarm.id });
  api.publish({
    alarms: (api.values.alarms ?? []).map((item) =>
      item.id === alarm.id ? { ...item, acknowledged: true } : item),
  });
  api.log("已确认告警 " + alarm.code);
  return "告警已确认。";
}

function updateAlarms(api, sample) {
  const current = sample.points.current.actual;
  const temperature = sample.points.temperature.value;
  const old = new Map((api.values.alarms ?? []).map((alarm) => [alarm.id, alarm]));
  const conditions = [
    {
      id: "overcurrent", code: "OC-01", label: "电流过高", severity: "critical",
      value: current, limit: api.values.currentLimit ?? currentLimitRange.initial, unit: "A",
    },
    {
      id: "overtemperature", code: "OT-01", label: "绕组温度偏高", severity: "warning",
      value: temperature, limit: api.values.temperatureLimit ?? temperatureLimitRange.initial, unit: "°C",
    },
  ];
  const next = new Map(old);
  for (const condition of conditions) {
    const previous = old.get(condition.id);
    if (condition.value >= condition.limit) {
      next.set(condition.id, {
        id: condition.id,
        code: condition.code,
        label: condition.label,
        severity: condition.severity,
        limit: condition.limit,
        message: previous?.active && previous.limit === condition.limit ? previous.message :
          condition.value.toFixed(1) + " " + condition.unit + "，阈值 " + condition.limit + " " + condition.unit,
        timestamp: previous?.active ? previous.timestamp : Date.now(),
        active: true,
        acknowledged: previous?.active ? previous.acknowledged : false,
      });
    } else if (previous?.active) {
      next.set(condition.id, { ...previous, active: false, recoveredAt: Date.now() });
    }
  }
  api.publish({ alarms: [...next.values()].slice(-20) });
}

const canStart = ({ interlock, running, jog }) => interlock && !running && !jog;

async function applySetpoint(api, speed, load) {
  const values = await api.configure({ speedSetpoint: speed, loadSetpoint: load });
  const message = "已设定 " + values.speedSetpoint + " rpm / " + values.loadSetpoint + "% 负载。";
  api.log(message);
  return message;
}

function chooseOperatingPoint(api, { x, y }) {
  const speed = Math.round(x / speedRange.step) * speedRange.step;
  const load = Math.round(y / loadRange.step) * loadRange.step;
  return applySetpoint(api, speed, load);
}

const measuredSpeed = { channel: "speed", series: "actual" };
const measuredCurrent = { channel: "current", series: "actual" };
const measuredLoad = { channel: "load", series: "value" };
const measuredTemperature = { channel: "temperature", series: "value" };

export const adapters = {
  example: {
    label: "电机台架示例",
    codec,
    write: writeSettings,
    transports: {
      simulation: { label: "本地模拟", open: openSimulation },
      // 内置连接可在面板中填写参数。以下配置可用来预填。
      // serial: { baudRate: 115200 },
      // tcp: { host: "127.0.0.1", port: 9000 },
      // udp: { host: "127.0.0.1", port: 9001, localPort: 9002 },
      // websocket: { url: "ws://127.0.0.1:8080" },
    },
    files: { preset: "adapters/assets/motor-preset.json" },
    channels: {
      speed: { label: "转速环", unit: "rpm" },
      current: { label: "电流环", unit: "A" },
      load: { label: "实际负载", unit: "%", series: { value: { label: "负载" } } },
      temperature: { label: "绕组温度", unit: "°C", series: { value: { label: "温度" } } },
    },
    modules: {
      tuning: {
        type: "parameters", label: "调参",
        parameters: [
          { key: "speedSetpoint", label: "目标转速", ...speedRange, unit: "rpm" },
          { key: "loadSetpoint", label: "目标负载", ...loadRange, unit: "%" },
          { key: "currentLimit", label: "电流上限", ...currentLimitRange, unit: "A" },
          { key: "temperatureLimit", label: "温度上限", ...temperatureLimitRange, unit: "°C" },
        ],
      },
      // 两张 PID 曲线各自采样，读数与工况点引用对应通道。
      speed: { type: "curve", windowMs: 10000 },
      current: { type: "curve", series: { target: {}, actual: { color: "var(--plot-blue)" } } },
    },
    panels: [
      {
        label: "台架控制", position: "sidebar", columns: 2,
        modules: {
          start: {
            type: "button", label: "启动并采集", motion: true, record: true, enabledWhen: canStart,
            async run(api) {
              await request(api, { op: "start" });
              return "电机已启动。";
            },
          },
          stop: {
            type: "button", label: "优先停止", stop: true,
            async run(api) {
              await request(api, { op: "stop" });
              api.log("电机已停止。");
              return "电机已停止。";
            },
          },
          loadPulse: { type: "normally-open", label: "常开加载", run: setValue("loadPulse") },
          interlock: { type: "normally-closed", label: "常闭联锁", run: setValue("interlock") },
          jog: {
            type: "momentary", label: "低速点动", motion: true, enabledWhen: canStart, run: setValue("jog"),
          },
          fan: { type: "toggle", label: "冷却风扇", initial: false, run: setValue("fan") },
          // 滑块、调参组件、工况点和文件预设共用设备的转速与负载设定。
          speedSlider: {
            type: "slider", label: "目标转速", bind: "speedSetpoint", unit: "rpm",
            ...speedRange, run: setValue("speedSetpoint"),
          },
          loadSlider: {
            type: "slider", label: "目标负载", bind: "loadSetpoint", unit: "%",
            ...loadRange, run: setValue("loadSetpoint"),
          },
        },
      },
      { label: "PID 曲线", modules: ["tuning", "speed", "current"] },
      {
        label: "设备读数", columns: 3, mobileColumns: 3,
        modules: {
          speedReading: { type: "value", label: "实测转速", source: measuredSpeed, unit: "rpm" },
          currentBar: { type: "bar", label: "实测电流", source: measuredCurrent, max: 4, unit: "A" },
          temperature: { type: "value", label: "绕组温度", source: measuredTemperature, unit: "°C" },
          measurements: {
            type: "table", label: "采样与设定",
            rows: [
              { label: "本帧目标转速", source: { channel: "speed", series: "target" }, unit: "rpm" },
              { label: "本帧实际负载", source: measuredLoad, unit: "%" },
              { label: "设备当前设定转速", source: "speedSetpoint", unit: "rpm" },
              { label: "设备当前设定负载", source: "loadSetpoint", unit: "%" },
            ],
          },
        },
      },
      {
        label: "工况与台架", columns: 2, mobileColumns: 1,
        modules: {
          operatingPoint: {
            type: "xy", label: "转速与负载工况",
            x: { label: "转速（rpm）", min: -100, max: 3200 },
            y: { label: "负载（%）", min: -5, max: 105 },
            style: {
              height: 280, background: "var(--surface-raised)",
              gridColor: "var(--line)", selectionColor: "var(--selection)",
            },
            points: [
              { id: "actual", label: "实测", x: measuredSpeed, y: measuredLoad, color: "var(--plot-actual)", radius: 6 },
              { id: "low", label: "低速", x: 600, y: 15, run: chooseOperatingPoint },
              { id: "rated", label: "额定", x: 1800, y: 65, run: chooseOperatingPoint },
              { id: "high", label: "高速", x: 2700, y: 85, run: chooseOperatingPoint },
            ],
            lines: [{
              id: "half-load", label: "50% 负载线", points: [[300, 50], [2800, 50]],
              color: "var(--plot-violet)", strokeWidth: 2, run: chooseOperatingPoint,
            }],
          },
          preset: {
            type: "button", label: "载入文件预设", wide: true,
            async run(api) {
              api.progress("正在读取工况预设…");
              const files = await api.sources();
              const { speed, load } = JSON.parse(files.preset);
              return applySetpoint(api, speed, load);
            },
          },
          bench: {
            type: "image", label: "电机台架示意图", alt: "电机、联轴器和负载器安装在同一底座上",
            src: new URL("./assets/motor-bench.jpg", import.meta.url).href,
            style: { height: 176, background: "var(--surface-raised)" },
          },
          wiring: {
            type: "svg", label: "控制与回传", alt: "控制台经驱动器控制电机，电机反馈转速与电流",
            style: { height: 176, background: "var(--surface-raised)", color: "var(--plot-actual)" },
            markup: [
              '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 330 120">',
              '  <g fill="none" stroke="#222" stroke-width="2" stroke-linejoin="round">',
              '    <path d="M8 25h80v38H8z M125 25h80v38h-80z M242 25h80v38h-80z"/>',
              '    <path d="M88 44h37m-8-5 8 5-8 5 M205 44h37m-8-5 8 5-8 5 M282 63v28H48V63m-5 8 5-8 5 8"/>',
              '  </g>',
              '  <g fill="#222" font-family="system-ui, sans-serif" font-size="14" text-anchor="middle">',
              '    <text x="48" y="49">控制台</text><text x="165" y="49">驱动器</text><text x="282" y="49">电机</text>',
              '    <text x="165" y="111">转速和电流回传</text>',
              '  </g>',
              '</svg>',
            ].join("\n"),
          },
        },
      },
      {
        position: "footer", columns: 2,
        modules: {
          status: { type: "status", wide: false },
          alarms: { type: "alarms", label: "设备告警", source: "alarms", wide: false, acknowledge: acknowledgeAlarm },
          diagnostics: { type: "diagnostics" },
          console: { type: "console" },
        },
      },
    ],
    status: async (api) => describeState((await request(api, { op: "status" })).state),
    async sample(api) {
      const sample = (await request(api, { op: "read" })).sample;
      updateAlarms(api, sample);
      return sample;
    },
    onFrame(frame) {
      if (!frame || frame.id !== undefined) return;
      if (frame.malformed) throw new Error(frame.error);
      if (frame.state) return { status: describeState(frame.state) };
      if (frame.sample) return { sample: frame.sample };
      if (frame.values) return { values: frame.values };
    },
    async command(api, text) {
      const frame = text.startsWith("{") ? JSON.parse(text) : { op: text.toLowerCase() };
      if (typeof frame?.op !== "string") throw new Error("命令缺少 op 字段。");
      if (frame.op === "set") {
        await api.configure({ [frame.key]: frame.value });
        return "配置已写入并回读。";
      }
      if (frame.op === "setpoint") {
        await api.configure({ speedSetpoint: frame.speed, loadSetpoint: frame.load });
        return "配置已写入并回读。";
      }
      if (frame.op === "configure") {
        await api.configure(frame.values);
        return "配置已写入并回读。";
      }
      await api.send(frame);
      return "命令已发送。";
    },
  },
};
