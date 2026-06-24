const MODEL = "deepseek-chat";
const ENDPOINT = "https://api.deepseek.com/v1/chat/completions";
const MAX_BODY_BYTES = 120000;
const TIMEOUT_MS = 28000;

const reply = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return reply(405, { error: "仅支持POST请求" });
  if (!event.body || Buffer.byteLength(event.body, "utf8") > MAX_BODY_BYTES) return reply(413, { error: "请求内容过大" });
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return reply(503, { error: "站点尚未配置DeepSeek服务" });

  let payload;
  try { payload = JSON.parse(event.body); } catch { return reply(400, { error: "请求格式无效" }); }
  if (!Array.isArray(payload.messages) || !payload.messages.length || payload.messages.length > 16) return reply(400, { error: "messages格式无效" });
  const messages = payload.messages.map((message) => ({
    role: ["system", "user", "assistant"].includes(message?.role) ? message.role : "user",
    content: String(message?.content || "").slice(0, 30000),
  })).filter((message) => message.content);
  if (!messages.length) return reply(400, { error: "请求内容为空" });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: MODEL, messages, temperature: payload.mode === "planner" ? 0 : 0.2, stream: false }),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return reply(response.status >= 500 ? 502 : response.status, { error: data?.error?.message || "DeepSeek调用失败" });
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return reply(502, { error: "DeepSeek未返回有效内容" });
    return reply(200, { model: data.model || MODEL, content, usage: data.usage || null });
  } catch (error) {
    return reply(error?.name === "AbortError" ? 504 : 502, { error: error?.name === "AbortError" ? "DeepSeek响应超时" : "DeepSeek服务暂不可用" });
  } finally {
    clearTimeout(timer);
  }
};
