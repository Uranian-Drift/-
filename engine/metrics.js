const numeric = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
const sum = (rows, field) => rows.reduce((total, row) => total + (numeric(row?.[field]) ?? 0), 0);
const divide = (value, base) => Number.isFinite(value) && Number.isFinite(base) && base !== 0 ? value / base : null;
const money = (value) => Number.isFinite(value) ? `¥${Math.round(value).toLocaleString("zh-CN")}` : "-";
const integer = (value) => Number.isFinite(value) ? Math.round(value).toLocaleString("zh-CN") : "-";
const decimal = (value, digits = 2) => Number.isFinite(value) ? value.toFixed(digits) : "-";
const percent = (value) => Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "-";

export const METRIC_REGISTRY = Object.freeze({
  salesAmount: { id: "salesAmount", name: "销售额", calculation: "销售金额合计", formatter: money, requiredFields: ["amount"] },
  quantity: { id: "quantity", name: "销量", calculation: "销售数量合计", formatter: integer, requiredFields: ["qty"] },
  avgSellingPrice: { id: "avgSellingPrice", name: "销售均价", calculation: "销售额÷销量", formatter: money, requiredFields: ["amount", "qty"] },
  accountingAmount: { id: "accountingAmount", name: "核算金额", calculation: "核算价金额合计", formatter: money, requiredFields: ["accounting"] },
  accountingPrice: { id: "accountingPrice", name: "核算价", calculation: "核算金额÷对应销量", formatter: money, requiredFields: ["accounting", "qty"] },
  policyPrice: { id: "policyPrice", name: "政策价", calculation: "政策价金额÷对应销量", formatter: money, requiredFields: ["policy", "qty"] },
  promotionPrice: { id: "promotionPrice", name: "促销价", calculation: "促销价金额÷对应销量", formatter: money, requiredFields: ["promo", "qty"] },
  discountDepth: { id: "discountDepth", name: "折扣深度", calculation: "1－有政策价记录销售额÷政策价金额", formatter: percent, requiredFields: ["amount", "policy"] },
  priceIndex: { id: "priceIndex", name: "价格指数", calculation: "有核算价记录销售额÷核算金额", formatter: decimal, requiredFields: ["amount", "accounting"] },
  productContribution: { id: "productContribution", name: "产品贡献度", calculation: "产品销售额÷筛选范围总销售额", formatter: percent, requiredFields: ["amount", "product"] },
  channelContribution: { id: "channelContribution", name: "渠道贡献度", calculation: "渠道销售额÷筛选范围总销售额", formatter: percent, requiredFields: ["amount", "channel"] },
  salesGrowthRate: { id: "salesGrowthRate", name: "销售额增长率", calculation: "当前销售额÷对比期销售额－1", formatter: percent, requiredFields: ["amount", "date"] },
  quantityGrowthRate: { id: "quantityGrowthRate", name: "销量增长率", calculation: "当前销量÷对比期销量－1", formatter: percent, requiredFields: ["qty", "date"] },
  avgPriceGrowthRate: { id: "avgPriceGrowthRate", name: "均价增长率", calculation: "当前销售均价÷对比期销售均价－1", formatter: percent, requiredFields: ["amount", "qty", "date"] },
  recoveryRate: { id: "recoveryRate", name: "价格恢复率", calculation: "有政策价记录销售额÷政策价金额", formatter: percent, requiredFields: ["amount", "policy"] },
});

export function getSupportedMetrics(records = []) {
  const rows = Array.isArray(records) ? records : [];
  const hasField = (field) => rows.some((row) => {
    if (field === "product") return Boolean(row?.product?.name || row?.product?.code);
    return row?.[field] !== null && row?.[field] !== undefined && row?.[field] !== "";
  });
  return Object.values(METRIC_REGISTRY).filter((metric) => metric.requiredFields.every(hasField));
}

export function summarizeRecords(records = []) {
  const rows = Array.isArray(records) ? records : [];
  const salesAmount = sum(rows, "amount");
  const quantity = sum(rows, "qty");
  const accountingRows = rows.filter((row) => numeric(row?.accounting) !== null);
  const policyRows = rows.filter((row) => numeric(row?.policy) !== null && numeric(row?.policy) !== 0);
  const promoRows = rows.filter((row) => numeric(row?.promo) !== null && numeric(row?.promo) !== 0);
  const accountingAmount = sum(accountingRows, "accounting");
  const accountingSales = sum(accountingRows, "amount");
  const accountingQty = sum(accountingRows, "qty");
  const policyAmount = sum(policyRows, "policy");
  const policySales = sum(policyRows, "amount");
  const policyQty = sum(policyRows, "qty");
  const promotionAmount = sum(promoRows, "promo");
  const promotionQty = sum(promoRows, "qty");
  const values = {
    salesAmount,
    quantity,
    avgSellingPrice: divide(salesAmount, quantity),
    accountingAmount: accountingRows.length ? accountingAmount : null,
    accountingPrice: accountingRows.length ? divide(accountingAmount, accountingQty) : null,
    policyPrice: policyRows.length ? divide(policyAmount, policyQty) : null,
    promotionPrice: promoRows.length ? divide(promotionAmount, promotionQty) : null,
    discountDepth: policyRows.length ? 1 - (divide(policySales, policyAmount) ?? 1) : null,
    priceIndex: accountingRows.length ? divide(accountingSales, accountingAmount) : null,
    recoveryRate: policyRows.length ? divide(policySales, policyAmount) : null,
    recordCount: rows.length,
    skuCount: new Set(rows.map((row) => row?.product?.name || row?.product?.code).filter(Boolean)).size,
    channelCount: new Set(rows.map((row) => row?.channel).filter(Boolean)).size,
    accountingCoverage: rows.length ? accountingRows.length / rows.length : 0,
    policyCoverage: rows.length ? policyRows.length / rows.length : 0,
    promotionCoverage: rows.length ? promoRows.length / rows.length : 0,
  };
  return {
    ...values,
    formatted: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, METRIC_REGISTRY[key]?.formatter ? METRIC_REGISTRY[key].formatter(value) : value])),
  };
}

function nameOf(row) { return row?.product?.name || row?.product?.code || "未标注型号"; }
function channelOf(row) { return row?.channel || "未标注渠道"; }
function group(rows, getter) {
  const map = new Map();
  rows.forEach((row) => { const key = getter(row); if (!map.has(key)) map.set(key, []); map.get(key).push(row); });
  return map;
}

function aggregateGroups(rows, getter, totalSales, contributionKey) {
  return [...group(rows, getter)].map(([name, values]) => {
    const summary = summarizeRecords(values);
    const contribution = divide(summary.salesAmount, totalSales);
    return {
      name,
      sales: summary.salesAmount,
      quantity: summary.quantity,
      averagePrice: summary.avgSellingPrice,
      accountingAmount: summary.accountingAmount,
      accountingPrice: summary.accountingPrice,
      policyPrice: summary.policyPrice,
      promotionPrice: summary.promotionPrice,
      discountDepth: summary.discountDepth,
      priceIndex: summary.priceIndex,
      recoveryRate: summary.recoveryRate,
      share: contribution,
      [contributionKey]: contribution,
      recordCount: values.length,
      formatted: summary.formatted,
    };
  }).sort((a, b) => b.sales - a.sales);
}

export function calculateMetrics(records = []) {
  const rows = (Array.isArray(records) ? records : []).map((row, index) => ({ ...row, _analysisIndex: index }));
  const summaryBase = summarizeRecords(rows);
  const products = aggregateGroups(rows, nameOf, summaryBase.salesAmount, "productContribution").map((item) => {
    const source = rows.find((row) => nameOf(row) === item.name);
    return { ...item, code: source?.product?.code || "", series: source?.product?.series || "未分系列" };
  });
  const channels = aggregateGroups(rows, channelOf, summaryBase.salesAmount, "channelContribution");
  const daily = [...group(rows, (row) => row?.date || "未标注日期")].map(([date, values]) => ({ date, ...summarizeRecords(values) })).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return {
    records: rows,
    summary: {
      ...summaryBase,
      totalSales: summaryBase.salesAmount,
      totalQuantity: summaryBase.quantity,
      averagePrice: summaryBase.avgSellingPrice,
      dateStart: daily[0]?.date || null,
      dateEnd: daily[daily.length - 1]?.date || null,
    },
    products,
    channels,
    daily,
    supportedMetrics: getSupportedMetrics(rows).map((metric) => metric.id),
  };
}

export const deriveMetrics = calculateMetrics;
