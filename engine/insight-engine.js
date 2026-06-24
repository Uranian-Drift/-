import { AI_CONFIG } from "../config/ai-config.js";

const pct = (value) => Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "-";
const money = (value) => Number.isFinite(value) ? `¥${Math.round(value).toLocaleString("zh-CN")}` : "-";

export function generateInsights(queryResult = {}) {
  const insights = [];
  const current = queryResult.current || queryResult.summary || {};
  const changes = queryResult.comparisonResult?.changeRate || {};
  const groups = queryResult.groups || [];
  const topChannel = (queryResult.channelGroups || []).sort((a, b) => b.salesAmount - a.salesAmount)[0];
  const topProduct = (queryResult.productGroups || []).sort((a, b) => b.salesAmount - a.salesAmount)[0];

  if (Number.isFinite(current.discountDepth) && current.discountDepth > AI_CONFIG.thresholds.deepDiscount) {
    insights.push({ type: "price_discount", level: "high", title: "折扣偏深", message: `当前折扣深度${pct(current.discountDepth)}，超过30%关注线。`, evidence: { discountDepth: current.discountDepth }, relatedDimensions: ["price"] });
  }
  if (topChannel?.channelContribution > AI_CONFIG.thresholds.channelDependency) {
    insights.push({ type: "channel_dependency", level: "high", title: "渠道依赖", message: `${topChannel.name}贡献${pct(topChannel.channelContribution)}，单一渠道依赖较高。`, evidence: topChannel, relatedDimensions: ["channel"] });
  }
  if (topProduct?.productContribution > AI_CONFIG.thresholds.skuDependency) {
    insights.push({ type: "product_concentration", level: "medium", title: "SKU集中度较高", message: `${topProduct.name}贡献${pct(topProduct.productContribution)}，需关注爆品波动对整体的影响。`, evidence: topProduct, relatedDimensions: ["product"] });
  }
  if (Number.isFinite(changes.salesGrowthRate) && changes.salesGrowthRate < 0) {
    const q = changes.quantityGrowthRate;
    const p = changes.avgPriceGrowthRate;
    insights.push({
      type: "sales_decline", level: changes.salesGrowthRate < -0.2 ? "high" : "medium", title: "销售额下降",
      message: `销售额较对比期${pct(changes.salesGrowthRate)}，销量${pct(q)}、均价${pct(p)}。`,
      evidence: { salesGrowthRate: changes.salesGrowthRate, quantityGrowthRate: q, avgPriceGrowthRate: p }, relatedDimensions: ["date", "product", "channel"],
    });
  }
  const lowPriceVolume = groups.filter((item) => item?.changeRate?.quantityGrowthRate > AI_CONFIG.thresholds.lowPriceVolumeQuantityGrowth && item?.changeRate?.avgPriceGrowthRate < AI_CONFIG.thresholds.lowPriceVolumePriceGrowth);
  if (lowPriceVolume.length) {
    insights.push({ type: "low_price_volume", level: "medium", title: "低价换量", message: `${lowPriceVolume.slice(0, 3).map((item) => item.name).join("、")}呈现销量增长但均价下滑。`, evidence: lowPriceVolume.slice(0, 3), relatedDimensions: ["product", "price"] });
  }
  const anomaly = (queryResult.anomalies || [])[0];
  if (anomaly) insights.push({ type: "volume_anomaly", level: Math.abs(anomaly.deviationRate) > 0.6 ? "high" : "medium", title: "销量异常波动", message: `${anomaly.date}销量${anomaly.quantity}台，较日均偏离${pct(anomaly.deviationRate)}。`, evidence: anomaly, relatedDimensions: ["date"] });
  if (!insights.length) insights.push({ type: "stable", level: "low", title: "暂无显著异常", message: `当前范围销售额${money(current.salesAmount)}，未触发预设经营风险阈值。`, evidence: { salesAmount: current.salesAmount }, relatedDimensions: [] });
  return insights.slice(0, 8);
}

export default generateInsights;
