import { connectDevice } from "./transport.mjs";
import { Capture, channelFor, chartFor, drawPlot, formatValue, frameIndexAt } from "./telemetry.mjs";
import { consoleView, controlView, dataView, definition, panelsFor, statusView } from "./modules.mjs";
import { imageView, xyView } from "./graphics.mjs";

const dashboard = `
  <header class="topbar">
    <div class="masthead">
      <div class="brand"><span class="brand-mark" aria-hidden="true"></span><h1>PID Visualizer</h1></div>
      <div class="header-tools">
        <div class="connection-indicator" data-ui="connection" role="status"></div>
        <div class="theme-switch" role="group" aria-label="界面主题">
          <button type="button" data-theme-choice="light" aria-pressed="false">浅色</button>
          <button type="button" data-theme-choice="dark" aria-pressed="false">深色</button>
        </div>
      </div>
    </div>
  </header>
  <div class="dashboard">
    <aside class="sidebar" aria-label="连接与侧栏">
      <section class="panel setup">
        <h2>连接设备</h2>
        <label>项目适配器<select data-ui="adapter"></select></label>
        <label>连接方式<select data-ui="transport"></select></label>
        <button type="button" class="primary" data-ui="connect"></button>
        <p class="help" data-ui="notice" role="status"></p>
      </section>
      <div class="registered-panels" data-ui="sidebar-panels"></div>
    </aside>
    <div class="main-column">
      <section class="chart-panel">
        <div class="panel-heading">
          <div>
            <h2>采集记录</h2>
            <div class="capture-meta">
              <span data-ui="capture-status" aria-live="polite"></span>
              <div class="log-links" data-ui="log-links"></div>
            </div>
          </div>
          <button type="button" class="primary" data-ui="capture">开始采集</button>
        </div>
        <div class="panel-tabs" data-ui="panel-tabs" role="group" aria-label="项目面板" hidden></div>
        <div class="chart-controls" data-ui="chart-controls" hidden>
          <div class="time-controls">
            <div class="timeline">
              <div class="timeline-label"><span>采集时间</span><output data-ui="time-readout"></output></div>
              <input type="range" data-ui="time-slider" min="0" max="0" step="1" value="0" aria-label="采集时间">
            </div>
            <button type="button" data-ui="follow">暂停画面</button>
          </div>
        </div>
        <div class="registered-panels" data-ui="main-panels"></div>
        <div class="registered-panels" data-ui="footer-panels"></div>
      </section>
    </div>
  </div>`;

const transportLabels = { ble: "低功耗蓝牙（BLE）", serial: "蓝牙 SPP / COM 串口" };
const clock = () => new Date().toLocaleTimeString("zh-CN", { hour12: false });
const chartLabel = ({ label, unit }) => unit ? label + "（" + unit + "）" : label;
const dataTypes = new Set(["value", "bar", "table"]);
const themeKey = "pid-visualizer.theme";
const isConfirmedValue = (value) => typeof value === "boolean" || Number.isFinite(value);
const sourceChannel = (source) => source?.channel ?? source?.curve;

function chartView(document, chart) {
  const node = document.createElement("article");
  node.className = "curve-module";
  node.innerHTML = `
    <div class="plot-toolbar">
      <div class="plot-heading"><h3></h3><span class="window"></span></div>
      <dl class="readings"></dl>
    </div>
    <div class="plot"><canvas></canvas><span class="plot-message"></span></div>`;
  node.querySelector("h3").textContent = chartLabel(chart);
  node.querySelector(".window").textContent = chart.windowMs / 1000 + " 秒窗口";
  const readings = node.querySelector(".readings");
  const values = new Map();
  for (const [index, { key, label, color, stepped }] of chart.series.entries()) {
    const property = "--pid-series-" + index;
    node.style.setProperty(property, color);
    const cell = definition(document, label, "—");
    const swatch = document.createElement("i");
    swatch.style.borderColor = "var(" + property + ")";
    swatch.classList.toggle("stepped", stepped);
    swatch.setAttribute("aria-hidden", "true");
    cell.firstElementChild.prepend(swatch);
    cell.lastChild.style.color = "var(" + property + ")";
    values.set(key, cell.lastChild);
    readings.append(cell);
  }
  let error;
  if (chart.showError) {
    const cell = definition(document, "误差", "—");
    error = cell.lastChild;
    readings.append(cell);
  }
  const canvas = node.querySelector("canvas");
  canvas.setAttribute("aria-label", chartLabel(chart) + "曲线");
  return { node, canvas, values, error, message: node.querySelector(".plot-message") };
}

export function mountPidVisualizer(root, adapters, { readSources, saveLogs } = {}) {
  const entries = Object.entries(adapters);
  if (!entries.length) throw new Error("请至少注册一个项目适配器。");
  const document = root.ownerDocument;
  const view = document.defaultView;
  const lifetime = new AbortController();
  root.classList.add("pid-visualizer");
  root.innerHTML = dashboard;
  const ui = Object.fromEntries([...root.querySelectorAll("[data-ui]")].map((node) => [node.dataset.ui, node]));
  const themeButtons = [...root.querySelectorAll("[data-theme-choice]")];
  const systemTheme = view.matchMedia("(prefers-color-scheme: dark)");
  let themeChoice;
  try {
    const saved = view.localStorage.getItem(themeKey);
    if (saved === "light" || saved === "dark") themeChoice = saved;
  } catch { /* 浏览器禁用存储时仍可切换主题。 */ }
  const option = (select, value, label) => select.add(new view.Option(label, value));
  const messages = [];
  const downloads = [];
  let selected;
  let connected;
  let history;
  let review;
  let captureState = "idle";
  let sampleMessage = "";
  let plotFrame = 0;
  const channels = [];
  const channelIndices = new Map();
  const panels = [];
  const controls = [];
  const statuses = [];
  const consoles = [];
  const observer = new view.ResizeObserver(renderPlots);

  function updateTheme() {
    const theme = themeChoice ?? (systemTheme.matches ? "dark" : "light");
    root.dataset.pidTheme = theme;
    for (const button of themeButtons) {
      button.setAttribute("aria-pressed", String(button.dataset.themeChoice === theme));
    }
    renderPlots();
  }

  function notice(text, error = false) {
    ui.notice.textContent = text;
    ui.notice.dataset.error = error;
  }

  function captureNotice(text, error = false) {
    ui["capture-status"].textContent = text;
    ui["capture-status"].dataset.error = error;
  }

  function enabledByAdapter(session, action) {
    return !action.enabledWhen || Boolean(action.enabledWhen(session.values));
  }

  function canRun(session, action) {
    if (!session?.ready || !enabledByAdapter(session, action)) return false;
    const kind = session.job?.kind;
    if (action.stop) return kind !== "stop" && !session.queue.some(({ action }) => action.stop);
    const held = action.key !== undefined && Array.from(session.held.keys()).some((item) => item.key === action.key);
    return !session.queue.length && !held && kind !== "control" && kind !== "stop";
  }

  function updateControls() {
    const ready = Boolean(connected?.ready);
    const job = connected?.job?.kind;
    const busy = job === "control" || job === "stop";
    const queued = connected?.queue.length;
    ui.adapter.disabled = Boolean(connected) || captureState !== "idle";
    ui.transport.disabled = Boolean(connected);
    const kind = ui.transport.value;
    const connectLabel = kind === "ble" ? "扫描并连接" : kind === "serial" ? "选择并连接串口" : "连接设备";
    ui.connect.textContent = connected ? (ready ? "断开连接" : connected.closing ? "正在断开…" : "连接中…") : connectLabel;
    ui.connect.disabled = connected ? !ready || connected.mayRun || busy || Boolean(queued || connected.held.size) : !kind;
    ui.connection.textContent = ready ? "已连接 · " + connected.wire.name : connected ?
      ui.connect.textContent : "未连接";
    ui.connection.dataset.online = ready;
    ui.capture.textContent = ({ idle: "开始采集", recording: "停止采集", saving: "正在保存…", unsaved: "重试保存" })[captureState];
    ui.capture.disabled = captureState === "saving" || (captureState === "idle" && !ready);
    for (const { enable } of consoles) enable(ready && !busy && !queued);
    for (const { action, update } of controls) {
      update(connected?.values[action.key], canRun(connected, action), connected?.held.has(action),
        connected?.unconfirmed.has(action.key));
    }
    if (panels.some(({ node, data }) => !node.hidden && data.length)) renderPlots();
  }

  function clearDownloads() {
    for (const url of downloads.splice(0)) view.URL.revokeObjectURL(url);
    ui["log-links"].replaceChildren();
  }

  function selectAdapter() {
    selected = adapters[ui.adapter.value];
    history = undefined;
    review = undefined;
    sampleMessage = "";
    messages.length = 0;
    clearDownloads();
    captureNotice("连接设备后可开始采集。");
    notice("");
    ui.transport.replaceChildren();
    for (const [kind, config] of Object.entries(selected.transports ?? {})) {
      option(ui.transport, kind, config.label ?? transportLabels[kind] ?? kind);
    }
    mountPanels();
    updateControls();
  }

  function mountPanels() {
    observer.disconnect();
    channels.length = panels.length = controls.length = statuses.length = consoles.length = 0;
    channelIndices.clear();
    for (const [id, spec] of Object.entries(selected.channels ?? {})) registerChannel(id, spec);
    const targets = { sidebar: ui["sidebar-panels"], main: ui["main-panels"], footer: ui["footer-panels"] };
    for (const target of Object.values(targets)) target.replaceChildren();

    const main = [];
    for (const { label, position = "main", columns = 1, mobileColumns = position === "sidebar" ? columns : 1,
      modules } of panelsFor(selected)) {
      const entries = Object.entries(modules ?? {});
      if (!entries.length) continue;
      if (!Object.hasOwn(targets, position) ||
          [columns, mobileColumns].some((count) => !Number.isInteger(count) || count < 1)) {
        throw new Error("面板 " + (label ?? "") + " 的位置或列数无效。");
      }
      const node = document.createElement("section");
      node.className = position === "sidebar" ? "registered-panel panel" : "registered-panel";
      const heading = document.createElement("h2");
      const name = label ?? "面板 " + (panels.length + 1);
      if (label) {
        heading.textContent = label;
        node.setAttribute("aria-label", label);
        node.append(heading);
      }
      const grid = document.createElement("div");
      grid.className = "module-grid";
      grid.style.setProperty("--columns", columns);
      grid.style.setProperty("--mobile-columns", mobileColumns);
      const panel = { node, heading, name, plots: [], data: [], controls: [], usesTimeline: false };
      for (const [key, entry] of entries) {
        const reference = typeof entry === "string";
        if (reference && !Object.hasOwn(selected.modules ?? {}, entry)) {
          throw new Error("面板 " + name + " 引用了未注册的组件 " + entry + "。");
        }
        const id = reference && Array.isArray(modules) ? entry : key;
        const spec = reference ? selected.modules[entry] : entry;
        const widget = mountModule(panel, id, spec, reference ? entry : id);
        if (spec.span !== undefined) {
          if (!Number.isInteger(spec.span) || spec.span < 1) throw new Error("模块 " + id + " 的跨度无效。");
          widget.classList.remove("wide");
          widget.style.setProperty("--span", Math.min(spec.span, columns));
          widget.style.setProperty("--mobile-span", Math.min(spec.span, mobileColumns));
        }
        grid.append(widget);
      }
      addCurvePicker(panel);
      node.append(grid);
      targets[position].append(node);
      panels.push(panel);
      if (position === "main") main.push(panel);
    }
    ui["panel-tabs"].replaceChildren();
    const useTabs = selected.panelMode !== "stack" && main.length > 1;
    ui["panel-tabs"].hidden = !useTabs;
    if (useTabs) {
      for (const panel of main) {
        panel.heading.hidden = true;
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = panel.name;
        button.addEventListener("click", () => showPanel(main, panel));
        panel.tab = button;
        ui["panel-tabs"].append(button);
      }
      showPanel(main, main[0]);
    } else updateTimeline();
  }

  function registerChannel(id, spec) {
    const index = channels.length;
    channelIndices.set(id, index);
    channels.push(channelFor(id, spec));
    return index;
  }

  function mountModule(panel, id, spec, moduleId) {
    let widget;
    if (spec.type === "curve") {
      const channelId = spec.channel ?? moduleId;
      let index = channelIndices.get(channelId);
      if (index === undefined) {
        if (spec.channel !== undefined || selected.channels !== undefined) {
          throw new Error("曲线 " + id + " 引用了未注册的采样通道 " + channelId + "。");
        }
        index = registerChannel(channelId, spec);
      }
      const chart = chartFor(id, spec, selected.intervalMs, channels[index]);
      widget = chartView(document, chart);
      panel.plots.push({ ...widget, chart, index });
      panel.usesTimeline = true;
      bindPlotNavigation(widget.canvas, chart.windowMs);
      observer.observe(widget.canvas);
      widget.node.classList.toggle("wide", spec.wide ?? true);
    } else if (spec.type === "status") {
      widget = statusView(document, spec);
      widget.update([], "等待连接");
      statuses.push(widget);
      widget.node.classList.toggle("wide", spec.wide ?? true);
    } else if (spec.type === "console") {
      const send = selected.command && ((text) =>
        requestControl({ label: "发送命令", run: (api) => selected.command(api, text) }));
      widget = consoleView(document, spec, send);
      widget.node.addEventListener("toggle", refreshConsole);
      consoles.push(widget);
      widget.node.classList.toggle("wide", spec.wide ?? true);
    } else if (spec.type === "image" || spec.type === "svg") {
      widget = imageView(document, id, spec);
      widget.node.classList.toggle("wide", Boolean(spec.wide));
    } else if (spec.type === "xy") {
      widget = xyView(document, id, spec, requestControl, (action) => canRun(connected, action));
      panel.data.push(widget);
      panel.usesTimeline ||= Boolean(spec.points?.some(({ x, y }) => sourceChannel(x) || sourceChannel(y)));
      observer.observe(widget.svg);
      widget.node.classList.toggle("wide", spec.wide ?? true);
    } else if (dataTypes.has(spec.type)) {
      widget = dataView(document, id, spec);
      panel.data.push(widget);
      panel.usesTimeline ||= Boolean(sourceChannel(spec.source) || spec.rows?.some(({ source }) => sourceChannel(source)));
    } else {
      widget = controlView(document, moduleId, spec, requestControl);
      panel.controls.push(widget);
      controls.push(widget);
    }
    widget.node.dataset.module = id;
    return widget.node;
  }

  function showPanel(main, active) {
    for (const panel of main) {
      const visible = panel === active;
      if (!visible && !panel.node.hidden) {
        for (const { release } of panel.controls) release?.();
      }
      panel.node.hidden = !visible;
      panel.tab.setAttribute("aria-pressed", String(visible));
    }
    updateTimeline();
  }

  function updateTimeline() {
    ui["chart-controls"].hidden = !panels.some(({ node, usesTimeline }) => !node.hidden && usesTimeline);
    renderPlots();
  }

  function addCurvePicker({ node, plots }) {
    if (plots.length < 2) {
      if (plots.length) plots[0].node.dataset.single = "true";
      return;
    }
    const label = document.createElement("label");
    const select = document.createElement("select");
    label.className = "chart-picker";
    label.append("显示曲线", select);
    option(select, "", "全部曲线");
    for (const { chart } of plots) option(select, chart.id, chartLabel(chart));
    if (selected.chartMode === "select") select.value = plots[0].chart.id;
    function showPlots() {
      for (const plot of plots) {
        plot.node.hidden = select.value !== "" && plot.chart.id !== select.value;
        plot.node.dataset.single = String(select.value !== "");
      }
      renderPlots();
    }
    select.addEventListener("change", showPlots);
    node.append(label);
    showPlots();
  }

  function seekTime(time) {
    const frames = history?.frames;
    if (!frames?.length) return;
    const bounded = Math.max(frames[0].timelineMs, Math.min(frames.at(-1).timelineMs, Math.round(time)));
    review = { time: bounded, frameIndex: frameIndexAt(frames, bounded) };
    renderPlots();
  }

  function bindPlotNavigation(canvas, windowMs) {
    let drag;
    canvas.addEventListener("pointerdown", (event) => {
      const latest = history?.frames.at(-1);
      if (!latest || !event.isPrimary || event.button !== 0) return;
      drag = { id: event.pointerId, x: event.clientX, time: review?.time ?? latest.timelineMs, history };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!drag || drag.id !== event.pointerId || drag.history !== history) return;
      const distance = drag.x - event.clientX;
      if (!drag.active && Math.abs(distance) < 4) return;
      drag.active = true;
      seekTime(drag.time + distance * windowMs / canvas.clientWidth);
    });
    canvas.addEventListener("lostpointercapture", () => { drag = undefined; });
    canvas.addEventListener("wheel", (event) => {
      if (!event.shiftKey && Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      const distance = event.deltaX || event.deltaY;
      const latest = history?.frames.at(-1);
      if (!latest || !distance || event.ctrlKey) return;
      event.preventDefault();
      const width = canvas.clientWidth;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? width : 1;
      seekTime((review?.time ?? latest.timelineMs) + distance * unit * windowMs / width);
    }, { passive: false });
  }

  function renderPlots() {
    if (plotFrame || lifetime.signal.aborted) return;
    plotFrame = view.requestAnimationFrame(() => {
      plotFrame = 0;
      const frames = history?.frames ?? [];
      const first = frames[0]?.timelineMs ?? 0;
      const latest = frames.at(-1)?.timelineMs ?? 0;
      const range = review ?? { time: latest, frameIndex: frames.length - 1 };
      const frame = frames[range.frameIndex];
      const read = (source) => typeof source === "string" ? connected?.values[source] :
        frame?.points[channelIndices.get(sourceChannel(source))]?.values[source?.series];
      const slider = ui["time-slider"];
      slider.min = first;
      slider.max = latest;
      slider.value = range.time;
      slider.disabled = first === latest;
      const seconds = (range.time / 1000).toFixed(2);
      slider.setAttribute("aria-valuetext", seconds + " 秒");
      ui["time-readout"].textContent = seconds + " / " + (latest / 1000).toFixed(2) + " 秒";
      const recording = captureState === "recording";
      ui.follow.textContent = recording ? (review ? "回到实时" : "暂停画面") : "跳到末尾";
      ui.follow.disabled = !frames.length || (!recording && !review);
      root.dataset.pidHistory = Boolean(frames.length);

      for (const panel of panels) {
        if (panel.node.hidden) continue;
        for (const { update } of panel.data) update(read);
        for (const { node, canvas, values, error, message, chart, index } of panel.plots) {
          if (node.hidden) continue;
          const point = frame?.points[index];
          for (const [key, field] of values) field.textContent = formatValue(point?.values[key]);
          if (error) error.textContent = formatValue(point ? point.values.target - point.values.actual : NaN);
          message.hidden = drawPlot(canvas, frames, chart, index, range);
          message.textContent = frames.length ? "这段时间暂无有效采样" :
            sampleMessage || (recording ? "等待采样数据" : "等待采集");
        }
      }
    });
  }

  function refreshConsole() {
    for (const { update } of consoles) update(messages);
  }

  function record(mark, text) {
    if (!text) return;
    if (captureState === "recording") history.record(mark, text);
    messages.push(mark + "  " + text);
    if (messages.length > 70) messages.shift();
    refreshConsole();
  }

  function context(session, signal) {
    const { wire } = session;
    return {
      signal,
      memory: session.memory,
      values: session.values,
      publish(values) {
        signal.throwIfAborted();
        publishValues(session, values);
        updateControls();
      },
      ask: (command, accept, timeout) => wire.ask(command, accept, signal, timeout),
      send(command) {
        signal.throwIfAborted();
        return wire.send(command);
      },
      progress(text) {
        signal.throwIfAborted();
        notice(text);
      },
      log(text) {
        signal.throwIfAborted();
        record("事件", text);
      },
      sources() {
        signal.throwIfAborted();
        if (!readSources) throw new Error("当前页面未提供配置文件读取功能。");
        return readSources(session.id, signal);
      },
    };
  }

  function publishValues(session, values) {
    for (const [key, value] of Object.entries(values ?? {})) {
      const expectedType = session.unconfirmed.get(key);
      if (expectedType) {
        if (typeof value !== expectedType || !isConfirmedValue(value)) continue;
        session.unconfirmed.delete(key);
      }
      session.values[key] = value;
    }
  }

  function showStatus(session, report) {
    publishValues(session, report.values);
    if (report.running !== undefined) session.mayRun = Boolean(report.running);
    const time = "更新于 " + clock();
    for (const { update } of statuses) update(report.rows ?? [], time);
  }

  function statusTime(text) {
    for (const { time } of statuses) time.textContent = text;
  }

  function addSample(sample) {
    if (captureState !== "recording" || !channels.length) return;
    history.add(sample);
    sampleMessage = "";
    captureNotice("采集中 · " + history.frames.length + " 帧");
    renderPlots();
  }

  function sampleError(error) {
    sampleMessage = error.message;
    captureNotice("采样失败。 " + error.message, true);
    renderPlots();
  }

  function receiveFrame(session, text, frame) {
    if (connected !== session) return;
    record("接收", text);
    if (!session.adapter.onFrame) return;
    try {
      const report = session.adapter.onFrame(frame, session.memory);
      if (report?.status || report?.values) {
        if (report.status) showStatus(session, report.status);
        publishValues(session, report.values);
        updateControls();
      }
      if (report?.sample) addSample(report.sample);
    } catch (error) {
      if (captureState === "recording") sampleError(error);
      else notice("报文解析失败。 " + error.message, true);
    }
  }

  async function toggleConnection() {
    if (connected) {
      const session = connected;
      if (!session.ready || session.mayRun || session.held.size) return;
      session.ready = false;
      session.closing = true;
      session.opening.abort();
      session.job?.controller.abort();
      updateControls();
      const [closed] = await Promise.allSettled([session.wire.close(), saveCapture()]);
      if (connected !== session) return;
      connected = undefined;
      statusTime("连接已断开");
      notice(closed.status === "fulfilled" ? "设备连接已断开。" : closed.reason.message, closed.status !== "fulfilled");
      updateControls();
      return;
    }

    const kind = ui.transport.value;
    const session = {
      id: ui.adapter.value, adapter: selected, memory: {}, values: Object.create(null), unconfirmed: new Map(),
      nextStatus: Infinity, nextSample: 0, opening: new AbortController(), queue: [], held: new Map(),
    };
    connected = session;
    const signal = session.opening.signal;
    for (const { update } of statuses) update([], "等待设备状态");
    updateControls();
    notice("");
    try {
      session.wire = await connectDevice(kind, selected.transports[kind], selected.codec, {
        onReceive: (text, frame) => receiveFrame(session, text, frame),
        onSend: (text) => { if (connected === session) record("发送", text); },
        onLost: (reason) => {
          if (connected !== session) return;
          session.opening.abort();
          session.job?.controller.abort();
          connected = undefined;
          statusTime("连接已断开");
          notice(session.mayRun ? reason + " 设备状态待确认。" : reason, true);
          void saveCapture();
          updateControls();
        },
      });
      signal.throwIfAborted();
      if (session.adapter.status) {
        const report = await session.adapter.status(context(session, signal));
        signal.throwIfAborted();
        showStatus(session, report);
      }
      session.ready = true;
    } catch (error) {
      await session.wire?.close().catch(() => {});
      if (connected === session) {
        connected = undefined;
        statusTime("等待连接");
        const canceled = error.name === "AbortError";
        notice(canceled ? "连接已取消。" : error.message, !canceled);
      }
    } finally {
      updateControls();
    }
  }

  async function perform(session, kind, task) {
    const controller = new AbortController();
    session.job = { kind, controller };
    updateControls();
    try {
      await task(context(session, controller.signal));
    } catch (error) {
      if (connected === session && !controller.signal.aborted) {
        if (kind === "status") statusTime("状态回执待确认");
        else if (kind === "sample") sampleError(error);
        else notice(error.message, true);
      }
    } finally {
      session.job = undefined;
      runQueuedControl(session);
    }
  }

  function requestControl(action, value, release = false) {
    const session = connected;
    if (!session?.ready) return false;
    let contact;
    if (release) {
      contact = session.held.get(action);
      if (!contact) return false;
      session.held.delete(action);
    } else {
      if (!canRun(session, action)) return false;
      if (action.hold) {
        contact = { started: false };
        session.held.set(action, contact);
      }
    }
    if (action.stop) {
      session.queue.length = 0;
      session.held.clear();
    }
    session.queue.push({ action, value, contact, release });
    const job = session.job;
    if (action.stop || job?.kind === "status" || job?.kind === "sample") job?.controller.abort();
    runQueuedControl(session);
    return true;
  }

  function runQueuedControl(session) {
    if (connected === session && session.ready && !session.job) {
      while (session.queue.length) {
        const command = session.queue.shift();
        const { action, contact, release } = command;
        if (release ? contact.started : enabledByAdapter(session, action)) {
          if (contact) contact.started = true;
          runControl(session, command);
          return;
        }
        if (contact && session.held.get(action) === contact) session.held.delete(action);
      }
    }
    updateControls();
  }

  function runControl(session, { action, value }) {
    const key = action.key;
    if (key !== undefined) session.unconfirmed.set(key, typeof value);
    void perform(session, action.stop ? "stop" : "control", async (api) => {
      try {
        notice("正在" + action.label + "…");
        if (action.motion) session.mayRun = true;
        const result = await action.run(api, value);
        api.signal.throwIfAborted();
        const confirmed = result?.value ?? result;
        if (key !== undefined && typeof confirmed === typeof value && isConfirmedValue(confirmed)) {
          publishValues(session, { [key]: confirmed });
        }
        if (action.stop) session.mayRun = false;
        const autoRecord = typeof action.record === "function" ? action.record(result) : action.record;
        if (autoRecord) startCapture();
        const message = typeof result === "string" ? result : result?.message;
        notice(message ?? (session.unconfirmed.has(key) ? "等待设备确认。" : "操作已完成。"));
      } finally {
        session.nextStatus = 0;
      }
    });
  }

  function startCapture() {
    if (!connected?.ready || captureState !== "idle") return;
    history = new Capture(connected.adapter.label, connected.wire.name, channels);
    review = undefined;
    captureState = "recording";
    connected.sampleUnavailable = false;
    connected.nextSample = 0;
    connected.nextStatus = channels.length && connected.adapter.sample ? performance.now() +
      (connected.adapter.statusIntervalMs ?? 500) : 0;
    sampleMessage = "";
    clearDownloads();
    captureNotice("正在采集。");
    updateControls();
    renderPlots();
  }

  function download(content, type) {
    const url = view.URL.createObjectURL(new view.Blob([content], { type: type + ";charset=utf-8" }));
    downloads.push(url);
    return url;
  }

  async function saveCapture() {
    if (captureState !== "recording" && captureState !== "unsaved") return;
    captureState = "saving";
    if (connected) {
      connected.nextStatus = Infinity;
      const job = connected.job;
      if (job?.kind === "sample" || job?.kind === "status") job.controller.abort();
    }
    updateControls();
    renderPlots();
    try {
      if (!history.raw.length && !history.frames.length) {
        captureNotice("本轮没有记录。");
      } else {
        const data = history.files();
        const files = saveLogs ? await saveLogs(data, lifetime.signal) : {
          log: download(data.log, "text/plain"),
          csv: data.csv && download("\ufeff" + data.csv, "text/csv"),
        };
        if (lifetime.signal.aborted) return;
        for (const [label, path, name] of [["报文日志", files.log, "status.log"], ["曲线 CSV", files.csv, "pid.csv"]]) {
          if (!path) continue;
          const link = document.createElement("a");
          link.href = path;
          link.download = saveLogs ? "" : name;
          link.textContent = label;
          ui["log-links"].append(link);
        }
        const result = saveLogs ? "已保存本轮记录" : "本轮记录可下载";
        captureNotice(history.frames.length ? result + " · " + history.frames.length + " 帧" : result + "。");
      }
      captureState = "idle";
    } catch (error) {
      captureState = "unsaved";
      captureNotice("写入日志失败。 " + error.message, true);
    } finally {
      updateControls();
      renderPlots();
    }
  }

  async function pollSamples(session, api) {
    const activeHistory = history;
    try {
      const sample = await session.adapter.sample(api);
      if (api.signal.aborted || captureState !== "recording" || history !== activeHistory) return;
      if (sample === null) {
        session.sampleUnavailable = true;
        sampleMessage = "设备未提供采样数据";
        captureNotice("正在记录设备报文。");
        renderPlots();
      } else if (sample !== undefined) addSample(sample);
    } finally {
      if (!api.signal.aborted) session.nextSample = performance.now() + (session.adapter.intervalMs ?? 50);
    }
  }

  const timer = view.setInterval(() => {
    const session = connected;
    if (!session?.ready || session.job) return;
    const now = performance.now();
    const sampleDue = captureState === "recording" && channels.length && session.adapter.sample &&
      !session.sampleUnavailable && now >= session.nextSample;
    if (session.adapter.status && now >= session.nextStatus && (!sampleDue || session.nextStatus <= session.nextSample)) {
      void perform(session, "status", async (api) => {
        try {
          const report = await session.adapter.status(api);
          if (!api.signal.aborted) showStatus(session, report);
        } finally {
          if (!api.signal.aborted) session.nextStatus = captureState === "recording" ?
            performance.now() + (session.adapter.statusIntervalMs ?? 500) : Infinity;
        }
      });
    } else if (sampleDue) {
      void perform(session, "sample", (api) => pollSamples(session, api));
    }
  }, 25);

  for (const [key, adapter] of entries) option(ui.adapter, key, adapter.label);
  for (const button of themeButtons) {
    button.addEventListener("click", () => {
      themeChoice = button.dataset.themeChoice;
      try {
        view.localStorage.setItem(themeKey, themeChoice);
      } catch { /* 当前页面保留选择。 */ }
      updateTheme();
    });
  }
  systemTheme.addEventListener("change", updateTheme, { signal: lifetime.signal });
  ui.adapter.addEventListener("change", selectAdapter);
  ui.transport.addEventListener("change", updateControls);
  ui["time-slider"].addEventListener("input", (event) => seekTime(event.target.valueAsNumber));
  ui.follow.addEventListener("click", () => {
    const latest = history?.frames.at(-1);
    if (!latest) return;
    if (captureState === "recording" && !review) {
      seekTime(latest.timelineMs);
    } else {
      review = undefined;
      renderPlots();
    }
  });
  ui.connect.addEventListener("click", toggleConnection);
  ui.capture.addEventListener("click", () => {
    if (captureState === "idle") startCapture();
    else void saveCapture();
  });
  view.addEventListener("beforeunload", (event) => {
    if (captureState !== "idle" || connected?.mayRun || connected?.held.size) event.preventDefault();
  }, { signal: lifetime.signal });
  updateTheme();
  selectAdapter();

  return async function unmount() {
    if (lifetime.signal.aborted) return;
    if (connected?.held.size) throw new Error("请先松开按键。");
    if (connected?.mayRun) throw new Error("请先停止设备。");
    const session = connected;
    connected = undefined;
    lifetime.abort();
    session?.opening.abort();
    session?.job?.controller.abort();
    view.clearInterval(timer);
    view.cancelAnimationFrame(plotFrame);
    observer.disconnect();
    clearDownloads();
    root.classList.remove("pid-visualizer");
    delete root.dataset.pidTheme;
    delete root.dataset.pidHistory;
    root.replaceChildren();
    await session?.wire?.close();
    return history?.files();
  };
}
