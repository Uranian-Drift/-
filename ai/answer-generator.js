import { AI_CONFIG } from "../config/ai-config.js";
import { buildAnswerMessages } from "./prompts.js";

const pct = (value) => Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%` : "-";
const money = (value) => Number.isFinite(value) ? `¥${Math.round(value).toLocaleString("zh-CN")}` : "-";
const integer = (value) => Number.isFinite(value) ? Math.round(value).toLocaleString("zh-CN") : "-";

export function compressQueryResult(result = {}) {
  const pickSummary = (summary) => summary ? {
    salesAmount: summary.salesAmount,
    quantity: summary.quantity,
    avgSellingPrice: summary.avgSellingPrice,
    accountingPrice: summary.accountingPrice,
    policyPrice: summary.policyPrice,
    promotionPrice: summary.promotionPrice,
    discountDepth: summary.discountDepth,
    priceIndex: summary.priceIndex,
    recoveryRate: summary.recoveryRate,
    recordCount: summary.recordCount,
    skuCount: summary.skuCount,
  } : null;
  const pickGroup = (item) => ({
    name: item.name,
    salesAmount: item.salesAmount,
    quantity: item.quantity,
    avgSellingPrice: item.avgSellingPrice,
    discountDepth: item.discountDepth,
    priceIndex: item.priceIndex,
    productContribution: item.productContribution,
    channelContribution: item.channelContribution,
    changeRate: item.changeRate,
  });
  return {
    meta: result.meta,
    current: pickSummary(result.current),
    comparison: pickSummary(result.comparison),
    change: result.comparisonResult ? {
      absoluteChange: result.comparisonResult.absoluteChange,
      changeRate: result.comparisonResult.changeRate,
      decomposition: result.comparisonResult.decomposition,
      contributionAnalysis: result.comparisonResult.contributionAnalysis?.slice(0, 10),
    } : null,
    groups: (result.groups || []).slice(0, AI_CONFIG.maxResultGroups).map(pickGroup),
    topProducts: (result.productGroups || []).slice(0, 8).map(pickGroup),
    channelDistribution: (result.channelGroups || []).slice(0, 8).map(pickGroup),
    trend: (result.trend || []).slice(-AI_CONFIG.maxTrendPoints),
    anomalies: (result.anomalies || []).slice(0, 8),
  };
}

function scopeText(meta = {}) {
  const filters = meta.actualFilters || {};
  const products = (filters.products || []).length ? filters.products.join("、") : "全部产品";
  const channels = (filters.channels || []).length ? filters.channels.join("、") : "全部渠道";
  const comparison = meta.comparison?.type && meta.comparison.type !== "none"
    ? `${meta.comparison.type}（${meta.comparison.startDate}至${meta.comparison.endDate}）` : "无对比期";
  return `${filters.startDate || "最早日期"}至${filters.endDate || "最新日期"}；${products}；${channels}；${comparison}`;
}

export function buildLocalAnswer({ question, plan, result, insights, warning }) {
  const current = result.current || {};
  const changes = result.comparisonResult?.changeRate || {};
  const top = result.groups?.[0] || result.productGroups?.[0] || result.channelGroups?.[0];
  const unsupportedMargin = /毛利/.test(question);
  const conclusion = unsupportedMargin
    ? "当前数据不包含成本字段，无法计算毛利或毛利率；以下仅提供可核验的销售与价格指标。"
    : result.meta?.rowCount === 0
      ? "当前条件没有匹配到销售记录，请调整日期、产品或渠道。"
      : `当前销售额${money(current.salesAmount)}、销量${integer(current.quantity)}台、成交均价${money(current.avgSellingPrice)}${Number.isFinite(changes.salesGrowthRate) ? `；销售额较对比期${pct(changes.salesGrowthRate)}` : ""}。`;
  const decomposition = result.comparisonResult?.decomposition;
  const reasons = decomposition
    ? `销量变化${pct(changes.quantityGrowthRate)}，均价变化${pct(changes.avgPriceGrowthRate)}；数量影响约${money(decomposition.quantityEffect)}，价格影响约${money(decomposition.priceEffect)}${decomposition.priceVolumeOpposite ? "，价格与销量方向相反，需关注低价换量或提价损量。" : "。"}`
    : "当前问题未要求或没有足够对比数据，暂不做变化归因。";
  const evidence = top ? `${top.name}为当前首位，销售额${money(top.salesAmount)}、销量${integer(top.quantity)}台。` : "当前没有可展示的分组明细。";
  const risk = [warning, ...(plan.warnings || []), ...(insights || []).filter((item) => item.level !== "low").slice(0, 2).map((item) => item.message)].filter(Boolean).join("；") || "未触发预设风险阈值；仍需结合活动、流量与库存信息判断因果。";
  return `【结论】\n${conclusion}\n\n【数据依据】\n${evidence}\n实际口径：${scopeText(result.meta)}。有效记录${integer(result.meta?.rowCount)}行。\n\n【原因拆解】\n${reasons}\n\n【建议动作】\n1. 优先核查变化贡献最大的产品与渠道，并拆到日趋势验证。\n2. 对均价下滑但销量增长的型号核查活动与搭配购影响。\n3. 将重点型号16N1、18M2PRO按渠道持续跟踪销量与价格恢复。\n\n【风险与限制】\n${risk}`;
}

export async function generateAnswer({ question, plan, result, insights, deepseekClient, plannerWarning = "" }) {
  const compressed = compressQueryResult(result);
  if (typeof deepseekClient !== "function") return { content: buildLocalAnswer({ question, plan, result, insights, warning: "DeepSeek服务未连接，当前为本地计算摘要。" }), source: "local-fallback", model: "local-rules", warning: "DeepSeek服务未连接" };
  try {
    const messages = buildAnswerMessages({ question, plan, result: compressed, insights });
    const response = await deepseekClient({ messages, mode: "answer" });
    return { content: response.content, source: "deepseek", model: response.model || AI_CONFIG.model, warning: plannerWarning };
  } catch (error) {
    const warning = `${error?.message || "DeepSeek服务不可用"}。已返回本地计算摘要。`;
    return { content: buildLocalAnswer({ question, plan, result, insights, warning }), source: "local-fallback", model: "local-rules", warning };
  }
}

export default generateAnswer;
