import { AI_MODES } from "../config/ai-config.js";

const numeric = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const sum = (rows, field) => rows.reduce((total, row) => total + (numeric(row?.[field]) ?? 0), 0);
const divide = (value, base) => Number.isFinite(value) && Number.isFinite(base) && base !== 0 ? value / base : null;
const rate = (current, previous) => Number.isFinite(current) && Number.isFinite(previous) && previous !== 0 ? current / previous - 1 : null;
const iso = (date) => date.toISOString().slice(0, 10);
const unique = (values) => [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))];
const normalized = (value) => String(value || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

const FILTER_DIMENSIONS = Object.freeze({
  models: "model",
  series: "series",
  shapes: "shape",
  newShapes: "newShape",
  core: "core",
  categories: "category",
  positions: "position",
  channels: "channel",
  businesses: "business",
  departments: "business",
  stores: "store",
  brands: "brand",
  priceBands: "priceBand",
  volumeSegments: "volumeSegment",
});

const PRIMARY_METRICS = Object.freeze({
  sales: "salesAmount",
  outbound: "outboundAmount",
  ovi: "marketSales",
  cross: "salesAmount",
});

function shiftDate(value, days = 0, years = 0, months = 0) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCFullYear(date.getUTCFullYear() + years);
  date.setUTCMonth(date.getUTCMonth() + months);
  date.setUTCDate(date.getUTCDate() + days);
  return iso(date);
}

function shiftMonth(value, months) {
  const date = new Date(`${value}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return iso(date).slice(0, 7);
}

function previousRange(filters, type, dataset) {
  if (!filters.startDate || !filters.endDate || type === "none") return null;
  if (filters.startDate > filters.endDate) return null;
  if (dataset === "ovi") {
    const start = filters.startDate.slice(0, 7);
    const end = filters.endDate.slice(0, 7);
    const startDate = new Date(`${start}-01T00:00:00Z`);
    const endDate = new Date(`${end}-01T00:00:00Z`);
    const monthCount = (endDate.getUTCFullYear() - startDate.getUTCFullYear()) * 12 + endDate.getUTCMonth() - startDate.getUTCMonth() + 1;
    if (type === "year_over_year") return { startDate: shiftMonth(start, -12), endDate: shiftMonth(end, -12) };
    if (type === "previous_month") return { startDate: shiftMonth(start, -1), endDate: shiftMonth(end, -1) };
    return { startDate: shiftMonth(start, -monthCount), endDate: shiftMonth(start, -1) };
  }
  const days = Math.round((Date.parse(`${filters.endDate}T00:00:00Z`) - Date.parse(`${filters.startDate}T00:00:00Z`)) / 86400000) + 1;
  if (type === "year_over_year") return { startDate: shiftDate(filters.startDate, 0, -1), endDate: shiftDate(filters.endDate, 0, -1) };
  if (type === "previous_month") return { startDate: shiftDate(filters.startDate, 0, 0, -1), endDate: shiftDate(filters.endDate, 0, 0, -1) };
  return { startDate: shiftDate(filters.startDate, -days), endDate: shiftDate(filters.startDate, -1) };
}

function mergeFilters(base = {}, extra = {}) {
  const result = { ...base, ...extra };
  Object.keys(FILTER_DIMENSIONS).forEach((key) => {
    const values = unique(extra[key]);
    if (values.length) result[key] = values;
    else if (!Array.isArray(result[key])) result[key] = [];
  });
  return result;
}

function effectiveFilters(layer, dataset, requested = {}) {
  const filters = { ...requested };
  if (dataset === "ovi") {
    const minMonth = layer.meta.oviMonthMin;
    const maxMonth = layer.meta.oviMonthMax;
    let startMonth = filters.startDate?.slice(0, 7) || minMonth;
    let endMonth = filters.endDate?.slice(0, 7) || maxMonth;
    if (maxMonth && startMonth > maxMonth) {
      startMonth = maxMonth;
      endMonth = maxMonth;
    } else {
      if (minMonth && startMonth < minMonth) startMonth = minMonth;
      if (maxMonth && endMonth > maxMonth) endMonth = maxMonth;
    }
    if (startMonth) filters.startDate = `${startMonth}-01`;
    if (endMonth) filters.endDate = `${endMonth}-01`;
    return filters;
  }
  const maxDate = dataset === "outbound" ? layer.meta.outboundDateMax : layer.meta.salesDateMax;
  if (filters.endDate && maxDate && filters.endDate > maxDate) filters.endDate = maxDate;
  return filters;
}

function valueMatches(actual, wanted) {
  const source = normalized(actual);
  return wanted.some((value) => {
    const target = normalized(value);
    return source === target || (target.length >= 3 && (source.includes(target) || target.includes(source)));
  });
}

function filterRows(rows, filters = {}, dataset = "sales") {
  const supported = new Set(Object.values(FILTER_DIMENSIONS).filter((dimension) => rows.some((row) => Object.hasOwn(row, dimension))));
  return rows.filter((row) => {
    const period = dataset === "ovi" ? row.month : row.date;
    const start = dataset === "ovi" ? filters.startDate?.slice(0, 7) : filters.startDate;
    const end = dataset === "ovi" ? filters.endDate?.slice(0, 7) : filters.endDate;
    if (start && period < start) return false;
    if (end && period > end) return false;
    return Object.entries(FILTER_DIMENSIONS).every(([key, dimension]) => {
      const wanted = unique(filters[key]);
      if (!wanted.length || !supported.has(dimension)) return true;
      return valueMatches(row[dimension], wanted);
    });
  });
}

function salesSummary(rows) {
  const amount = sum(rows, "amount");
  const quantity = sum(rows, "qty");
  const accountingRows = rows.filter((row) => numeric(row.accounting) !== null);
  const policyRows = rows.filter((row) => numeric(row.policy) !== null && numeric(row.policy) !== 0);
  const accountingAmount = sum(accountingRows, "accounting");
  const accountingSales = sum(accountingRows, "amount");
  const policyAmount = sum(policyRows, "policy");
  const policySales = sum(policyRows, "amount");
  return {
    salesAmount: amount,
    quantity,
    avgSellingPrice: divide(amount, quantity),
    accountingAmount: accountingRows.length ? accountingAmount : null,
    policyAmount: policyRows.length ? policyAmount : null,
    priceIndex: accountingRows.length ? divide(accountingSales, accountingAmount) : null,
    recoveryRate: policyRows.length ? divide(policySales, policyAmount) : null,
    recordCount: rows.length,
    skuCount: new Set(rows.map((row) => row.model)).size,
  };
}

function outboundSummary(rows) {
  const quantity = sum(rows, "qty");
  const amount = sum(rows, "amount");
  return {
    outboundQuantity: quantity,
    outboundAmount: amount,
    outboundAvgPrice: divide(amount, quantity),
    recordCount: rows.length,
    skuCount: new Set(rows.map((row) => row.model)).size,
  };
}

function oviSummary(rows, brand) {
  const marketSales = sum(rows, "sales");
  const marketQuantity = sum(rows, "qty");
  const brandRows = rows.filter((row) => row.brand === brand);
  const brandSales = sum(brandRows, "sales");
  const brandQuantity = sum(brandRows, "qty");
  const brandTotals = [...new Set(rows.map((row) => row.brand))]
    .map((name) => ({ name, sales: sum(rows.filter((row) => row.brand === name), "sales") }))
    .sort((a, b) => b.sales - a.sales);
  return {
    marketSales,
    marketQuantity,
    marketAvgPrice: divide(marketSales, marketQuantity),
    brandSales,
    brandQuantity,
    brandAvgPrice: divide(brandSales, brandQuantity),
    brandShare: divide(brandSales, marketSales),
    brandRank: Math.max(0, brandTotals.findIndex((item) => item.name === brand)) + 1,
    marketBrandCount: brandTotals.length,
    recordCount: rows.length,
  };
}

function compareSummary(current = {}, previous = {}) {
  const fields = [...new Set([...Object.keys(current), ...Object.keys(previous)])];
  return {
    absolute: Object.fromEntries(fields.map((field) => [field, Number.isFinite(current[field]) && Number.isFinite(previous[field]) ? current[field] - previous[field] : null])),
    rate: Object.fromEntries(fields.map((field) => [field, rate(current[field], previous[field])])),
  };
}

function groupRows(rows, dimensions = []) {
  if (!dimensions.length) return [];
  const groups = new Map();
  rows.forEach((row) => {
    const values = dimensions.map((dimension) => row[dimension] || "未标注");
    const key = JSON.stringify(values);
    if (!groups.has(key)) groups.set(key, { key, name: values.join(" / "), dimensions: Object.fromEntries(dimensions.map((dimension, index) => [dimension, values[index]])), rows: [] });
    groups.get(key).rows.push(row);
  });
  return [...groups.values()];
}

function summaryFor(dataset, rows, brand) {
  if (dataset === "outbound") return outboundSummary(rows);
  if (dataset === "ovi") return oviSummary(rows, brand);
  return salesSummary(rows);
}

function sortRows(rows, sort = {}, fallbackField = "salesAmount") {
  const field = sort.field || fallbackField;
  const direction = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = field.startsWith("change.") ? a.change?.rate?.[field.slice(7)] : a.current?.[field] ?? a[field];
    const bv = field.startsWith("change.") ? b.change?.rate?.[field.slice(7)] : b.current?.[field] ?? b[field];
    if (typeof av === "string") return av.localeCompare(String(bv || ""), "zh-CN") * direction;
    return ((Number(av) || 0) - (Number(bv) || 0)) * direction;
  });
}

function buildTrend(dataset, rows, brand, maxPoints) {
  const dimension = dataset === "ovi" ? "month" : "date";
  return groupRows(rows, [dimension])
    .map((group) => ({ period: group.name, ...summaryFor(dataset, group.rows, brand) }))
    .sort((a, b) => a.period.localeCompare(b.period))
    .slice(-maxPoints);
}

function executeSingle(layer, query, baseFilters, modeConfig) {
  const dataset = ["sales", "outbound", "ovi"].includes(query.dataset) ? query.dataset : "sales";
  const requestedFilters = mergeFilters(baseFilters, query.filters || {});
  const filters = effectiveFilters(layer, dataset, requestedFilters);
  const source = layer.sources[dataset] || [];
  const currentRows = filterRows(source, filters, dataset);
  const comparisonType = query.comparison || "year_over_year";
  const priorPeriod = previousRange(filters, comparisonType, dataset);
  const previousFilters = priorPeriod ? { ...filters, ...priorPeriod } : null;
  const previousRows = previousFilters ? filterRows(source, previousFilters, dataset) : [];
  const current = summaryFor(dataset, currentRows, layer.brand);
  const previous = previousFilters ? summaryFor(dataset, previousRows, layer.brand) : null;
  const groupBy = unique(query.groupBy).slice(0, 2);
  const previousGroups = new Map(groupRows(previousRows, groupBy).map((group) => [group.key, group]));
  const primary = PRIMARY_METRICS[dataset];
  const total = current[primary] || 0;
  let rows = groupRows(currentRows, groupBy).map((group) => {
    const currentGroup = summaryFor(dataset, group.rows, layer.brand);
    const previousGroupRows = previousGroups.get(group.key)?.rows || [];
    const previousGroup = previousFilters ? summaryFor(dataset, previousGroupRows, layer.brand) : null;
    return {
      name: group.name,
      dimensions: group.dimensions,
      current: { ...currentGroup, contribution: divide(currentGroup[primary], total) },
      previous: previousGroup,
      change: previousGroup ? compareSummary(currentGroup, previousGroup) : null,
    };
  });
  if (dataset === "ovi" && groupBy[0] === "brand") {
    rows = rows.map((item) => ({ ...item, current: { ...item.current, brandShare: item.current.marketSales / (current.marketSales || 1) } }));
  }
  rows = sortRows(rows, query.sort, primary).slice(0, Math.min(Number(query.limit) || modeConfig.maxRowsPerQuery, modeConfig.maxRowsPerQuery));
  return {
    id: query.id,
    label: query.label || `${dataset}分析`,
    dataset,
    metrics: unique(query.metrics),
    groupBy,
    filters,
    comparison: priorPeriod ? { type: comparisonType, ...priorPeriod } : { type: "none" },
    current,
    previous,
    change: previous ? compareSummary(current, previous) : null,
    rows,
    trend: query.includeTrend ? buildTrend(dataset, currentRows, layer.brand, modeConfig.maxTrendPoints) : [],
    meta: {
      currentRowCount: currentRows.length,
      previousRowCount: previousRows.length,
      truncated: rows.length >= modeConfig.maxRowsPerQuery,
      dateAdjustedToSourceCoverage: requestedFilters.startDate !== filters.startDate || requestedFilters.endDate !== filters.endDate,
      requestedDateRange: { startDate: requestedFilters.startDate, endDate: requestedFilters.endDate },
    },
  };
}

function crossSummary(salesRows, outboundRows) {
  const sales = salesSummary(salesRows);
  const outbound = outboundSummary(outboundRows);
  return {
    salesAmount: sales.salesAmount,
    salesQuantity: sales.quantity,
    avgSellingPrice: sales.avgSellingPrice,
    outboundAmount: outbound.outboundAmount,
    outboundQuantity: outbound.outboundQuantity,
    sellThroughRate: divide(sales.quantity, outbound.outboundQuantity),
    flowGap: outbound.outboundQuantity - sales.quantity,
  };
}

function executeCross(layer, query, baseFilters, modeConfig) {
  const requestedFilters = mergeFilters(baseFilters, query.filters || {});
  const comparableEnd = [requestedFilters.endDate, layer.meta.salesDateMax, layer.meta.outboundDateMax].filter(Boolean).sort()[0];
  const filters = { ...requestedFilters, ...(comparableEnd ? { endDate: comparableEnd } : {}) };
  const currentSales = filterRows(layer.sources.sales, filters, "sales");
  const currentOutbound = filterRows(layer.sources.outbound, filters, "outbound");
  const comparisonType = query.comparison || "year_over_year";
  const priorPeriod = previousRange(filters, comparisonType, "sales");
  const priorFilters = priorPeriod ? { ...filters, ...priorPeriod } : null;
  const priorSales = priorFilters ? filterRows(layer.sources.sales, priorFilters, "sales") : [];
  const priorOutbound = priorFilters ? filterRows(layer.sources.outbound, priorFilters, "outbound") : [];
  const groupBy = unique(query.groupBy).slice(0, 2);
  const salesGroups = new Map(groupRows(currentSales, groupBy).map((group) => [group.key, group]));
  const outboundGroups = new Map(groupRows(currentOutbound, groupBy).map((group) => [group.key, group]));
  const priorSalesGroups = new Map(groupRows(priorSales, groupBy).map((group) => [group.key, group]));
  const priorOutboundGroups = new Map(groupRows(priorOutbound, groupBy).map((group) => [group.key, group]));
  const keys = new Set([...salesGroups.keys(), ...outboundGroups.keys()]);
  let rows = [...keys].map((key) => {
    const saleGroup = salesGroups.get(key);
    const outboundGroup = outboundGroups.get(key);
    const current = crossSummary(saleGroup?.rows || [], outboundGroup?.rows || []);
    const previous = priorPeriod ? crossSummary(priorSalesGroups.get(key)?.rows || [], priorOutboundGroups.get(key)?.rows || []) : null;
    return {
      name: saleGroup?.name || outboundGroup?.name || "未标注",
      dimensions: saleGroup?.dimensions || outboundGroup?.dimensions || {},
      current,
      previous,
      change: previous ? compareSummary(current, previous) : null,
    };
  });
  rows = sortRows(rows, query.sort, "salesAmount").slice(0, Math.min(Number(query.limit) || modeConfig.maxRowsPerQuery, modeConfig.maxRowsPerQuery));
  const current = crossSummary(currentSales, currentOutbound);
  const previous = priorPeriod ? crossSummary(priorSales, priorOutbound) : null;
  return {
    id: query.id,
    label: query.label || "销售与出库交叉分析",
    dataset: "cross",
    metrics: unique(query.metrics),
    groupBy,
    filters,
    comparison: priorPeriod ? { type: comparisonType, ...priorPeriod } : { type: "none" },
    current,
    previous,
    change: previous ? compareSummary(current, previous) : null,
    rows,
    trend: [],
    meta: {
      currentRowCount: currentSales.length + currentOutbound.length,
      previousRowCount: priorSales.length + priorOutbound.length,
      truncated: rows.length >= modeConfig.maxRowsPerQuery,
      dateAdjustedToSourceCoverage: requestedFilters.endDate !== filters.endDate,
      requestedDateRange: { startDate: requestedFilters.startDate, endDate: requestedFilters.endDate },
    },
  };
}

export function createMultiQueryEngine(layer) {
  return {
    execute(plan = {}, { mode = "deep", baseFilters = {} } = {}) {
      const modeConfig = AI_MODES[mode] || AI_MODES.deep;
      const queries = (Array.isArray(plan.queries) ? plan.queries : []).slice(0, modeConfig.maxQueries);
      return queries.map((query, index) => {
        const safeQuery = { ...query, id: query.id || `q${index + 1}` };
        return safeQuery.dataset === "cross"
          ? executeCross(layer, safeQuery, baseFilters, modeConfig)
          : executeSingle(layer, safeQuery, baseFilters, modeConfig);
      });
    },
  };
}

export default createMultiQueryEngine;
