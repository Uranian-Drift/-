import { AI_MODES, MULTI_QUERY_WHITELIST } from "../config/ai-config.js?v=20260722b";
import { buildDeepPlannerMessages } from "./prompts-v2.js?v=20260722b";

const unique = (values) => [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))];
const isDate = (value) => /^\d{4}-\d{2}(?:-\d{2})?$/.test(String(value || ""));

function parseJson(content) {
  const text = String(content || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(text);
}

function safeFilters(value = {}) {
  const output = {};
  MULTI_QUERY_WHITELIST.filterKeys.forEach((key) => {
    if (["startDate", "endDate"].includes(key)) {
      if (isDate(value[key])) output[key] = value[key];
      return;
    }
    const values = unique(value[key]).slice(0, 50);
    if (values.length) output[key] = values;
  });
  return output;
}

function safeQuery(query, index, modeConfig) {
  const dataset = MULTI_QUERY_WHITELIST.datasets.includes(query?.dataset) ? query.dataset : "sales";
  const groupBy = unique(query?.groupBy).filter((field) => MULTI_QUERY_WHITELIST.dimensions.includes(field)).slice(0, 2);
  const metrics = unique(query?.metrics).filter((field) => MULTI_QUERY_WHITELIST.metrics.includes(field));
  const comparison = MULTI_QUERY_WHITELIST.comparisons.includes(query?.comparison) ? query.comparison : "year_over_year";
  const field = String(query?.sort?.field || (dataset === "ovi" ? "marketSales" : "salesAmount"));
  return {
    id: String(query?.id || `q${index + 1}`).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 30) || `q${index + 1}`,
    label: String(query?.label || `分析任务${index + 1}`).slice(0, 80),
    dataset,
    filters: safeFilters(query?.filters),
    metrics,
    groupBy,
    comparison,
    sort: { field, direction: query?.sort?.direction === "asc" ? "asc" : "desc" },
    limit: Math.min(modeConfig.maxRowsPerQuery, Math.max(1, Number(query?.limit) || modeConfig.maxRowsPerQuery)),
    includeTrend: Boolean(query?.includeTrend),
  };
}

const query = (id, label, dataset, groupBy = [], options = {}) => ({
  id,
  label,
  dataset,
  filters: {},
  metrics: [],
  groupBy,
  comparison: "year_over_year",
  sort: { field: dataset === "ovi" ? "marketSales" : "salesAmount", direction: "desc" },
  limit: options.limit || 40,
  includeTrend: Boolean(options.includeTrend),
});

export function buildFallbackDeepPlan({ question, mode = "deep" } = {}) {
  const modeConfig = AI_MODES[mode] || AI_MODES.deep;
  const tasks = [query("overall_sales", "整体销售与量价同比", "sales", [], { includeTrend: true })];
  const keywordDimension = /店铺/.test(question) ? "store" : /渠道|京东|天猫|抖音|拼多多/.test(question) ? "channel" : /形态|蝶翼|平衡机/.test(question) ? "newShape" : /系列/.test(question) ? "series" : "model";
  tasks.push(query(`by_${keywordDimension}`, `按${keywordDimension}拆解增长和下滑贡献`, "sales", [keywordDimension]));
  if (mode !== "quick") {
    [
      query("by_model", "型号增长与下滑贡献", "sales", ["model"]),
      query("by_channel", "渠道经营变化", "sales", ["channel"]),
      query("by_store", "店铺经营变化", "sales", ["store"]),
      query("by_shape_series", "新版形态与系列结构变化", "sales", ["newShape", "series"]),
      query("industry_overall", "奥维行业规模与方太市占", "ovi", [], { includeTrend: true }),
    ].forEach((task) => { if (!tasks.some((item) => item.id === task.id)) tasks.push(task); });
  }
  if (mode === "deep") {
    tasks.push(
      query("model_channel", "型号与渠道交叉表现", "sales", ["model", "channel"]),
      query("model_store", "型号与店铺交叉表现", "sales", ["model", "store"]),
      query("ovi_brand_rank", "奥维品牌排名与份额", "ovi", ["brand"]),
      query("ovi_price_band", "奥维价位段结构", "ovi", ["priceBand"]),
    );
  }
  return {
    analysisGoal: question || "分析当前经营表现并定位主要驱动因素",
    hypotheses: ["产品结构变化", "渠道或店铺贡献变化", "价格与销量变化", "行业规模或市占变化"],
    queries: tasks.slice(0, modeConfig.maxQueries).map((item, index) => safeQuery(item, index, modeConfig)),
    answerFocus: ["最大正负贡献", "内部因素与市场因素", "可执行动作与观察指标"],
    missingContext: [],
  };
}

export function validateDeepPlan(value, fallback, mode = "deep") {
  const modeConfig = AI_MODES[mode] || AI_MODES.deep;
  if (!value || typeof value !== "object" || !Array.isArray(value.queries)) return fallback;
  const queries = value.queries.slice(0, modeConfig.maxQueries).map((item, index) => safeQuery(item, index, modeConfig));
  if (!queries.length) return fallback;
  return {
    analysisGoal: String(value.analysisGoal || fallback.analysisGoal).slice(0, 800),
    hypotheses: unique(value.hypotheses).slice(0, 12),
    queries,
    answerFocus: unique(value.answerFocus).slice(0, 12),
    missingContext: unique(value.missingContext).slice(0, 12),
  };
}

export async function planDeepAnalysis({ question, mode, dashboardFilters, memory, layer, businessContext, deepseekClient }) {
  const fallback = buildFallbackDeepPlan({ question, mode });
  if (typeof deepseekClient !== "function") return { plan: fallback, source: "local-fallback", warning: "DeepSeek规划服务未连接，使用本地深度规划。" };
  try {
    const messages = buildDeepPlannerMessages({
      question,
      mode,
      dashboardFilters,
      memory,
      catalog: layer.catalog,
      sourceMeta: layer.meta,
      businessContext,
    });
    const response = await deepseekClient({ messages, mode: "planner", maxTokens: 4200 });
    return { plan: validateDeepPlan(parseJson(response.content), fallback, mode), source: "deepseek", warning: "" };
  } catch (error) {
    return { plan: fallback, source: "local-fallback", warning: `${error?.message || "规划失败"}，已使用本地深度规划。` };
  }
}

export default planDeepAnalysis;
