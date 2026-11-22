const pidSeries = {
  target: { label: "目标", color: "var(--plot-target)", stepped: true },
  actual: { label: "实测", color: "var(--plot-actual)" },
};
const palette = ["--plot-actual", "--plot-target", "--plot-blue", "--plot-pink", "--plot-violet", "--plot-olive"];
const uint32 = (value) => Number.isInteger(value) && value >= 0 && value <= 0xffffffff;

export function channelFor(id, spec) {
  return {
    id,
    label: spec.label ?? id,
    unit: spec.unit ?? "",
    series: Object.entries(spec.series ?? pidSeries).map(([key, line]) => ({ ...line, key })),
  };
}

export function chartFor(id, spec, intervalMs = 50, channel = channelFor(id, spec)) {
  const lines = spec.series === undefined ? channel.series : Object.entries(spec.series).map(([key, line]) => {
    const field = channel.series.find((item) => item.key === key);
    if (!field) throw new Error("曲线 " + id + " 引用了通道 " + channel.id + " 中不存在的序列 " + key + "。");
    return { ...field, ...line, key };
  });
  const series = lines.map(({ key, label, color, stepped }, index) => ({
    key,
    label: label ?? key,
    color: color ?? "var(" + palette[index % palette.length] + ")",
    stepped: Boolean(stepped),
  }));
  return {
    id,
    label: spec.label ?? channel.label,
    unit: spec.unit ?? channel.unit,
    windowMs: Number.isFinite(spec.windowMs) && spec.windowMs >= 1 ? spec.windowMs : 10000,
    gapMs: spec.gapMs ?? Math.max(500, 3 * intervalMs),
    series,
    showError: series.some(({ key }) => key === "target") && series.some(({ key }) => key === "actual"),
  };
}

function csvField(value) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
}

export class Capture {
  constructor(profile, device, channels) {
    this.profile = profile;
    this.device = device;
    this.channels = channels;
    this.frames = [];
    this.raw = [];
  }

  record(direction, text) {
    if (text) this.raw.push(new Date().toISOString() + "\t" + direction + "\t" + text);
  }

  add(sample) {
    const tick = sample.tick ?? (Math.round(performance.now()) >>> 0);
    if (!uint32(tick)) throw new Error("采样时间应为 32 位无符号毫秒数。");
    if (!sample.points || typeof sample.points !== "object") throw new Error("采样缺少 points。");
    const last = this.frames.at(-1);
    const delta = last ? (tick - last.tick) >>> 0 : 0;
    const newSegment = last && delta > 0x7fffffff;
    const points = this.channels.map(({ id, series }) => {
      const point = Object.hasOwn(sample.points, id) ? sample.points[id] : null;
      if (!point) return null;
      const values = Object.create(null);
      for (const { key } of series) {
        if (Number.isFinite(point[key])) values[key] = point[key];
      }
      if (!Object.keys(values).length) return null;
      const at = point.tick ?? tick;
      if (!uint32(at)) throw new Error("控制时刻无效。");
      const age = (tick - at) >>> 0;
      if (age > 0x7fffffff) throw new Error("控制时刻无效。");
      return { tick: at, age, values };
    });
    const elapsed = !last || newSegment ? Math.max(0, ...points.map((point) => point?.age ?? 0)) : last.elapsed + delta;
    // 设备时钟重置后的新段接在整轮采集时间轴的上一段之后。
    const timelineMs = !last ? elapsed : last.timelineMs + (newSegment ? elapsed + 1 : delta);
    this.frames.push({
      tick,
      segment: !last ? 1 : last.segment + Number(Boolean(newSegment)),
      elapsed,
      timelineMs,
      received: new Date().toISOString(),
      points: points.map((point) => point && { ...point, time: Math.max(0, elapsed - point.age) }),
    });
  }

  files() {
    const keys = new Set(this.channels.flatMap(({ series }) => series.map(({ key }) => key)));
    const hasPid = keys.has("target") || keys.has("actual");
    const extras = [...keys].filter((key) => key !== "target" && key !== "actual");
    const header = ["接收时间", "设备", "时间段", "回执时刻_ms", "控制时刻_ms", "曲线时间_ms", "控制环", "单位", "有效"];
    if (hasPid) header.push("目标", "实测", "误差");
    header.push(...extras);
    const csv = this.frames.length ? [header.map(csvField).join(",")] : [];
    for (const frame of this.frames) {
      this.channels.forEach(({ label, unit }, index) => {
        const point = frame.points[index];
        const columns = [frame.received, this.device, frame.segment, frame.tick, point?.tick ?? "",
          point?.time ?? frame.elapsed, label, unit, Number(Boolean(point))];
        if (hasPid) {
          const { target, actual } = point?.values ?? {};
          const error = target - actual;
          columns.push(target ?? "", actual ?? "", Number.isFinite(error) ? Number(error.toPrecision(12)) : "");
        }
        for (const key of extras) columns.push(point?.values[key] ?? "");
        csv.push(columns.map(csvField).join(","));
      });
    }
    return {
      log: ["设备\t" + this.device, "适配器\t" + this.profile, ...this.raw].join("\n") + "\n",
      csv: csv.length ? csv.join("\r\n") + "\r\n" : "",
    };
  }
}

export function formatValue(value) {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1e5) return value.toExponential(2);
  return Number(value.toFixed(3)).toString();
}

export function frameIndexAt(frames, time) {
  let start = 0;
  let end = frames.length;
  while (start < end) {
    const middle = Math.floor((start + end) / 2);
    if (frames[middle].timelineMs <= time) start = middle + 1;
    else end = middle;
  }
  return start - 1;
}

const pointTime = (frame, point) => frame.timelineMs - frame.elapsed + point.time;

export function drawPlot(canvas, frames, chart, channelIndex, { time, frameIndex }) {
  const { gapMs, windowMs } = chart;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return false;
  const view = canvas.ownerDocument.defaultView;
  const scale = view.devicePixelRatio || 1;
  const pixelWidth = Math.round(width * scale);
  const pixelHeight = Math.round(height * scale);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const left = 54;
  const right = width - 23;
  const top = 22;
  const bottom = height - 38;
  if (right <= left || bottom <= top) return false;
  const from = Math.max(0, time - windowMs);
  let start = frameIndex + 1;
  while (start > 0 && frames[start - 1].timelineMs >= from - gapMs) start--;
  const visible = frames.slice(start, frameIndex + 1);
  let low = Infinity;
  let high = -Infinity;
  for (const frame of visible) {
    const point = frame.points[channelIndex];
    if (!point || pointTime(frame, point) < from) continue;
    for (const { key } of chart.series) {
      const value = point.values[key];
      if (value === undefined) continue;
      low = Math.min(low, value);
      high = Math.max(high, value);
    }
  }
  const hasValues = low !== Infinity;
  if (!hasValues) {
    low = -1;
    high = 1;
  }
  const pad = Math.max(0.1, (high - low) * 0.12, Math.max(Math.abs(low), Math.abs(high)) * 1e-8);
  const wanted = (high - low + 2 * pad) / 4;
  const decade = 10 ** Math.floor(Math.log10(wanted));
  const step = [1, 2, 5, 10].find((n) => n * decade >= wanted) * decade;
  const first = Math.floor((low - pad) / step);
  const last = Math.ceil((high + pad) / step);
  const x = (ms) => left + (right - left) * (ms - from) / windowMs;
  const y = (value) => bottom - (bottom - top) * (value / step - first) / (last - first);

  const style = view.getComputedStyle(canvas);
  ctx.font = "12px " + style.getPropertyValue("--mono");
  ctx.lineWidth = 1;
  ctx.textBaseline = "middle";
  ctx.strokeStyle = style.getPropertyValue("--chart-line").trim();
  ctx.fillStyle = style.getPropertyValue("--chart-muted").trim();
  ctx.textAlign = "right";
  ctx.beginPath();
  for (let tick = first; tick <= last; tick++) {
    const value = tick * step;
    ctx.moveTo(left, y(value));
    ctx.lineTo(right, y(value));
    ctx.fillText(formatValue(value), left - 10, y(value));
  }
  ctx.textAlign = "center";
  const divisions = Math.max(2, Math.min(5, Math.floor((right - left) / 58)));
  const timeStep = windowMs / divisions;
  for (let ms = Math.ceil(from / timeStep) * timeStep; ms <= from + windowMs; ms += timeStep) {
    ctx.moveTo(x(ms), top);
    ctx.lineTo(x(ms), bottom);
    ctx.fillText(formatValue(ms / 1000), x(ms), bottom + 13);
  }
  ctx.stroke();
  ctx.fillText("采集时间（s）", (left + right) / 2, bottom + 28);

  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top - 2, right - left, bottom - top + 4);
  ctx.clip();
  for (let index = chart.series.length - 1; index >= 0; index--) {
    const { key, color, stepped } = chart.series[index];
    const paint = style.getPropertyValue("--pid-series-" + index).trim() || color;
    ctx.strokeStyle = paint;
    ctx.fillStyle = paint;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.setLineDash(stepped ? [5, 5] : []);
    ctx.beginPath();
    let previous;
    for (const frame of visible) {
      const point = frame.points[channelIndex];
      const value = point?.values[key];
      if (value === undefined || (previous && (frame.segment !== previous.segment ||
          frame.timelineMs - previous.received > gapMs))) previous = undefined;
      if (value === undefined) continue;
      const pointMs = pointTime(frame, point);
      if (previous && pointMs <= previous.time) continue;
      const px = x(pointMs);
      const py = y(value);
      if (previous) {
        if (stepped) ctx.lineTo(px, previous.y);
        ctx.lineTo(px, py);
      } else {
        ctx.fillRect(px - 1, py - 1, 2, 2);
        ctx.moveTo(px, py);
      }
      previous = { time: pointMs, received: frame.timelineMs, segment: frame.segment, y: py };
    }
    ctx.stroke();
  }
  ctx.restore();
  return hasValues;
}
