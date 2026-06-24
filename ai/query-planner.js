import { AI_CONFIG, QUERY_WHITELIST } from "../config/ai-config.js";
import { buildPlannerMessages } from "./prompts.js";

const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const normalize = (value) => String(value || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const cleanList = (value) => Array.isArray(value) ? [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, 30) : [];
const asDate = (date) => date.toISOString().slice(0, 10);
const shiftDays = (value, days) => { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return asDate(date); };

function nonEmptyFilters(filters = {}) {
  const output = {};
  ["startDate", "endDate"].forEach((key) => { if (validDate(filters[key])) output[key] = filters[key]; });
  ["products", "series", "models", "channels", "departments"].forEach((key) => { const values = cleanList(filters[key]); if (values.length) output[key] = values; });
  return output;
}

function mergeFilters(defaults, memory, dashboard, explicit) {
  return { ...defaults, ...nonEmptyFilters(memory), ...nonEmptyFilters(dashboard), ...nonEmptyFilters(explicit) };
}

function detectProducts(question, catalog = []) {
  const compact = normalize(question);
  const named = catalog.filter((item) => [item.name, item.code].some((value) => {
    const key = normalize(value);
    if (!key || key.length < 3) return false;
    if (compact.includes(key)) return true;
    const tokens = key.match(/[a-z]*\d+[a-z0-9]*/g) || [];
    return tokens.some((token) => token.length >= 3 && compact.includes(token));
  })).map((item) => item.name);
  ["16N1", "18M2PRO"].forEach((alias) => {
    if (!compact.includes(normalize(alias))) return;
    catalog.forEach((item) => {
      if ([item.name, item.code].some((value) => normalize(value).includes(normalize(alias)))) named.push(item.name);
    });
  });
  return [...new Set(named)];
}

function detectChannels(question, catalog) {
  return ["天猫", "京东", "抖音", "拼多多", "苏宁", "自营"].filter((value) => question.includes(value));
}

function explicitDates(question, dataRange) {
  const dates = question.match(/20\d{2}[-/.年]\d{1,2}(?:[-/.月]\d{1,2}日?)?/g) || [];
  if (dates.length) {
    const normalizeDate = (value, end = false) => {
      const parts = value.replace(/[年月/.]/g, "-").replace(/日/g, "").split("-").filter(Boolean).map(Number);
      if (parts.length === 2) {
        const last = new Date(Date.UTC(parts[0], parts[1], 0)).getUTCDate();
        return `${parts[0]}-${String(parts[1]).padStart(2, "0")}-${String(end ? last : 1).padStart(2, "0")}`;
      }
      return `${parts[0]}-${String(parts[1]).padStart(2, "0")}-${String(parts[2]).padStart(2, "0")}`;
    };
    return { startDate: normalizeDate(dates[0]), endDate: normalizeDate(dates[dates.length - 1], true) };
  }
  const end = dataRange.endDate;
  if (!validDate(end)) return {};
  if (/最近\s*7\s*天/.test(question)) return { startDate: shiftDays(end, -6), endDate: end };
  if (/最近\s*30\s*天/.test(question)) return { startDate: shiftDays(end, -29), endDate: end };
  if (/本周|这周/.test(question)) {
    const date = new Date(`${end}T00:00:00Z`); const weekday = date.getUTCDay() || 7;
    return { startDate: shiftDays(end, -(weekday - 1)), endDate: end };
  }
  return {};
}

export function buildFallbackPlan({ question, dashboardFilters = {}, memory = [], catalog = {}, dataRange = {} }) {
  const previous = memory[memory.length - 1]?.filters || {};
  const explicitProducts = detectProducts(question, catalog.products || catalog || []);
  const explicit = {
    ...explicitDates(question, dataRange),
    products: explicitProducts,
    channels: detectChannels(question, catalog),
  };
  const filters = mergeFilters({ startDate: dataRange.startDate, endDate: dataRange.endDate, products: [], series: [], models: [], channels: [], departments: [] }, previous, dashboardFilters, explicit);
  let intent = "summary";
  if (/周报|总结|报告/.test(question)) intent = "generate_report";
  else if (/为什么|下降|下滑|增长原因|变化原因/.test(question)) intent = "diagnose_change";
  else if (/低价换量|价格|均价|折扣|恢复率/.test(question)) intent = "price_analysis";
  else if (/异常|波动/.test(question)) intent = "anomaly";
  else if (/贡献最大|贡献度|占比/.test(question)) intent = "contribution";
  else if (/哪个|排名|top|前\d+/i.test(question)) intent = explicitProducts.length > 1 ? "compare" : "rank";
  else if (/对比|相比|比较|比一下|哪个卖得更好/.test(question) || explicitProducts.length > 1) intent = "compare";
  else if (/趋势|走势/.test(question)) intent = "trend";
  let comparisonType = "none";
  if (/同比|去年/.test(question)) comparisonType = "year_over_year";
  else if (/上个月|上月/.test(question)) comparisonType = "previous_month";
  else if (/上周/.test(question)) comparisonType = "previous_week";
  else if (["compare", "diagnose_change", "price_analysis", "generate_report"].includes(intent)) comparisonType = "previous_period";
  const groupBy = intent === "contribution" && /渠道/.test(question) ? ["channel"]
    : intent === "rank" && /渠道/.test(question) ? ["channel"]
      : ["compare", "rank", "price_analysis"].includes(intent) ? ["product"]
        : intent === "trend" || intent === "anomaly" ? ["date"] : [];
  return {
    intent,
    resolvedQuestion: question,
    filters,
    metrics: /毛利/.test(question) ? ["salesAmount", "quantity", "avgSellingPrice"] : ["salesAmount", "quantity", "avgSellingPrice", "discountDepth", "priceIndex"],
    groupBy,
    comparison: { type: comparisonType, startDate: null, endDate: null },
    sort: [{ field: intent === "price_analysis" ? "quantityGrowthRate" : "salesAmount", direction: "desc" }],
    limit: 20,
    needsTrend: ["trend", "diagnose_change", "anomaly", "generate_report"].includes(intent),
    needsRawSamples: false,
    warnings: /毛利/.test(question) ? ["当前数据无成本字段，毛利指标不可用"] : [],
  };
}

function parseJson(content) {
  const text = String(content || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(text);
}

export function validatePlan(value, fallback, supportedMetrics = QUERY_WHITELIST.metrics) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const intent = QUERY_WHITELIST.intents.includes(value.intent) ? value.intent : fallback.intent;
  const filters = mergeFilters(fallback.filters, {}, {}, value.filters || {});
  const comparisonType = QUERY_WHITELIST.comparisonTypes.includes(value?.comparison?.type) ? value.comparison.type : fallback.comparison.type;
  const metrics = cleanList(value.metrics).filter((item) => QUERY_WHITELIST.metrics.includes(item) && supportedMetrics.includes(item));
  const groupBy = cleanList(value.groupBy).filter((item) => QUERY_WHITELIST.groupBy.includes(item));
  const sort = (Array.isArray(value.sort) ? value.sort : []).filter((item) => QUERY_WHITELIST.sortFields.includes(item?.field)).slice(0, 2).map((item) => ({ field: item.field, direction: item.direction === "asc" ? "asc" : "desc" }));
  const comparison = {
    type: comparisonType,
    startDate: validDate(value?.comparison?.startDate) ? value.comparison.startDate : null,
    endDate: validDate(value?.comparison?.endDate) ? value.comparison.endDate : null,
  };
  return {
    intent,
    resolvedQuestion: String(value.resolvedQuestion || fallback.resolvedQuestion).slice(0, 500),
    filters: { ...fallback.filters, ...filters },
    metrics: metrics.length ? metrics : fallback.metrics.filter((item) => supportedMetrics.includes(item)),
    groupBy,
    comparison,
    sort: sort.length ? sort : fallback.sort,
    limit: Math.min(AI_CONFIG.maxPlanLimit, Math.max(1, Number(value.limit) || fallback.limit)),
    needsTrend: Boolean(value.needsTrend),
    needsRawSamples: Boolean(value.needsRawSamples),
    warnings: fallback.warnings || [],
  };
}

export async function planQuery({ question, dashboardFilters, memory, catalog, supportedMetrics, dataRange, deepseekClient }) {
  const safeQuestion = String(question || "").trim().slice(0, AI_CONFIG.maxQuestionLength);
  if (!safeQuestion) throw new Error("请输入要分析的问题");
  const fallback = buildFallbackPlan({ question: safeQuestion, dashboardFilters, memory, catalog, dataRange });
  if (typeof deepseekClient !== "function") return { plan: fallback, source: "local-fallback", warning: "DeepSeek查询规划服务未连接，已使用本地安全规划。" };
  try {
    const messages = buildPlannerMessages({ question: safeQuestion, dashboardFilters, memory, catalog, supportedMetrics });
    const response = await deepseekClient({ messages, mode: "planner" });
    return { plan: validatePlan(parseJson(response.content), fallback, supportedMetrics), source: "deepseek", warning: "" };
  } catch (error) {
    return { plan: fallback, source: "local-fallback", warning: `${error?.message || "DeepSeek查询规划失败"}，已使用本地安全规划。` };
  }
}

export default planQuery;
