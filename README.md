# PID Visualizer

通过 JavaScript 适配器把设备接入 PID 调试界面。可同时查看多个控制环、暂停回看、操作设备，并保存报文和采样 CSV。浏览器界面和本地 Node.js 服务都使用原生 API，无需安装 npm 依赖。

## 快速运行

使用 Node.js 24，在项目目录运行以下命令。Windows 用户也可以双击 `start.cmd`，脚本优先使用 `runtime/node.exe`，也支持系统已安装的 Node.js。

```sh
node server.mjs
```

用桌面版 Edge 或 Chrome 打开终端给出的本机地址，默认是 `http://127.0.0.1:8765`。默认端口被其他进程占用时，服务会尝试 `8766`。可以用环境变量 `PID_VISUALIZER_PORT` 指定端口，或用 `PID_VISUALIZER_LOGS` 指定日志目录。

1. 连接方式选择「本地模拟」，点击「连接设备」和「开始采集」。拖动目标转速滑块，转速环和电流环会一起更新。虚线表示目标值，实线表示实测值。
2. 点「暂停画面」固定当前画面，后台继续采集。拖动时间轴、横向拖动曲线或在曲线上按住 Shift 滚动，都可以同步回看。点「回到实时」恢复跟随。
3. 点「停止采集」保存本轮记录，之后仍可回看。报文日志和采样 CSV 可从页面下载，也保存在项目的 `logs/` 目录。当本轮有采样帧时会生成 CSV。

## 接入自己的设备

适配器入口只有一个文件，里面的模拟设备通过文本报文演示了采样和指令回显。修改该文件导出的 `adapters` 映射即可登记项目。接入多个项目时可拆成独立文件，再从入口导入。浏览器和本地服务都会加载入口，设备操作放在回调中。修改适配器后重启服务。 [示例适配器](adapters/example.mjs)

| 配置 | 用法 |
| --- | --- |
| `transports.serial` | 填写 `baudRate` 等串口参数。使用蓝牙 SPP 时，先在系统中配对并确认 COM 端口。 |
| `transports.ble` | 填写设备的 `service`、`write` 和 `notify`，可选 `filters` 和 `chunkSize`。 |
| 自定义连接 | 登记 `{ label, open({ receive, lost }) }`，返回 `{ name, write(bytes), close() }`。收到数据调用 `receive(bytes)`，意外断开调用 `lost(原因)`。 |
| `codec` | 默认用 UTF-8 文本行收发。自定义时提供 `encode(payload)` 和 `decoder(emit)`。解码器收到完整帧后调用 `emit(frame)`，可用 `format(value)` 定义日志显示。 |
| `files` | 登记配置名到文件路径的映射。服务以项目目录解析相对路径，适配器可调用 `api.sources()` 读取。 |
| `command(api, text)` | 启用原始报文模块中的手动命令输入。 |

### 采样与回显

- 用顶层 `channels` 登记独立通道，每项可填 `label`、`unit` 和 `series`。默认序列是 `target` 和 `actual`。单值通道可以登记 `series: { value: { label: "电压" } }`。
- `sample(api)` 在采集期间轮询，按通道 ID 返回数据，例如 `{ points: { speed: { target: 1200, actual: 1180 } } }`。默认间隔 50 ms，可用 `intervalMs` 调整。返回 `undefined` 跳过本帧，返回 `null` 停止本轮轮询。
- `onFrame(frame, memory)` 处理主动上报，可同步返回 `{ sample, status, values }`。`status(api)` 则在连接时查询状态，采集期间按 `statusIntervalMs` 刷新，默认 500 ms。状态可包含 `rows`（名称和值的二元数组）、`values`（共享状态）和 `running`（运行中会禁止断开）。
- 采样和各通道数据都可带 32 位无符号毫秒时间 `tick`，分别表示回执和控制时刻。省略时使用浏览器时钟或该帧的回执时刻。CSV 按帧和通道保存数据，每个通道各占一行。
- 控件的 `bind` 指向共享状态键，默认为组件 ID。回调可返回设备确认的数字、布尔值或 `{ value, message }`，也可通过 `api.publish({ 键: 值 })` 更新状态。等待回执超时时，控件保留最近确认的值并显示「待确认」。用 `enabledWhen(values)` 可声明启用条件。

回调中调用 `api.ask(command, parse, timeoutMs)` 发送命令并等待回执。解析函数返回 `undefined` 时继续等待，返回其他值时完成请求。把命令写成 `null` 可单独等帧。用 `api.send(command)` 直接发送，`api.progress(text)` 更新提示，`api.log(text)` 记录事件。`api.memory` 在一次连接内共享，`api.values` 是当前共享状态，`api.signal` 用于响应取消。

### 面板与组件

在 `panels` 数组中按显示顺序注册面板。组件可直接写在面板的 `modules` 对象里，也可在顶层 `modules` 登记后按 ID 引用。同一通道可以供多张曲线、读数或坐标图使用，这些组件会共享本轮采样数据和回看位置。

| 配置 | 布局 |
| --- | --- |
| `position` | 默认 `main`（主区），也可设为 `sidebar`（侧栏）或 `footer`（主区下方）。 |
| `panelMode` | 主区有多个面板时默认通过标签切换。设为 `"stack"` 可依次展开。 |
| `columns`、`mobileColumns` | 设置桌面和窄屏列数。桌面和窄屏主区默认一列，窄屏侧栏默认沿用桌面列数。 |
| `span`、`wide` | 设置组件占用的列数。`wide: true` 占整行，曲线、表格、状态和原始报文默认占整行。 |
| `chartMode` | 默认同时显示面板内的所有曲线。设为 `"select"` 时默认显示第一条，可用下拉框切换。 |

| 组件 `type` | 注册方式 |
| --- | --- |
| `curve` | 用 `channel` 指定通道，默认是同名通道。可设置 `windowMs`（默认 10000）、`gapMs`、`unit`，也可用 `series` 选择序列并设置图例、颜色或阶梯线。 |
| `value`、`bar`、`table` | 数值卡、条形图和表格。数据源 `source` 可填共享状态键，或 `{ channel, series }`。条形图可设 `min`、`max`，表格用 `rows` 逐行登记 `label`、`source` 和可选的 `unit`。 |
| `status`、`console` | 显示设备状态或原始报文。`console` 可设 `open: true` 默认展开。 |
| `button` | 普通按钮，可省略 `type`。点击执行 `run(api)`。 |
| `normally-open`、`momentary` | 常开或点动按键，按下向 `run(api, value)` 传入 `true`，松开传入 `false`。 |
| `normally-closed` | 常闭按键，按下传入 `false`，松开传入 `true`。 |
| `toggle` | 交替按键，点击传入已确认状态的反值，可设 `initial`。 |
| `slider` | 可设 `min`、`max`、`step`、`initial` 和 `unit`。通过 `orientation` 选择 `"horizontal"` 或 `"vertical"`。拖动时预览，松开后提交。 |

按下和松开事件会依次执行。指针取消、失去焦点或页面隐藏时会释放按住的控件。可用 `stop: true` 登记优先停止按钮，用 `motion: true` 标记可能启动设备的动作，用 `record` 指定动作成功后开启采集。

### 图片、SVG 和二维坐标图

- `type: "image"` 用 `src` 加载图片。SVG 可用 `type: "svg"` 配合 `src` 或完整的 `markup`。项目素材可放在 `adapters/assets/`，在适配器中通过 `new URL(..., import.meta.url)` 引用。
- 图片、SVG 和坐标图可在 `style` 中设置 `width`、`height`、`align` 和 `background`。宽高可用像素数值或 CSS 长度，宽度也可用百分比。图片和 SVG 可设 `fit` 和 `filter`，项目内或内嵌 SVG 可用 `color` 统一着色。
- `type: "xy"` 可登记 `x`、`y` 轴、`points` 和 `lines`。省略轴范围时按数据计算，`equalScale: true` 让两轴等比例。点的坐标可取常量、共享状态键或采样通道。`style` 可设 `gridColor`、`axisColor` 和 `selectionColor`，点和线可单独设置 `color` 和 `strokeWidth`。
- 点击点或线可高亮并显示坐标，也可用 Tab 聚焦后按 Enter 或空格。点击线时取线上最近的坐标，键盘选择时取首点。图元可登记 `run(api, { id, kind, label, x, y })` 执行联动，线的回调还会收到 `points`。

## 主题与嵌入

右上角可切换浅色和深色。第一次打开时跟随系统设置，手动选择保存在浏览器中。适配器可以用 `var(--accent)`、`var(--surface)` 和 `var(--line)` 随主题取色。

嵌入网页时引入 `lib/style.css`，从 `lib/visualizer.mjs` 导入 `mountPidVisualizer`，传入容器和适配器映射即可挂载。可选的 `readSources(id, signal)` 提供配置文本，`saveLogs({ log, csv }, signal)` 保存日志并返回下载地址 `{ log, csv }`。不传 `saveLogs` 时由浏览器生成下载链接。挂载函数返回异步卸载函数。

## 便携分发

Git 会忽略本机的 `runtime/` 和 `logs/`。给没有安装 Node.js 的 Windows x64 用户分发时，把 Windows x64 版的 `node.exe` 放入 `runtime/`，再把项目和运行时一起打包。解压后双击 `start.cmd` 即可使用模拟示例。接入设备的适配器还需要提供自己登记的配置文件和素材。
