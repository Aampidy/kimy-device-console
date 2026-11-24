import { formatValue } from "./telemetry.mjs";

const svgNamespace = "http://www.w3.org/2000/svg";
const isPair = (point) => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);
const coordinateText = (value) => value && Math.abs(value) < .001 ? value.toExponential(2) : formatValue(value);
const pointText = ([x, y]) => "(" + coordinateText(x) + ", " + coordinateText(y) + ")";

function graphicStyle(node, style = {}) {
  const { width, height, align, background, color, axisColor, gridColor, selectionColor, fit, filter } = style;
  for (const [property, value] of Object.entries({
    width, height, background, color, "axis-color": axisColor, "grid-color": gridColor,
    "selection-color": selectionColor, fit, filter,
  })) {
    if (value == null) continue;
    const length = (property === "width" || property === "height") && typeof value === "number";
    node.style.setProperty("--graphic-" + property, length ? value + "px" : value);
  }
  if (align) node.dataset.graphicAlign = align;
}

export function imageView(document, id, spec, localization) {
  let src = spec.src;
  let image;
  const inlineSvg = !src && spec.type === "svg" && typeof spec.markup === "string";
  function updateSource() {
    if (!inlineSvg) return;
    const template = document.createElement("template");
    template.innerHTML = spec.markup;
    const svg = template.content.firstElementChild;
    if (svg?.namespaceURI !== svgNamespace || svg.localName !== "svg") {
      throw new Error("SVG 模块 " + id + " 需要完整的 <svg> 元素。");
    }
    for (const text of svg.querySelectorAll("text")) {
      text.textContent = localization?.translate(text.textContent) ?? text.textContent;
    }
    const markup = new document.defaultView.XMLSerializer().serializeToString(svg);
    src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(markup);
    if (image) image.src = src;
  }
  updateSource();
  if (!src) throw new Error("图片模块 " + id + " 需要 src 或 SVG 内容。");

  const node = document.createElement("figure");
  node.className = "data-module image-module";
  graphicStyle(node, spec.style);
  if (spec.label) {
    const caption = document.createElement("figcaption");
    caption.textContent = spec.label;
    node.append(caption);
  }
  const display = document.createElement("div");
  display.className = "graphic-display image-display";
  node.append(display);
  image = document.createElement("img");
  image.alt = spec.alt ?? spec.label ?? id;
  image.loading = "lazy";
  image.decoding = "async";
  if (spec.type === "svg" && spec.style?.color) {
    image.addEventListener("load", () => {
      if (!image.src.startsWith("data:") && !image.src.startsWith(document.location.origin + "/")) return;
      display.style.setProperty("--svg-mask", "url(" + JSON.stringify(image.src) + ")");
      display.classList.add("svg-tint");
    });
  }
  image.addEventListener("error", () => {
    const message = document.createElement("p");
    message.className = "help";
    message.textContent = "图片加载失败";
    image.replaceWith(message);
  }, { once: true });
  image.src = src;
  display.append(image);
  if (inlineSvg) localization?.onChange(updateSource);
  return { node };
}

function axisRange(axis, values) {
  if (axis.min !== undefined) return [axis.min, axis.max];
  if (!values.length) return [0, 1];
  let min = values[0];
  let max = min;
  for (const value of values) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  const padding = min === max ? Math.max(1, Math.abs(min) * .05) : (max - min) * .06;
  return [min - padding, max + padding];
}

function nearestOnLine(points, screen, cursor) {
  let hit = points[0];
  let nearest = Infinity;
  for (let index = 1; index < screen.length; index++) {
    const [ax, ay] = screen[index - 1];
    const [bx, by] = screen[index];
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    const projection = ((cursor.x - ax) * dx + (cursor.y - ay) * dy) / (lengthSquared || 1);
    const fraction = Math.max(0, Math.min(1, projection));
    const distance = Math.hypot(cursor.x - ax - fraction * dx, cursor.y - ay - fraction * dy);
    if (distance >= nearest) continue;
    nearest = distance;
    const [startX, startY] = points[index - 1];
    const [endX, endY] = points[index];
    hit = [startX + (endX - startX) * fraction, startY + (endY - startY) * fraction];
  }
  return hit;
}

export function xyView(document, id, spec, request, canRun) {
  const { label = id, x = {}, y = {}, points = [], lines = [], equalScale = false } = spec;
  for (const axis of [x, y]) {
    const { min, max, step } = axis;
    if ((min !== undefined || max !== undefined) &&
        (![min, max, max - min].every(Number.isFinite) || max <= min)) {
      throw new Error("坐标图 " + id + " 的轴范围无效。");
    }
    if (step !== undefined && (!Number.isFinite(step) || step <= 0)) {
      throw new Error("坐标图 " + id + " 的坐标步长无效。");
    }
  }
  const element = (tag, attributes = {}) => {
    const node = document.createElementNS(svgNamespace, tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    return node;
  };
  const node = document.createElement("article");
  node.className = "data-module xy-module";
  graphicStyle(node, spec.style);
  const heading = document.createElement("h3");
  heading.textContent = label;
  const svg = element("svg", { class: "graphic-display xy-plot", role: "group", "aria-label": label });
  const grid = element("g", { class: "xy-grid", "aria-hidden": "true" });
  const layer = element("svg", { overflow: "hidden" });
  svg.append(grid, layer);
  const output = document.createElement("output");
  output.textContent = "点选坐标点或线段";
  node.append(heading, svg, output);

  let selected;
  let lastLayout;
  let lastPlot;
  const targets = [
    ...lines.map((line, index) => target(line, "line", index)),
    ...points.map((point, index) => target(point, "point", index)),
  ];

  function target(spec, kind, index) {
    const isPoint = kind === "point";
    const name = spec.label ?? (isPoint ? "点 " : "线 ") + (index + 1);
    if (!isPoint && (!Array.isArray(spec.points) || spec.points.length < 2 || !spec.points.every(isPair))) {
      throw new Error("坐标图 " + id + " 中的" + name + "需要至少两个坐标。");
    }
    const node = element("g", { class: "xy-target xy-" + kind, role: "button", "aria-label": name, "aria-pressed": "false" });
    const title = element("title");
    title.textContent = name;
    const tag = isPoint ? "circle" : "polyline";
    const mark = element(tag, { class: "xy-mark" });
    const hit = element(tag, { class: "xy-hit" });
    if (isPoint) {
      const radius = Number.isFinite(spec.radius) && spec.radius > 0 ? spec.radius : 5;
      mark.setAttribute("r", radius);
      hit.setAttribute("r", Math.max(12, radius + 5));
    }
    if (Number.isFinite(spec.strokeWidth) && spec.strokeWidth > 0) {
      node.style.setProperty("--xy-stroke", spec.strokeWidth + "px");
    }
    node.append(title, mark, hit);
    const caption = isPoint && spec.label ? element("text", { class: "xy-point-label" }) : null;
    if (caption) {
      caption.textContent = spec.label;
      node.append(caption);
    }
    if (spec.color) node.style.setProperty("--xy-color", spec.color);
    layer.append(node);
    const action = typeof spec.run === "function" ? { label: name, run: spec.run, enabledWhen: spec.enabledWhen } : null;
    if (spec.draggable && (!isPoint || !action)) {
      throw new Error("坐标图 " + id + " 中可拖动的点需要提供 run 回调。");
    }
    const item = {
      id: spec.id ?? kind + "-" + (index + 1), name, kind, spec, node, mark, hit, caption, action,
      draggable: Boolean(spec.draggable), position: undefined, drag: undefined, suppressClick: false,
    };
    if (item.draggable) node.dataset.draggable = "true";
    node.addEventListener("click", (event) => select(item, event));
    node.addEventListener("keydown", (event) => {
      if (event.repeat) return;
      if (item.draggable && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
        event.preventDefault();
        if (!lastPlot || !item.points.length) return;
        const [currentX, currentY] = item.position ?? item.points[0];
        const multiplier = event.shiftKey ? 5 : 1;
        const xStep = x.step ?? (lastPlot.xRange[1] - lastPlot.xRange[0]) / 100;
        const yStep = y.step ?? (lastPlot.yRange[1] - lastPlot.yRange[0]) / 100;
        movePoint(item, [
          currentX + (event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0) * xStep * multiplier,
          currentY + (event.key === "ArrowUp" ? 1 : event.key === "ArrowDown" ? -1 : 0) * yStep * multiplier,
        ]);
      } else if ((event.key === "Enter" || event.key === " ") && !event.repeat) {
        event.preventDefault();
        select(item);
      }
    });
    if (item.draggable) {
      node.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || !canRun(item.action)) return;
        item.drag = {
          pointerId: event.pointerId,
          start: [...item.points[0]],
          originalPosition: item.position,
          clientX: event.clientX,
          clientY: event.clientY,
          moved: false,
        };
        node.setPointerCapture(event.pointerId);
        event.preventDefault();
      });
      node.addEventListener("pointermove", (event) => {
        const drag = item.drag;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const position = readPointer(event);
        if (!position) return;
        if (!drag.moved && Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) < 3) return;
        drag.moved = true;
        item.position = position;
        item.points = [position];
        drawTarget(item);
        showCoordinates(item, position);
        event.preventDefault();
      });
      node.addEventListener("pointerup", (event) => {
        const drag = item.drag;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const position = drag.moved ? readPointer(event) ?? item.points[0] : null;
        item.drag = undefined;
        if (position) {
          item.suppressClick = true;
          document.defaultView.setTimeout(() => { item.suppressClick = false; }, 0);
          movePoint(item, position, drag.originalPosition ?? drag.start);
          event.preventDefault();
        }
      });
      const cancelDrag = (event) => {
        if (!item.drag || item.drag.pointerId !== event.pointerId) return;
        item.position = item.drag.originalPosition;
        item.points = [item.drag.start];
        item.drag = undefined;
        drawTarget(item);
        if (selected) showCoordinates(selected, selected.points[0]);
        else output.textContent = "点选坐标点或线段";
      };
      node.addEventListener("pointercancel", cancelDrag);
      node.addEventListener("lostpointercapture", cancelDrag);
    }
    return item;
  }

  function select(item, event) {
    if (item.suppressClick) {
      item.suppressClick = false;
      event?.preventDefault();
      event?.stopPropagation();
      return;
    }
    if (item.node.hasAttribute("hidden") || !item.points?.length) return;
    let hit = item.points[0];
    if (item.kind === "line" && event?.detail) {
      const matrix = svg.getScreenCTM();
      if (matrix) {
        const cursor = svg.createSVGPoint();
        cursor.x = event.clientX;
        cursor.y = event.clientY;
        hit = nearestOnLine(item.points, item.screen, cursor.matrixTransform(matrix.inverse()));
      }
    }
    const [x, y] = hit;
    const selection = { id: item.id, kind: item.kind, label: item.name, x, y };
    if (item.kind === "line") selection.points = item.points.map((point) => [...point]);
    if (item.action && !request(item.action, selection)) return;
    selected?.node.setAttribute("aria-pressed", "false");
    selected = item;
    item.node.setAttribute("aria-pressed", "true");
    showCoordinates(item, hit);
  }

  function showCoordinates(item, position) {
    const text = item.name + "  " + pointText(position);
    if (output.textContent !== text) output.textContent = text;
  }

  function screenPosition([xValue, yValue]) {
    const { area, xRange, yRange } = lastPlot;
    return [
      area.left + (xValue - xRange[0]) / (xRange[1] - xRange[0]) * area.width,
      area.top + (yRange[1] - yValue) / (yRange[1] - yRange[0]) * area.height,
    ];
  }

  function drawTarget(item) {
    const screen = item.points.map(screenPosition);
    item.screen = screen;
    const { area } = lastPlot;
    const point = item.kind === "point";
    const outside = point && screen.length && (
      screen[0][0] < area.left || screen[0][0] > area.left + area.width ||
      screen[0][1] < area.top || screen[0][1] > area.top + area.height);
    item.node.toggleAttribute("hidden", !screen.length || Boolean(outside));
    if (!screen.length || outside) return;
    const enabled = !item.action || canRun(item.action);
    item.node.setAttribute("aria-disabled", String(!enabled));
    item.node.setAttribute("tabindex", enabled ? "0" : "-1");
    if (point) {
      const [screenX, screenY] = screen[0];
      item.node.setAttribute("transform", "translate(" + screenX + " " + screenY + ")");
      if (item.caption) {
        const offset = item.mark.r.baseVal.value + 5;
        const left = screenX > area.left + area.width - 50 - offset;
        item.caption.setAttribute("x", left ? -offset : offset);
        item.caption.setAttribute("y", 4);
        item.caption.setAttribute("text-anchor", left ? "end" : "start");
      }
    } else {
      const path = screen.map((pair) => pair.join(",")).join(" ");
      item.mark.setAttribute("points", path);
      item.hit.setAttribute("points", path);
    }
  }

  function readPointer(event) {
    const matrix = layer.getScreenCTM();
    if (!matrix) return undefined;
    const cursor = svg.createSVGPoint();
    cursor.x = event.clientX;
    cursor.y = event.clientY;
    const position = cursor.matrixTransform(matrix.inverse());
    const { area, xRange, yRange } = lastPlot;
    const xValue = xRange[0] + (position.x - area.left) / area.width * (xRange[1] - xRange[0]);
    const yValue = yRange[1] - (position.y - area.top) / area.height * (yRange[1] - yRange[0]);
    return [snapCoordinate(xValue, x, xRange), snapCoordinate(yValue, y, yRange)];
  }

  function snapCoordinate(value, axis, range) {
    if (axis.step) {
      const origin = axis.min ?? 0;
      value = origin + Math.round((value - origin) / axis.step) * axis.step;
    }
    return Math.max(range[0], Math.min(range[1], value));
  }

  function movePoint(item, position, previous = item.position ?? item.points[0]) {
    const next = [snapCoordinate(position[0], x, lastPlot.xRange), snapCoordinate(position[1], y, lastPlot.yRange)];
    item.position = next;
    item.points = [next];
    drawTarget(item);
    if (!request(item.action, { id: item.id, kind: item.kind, label: item.name, x: next[0], y: next[1] })) {
      item.position = previous;
      item.points = [previous];
      drawTarget(item);
      if (selected) showCoordinates(selected, selected.points[0]);
      else output.textContent = "点选坐标点或线段";
      return;
    }
    selected?.node.setAttribute("aria-pressed", "false");
    selected = item;
    item.node.setAttribute("aria-pressed", "true");
    showCoordinates(item, next);
  }

  function drawGrid(area, xRange, yRange) {
    const { left, top, width, height } = area;
    const right = left + width;
    const bottom = top + height;
    grid.replaceChildren(element("rect", { x: left, y: top, width, height }));
    const tickAxis = (range, divisions, horizontal) => {
      const span = range[1] - range[0];
      const ideal = span / divisions;
      const base = 10 ** Math.floor(Math.log10(ideal));
      const step = [1, 2, 2.5, 5, 10].find((scale) => scale * base >= ideal) * base;
      const first = Math.ceil(range[0] / step);
      const count = Math.floor(range[1] / step) - first + 1;
      for (let index = 0; index < Math.min(count, divisions + 1); index++) {
        const tick = (first + index) * step;
        const fraction = (tick - range[0]) / span;
        const position = horizontal ? left + fraction * width : bottom - fraction * height;
        const attrs = horizontal ? { x1: position, x2: position, y1: top, y2: bottom } :
          { x1: left, x2: right, y1: position, y2: position };
        const text = horizontal ? { x: position, y: bottom + 15, "text-anchor": "middle" } :
          { x: left - 7, y: position, "text-anchor": "end", "dominant-baseline": "middle" };
        const value = element("text", text);
        value.textContent = coordinateText(tick);
        grid.append(element("line", attrs), value);
      }
    };
    tickAxis(xRange, Math.max(1, Math.min(6, Math.floor(width / 52))), true);
    tickAxis(yRange, Math.max(1, Math.min(5, Math.floor(height / 43))), false);
    const xTitle = element("text", { x: left + width / 2, y: bottom + 32, "text-anchor": "middle" });
    const yTitle = element("text", {
      transform: "translate(" + Math.max(10, left - 47) + " " + (top + height / 2) + ") rotate(-90)",
      "text-anchor": "middle",
    });
    xTitle.textContent = x.label ?? "X";
    yTitle.textContent = y.label ?? "Y";
    grid.append(xTitle, yTitle);
  }

  function update(read) {
    const width = svg.clientWidth;
    const height = svg.clientHeight;
    if (width < 100 || height < 70) return;
    const readCoordinate = (value) => typeof value === "number" ? value : read(value);
    const coordinates = targets.flatMap((item) => {
      const source = item.spec;
      const data = item.kind === "point" ? [item.position ?? [readCoordinate(source.x), readCoordinate(source.y)]] : source.points;
      item.points = data.every(isPair) ? data : [];
      return item.points;
    });
    const xRange = axisRange(x, coordinates.map(([value]) => value));
    const yRange = axisRange(y, coordinates.map(([, value]) => value));
    const dx = xRange[1] - xRange[0];
    const dy = yRange[1] - yRange[0];
    const area = { left: 57, top: 13, width: width - 73, height: height - 52 };
    if (equalScale) {
      const scale = Math.min(area.width / dx, area.height / dy);
      area.left += (area.width - dx * scale) / 2;
      area.top += (area.height - dy * scale) / 2;
      area.width = dx * scale;
      area.height = dy * scale;
    }
    const layout = [width, height, ...xRange, ...yRange].join(",");
    if (layout !== lastLayout) {
      lastLayout = layout;
      svg.setAttribute("viewBox", "0 0 " + width + " " + height);
      for (const [key, value] of Object.entries({ x: area.left, y: area.top, width: area.width, height: area.height })) {
        layer.setAttribute(key, value);
      }
      layer.setAttribute("viewBox", [area.left, area.top, area.width, area.height].join(" "));
      drawGrid(area, xRange, yRange);
    }
    lastPlot = { area, xRange, yRange };
    for (const item of targets) drawTarget(item);
    if (selected?.kind === "point" && !selected.node.hasAttribute("hidden")) {
      showCoordinates(selected, selected.points[0]);
    }
  }

  return { node, svg, update };
}
