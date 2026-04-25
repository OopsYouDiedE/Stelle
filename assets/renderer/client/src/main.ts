/**
 * 模块：Renderer 浏览器入口
 *
 * 运行逻辑：
 * - 页面启动后连接 `/events` SSE。
 * - 收到 LiveRuntime 发布的 command 后更新字幕。
 * - 当前 renderer 是轻量状态页，后续可在这里接入动画、音频和舞台元素。
 */
import "./style.css";

// 模块：SSE command 消费。
const caption = document.querySelector<HTMLHeadingElement>("#caption");
const events = new EventSource("/events");

events.addEventListener("command", (event) => {
  const command = JSON.parse(event.data) as { type?: string; text?: string; state?: { caption?: string } };
  if (command.type === "caption:set" && caption) caption.textContent = command.text ?? "";
  if (command.type === "state:set" && caption) caption.textContent = command.state?.caption ?? "Renderer ready.";
});
