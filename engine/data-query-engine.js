import { AI_CONFIG } from "../config/ai-config.js";
import { summarizeRecords, METRIC_REGISTRY } from "./metrics.js";
import { compareSummaries } from "./comparison-engine.js";

const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const iso = (date) => date.toISOString().slice(0, 10);
const shiftDays = (value, days) => { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return iso(date); };
const shiftYears = (value, years) => { const date = new Date(`${value}T00:00:00Z`); date.setUTCFullYear(date.getUTCFullYear() + years); return iso(date); };
const normalize = (value) => String(value || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const productName = (row) => row?.product?.name || row?.product?.code || "未标注型号";
const seriesName = (row) => row?.product?.series || "未分系列";
const modelName = (row) => row?.product?.code || row?.product?.name || "未标注型号";
const channelName = (row) => row?.channel || "未标注渠道";
const departmentName = (row) => row?.business || "未标注业务部";

const DIMENSIONS = Object.freeze({
  date: (row) => row?.date || "未标注日期",
  product: productName,
  series: seriesName,
  model: modelName,
  channel: channelName,
  department: departmentName,
});

function resolveProducts(values, catalog) {
  const wanted = (values || []).map(normalize).filter(Boolean);
  if (!wanted.length) return [];
  return catalog.filter((item) => {
    const haystack = [item.name, item.code].map(normalize);
    return wanted.some((needle) => haystack.some((value) => value.includes(needle) || needle.includes(value)));
  }).map((item) => item.name);
}

function filterRows(records, filters, catalog) {
  const resolvedProducts = resolveProducts([...(filters.products || []), ...(filters.models || [])], catalog);
  const productSet = new Set(resolvedProducts.map(normalize));
  const sets = {
    series: new Set((filters.series || []).map(normalize)),
    channels: new Set((filters.channels || []).map(normalize)),
    departments: new Set((filters.departments || []).map(normalize)),
  };
  const rows = records.filter((row) => {
    if (filters.startDate && row.date < filters.startDate) return false;
    if (filters.endDate && row.date > filters.endDate) return false;
    if (productSet.size && !productSet.has(normalize(productName(row)))) return false;
    if (sets.series.size && !sets.series.has(normalize(seriesName(row)))) return false;
    if (sets.channels.size) {
      const channel = normalize(channelName(row));
      if (![...sets.channels].some((wanted) => channel.includes(wanted) || wanted.includes(channel))) return false;
    }
    if (sets.departments.size && !sets.departments.has(normalize(departmentName(row)))) return false;
    return true;
  });
  return { rows, resolvedProducts };
}

function aggregate(rows, name) {
  const summary = summarizeRecords(rows);
  return { name, ...summary };
}

function groupRows(rows, dimensions = []) {
  if (!dimensions.length) return [];
  const map = new Map();
  rows.forEach((row) => {
    const values = dimensions.map((dimension) => DIMENSIONS[dimension]?.(row) || "未标注");
    const key = JSON.stringify(values);
    if (!map.has(key)) map.set(key, { name: values.join(" / "), values, rows: [] });
    map.get(key).rows.push(row);
  });
  const totalSales = summarizeRecords(rows).salesAmount;
  return [...map.values()].map((group) => {
    const item = aggregate(group.rows, group.name);
    const contribution = totalSales ? item.salesAmount / totalSales : null;
    return { ...item, dimensions: Object.fromEntries(dimensions.map((dimension, index) => [dimension, group.values[index]])), contribution };
  });
}

function comparisonRange(filters, comparison) {
  const start = comparison?.startDate;
  const end = comparison?.endDate;
  if (validDate(start) && validDate(end)) return { startDate: start, endDate: end };
  if (!validDate(filters.startDate) || !validDate(filters.endDate) || comparison?.type === "none") return null;
  const days = Math.round((Date.parse(`${filters.endDate}T00:00:00Z`) - Date.parse(`${filters.startDate}T00:00:00Z`)) / 86400000) + 1;
  if (comparison.type === "year_over_year") return { startDate: shiftYears(filters.startDate, -1), endDate: shiftYears(filters.endDate, -1) };
  if (comparison.type === "previous_week") return { startDate: shiftDays(filters.startDate, -7), endDate: shiftDays(filters.endDate, -7) };
  if (comparison.type === "previous_month") {
    const date = new Date(`${filters.startDate}T00:00:00Z`); date.setUTCMonth(date.getUTCMonth() - 1);
    const prevStart = iso(date); return { startDate: prevStart, endDate: shiftDays(prevStart, days - 1) };
  }
  return { startDate: shiftDays(filters.startDate, -days), endDate: shiftDays(filters.startDate, -1) };
}

function applyContribution(groups, dimension) {
  return groups.map((item) => ({
    ...item,
    productContribution: dimension === "product" || dimension === "model" ? item.contribution : null,
    channelContribution: dimension === "channel" ? item.contribution : null,
  }));
}

function addGroupComparisons(currentGroups, previousGroups) {
  const before = new Map(previousGroups.map((item) => [item.name, item]));
  return currentGroups.map((item) => {
    const previous = before.get(item.name) || {};
    const comparisonResult = compareSummaries(item, previous);
    return { ...item, comparison: previous, changeRate: comparisonResult.changeRate, absoluteChange: comparisonResult.absoluteChange };
  });
}

function sortAndLimit(groups, sort = [], limit = 20) {
  const spec = sort[0] || { field: "salesAmount", direction: "desc" };
  const direction = spec.direction === "asc" ? 1 : -1;
  return [...groups].sort((a, b) => {
    const av = spec.field in (a.changeRate || {}) ? a.changeRate[spec.field] : a[spec.field];
    const bv = spec.field in (b.changeRate || {}) ? b.changeRate[spec.field] : b[spec.field];
    if (typeof av === "string") return av.localeCompare(String(bv || ""), "zh-CN") * direction;
    return ((Number(av) || 0) - (Number(bv) || 0)) * direction;
  }).slice(0, Math.min(AI_CONFIG.maxPlanLimit, Math.max(1, limit || 20)));
}

function buildTrend(rows) {
  return groupRows(rows, ["date"]).sort((a, b) => a.name.localeCompare(b.name)).slice(-AI_CONFIG.maxTrendPoints).map((item) => ({ date: item.name, salesAmount: item.salesAmount, quantity: item.quantity, avgSellingPrice: item.avgSellingPrice }));
}

function buildAnomalies(trend) {
  if (trend.length < 3) return [];
  const mean = trend.reduce((sum, item) => sum + item.quantity, 0) / trend.length;
  if (!mean) return [];
  return trend.map((item) => ({ ...item, deviationRate: item.quantity / mean - 1 })).filter((item) => Math.abs(item.deviationRate) >= AI_CONFIG.thresholds.anomalyDeviation).sort((a, b) => Math.abs(b.deviationRate) - Math.abs(a.deviationRate)).slice(0, 8);
}

function formatSummary(summary) {
  return {
    ...summary,
    formatted: Object.fromEntries(Object.keys(METRIC_REGISTRY).map((id) => [id, METRIC_REGISTRY[id].formatter(summary[id])])),
  };
}

export function createDataQueryEngine(records = []) {
  const source = (Array.isArray(records) ? records : []).map((row) => ({ ...row, product: { ...(row?.product || {}) } }));
  const catalog = [...new Map(source.map((row) => [productName(row), { name: productName(row), code: row?.product?.code || "", series: seriesName(row) }])).values()];
  return {
    catalog,
    execute(plan) {
      const filters = plan?.filters || {};
      const currentSelection = filterRows(source, filters, catalog);
      const currentRows = currentSelection.rows;
      const current = formatSummary(summarizeRecords(currentRows));
      const dimension = plan.groupBy?.[0] || (plan.intent === "contribution" || plan.intent === "rank" ? "product" : null);
      const currentGroupsBase = dimension ? applyContribution(groupRows(currentRows, plan.groupBy?.length ? plan.groupBy : [dimension]), dimension) : [];
      const range = comparisonRange(filters, plan.comparison || { type: "none" });
      let comparisonRows = [];
      let comparison = null;
      let previousGroups = [];
      if (range) {
        comparisonRows = filterRows(source, { ...filters, ...range }, catalog).rows;
        comparison = formatSummary(summarizeRecords(comparisonRows));
        previousGroups = dimension ? applyContribution(groupRows(comparisonRows, plan.groupBy?.length ? plan.groupBy : [dimension]), dimension) : [];
      }
      const groups = sortAndLimit(addGroupComparisons(currentGroupsBase, previousGroups), plan.sort, plan.limit);
      const productGroups = applyContribution(groupRows(currentRows, ["product"]), "product").sort((a, b) => b.salesAmount - a.salesAmount).slice(0, AI_CONFIG.maxResultGroups);
      const channelGroups = applyContribution(groupRows(currentRows, ["channel"]), "channel").sort((a, b) => b.salesAmount - a.salesAmount).slice(0, AI_CONFIG.maxResultGroups);
      const trend = (plan.needsTrend || ["trend", "anomaly", "diagnose_change", "generate_report"].includes(plan.intent)) ? buildTrend(currentRows) : [];
      const comparisonResult = comparison ? compareSummaries(current, comparison, currentGroupsBase, previousGroups) : null;
      return {
        meta: {
          actualFilters: { ...filters, products: currentSelection.resolvedProducts },
          comparison: range ? { type: plan.comparison.type, ...range } : { type: "none" },
          rowCount: currentRows.length,
          comparisonRowCount: comparisonRows.length,
          matchedProducts: currentSelection.resolvedProducts,
          dataLimited: groups.length >= AI_CONFIG.maxResultGroups,
        },
        current,
        comparison,
        comparisonResult,
        groups,
        productGroups,
        channelGroups,
        trend,
        anomalies: buildAnomalies(trend),
        rawSamples: plan.needsRawSamples ? currentRows.slice(0, 5).map((row) => ({ date: row.date, product: productName(row), channel: channelName(row), amount: row.amount, qty: row.qty })) : [],
      };
    },
  };
}

export default createDataQueryEngine;
