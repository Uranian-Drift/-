export const AI_CONFIG = Object.freeze({
  model: "deepseek-chat",
  functionUrl: "/.netlify/functions/deepseek",
  requestTimeoutMs: 45000,
  maxQuestionLength: 1000,
  maxResultGroups: 50,
  maxTrendPoints: 180,
  maxPlanLimit: 200,
  memoryTurns: 12,
  thresholds: Object.freeze({
    channelDependency: 0.6,
    skuDependency: 0.45,
    anomalyDeviation: 0.35,
    lowPriceVolumeQuantityGrowth: 0.08,
    lowPriceVolumePriceGrowth: -0.03,
  }),
});

export const AI_MODES = Object.freeze({
  quick: Object.freeze({
    id: "quick",
    label: "快速查询",
    description: "查数字、排名和单一维度表现",
    maxQueries: 3,
    maxRowsPerQuery: 15,
    maxTrendPoints: 45,
    review: false,
    maxAnswerTokens: 2200,
  }),
  professional: Object.freeze({
    id: "professional",
    label: "专业分析",
    description: "自动执行多维拆解并生成经营动作",
    maxQueries: 8,
    maxRowsPerQuery: 35,
    maxTrendPoints: 120,
    review: true,
    maxAnswerTokens: 4200,
  }),
  deep: Object.freeze({
    id: "deep",
    label: "深度诊断",
    description: "跨销售与奥维执行完整诊断并二次复核",
    maxQueries: 15,
    maxRowsPerQuery: 60,
    maxTrendPoints: 180,
    review: true,
    maxAnswerTokens: 7000,
  }),
});

export const MULTI_QUERY_WHITELIST = Object.freeze({
  datasets: ["sales", "ovi"],
  dimensions: [
    "date", "month", "model", "productCode", "series", "shape", "newShape", "core",
    "category", "position", "channel", "business", "store", "brand", "priceBand", "volumeSegment",
  ],
  comparisons: ["none", "year_over_year", "previous_period", "previous_month"],
  metrics: [
    "salesAmount", "quantity", "avgSellingPrice", "accountingAmount", "policyAmount", "priceIndex",
    "recoveryRate", "recordCount", "skuCount", "contribution", "salesGrowthRate", "quantityGrowthRate",
    "avgPriceGrowthRate", "marketSales",
    "marketQuantity", "marketAvgPrice", "brandSales", "brandQuantity", "brandShare", "brandRank",
  ],
  filterKeys: [
    "startDate", "endDate", "models", "series", "shapes", "newShapes", "core", "categories", "positions",
    "channels", "businesses", "stores", "brands", "priceBands", "volumeSegments",
  ],
});

export const QUERY_WHITELIST = Object.freeze({
  intents: ["summary", "compare", "trend", "diagnose_change", "rank", "anomaly", "contribution", "price_analysis", "generate_report"],
  metrics: ["salesAmount", "quantity", "avgSellingPrice", "accountingAmount", "accountingPrice", "policyPrice", "promotionPrice", "priceIndex", "productContribution", "channelContribution", "salesGrowthRate", "quantityGrowthRate", "avgPriceGrowthRate", "recoveryRate"],
  groupBy: ["date", "product", "series", "model", "channel", "department"],
  comparisonTypes: ["none", "previous_period", "previous_month", "previous_week", "year_over_year"],
  sortFields: ["salesAmount", "quantity", "avgSellingPrice", "priceIndex", "productContribution", "channelContribution", "salesGrowthRate", "quantityGrowthRate", "avgPriceGrowthRate", "date", "name"],
});

export const RECOMMENDED_QUESTIONS = Object.freeze([
  "本月经营表现为什么变化？请从型号、渠道、店铺、形态和奥维进行深度诊断。",
  "找出本月销售下滑贡献最大的型号，并继续拆到渠道和店铺。",
  "哪些型号存在低价换量？对销售额和销售指数分别有什么影响？",
  "哪些型号的销售变化最值得关注？请继续拆到渠道和店铺。",
  "结合奥维判断方太的变化主要来自行业、价格段还是自身经营。",
  "生成本月GTM经营复盘和未来7天行动清单。",
]);
