import { formatValue } from "./telemetry.mjs";

const contacts = new Map([["normally-open", true], ["normally-closed", false], ["momentary", true]]);

export function panelsFor(adapter) {
  if (Array.isArray(adapter.panels)) return adapter.panels;
  const { controls = adapter.actions, curves = adapter.charts, charts } = adapter.panels ?? {};
  const footer = {};
  if (adapter.status || adapter.onFrame) footer.status = { type: "status", hideEmpty: true };
  if (adapter.console !== false) footer.console = { type: "console" };
  const typed = (entries, type) => Object.fromEntries(Object.entries(entries ?? {}).map(([id, spec]) => [id, { type, ...spec }]));
  return [
    { label: "控制面板", position: "sidebar", columns: 2, modules: controls },
    { label: "PID 曲线", modules: typed(curves, "curve") },
    { label: "图表", columns: 2, modules: typed(charts, "value") },
    { position: "footer", modules: footer },
  ];
}

export function definition(document, label, value) {
  const cell = document.createElement("div");
  const term = document.createElement("dt");
  const description = document.createElement("dd");
  term.textContent = label;
  description.textContent = value;
  cell.append(term, description);
  return cell;
}

function valueText(value, unit = "") {
  if (value == null || (typeof value === "number" && !Number.isFinite(value))) return "—";
  const text = typeof value === "number" ? formatValue(value) :
    value === true ? "是" : value === false ? "否" : String(value);
  return unit ? text + " " + unit : text;
}

export function controlView(document, id, spec, request) {
  const type = spec.type ?? "button";
  const hold = contacts.has(type);
  const key = type === "button" ? undefined : (spec.bind ?? id);
  const action = { ...spec, label: spec.label ?? id, key, hold };
  if (typeof spec.run !== "function" || (spec.stop && type !== "button")) {
    throw new Error("控件 " + id + " 需要 run 回调，优先停止使用普通按钮。");
  }
  if (type === "slider") return sliderView(document, id, action, request);
  if (!hold && type !== "button" && type !== "toggle") throw new Error("未知按键类型 " + type);

  const node = document.createElement("button");
  node.type = "button";
  node.dataset.module = id;
  node.textContent = action.label;
  node.classList.toggle("stop", Boolean(spec.stop));
  node.classList.toggle("wide", Boolean(spec.wide));
  const toggle = type === "toggle";
  let active = false;
  let contact;
  if (hold) {
    const pressedValue = contacts.get(type);
    contact = bindContact(node, () => request(action, pressedValue), () => request(action, !pressedValue, true));
  } else {
    node.addEventListener("click", () => request(action, toggle ? !active : undefined));
  }
  return {
    node,
    action,
    release: contact?.finish,
    update(value, enabled, held, unconfirmed) {
      node.disabled = !enabled && !held;
      if (!hold && !toggle) return;
      const pending = unconfirmed ? "待确认" : "";
      node.title = pending;
      if (hold) {
        node.dataset.held = String(Boolean(held));
        const position = held ? "按住" : "松开";
        node.setAttribute("aria-description", pending ? position + " · " + pending : position);
        if (!held) contact.clear();
      } else {
        active = Boolean(value ?? spec.initial ?? false);
        node.setAttribute("aria-pressed", String(active));
      }
    },
  };
}

function bindContact(button, press, release) {
  const document = button.ownerDocument;
  let gesture;
  function clear() {
    if (!gesture) return;
    const { listeners, pointerId } = gesture;
    gesture = undefined;
    listeners.abort();
    if (pointerId != null && button.hasPointerCapture(pointerId)) button.releasePointerCapture(pointerId);
  }
  function finish() {
    if (!gesture) return;
    clear();
    release();
  }
  function begin(event, pointerId) {
    event.preventDefault();
    if (gesture || button.disabled || !press()) return;
    const listeners = new AbortController();
    gesture = { listeners, pointerId };
    const options = { signal: listeners.signal };
    document.defaultView.addEventListener("blur", finish, options);
    document.addEventListener("visibilitychange", () => { if (document.hidden) finish(); }, options);
    if (pointerId != null) {
      button.focus({ preventScroll: true });
      button.setPointerCapture(pointerId);
      const endPointer = (event) => { if (event.pointerId === pointerId) finish(); };
      button.addEventListener("pointerup", endPointer, options);
      button.addEventListener("pointercancel", endPointer, options);
      button.addEventListener("lostpointercapture", endPointer, options);
    } else {
      button.addEventListener("blur", finish, options);
      button.addEventListener("keyup", (event) => {
        if (event.key === gesture?.key) {
          event.preventDefault();
          finish();
        }
      }, options);
      gesture.key = event.key;
    }
  }
  button.addEventListener("pointerdown", (event) => {
    if (event.button === 0) begin(event, event.pointerId);
  });
  button.addEventListener("keydown", (event) => {
    if (event.key !== " " && event.key !== "Enter") return;
    if (event.repeat) event.preventDefault();
    else begin(event);
  });
  return { clear, finish };
}

function sliderView(document, id, action, request) {
  const { min = 0, max = 100, step = 1, initial, unit, orientation = "horizontal" } = action;
  if (![min, max, step].every(Number.isFinite) || max <= min || step <= 0 ||
      (initial !== undefined && (!Number.isFinite(initial) || initial < min || initial > max)) ||
      !["horizontal", "vertical"].includes(orientation)) {
    throw new Error("滑块 " + id + " 的范围、初值或方向无效。");
  }
  const node = document.createElement("label");
  node.className = "control-slider";
  node.dataset.module = id;
  node.dataset.orientation = orientation;
  node.classList.toggle("wide", action.wide ?? orientation === "horizontal");
  const heading = document.createElement("span");
  heading.className = "slider-heading";
  const name = document.createElement("span");
  name.textContent = action.label ?? id;
  const output = document.createElement("output");
  const field = document.createElement("input");
  field.type = "range";
  field.min = min;
  field.max = max;
  field.step = step;
  field.setAttribute("aria-label", name.textContent);
  field.setAttribute("aria-orientation", orientation);
  const track = document.createElement("span");
  track.className = "slider-range";
  const lower = document.createElement("span");
  lower.textContent = formatValue(min);
  const upper = document.createElement("span");
  upper.textContent = formatValue(max);
  track.append(lower, field, upper);
  heading.append(name, output);
  node.append(heading, track);

  let confirmed = initial;
  let awaiting = false;
  let editing = false;
  function show(value, pending = false) {
    const text = valueText(value, unit) + (pending ? " · 待确认" : "");
    output.textContent = text;
    output.dataset.unconfirmed = String(pending);
    field.setAttribute("aria-valuetext", text);
  }
  function restore() {
    editing = false;
    field.value = confirmed ?? min;
    show(confirmed, awaiting);
  }
  field.addEventListener("input", () => {
    editing = true;
    show(field.valueAsNumber);
  });
  field.addEventListener("change", () => {
    const value = field.valueAsNumber;
    restore();
    request(action, value);
  });
  field.addEventListener("pointercancel", restore);
  field.addEventListener("blur", restore);
  return {
    node,
    action,
    update(value, enabled, held, unconfirmed) {
      confirmed = Number.isFinite(value) ? value : initial;
      awaiting = unconfirmed;
      field.disabled = !enabled;
      if (!editing || field.disabled) restore();
    },
  };
}

export function dataView(document, id, spec) {
  const { type = "value", label = id, unit, source, min = 0, max = 100 } = spec;
  const node = document.createElement("article");
  node.className = "data-module";
  node.dataset.module = id;
  node.classList.toggle("wide", spec.wide ?? type === "table");
  const heading = document.createElement("h3");
  heading.textContent = label;
  node.append(heading);

  if (type === "table") {
    const table = document.createElement("table");
    table.setAttribute("aria-label", label);
    const body = table.createTBody();
    const rows = spec.rows.map((row) => {
      const tr = body.insertRow();
      const th = document.createElement("th");
      th.scope = "row";
      th.textContent = row.label;
      tr.append(th);
      return { row, cell: tr.insertCell() };
    });
    node.append(table);
    return { node, update: (read) => {
      for (const { row, cell } of rows) cell.textContent = valueText(read(row.source), row.unit);
    } };
  }

  const output = document.createElement("p");
  output.className = "data-value";
  node.append(output);
  if (type === "value") return { node, update: (read) => { output.textContent = valueText(read(source), unit); } };
  if (type !== "bar" || ![min, max].every(Number.isFinite) || max <= min) {
    throw new Error("图表 " + id + " 的类型或范围无效。");
  }
  const track = document.createElement("div");
  track.className = "data-bar";
  track.setAttribute("aria-hidden", "true");
  const fill = document.createElement("span");
  track.append(fill);
  node.append(track);
  const position = (value) => 100 * (Math.min(max, Math.max(min, value)) - min) / (max - min);
  const zero = position(0);
  track.style.setProperty("--zero", zero + "%");
  return { node, update: (read) => {
    const value = read(source);
    const end = Number.isFinite(value) ? position(value) : zero;
    output.textContent = valueText(value, unit);
    fill.style.left = Math.min(zero, end) + "%";
    fill.style.width = Math.abs(end - zero) + "%";
    fill.classList.toggle("negative", end < zero);
  } };
}

export function statusView(document, spec) {
  const node = document.createElement("section");
  node.className = "panel status-panel";
  node.innerHTML = `<div class="panel-heading"><h3></h3><span class="status-time"></span></div><dl class="overview"></dl>`;
  node.querySelector("h3").textContent = spec.label ?? "设备状态";
  const time = node.querySelector(".status-time");
  const overview = node.querySelector(".overview");
  return {
    node,
    time,
    update(rows, text) {
      node.hidden = Boolean(spec.hideEmpty && !rows.length);
      time.textContent = text;
      overview.replaceChildren(...rows.map(([label, value]) => definition(document, label, value ?? "—")));
    },
  };
}

export function alarmView(document, id, spec, request) {
  const node = document.createElement("section");
  node.className = "panel";
  node.classList.toggle("wide", spec.wide ?? true);
  const heading = document.createElement("h3");
  heading.textContent = spec.label ?? id;
  const list = document.createElement("div");
  list.className = "alarm-list";
  const empty = document.createElement("p");
  empty.className = "alarm-empty";
  empty.textContent = "当前无告警";
  node.append(heading, list, empty);

  let enabled = false;
  let previous = "";
  let acknowledgeButtons = [];
  function update(read) {
    const alarms = read(spec.source ?? "alarms");
    const entries = Array.isArray(alarms) ? alarms.filter((alarm) => alarm && typeof alarm === "object") : [];
    const snapshot = JSON.stringify(entries);
    if (snapshot === previous) return;
    previous = snapshot;
    acknowledgeButtons = [];
    empty.hidden = entries.length > 0;
    list.replaceChildren(...entries.map((alarm) => {
      const row = document.createElement("article");
      row.className = "alarm-row";
      row.dataset.severity = ["critical", "warning", "info"].includes(alarm.severity) ? alarm.severity : "info";
      row.dataset.active = String(alarm.active !== false);
      const top = document.createElement("div");
      top.className = "alarm-meta";
      const severity = document.createElement("span");
      severity.textContent = ({ critical: "严重", warning: "警告", info: "提示" })[row.dataset.severity];
      const code = document.createElement("span");
      code.className = "alarm-code";
      code.textContent = alarm.code ?? "";
      const time = document.createElement("time");
      const timestamp = alarm.timestamp ?? alarm.since;
      time.textContent = typeof timestamp === "number" ?
        new Date(timestamp).toLocaleTimeString("zh-CN", { hour12: false }) : String(timestamp ?? "");
      top.append(severity, code, time);
      const title = document.createElement("strong");
      title.textContent = alarm.label ?? alarm.code ?? alarm.id ?? "设备告警";
      const message = document.createElement("p");
      message.textContent = alarm.message ?? "";
      const state = document.createElement("span");
      state.className = "alarm-state";
      state.textContent = alarm.active === false ? "已恢复" : alarm.acknowledged ? "已确认" : "未确认";
      top.append(state);
      row.append(top, title, message);
      if (typeof spec.acknowledge === "function" && !alarm.acknowledged) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "确认";
        button.disabled = !enabled;
        button.addEventListener("click", () => request({
          label: "确认告警",
          run: (api) => spec.acknowledge(api, alarm),
        }));
        acknowledgeButtons.push(button);
        row.append(button);
      }
      return row;
    }));
  }

  return {
    node,
    update,
    enable(value) {
      enabled = value;
      for (const button of acknowledgeButtons) button.disabled = !enabled;
    },
  };
}

export function parameterView(document, id, spec, request) {
  if (!Array.isArray(spec.parameters) || !spec.parameters.length) {
    throw new Error("参数面板 " + id + " 需要 parameters。");
  }
  const node = document.createElement("section");
  node.className = "panel";
  node.classList.toggle("wide", spec.wide ?? true);
  const heading = document.createElement("h3");
  heading.textContent = spec.label ?? id;
  const table = document.createElement("table");
  table.className = "parameter-table";
  table.setAttribute("aria-label", heading.textContent);
  const header = table.createTHead().insertRow();
  for (const label of ["参数", "设备值", "新值", "操作"]) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = label;
    header.append(cell);
  }
  const body = table.createTBody();
  const controls = [];
  const keys = new Set();
  const rows = spec.parameters.map((parameter) => {
    if (!parameter || typeof parameter !== "object" || Array.isArray(parameter)) {
      throw new Error("参数面板 " + id + " 中的参数格式无效。");
    }
    const { key, label = key, min, max, step = 1, unit } = parameter;
    if (keys.has(key)) throw new Error("参数面板 " + id + " 中的键重复：" + key + "。");
    if (typeof key !== "string" || !key || !Number.isFinite(step) || step <= 0 ||
        (min !== undefined && !Number.isFinite(min)) || (max !== undefined && !Number.isFinite(max)) ||
        (min !== undefined && max !== undefined && max <= min)) {
      throw new Error("参数面板 " + id + " 中的参数范围无效。");
    }
    keys.add(key);
    const row = body.insertRow();
    const name = document.createElement("th");
    name.scope = "row";
    name.textContent = label;
    row.append(name);
    const current = row.insertCell();
    current.className = "parameter-current";
    const fieldCell = row.insertCell();
    const field = document.createElement("input");
    field.type = "number";
    field.required = true;
    field.step = step;
    if (min !== undefined) field.min = min;
    if (max !== undefined) field.max = max;
    field.setAttribute("aria-label", label + "新值");
    const fieldGroup = document.createElement("div");
    fieldGroup.className = "parameter-entry";
    fieldGroup.append(field);
    if (unit) {
      const unitLabel = document.createElement("span");
      unitLabel.textContent = unit;
      fieldGroup.append(unitLabel);
    }
    fieldCell.append(fieldGroup);
    const actions = row.insertCell();
    actions.className = "parameter-actions";
    const readButton = document.createElement("button");
    readButton.type = "button";
    readButton.textContent = "读取";
    const writeButton = document.createElement("button");
    writeButton.type = "button";
    writeButton.textContent = "写入";
    actions.append(readButton, writeButton);
    const status = document.createElement("span");
    status.className = "parameter-status";
    actions.append(status);

    const entry = { key, unit, current, field, status, editing: false, unconfirmed: false };
    field.addEventListener("input", () => { entry.editing = true; });
    field.addEventListener("change", () => { entry.editing = false; });
    const readAction = {
      label: "读取" + label,
      readback: true,
      run: (api) => api.readback(),
    };
    readButton.addEventListener("click", () => request(readAction));
    controls.push({ action: readAction, update: (value, enabled) => { readButton.disabled = !enabled; } });
    const action = {
      key,
      label: "写入" + label,
      run: (api, value) => api.configure({ [key]: value }),
    };
    writeButton.addEventListener("click", () => {
      if (!field.checkValidity()) {
        field.reportValidity();
        return;
      }
      request(action, field.valueAsNumber);
    });
    controls.push({
      action,
      update(value, enabled, held, unconfirmed) {
        writeButton.disabled = field.disabled = !enabled;
        entry.unconfirmed = Boolean(unconfirmed);
        status.textContent = entry.unconfirmed ? "待确认" : "";
      },
    });
    return entry;
  });
  node.append(heading, table);
  return {
    node,
    controls,
    update(read) {
      for (const row of rows) {
        const value = read(row.key);
        row.current.textContent = valueText(value, row.unit);
        if (!row.editing && !row.unconfirmed) row.field.value = Number.isFinite(value) ? value : "";
      }
    },
  };
}

export function diagnosticsView(document, spec) {
  const node = document.createElement("section");
  node.className = "panel";
  node.classList.toggle("wide", spec.wide ?? true);
  const heading = document.createElement("h3");
  heading.textContent = spec.label ?? "通信诊断";
  const grid = document.createElement("dl");
  grid.className = "diagnostics-grid";
  const fields = [
    ["连接", "connected"], ["接收字节", "rxBytes"], ["发送字节", "txBytes"],
    ["接收帧", "rxFrames"], ["发送帧", "txFrames"], ["最近响应", "lastResponseMs"],
    ["平均响应", "averageResponseMs"], ["超时", "timeouts"],
    ["解析错误", "parseErrors"], ["写入失败", "writeErrors"],
  ].map(([label, key]) => {
    const cell = definition(document, label, "—");
    grid.append(cell);
    return { key, output: cell.lastChild };
  });
  node.append(heading, grid);
  return {
    node,
    update(stats = {}) {
      for (const { key, output } of fields) {
        const value = stats[key];
        output.textContent = key === "connected" ? (value ? "已连接" : "未连接") :
          value == null ? "—" : key.endsWith("Ms") ? formatValue(value) + " ms" : valueText(value);
      }
    },
  };
}

export function consoleView(document, spec, send) {
  const node = document.createElement("details");
  node.className = "panel console";
  node.innerHTML = `
    <summary></summary>
    <div class="console-actions">
      <span role="status"></span>
      <button type="button" disabled>复制接收内容</button>
    </div>
    <pre aria-label="最近收发报文"></pre>
    <form>
      <fieldset class="console-options">
        <label>格式<select name="encoding" aria-label="发送格式">
          <option value="text">文本</option>
          <option value="hex">十六进制</option>
        </select></label>
        <label>结束符<select name="ending" aria-label="串口结束符">
          <option value="crlf">CRLF</option>
          <option value="lf">LF</option>
          <option value="none">不追加</option>
        </select></label>
      </fieldset>
      <input aria-label="串口或设备命令" placeholder="输入一条设备命令" autocomplete="off" spellcheck="false" required>
      <button type="submit">发送</button>
      <p class="console-feedback" role="status" aria-live="polite"></p>
    </form>`;
  node.querySelector("summary").textContent = spec.label ?? "串口调试与报文";
  node.open = Boolean(spec.open);
  const form = node.querySelector("form");
  const options = form.querySelector("fieldset");
  const input = form.querySelector("input");
  const sendButton = form.querySelector("button");
  const encoding = form.elements.namedItem("encoding");
  const ending = form.elements.namedItem("ending");
  const feedback = form.querySelector(".console-feedback");
  const copyButton = node.querySelector(".console-actions button");
  const copyFeedback = node.querySelector(".console-actions [role=status]");
  const output = node.querySelector("pre");
  const encoder = new TextEncoder();
  let messages = [];
  let serialMode = false;
  copyButton.addEventListener("click", async () => {
    const text = messages.filter(({ mark }) => mark === "接收").map(({ text }) => text).join("\n");
    copyFeedback.textContent = "";
      copyFeedback.dataset.error = "false";
    try {
      await document.defaultView.navigator.clipboard.writeText(text);
      copyFeedback.textContent = "已复制";
    } catch {
      copyFeedback.textContent = "复制失败，可手动选中报文复制。";
        copyFeedback.dataset.error = "true";
    }
  });
  function updateInputMode() {
    input.placeholder = encoding.value === "hex" ? "例如 50 49 4E 47" :
      serialMode ? "输入一条串口指令" : "输入一条设备命令";
    ending.disabled = encoding.value === "hex";
  }
  encoding.addEventListener("change", updateInputMode);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = input.value;
    if (!text) return;
    let bytes;
    let display;
    if (encoding.value === "hex") {
      const compact = text.replace(/\s+/g, "");
      if (!compact || compact.length % 2 || !/^[\da-f]+$/i.test(compact)) {
        feedback.textContent = "十六进制指令需由偶数个十六进制字符组成。";
        feedback.dataset.error = "true";
        return;
      }
      bytes = Uint8Array.from({ length: compact.length / 2 }, (_, index) =>
        Number.parseInt(compact.slice(index * 2, index * 2 + 2), 16));
      display = "HEX " + Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join(" ");
    } else {
      const suffix = { crlf: "\r\n", lf: "\n", none: "" }[ending.value];
      bytes = encoder.encode(text + suffix);
      display = text + (ending.value === "crlf" ? " [CRLF]" : ending.value === "lf" ? " [LF]" : "");
    }
    if (send?.({ text, bytes, display, encoding: encoding.value })) {
      input.value = "";
      feedback.textContent = "指令已提交。";
      feedback.dataset.error = "false";
    } else {
      feedback.textContent = "当前连接不可发送。";
      feedback.dataset.error = "true";
    }
  });
  return {
    node,
    enable(enabled, { serial, command }) {
      serialMode = serial;
      form.hidden = !serial && !command;
      options.hidden = !serial;
      if (!serial && encoding.value !== "text") {
        encoding.value = "text";
      }
      updateInputMode();
      input.disabled = sendButton.disabled = !enabled;
    },
    update(entries) {
      if (!node.open) return;
      messages = entries;
      copyButton.disabled = !messages.some(({ mark }) => mark === "接收");
      output.textContent = messages.map(({ mark, text }) => mark + "  " + text).join("\n");
      output.scrollTop = output.scrollHeight;
    },
  };
}
