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
  node.textContent = spec.label ?? id;
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
      const label = action.label + (unconfirmed ? " · 待确认" : "");
      if (node.textContent !== label) node.textContent = label;
      if (toggle) {
        active = Boolean(value ?? spec.initial ?? false);
        node.setAttribute("aria-pressed", String(active));
      }
      if (hold) {
        node.dataset.held = String(Boolean(held));
        if (!held) contact.clear();
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

export function consoleView(document, spec, send) {
  const node = document.createElement("details");
  node.className = "panel console";
  node.innerHTML = `
    <summary></summary>
    <pre aria-label="最近收发报文"></pre>
    <form>
      <input aria-label="设备命令" placeholder="输入一条设备命令" autocomplete="off" spellcheck="false" required>
      <button>发送</button>
    </form>`;
  node.querySelector("summary").textContent = spec.label ?? "原始报文";
  node.open = Boolean(spec.open);
  const form = node.querySelector("form");
  form.hidden = !send;
  const input = form.querySelector("input");
  const button = form.querySelector("button");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (text) send?.(text);
  });
  const output = node.querySelector("pre");
  return {
    node,
    enable(enabled) {
      input.disabled = button.disabled = !enabled;
    },
    update(messages) {
      if (!node.open) return;
      output.textContent = messages.join("\n");
      output.scrollTop = output.scrollHeight;
    },
  };
}
