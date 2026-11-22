import { textLines } from "../lib/transport.mjs";

const initialSpeed = 1200;
const maxSpeed = 3000;

function openSimulation({ receive }) {
  let targetSpeed = initialSpeed;
  let speed = 0;
  let current = 0;
  const reply = (line) => receive(textLines.encode(line));
  const write = textLines.decoder((line) => {
    if (line === "READ") {
      const targetCurrent = targetSpeed / 1000;
      speed += (targetSpeed - speed) * 0.15;
      current += (targetCurrent - current) * 0.3;
      reply(`PID ${targetSpeed} ${speed.toFixed(1)} ${targetCurrent} ${current.toFixed(3)}`);
    } else if (line.startsWith("SPEED ")) {
      const value = Number(line.slice(6));
      if (!Number.isInteger(value) || value < 0 || value > maxSpeed) {
        reply("ERR 转速指令超出范围");
        return;
      }
      targetSpeed = value;
      reply("OK SPEED " + value);
    } else {
      reply("ERR 未识别的命令");
    }
  });
  return { name: "模拟设备", write, close() {} };
}

export const adapters = {
  example: {
    label: "电机调试示例",
    transports: { simulation: { label: "本地模拟", open: openSimulation } },
    channels: {
      speed: { label: "转速环", unit: "rpm" },
      current: { label: "电流环", unit: "A" },
    },
    panels: [
      {
        label: "电机控制", position: "sidebar",
        modules: {
          speedCommand: {
            type: "slider", label: "目标转速", min: 0, max: maxSpeed, step: 50, initial: initialSpeed, unit: "rpm",
            run: ({ ask }, value) => ask("SPEED " + value, (line) => {
              if (line.startsWith("ERR ")) throw new Error(line.slice(4));
              if (line.startsWith("OK SPEED ")) return Number(line.slice(9));
            }),
          },
        },
      },
      {
        label: "PID 曲线",
        modules: { speed: { type: "curve" }, current: { type: "curve" } },
      },
      {
        label: "设备监控",
        modules: {
          actual: { type: "bar", label: "实测转速", source: { channel: "speed", series: "actual" }, max: maxSpeed, unit: "rpm" },
          console: { type: "console" },
        },
      },
    ],
    sample: ({ ask }) => ask("READ", (line) => {
      if (!line.startsWith("PID ")) return;
      const values = line.slice(4).trim().split(/\s+/).map(Number);
      if (values.length !== 4 || !values.every(Number.isFinite)) throw new Error("采样回执格式错误");
      const [targetSpeed, speed, targetCurrent, current] = values;
      return {
        points: {
          speed: { target: targetSpeed, actual: speed },
          current: { target: targetCurrent, actual: current },
        },
      };
    }),
  },
};
