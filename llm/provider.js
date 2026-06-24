import { AI_CONFIG } from "../config/ai-config.js";

export async function callDeepSeek({ messages, mode = "answer", signal } = {}) {
  if (!Array.isArray(messages) || !messages.length) throw new Error("AI请求内容为空");
  const controller = signal ? null : new AbortController();
  const timeout = controller ? setTimeout(() => controller.abort(), AI_CONFIG.requestTimeoutMs) : null;
  try {
    const response = await fetch(AI_CONFIG.functionUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, mode }),
      signal: signal || controller?.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error || `DeepSeek服务暂不可用（${response.status}）`);
    const content = payload?.content || payload?.choices?.[0]?.message?.content;
    if (!content) throw new Error("DeepSeek未返回有效内容");
    return { content, model: payload.model || AI_CONFIG.model, raw: payload };
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("DeepSeek响应超时，请稍后重试");
    throw new Error(error?.message || "DeepSeek服务暂不可用，请稍后重试");
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export const callLLM = callDeepSeek;
export const requestCompletion = callDeepSeek;
