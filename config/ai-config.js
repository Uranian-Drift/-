export const AI_CONFIG = Object.freeze({
  model: "deepseek-chat",
  functionUrl: "/.netlify/functions/deepseek",
  requestTimeoutMs: 30000,
  maxQuestionLength: 500,
  maxResultGroups: 20,
  maxTrendPoints: 45,
  maxPlanLimit: 100,
  memoryTurns: 8,
  thresholds: Object.freeze({
    deepDiscount: 0.3,
    channelDependency: 0.6,
    skuDependency: 0.45,
    anomalyDeviation: 0.35,
    lowPriceVolumeQuantityGrowth: 0.08,
    lowPriceVolumePriceGrowth: -0.03,
  }),
});

export const QUERY_WHITELIST = Object.freeze({
  intents: ["summary", "compare", "trend", "diagnose_change", "rank", "anomaly", "contribution", "price_analysis", "generate_report"],
  metrics: ["salesAmount", "quantity", "avgSellingPrice", "accountingAmount", "accountingPrice", "policyPrice", "promotionPrice", "discountDepth", "priceIndex", "productContribution", "channelContribution", "salesGrowthRate", "quantityGrowthRate", "avgPriceGrowthRate", "recoveryRate"],
  groupBy: ["date", "product", "series", "model", "channel", "department"],
  comparisonTypes: ["none", "previous_period", "previous_month", "previous_week", "year_over_year"],
  sortFields: ["salesAmount", "quantity", "avgSellingPrice", "discountDepth", "priceIndex", "productContribution", "channelContribution", "salesGrowthRate", "quantityGrowthRate", "avgPriceGrowthRate", "date", "name"],
});

export const RECOMMENDED_QUESTIONS = Object.freeze([
  "18M2PRO最近表现如何？",
  "16N1和18M2PRO哪个卖得更好？",
  "为什么销售额下降？",
  "哪个渠道贡献最大？",
  "哪些产品存在低价换量？",
  "帮我生成本周经营总结。",
]);
