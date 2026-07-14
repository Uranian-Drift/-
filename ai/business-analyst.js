import { AI_MODES } from "../config/ai-config.js";
import { buildBusinessAnalystMessages } from "./prompts-v2.js";

const list = (value) => Array.isArray(value) ? value : [];
const text = (value, fallback = "") => String(value ?? fallback).trim();
const money = (value) => Number.isFinite(Number(value)) ? `¥${Math.round(Number(value)).toLocaleString("zh-CN")}` : "-";
const integer = (value) => Number.isFinite(Number(value)) ? Math.round(Number(value)).toLocaleString("zh-CN") : "-";
const pct = (value) => Number.isFinite(Number(value)) ? `${Number(value) >= 0 ? "+" : ""}${(Number(value) * 100).toFixed(1)}%` : "-";

function parseJson(content) {
  const source = String(content || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(source);
}

export function normalizeAnalysis(value = {}) {
  return {
    executiveSummary: text(value.executiveSummary, "当前证据不足以形成明确结论。"),
    keyFacts: list(value.keyFacts).slice(0, 30).map((item) => ({ factId: text(item?.factId), statement: text(item?.statement), importance: ["high", "medium", "low"].includes(item?.importance) ? item.importance : "medium" })).filter((item) => item.statement),
    drivers: list(value.drivers).slice(0, 12).map((item, index) => ({ rank: Number(item?.rank) || index + 1, factor: text(item?.factor), evidence: text(item?.evidence), interpretation: text(item?.interpretation), confidence: ["high", "medium", "low"].includes(item?.confidence) ? item.confidence : "medium" })).filter((item) => item.factor),
    actions: list(value.actions).slice(0, 12).map((item) => ({ priority: ["P0", "P1", "P2"].includes(item?.priority) ? item.priority : "P1", action: text(item?.action), scope: text(item?.scope), timeframe: text(item?.timeframe), successMetric: text(item?.successMetric), rationale: text(item?.rationale), risk: text(item?.risk) })).filter((item) => item.action),
    risks: list(value.risks).map((item) => text(item)).filter(Boolean).slice(0, 12),
    dataGaps: list(value.dataGaps).map((item) => text(item)).filter(Boolean).slice(0, 12),
    followUps: list(value.followUps).map((item) => text(item)).filter(Boolean).slice(0, 8),
  };
}

function localAnalysis(question, evidence) {
  const overall = evidence?.signals?.overallSales;
  const current = overall?.current || {};
  const changes = overall?.change?.rate || {};
  const negative = evidence?.signals?.topNegativeContributors || [];
  const positive = evidence?.signals?.topPositiveContributors || [];
  const summary = overall
    ? `当前销售额${money(current.salesAmount)}、销量${integer(current.quantity)}台、成交均价${money(current.avgSellingPrice)}；销售额同比${pct(changes.salesAmount)}。`
    : "当前证据包未包含整体销售汇总。";
  return normalizeAnalysis({
    executiveSummary: summary,
    keyFacts: [
      overall && { factId: overall.factId, statement: summary, importance: "high" },
      negative[0] && { factId: negative[0].factId, statement: `${negative[0].name}是当前最大的负向贡献项，销售变化${money(negative[0].absolute)}。`, importance: "high" },
      positive[0] && { factId: positive[0].factId, statement: `${positive[0].name}是当前最大的正向贡献项，销售变化+${money(positive[0].absolute).replace("¥", "¥")}。`, importance: "medium" },
    ].filter(Boolean),
    drivers: negative.slice(0, 3).map((item, index) => ({ rank: index + 1, factor: item.name, evidence: `${item.factId}：销售变化${money(item.absolute)}，变化率${pct(item.rate)}`, interpretation: "需要继续结合型号、渠道、店铺和价格变化判断具体经营原因。", confidence: "high" })),
    actions: negative.slice(0, 3).map((item, index) => ({ priority: index === 0 ? "P0" : "P1", action: `针对${item.name}拆分最近10天销量、均价和渠道贡献，确认下滑集中点。`, scope: item.name, timeframe: "未来7天每日观察", successMetric: "销售额和销量停止下降，成交均价不继续恶化", rationale: `对应负向贡献证据${item.factId}`, risk: "缺少流量、活动和库存数据时不能直接确认因果" })),
    risks: ["DeepSeek分析服务不可用时，当前内容为本地证据摘要。"],
    dataGaps: evidence?.meta?.plannerHypotheses || [],
    followUps: ["继续拆解负向贡献最大的型号", "按渠道和店铺定位下滑来源", "结合奥维判断行业还是内部问题"],
  });
}

export function analysisToText(analysis, { reviewed = false, reviewIssues = [] } = {}) {
  const sections = [`【核心结论】\n${analysis.executiveSummary}`];
  if (analysis.keyFacts.length) sections.push(`【关键事实】\n${analysis.keyFacts.map((item) => `- ${item.statement}${item.factId ? `（证据：${item.factId}）` : ""}`).join("\n")}`);
  if (analysis.drivers.length) sections.push(`【驱动因素】\n${analysis.drivers.map((item) => `${item.rank}. ${item.factor}：${item.evidence}${item.interpretation ? `；${item.interpretation}` : ""}（置信度：${item.confidence}）`).join("\n")}`);
  if (analysis.actions.length) sections.push(`【行动方案】\n${analysis.actions.map((item, index) => `${index + 1}. [${item.priority}] ${item.action}\n   对象：${item.scope || "当前范围"}｜周期：${item.timeframe || "待确定"}｜成功指标：${item.successMetric || "待确定"}${item.rationale ? `｜依据：${item.rationale}` : ""}${item.risk ? `｜风险：${item.risk}` : ""}`).join("\n")}`);
  if (analysis.risks.length || analysis.dataGaps.length) sections.push(`【风险与待补信息】\n${[...analysis.risks, ...analysis.dataGaps].map((item) => `- ${item}`).join("\n")}`);
  if (analysis.followUps.length) sections.push(`【可以继续追问】\n${analysis.followUps.map((item) => `- ${item}`).join("\n")}`);
  if (reviewed) sections.push(`【复核状态】\n已完成第二轮数字与逻辑复核${reviewIssues.length ? `；修正项：${reviewIssues.join("；")}` : "，未发现需要修正的问题"}。`);
  return sections.join("\n\n");
}

export async function generateBusinessAnalysis({ question, mode = "deep", evidence, deepseekClient }) {
  const modeConfig = AI_MODES[mode] || AI_MODES.deep;
  if (typeof deepseekClient !== "function") {
    const analysis = localAnalysis(question, evidence);
    return { analysis, content: analysisToText(analysis), source: "local-fallback", model: "local-evidence", warning: "DeepSeek服务未连接" };
  }
  try {
    const messages = buildBusinessAnalystMessages({ question, mode, evidence });
    const response = await deepseekClient({ messages, mode: "analyst", maxTokens: modeConfig.maxAnswerTokens });
    const analysis = normalizeAnalysis(parseJson(response.content));
    return { analysis, content: analysisToText(analysis), source: "deepseek", model: response.model, warning: "" };
  } catch (error) {
    const analysis = localAnalysis(question, evidence);
    return { analysis, content: analysisToText(analysis), source: "local-fallback", model: "local-evidence", warning: `${error?.message || "DeepSeek分析失败"}，已返回本地证据摘要。` };
  }
}

export default generateBusinessAnalysis;
