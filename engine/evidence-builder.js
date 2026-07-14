const finite = (value) => Number.isFinite(Number(value));
const value = (input) => finite(input) ? Number(input) : null;

const SUMMARY_FIELDS = [
  "salesAmount", "quantity", "avgSellingPrice", "accountingAmount", "policyAmount", "priceIndex", "recoveryRate",
  "recordCount", "skuCount", "outboundQuantity", "outboundAmount", "outboundAvgPrice", "marketSales",
  "marketQuantity", "marketAvgPrice", "brandSales", "brandQuantity", "brandAvgPrice", "brandShare", "brandRank",
  "marketBrandCount", "salesQuantity", "sellThroughRate", "flowGap", "contribution",
];

function compactObject(input = {}) {
  return Object.fromEntries(SUMMARY_FIELDS.filter((field) => finite(input[field])).map((field) => [field, value(input[field])]));
}

function compactChange(change) {
  if (!change) return null;
  const compact = (input = {}) => Object.fromEntries(Object.entries(input).filter(([, item]) => finite(item)).map(([key, item]) => [key, value(item)]));
  return { absolute: compact(change.absolute), rate: compact(change.rate) };
}

function compactRow(row = {}) {
  return {
    name: row.name,
    dimensions: row.dimensions,
    current: compactObject(row.current),
    previous: row.previous ? compactObject(row.previous) : null,
    change: compactChange(row.change),
  };
}

function queryEvidence(result = {}) {
  return {
    factId: result.id,
    label: result.label,
    dataset: result.dataset,
    groupBy: result.groupBy,
    filters: result.filters,
    comparison: result.comparison,
    current: compactObject(result.current),
    previous: result.previous ? compactObject(result.previous) : null,
    change: compactChange(result.change),
    rows: (result.rows || []).map(compactRow),
    trend: (result.trend || []).map((item) => ({ period: item.period, ...compactObject(item) })),
    meta: result.meta,
  };
}

function changeOf(row, preferred = "salesAmount") {
  const absolute = row?.change?.absolute || {};
  const rate = row?.change?.rate || {};
  const candidates = [preferred, "salesAmount", "quantity", "outboundAmount", "outboundQuantity", "marketSales", "brandSales"];
  const metric = candidates.find((field) => finite(absolute[field])) || candidates.find((field) => finite(rate[field]));
  return metric ? { metric, absolute: value(absolute[metric]), rate: value(rate[metric]) } : null;
}

function buildSignals(results = []) {
  const contributions = results.flatMap((result) => (result.rows || []).map((row) => ({
    factId: result.id,
    query: result.label,
    dataset: result.dataset,
    name: row.name,
    dimensions: row.dimensions,
    ...changeOf(row, result.dataset === "outbound" ? "outboundAmount" : result.dataset === "ovi" ? "marketSales" : "salesAmount"),
  }))).filter((item) => finite(item.absolute));
  const ranked = (dataset, direction) => contributions
    .filter((item) => item.dataset === dataset && (direction === "positive" ? item.absolute > 0 : item.absolute < 0))
    .sort((a, b) => direction === "positive" ? b.absolute - a.absolute : a.absolute - b.absolute)
    .slice(0, 20);
  const positive = ranked("sales", "positive");
  const negative = ranked("sales", "negative");

  const lowPriceVolume = results.flatMap((result) => (result.rows || []).map((row) => ({
    factId: result.id,
    name: row.name,
    quantityGrowth: row.change?.rate?.quantity,
    priceGrowth: row.change?.rate?.avgSellingPrice,
  }))).filter((item) => finite(item.quantityGrowth) && finite(item.priceGrowth) && item.quantityGrowth > 0.08 && item.priceGrowth < -0.03).slice(0, 20);

  const cross = results.find((result) => result.dataset === "cross");
  const ovi = results.find((result) => result.dataset === "ovi" && finite(result.current?.brandShare));
  const sales = results.find((result) => result.dataset === "sales" && !result.groupBy?.length);
  return {
    topPositiveContributors: positive,
    topNegativeContributors: negative,
    contributorsByDataset: {
      sales: { positive, negative },
      outbound: { positive: ranked("outbound", "positive"), negative: ranked("outbound", "negative") },
      ovi: { positive: ranked("ovi", "positive"), negative: ranked("ovi", "negative") },
      cross: { positive: ranked("cross", "positive"), negative: ranked("cross", "negative") },
    },
    lowPriceVolume,
    salesAndOutbound: cross ? { factId: cross.id, current: compactObject(cross.current), previous: compactObject(cross.previous || {}), change: compactChange(cross.change) } : null,
    industryPosition: ovi ? { factId: ovi.id, current: compactObject(ovi.current), previous: compactObject(ovi.previous || {}), change: compactChange(ovi.change) } : null,
    overallSales: sales ? { factId: sales.id, current: compactObject(sales.current), previous: compactObject(sales.previous || {}), change: compactChange(sales.change) } : null,
  };
}

export function buildEvidencePack({ question, mode, filters, plan, results, businessContext, layerMeta } = {}) {
  const queries = (results || []).map(queryEvidence);
  return {
    meta: {
      question,
      mode,
      generatedAt: new Date().toISOString(),
      filters,
      queryCount: queries.length,
      plannerGoal: plan?.analysisGoal || question,
      plannerHypotheses: plan?.hypotheses || [],
      sourceCoverage: layerMeta,
    },
    businessContext,
    signals: buildSignals(results),
    queries,
    dataQuality: {
      factsAreAggregatedLocally: true,
      rawSalesRowsSentToModel: false,
      causalityWarning: "经营数据可以证明变化和贡献，不能在缺少流量、活动、库存等信息时直接证明因果。",
    },
  };
}

export default buildEvidencePack;
