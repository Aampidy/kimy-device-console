const languageKey = "device-console.language";

const english = new Map(Object.entries({
  "界面主题": "Theme",
  "浅色": "Light",
  "深色": "Dark",
  "语言": "Language",
  "连接与侧栏": "Connection and panels",
  "连接设备": "Connect device",
  "项目适配器": "Device profile",
  "连接方式": "Transport",
  "采集记录": "Capture",
  "开始采集": "Start capture",
  "停止采集": "Stop capture",
  "正在保存…": "Saving…",
  "重试保存": "Retry save",
  "项目面板": "Device panels",
  "采集时间": "Capture time",
  "暂停画面": "Pause display",
  "回到实时": "Return to live",
  "跳到末尾": "Jump to latest",
  "设备地址": "Device address",
  "设备端口": "Device port",
  "IP 或主机名": "IP address or hostname",
  "串口（USB / COM / 蓝牙 SPP）": "Serial port (USB / COM / Bluetooth SPP)",
  "波特率": "Baud rate",
  "低功耗蓝牙（BLE）": "Bluetooth Low Energy (BLE)",
  "高级设置": "Advanced settings",
  "服务 UUID": "Service UUID",
  "写入特征 UUID": "Write characteristic UUID",
  "通知特征 UUID": "Notify characteristic UUID",
  "本地端口（可选）": "Local port (optional)",
  "WebSocket 地址": "WebSocket address",
  "扫描并连接": "Scan and connect",
  "选择并连接串口": "Select serial port",
  "断开连接": "Disconnect",
  "正在断开…": "Disconnecting…",
  "连接中…": "Connecting…",
  "已连接": "Connected",
  "未连接": "Disconnected",
  "已连接 ·": "Connected ·",
  "未连接 ·": "Disconnected ·",
  "等待连接": "Waiting for connection",
  "等待设备状态": "Waiting for device status",
  "等待采样": "Waiting for capture",
  "等待采集": "Waiting for capture",
  "等待采样数据": "Waiting for sample data",
  "连接设备后可开始采集。": "Connect a device to start capturing.",
  "显示曲线": "Show curves",
  "全部曲线": "All curves",
  "误差": "Error",
  "这段时间暂无有效采样": "No valid samples in this interval",
  "设备未提供采样数据": "The device did not provide sample data",
  "采集中": "Recording",
  "正在采集。": "Capture in progress.",
  "正在记录设备报文。": "Recording device messages.",
  "本轮没有记录。": "No records in this capture.",
  "已保存本轮记录": "Capture saved",
  "本轮记录可下载": "Capture is ready to download",
  "报文日志": "Message log",
  "曲线 CSV": "Plot CSV",
  "帧": "frames",
  "更新于": "Updated at",
  "连接已断开": "Disconnected",
  "设备连接已断开。": "Device disconnected.",
  "连接已取消。": "Connection canceled.",
  "正在连接": "Connecting",
  "状态回执待确认": "Status response pending confirmation",
  "设备状态待确认。": "Device state is awaiting confirmation.",
  "等待设备确认。": "Waiting for device confirmation.",
  "操作已完成。": "Operation complete.",
  "发送命令": "Send command",
  "发送": "Send",
  "接收": "Receive",
  "事件": "Event",
  "按住": "Pressed",
  "松开": "Released",
  "常开触点": "Normally open contact",
  "发送格式": "Send format",
  "格式": "Format",
  "文本": "Text",
  "十六进制": "Hexadecimal",
  "结束符": "Line ending",
  "串口结束符": "Serial line ending",
  "不追加": "None",
  "串口或设备命令": "Serial or device command",
  "输入一条设备命令": "Enter a device command",
  "输入一条串口指令": "Enter a serial command",
  "例如 50 49 4E 47": "Example: 50 49 4E 47",
  "复制接收内容": "Copy received data",
  "串口调试与报文": "Serial debug and messages",
  "最近收发报文": "Recent messages",
  "已复制": "Copied",
  "复制失败，可手动选中报文复制。": "Copy failed. Select and copy the messages manually.",
  "十六进制指令需由偶数个十六进制字符组成。": "Hex commands must contain an even number of hexadecimal characters.",
  "指令已提交。": "Command submitted.",
  "当前连接不可发送。": "The current connection cannot send data.",
  "读取设备": "Read device",
  "撤销修改": "Undo changes",
  "应用修改": "Apply changes",
  "参数": "Parameter",
  "设备值": "Device value",
  "新值": "New value",
  "待确认": "Pending",
  "已修改": "Modified",
  "设备告警": "Device alarms",
  "当前无告警": "No active alarms",
  "严重": "Critical",
  "警告": "Warning",
  "提示": "Info",
  "已恢复": "Recovered",
  "已确认": "Acknowledged",
  "未确认": "Unacknowledged",
  "确认": "Acknowledge",
  "确认告警": "Acknowledge alarm",
  "读取设备参数": "Read device parameters",
  "正在读取设备…": "Reading device…",
  "已更新设备值。": "Device values updated.",
  "应用参数修改": "Apply parameter changes",
  "正在写入并回读…": "Writing and reading back…",
  "修改已应用。": "Changes applied.",
  "以设备回读值为准。": "Device readback values are shown.",
  "通信诊断": "Communication diagnostics",
  "连接": "Connection",
  "接收字节": "Bytes received",
  "发送字节": "Bytes sent",
  "接收帧": "Frames received",
  "发送帧": "Frames sent",
  "最近响应": "Last response",
  "平均响应": "Average response",
  "超时": "Timeouts",
  "解析错误": "Parse errors",
  "写入失败": "Write failures",
  "控制面板": "Controls",
  "PID 曲线": "PID plots",
  "图表": "Charts",
  "设备状态": "Device status",
  "是": "Yes",
  "否": "No",
  "点选坐标点或线段": "Select a point or line",
  "图片加载失败": "Image failed to load",
  "点 ": "Point ",
  "线 ": "Line ",
  "电机台架示例": "Motor bench example",
  "模拟电机台架": "Simulated motor bench",
  "本地模拟": "Local simulation",
  "转速环": "Speed loop",
  "电流环": "Current loop",
  "实际负载": "Measured load",
  "负载": "Load",
  "绕组温度": "Winding temperature",
  "温度": "Temperature",
  "调参": "Tuning",
  "目标转速": "Speed setpoint",
  "目标负载": "Load setpoint",
  "电流上限": "Current limit",
  "温度上限": "Temperature limit",
  "台架控制": "Bench controls",
  "启动并采集": "Start and capture",
  "优先停止": "Priority stop",
  "常开加载": "Normally open load",
  "常闭联锁": "Normally closed interlock",
  "低速点动": "Low-speed jog",
  "冷却风扇": "Cooling fan",
  "设备读数": "Device readings",
  "实测转速": "Measured speed",
  "实测电流": "Measured current",
  "采样与设定": "Samples and setpoints",
  "本帧目标转速": "Frame speed setpoint",
  "本帧实际负载": "Frame measured load",
  "设备当前设定转速": "Device speed setpoint",
  "设备当前设定负载": "Device load setpoint",
  "工况与台架": "Operating point and bench",
  "转速与负载工况": "Speed and load operating point",
  "转速（rpm）": "Speed (rpm)",
  "负载（%）": "Load (%)",
  "实测": "Measured",
  "低速": "Low speed",
  "额定": "Rated",
  "高速": "High speed",
  "50% 负载线": "50% load line",
  "载入文件预设": "Load file preset",
  "电机台架示意图": "Motor bench diagram",
  "电机、联轴器和负载器安装在同一底座上": "Motor, coupling, and load are mounted on a shared base",
  "控制与回传": "Control and feedback",
  "控制台经驱动器控制电机，电机反馈转速与电流": "The console controls the motor through a drive, and the motor returns speed and current",
  "控制台": "Console",
  "驱动器": "Drive",
  "电机": "Motor",
  "转速和电流回传": "Speed and current feedback",
  "电机已启动。": "Motor started.",
  "电机已停止。": "Motor stopped.",
  "告警已确认。": "Alarm acknowledged.",
  "配置已写入并回读。": "Configuration written and read back.",
  "命令已发送。": "Command sent.",
  "正在读取工况预设…": "Reading operating-point preset…",
  "电流过高": "Overcurrent",
  "绕组温度偏高": "Winding temperature high",
  "已确认告警 ": "Acknowledged alarm ",
  "接收时间": "Received at",
  "设备": "Device",
  "时间段": "Segment",
  "回执时刻_ms": "Received tick_ms",
  "控制时刻_ms": "Control tick_ms",
  "曲线时间_ms": "Plot time_ms",
  "控制环": "Control loop",
  "单位": "Unit",
  "有效": "Valid",
  "目标": "Target",
  "适配器": "Adapter",
  "串口设备": "Serial device",
  "蓝牙串口": "Bluetooth serial",
  "BLE 设备": "BLE device",
  "点动": "Jog",
  "运行": "Running",
  "停止": "Stopped",
  "闭合": "Closed",
  "断开": "Open",
  "开启": "On",
  "关闭": "Off",
  "配置值必须是数值、布尔值或文本。": "Configuration values must be numbers, booleans, or text.",
  "配置写入内容无效。": "Configuration payload is invalid.",
  "设置值无效。": "Setting value is invalid.",
  "未知设备参数。": "Unknown device parameter.",
  "请闭合联锁并松开点动按键。": "Close the interlock and release the jog control.",
  "点动需要先停止电机并闭合联锁。": "Stop the motor and close the interlock before jogging.",
  "工况超出设定范围。": "Operating point is outside the configured range.",
  "未知命令。可输入 PING、STATUS 或 READ。": "Unknown command. Enter PING, STATUS, or READ.",
  "命令缺少 op 字段。": "Command is missing the op field.",
  "JSON 报文格式错误。": "Invalid JSON message.",
  "素材路径无效。": "Asset path is invalid.",
  "找不到该素材。": "Asset not found.",
  "单次保存超过 64 MiB。": "A single save exceeds 64 MiB.",
  "缺少日志内容。": "Log content is missing.",
  "请通过本机网址打开。": "Open the console through its local address.",
  "请从本地界面连接设备。": "Connect the device from the local console.",
  "请从控制台保存。": "Save from the console.",
  "找不到该资源。": "Resource not found.",
  "找不到请求的文件。": "Requested file not found.",
  "请用桌面版 Chrome 或 Edge 打开本地网址。": "Open the local address in desktop Chrome or Edge.",
  "当前浏览器无法访问 BLE。": "This browser cannot access Bluetooth Low Energy.",
  "当前浏览器无法访问 BLE。请用桌面版 Chrome 或 Edge 打开本地网址。": "This browser cannot access Bluetooth Low Energy. Open the local address in desktop Chrome or Edge.",
  "当前浏览器无法访问串口。": "This browser cannot access serial ports.",
  "当前浏览器无法访问串口。请用桌面版 Chrome 或 Edge 打开本地网址。": "This browser cannot access serial ports. Open the local address in desktop Chrome or Edge.",
  "适配器的 BLE 分包长度必须为正整数。": "The adapter BLE chunk size must be a positive integer.",
  "请填齐三个蓝牙 UUID，或全部留空以自动匹配。": "Enter all three Bluetooth UUIDs, or leave all blank for automatic matching.",
  "蓝牙连接已断开。": "Bluetooth disconnected.",
  "未识别此设备的蓝牙收发服务。可在高级设置中填写设备的 UUID。": "Could not identify this device's Bluetooth service. Enter its UUIDs in Advanced settings.",
  "串口已断开。": "Serial port disconnected.",
  "串口读取失败。": "Serial read failed.",
  "请填写 WebSocket 地址。": "Enter a WebSocket address.",
  "WebSocket 连接失败。": "WebSocket connection failed.",
  "WebSocket 连接超时。": "WebSocket connection timed out.",
  "WebSocket 连接已断开。": "WebSocket disconnected.",
  "网络报文未接收完整。": "Network message was incomplete.",
  "本地服务未建立网络连接。": "The local service did not establish a network connection.",
  "设备已断开。": "Device disconnected.",
  "当前页面未提供 TCP / UDP 连接服务。": "TCP / UDP transport is unavailable on this page.",
  "连接方式缺少 open 回调。": "Transport is missing its open callback.",
  "请先松开按键。": "Release the control first.",
  "请先停止设备。": "Stop the device first.",
  "设备状态回读必须包含 values 对象。": "Device status readback must include a values object.",
  "提供 write 回调的适配器必须在 status 回读中返回 values 对象。": "An adapter with a write callback must return a values object from status readback.",
  "配置写入失败。状态回读也失败。": "Configuration write and status readback both failed.",
  "控件": "Control",
  "优先停止使用普通按钮。": "Priority stop must use a standard button.",
  "未知按键类型": "Unknown control type",
  "请至少注册一个项目适配器。": "Register at least one device profile.",
  "当前页面未提供配置文件读取功能。": "This page does not provide profile file access.",
  "配置回读需要适配器提供 status 回调。": "Configuration readback requires a status callback from the adapter.",
  "配置写入需要适配器提供 write 和 status 回调。": "Configuration writes require write and status callbacks from the adapter.",
  "连接建立时设备已断开。": "The device disconnected while establishing the connection.",
  "原始报文必须是 Uint8Array。": "Raw messages must be Uint8Array values.",
  "上一条命令仍在等待回执。": "The previous command is still awaiting a response.",
  "等待回执超时。": "Timed out waiting for a response.",
  "采样时间应为 32 位无符号毫秒数。": "Sample time must be an unsigned 32-bit millisecond value.",
  "采样缺少 points。": "Sample is missing points.",
  "控制时刻无效。": "Control timestamp is invalid.",
  "曲线时间（s）": "Plot time (s)",
  "采集时间（s）": "Capture time (s)",
}));

const patterns = [
  [/^(\d+(?:\.\d+)?) 秒窗口$/, (_match, seconds) => `${seconds} s window`],
  [/^(\d+(?:\.\d+)?) 秒$/, (_match, seconds) => `${seconds} seconds`],
  [/^(\d+(?:\.\d+)?) \/ (\d+(?:\.\d+)?) 秒$/, (_match, current, latest) => `${current} / ${latest} s`],
  [/^(.+)（(.+)）$/, (_match, label, unit) => `${translate(label)} (${translate(unit)})`],
  [/^(.+)曲线$/, (_match, label) => `${translate(label)} plot`],
  [/^(.+)环$/, (_match, label) => `${translate(label)} loop`],
  [/^(.+)新值$/, (_match, label) => `${translate(label)} new value`],
  [/^(.+?)\s{2}(\(-?[\d.eE+]+,\s*-?[\d.eE+]+\))$/, (_match, label, point) => `${translate(label)}  ${point}`],
  [/^点 (\d+)$/, (_match, index) => `Point ${index}`],
  [/^线 (\d+)$/, (_match, index) => `Line ${index}`],
  [/^已确认告警 (.+)$/, (_match, code) => `Acknowledged alarm ${code}`],
  [/^(按住|松开) · 待确认$/, (_match, action) => `${translate(action)} · Pending`],
  [/^应用 (\d+) 项修改$/, (_match, count) => `Apply ${count} change${count === "1" ? "" : "s"}`],
  [/^采集中 · (\d+) 帧$/, (_match, count) => `Recording · ${count} frame${count === "1" ? "" : "s"}`],
  [/^已保存本轮记录 · (\d+) 帧$/, (_match, count) => `Capture saved · ${count} frame${count === "1" ? "" : "s"}`],
  [/^更新于 (.+)$/, (_match, time) => `Updated at ${time}`],
  [/^已连接 · (.+)$/, (_match, name) => `Connected · ${translate(name)}`],
  [/^未连接 · (.+)$/, (_match, name) => `Disconnected · ${translate(name)}`],
  [/^正在(.+)…$/, (_match, action) => `Working: ${translate(action)}…`],
  [/^已设定 (.+) rpm \/ (.+)% 负载。$/, (_match, speed, load) => `Set to ${speed} rpm / ${load}% load.`],
  [/^(.+) (A|°C)，阈值 (.+) \2$/, (_match, value, unit, limit) => `${value} ${unit}, limit ${limit} ${unit}`],
  [/^串口读取失败。 (.+)$/, (_match, message) => `Serial read failed. ${translate(message)}`],
  [/^(.+) 连接已断开。$/, (_match, name) => `${translate(name)} disconnected.`],
  [/^(.+) 读取失败。 (.+)$/, (_match, name, message) => `${translate(name)} read failed. ${translate(message)}`],
  [/^本地网络服务返回 (\d+)$/, (_match, status) => `Local network service returned ${status}`],
  [/^正在(.+)，请稍候。$/, (_match, action) => `Working: ${translate(action)}. Please wait.`],
  [/^采样失败。 (.+)$/, (_match, message) => `Sampling failed. ${translate(message)}`],
  [/^报文解析失败。 (.+)$/, (_match, message) => `Message parsing failed. ${translate(message)}`],
  [/^写入日志失败。 (.+)$/, (_match, message) => `Failed to save the log. ${translate(message)}`],
  [/^设备状态回读未包含配置项 (.+)。$/, (_match, keys) => `Device readback did not include configuration keys ${keys}.`],
  [/^配置写入失败。状态回读也失败。 (.+) (.+)$/, (_match, writeError, readError) =>
    `Configuration write and status readback both failed. ${translate(writeError)} ${translate(readError)}`],
  [/^(.+)以设备回读值为准。$/, (_match, labels) =>
    `${labels.split("、").map(translate).join(", ")}. Device readback values are shown.`],
  [/^控件 (.+) 需要 run 回调，(优先停止使用普通按钮。)$/, (_match, id, message) => `${translate("控件")} ${id} requires a run callback. ${translate(message)}`],
  [/^未知按键类型 (.+)$/, (_match, type) => `Unknown control type ${type}`],
  [/^滑块 (.+) 的范围、初值或方向无效。$/, (_match, id) => `Slider ${id} has an invalid range, initial value, or orientation.`],
  [/^图表 (.+) 的类型或范围无效。$/, (_match, id) => `Chart ${id} has an invalid type or range.`],
];

function translate(value) {
  if (/^(发送|接收|事件)  /.test(value)) {
    return value.split("\n").map((line) => {
      const match = line.match(/^(发送|接收|事件)(  .*)$/);
      return match ? translate(match[1]) + match[2] : line;
    }).join("\n");
  }
  if (english.has(value)) return english.get(value);
  for (const [pattern, replacement] of patterns) {
    const match = value.match(pattern);
    if (match) return replacement(...match);
  }
  return value;
}

export function createLocalization(document, root) {
  const view = document.defaultView;
  let locale = "en";
  try {
    if (view.localStorage.getItem(languageKey) === "zh-CN") locale = "zh-CN";
  } catch { /* 存储不可用时仍可在当前页面切换语言。 */ }

  const textState = new WeakMap();
  const attributeState = new WeakMap();
  const listeners = new Set();
  const attributeNames = ["aria-description", "aria-label", "aria-valuetext", "alt", "placeholder", "title"];

  function localized(value) {
    return locale === "en" ? translate(value) : value;
  }

  function updateText(node) {
    if (!node.data.trim()) return;
    let state = textState.get(node);
    if (!state) state = { source: node.data };
    else if (node.data !== state.translated) state.source = node.data;
    const next = localized(state.source);
    state.translated = next;
    textState.set(node, state);
    if (node.data !== next) node.data = next;
  }

  function updateAttribute(node, name) {
    const value = node.getAttribute(name);
    if (value == null || !value.trim()) return;
    let state = attributeState.get(node);
    if (!state) {
      state = new Map();
      attributeState.set(node, state);
    }
    let entry = state.get(name);
    if (!entry) entry = { source: value };
    else if (value !== entry.translated) entry.source = value;
    const next = localized(entry.source);
    entry.translated = next;
    state.set(name, entry);
    if (value !== next) node.setAttribute(name, next);
  }

  function updateElement(element) {
    function updateNode(node) {
      if (node.nodeType === 1) {
        for (const name of attributeNames) updateAttribute(node, name);
      } else if (node.nodeType === 3) {
        updateText(node);
      }
    }
    updateNode(element);
    const walker = document.createTreeWalker(element, view.NodeFilter.SHOW_ELEMENT | view.NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) updateNode(node);
  }

  const observer = new view.MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "characterData") updateText(record.target);
      else if (record.type === "attributes") updateAttribute(record.target, record.attributeName);
      else for (const node of record.addedNodes) {
        if (node.nodeType === 1) updateElement(node);
        else if (node.nodeType === 3) updateText(node);
      }
    }
  });
  observer.observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: attributeNames,
  });

  function setLocale(value) {
    if (value !== "en" && value !== "zh-CN") return;
    locale = value;
    document.documentElement.lang = locale;
    try { view.localStorage.setItem(languageKey, locale); } catch { /* 页面内切换仍然有效。 */ }
    updateElement(root);
    for (const listener of listeners) listener(locale);
  }

  updateElement(root);
  document.documentElement.lang = locale;

  return {
    get locale() { return locale; },
    translate: localized,
    setLocale,
    dispose() {
      observer.disconnect();
      listeners.clear();
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
