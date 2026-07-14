import { buildReviewerMessages } from "./prompts-v2.js";
import { analysisToText, normalizeAnalysis } from "./business-analyst.js";

function parseJson(content) {
  const source = String(content || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(source);
}

export async function reviewBusinessAnalysis({ question, evidence, draft, deepseekClient }) {
  if (typeof deepseekClient !== "function") return { analysis: draft, content: analysisToText(draft), reviewed: false, issues: [], warning: "复核服务未连接" };
  try {
    const messages = buildReviewerMessages({ question, evidence, draft });
    const response = await deepseekClient({ messages, mode: "reviewer", maxTokens: 6500 });
    const payload = parseJson(response.content);
    const issues = Array.isArray(payload.issues) ? payload.issues.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 12) : [];
    const analysis = normalizeAnalysis(payload.revisedAnalysis && typeof payload.revisedAnalysis === "object" ? payload.revisedAnalysis : draft);
    return { analysis, content: analysisToText(analysis, { reviewed: true, reviewIssues: issues }), reviewed: true, issues, warning: "" };
  } catch (error) {
    return { analysis: draft, content: analysisToText(draft), reviewed: false, issues: [], warning: `${error?.message || "复核失败"}，已保留首轮分析。` };
  }
}

export default reviewBusinessAnalysis;
