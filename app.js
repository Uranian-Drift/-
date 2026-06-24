import { calculateMetrics } from "./engine/metrics.js";
import { createChatController } from "./ai/chat-controller.js";
import { RECOMMENDED_QUESTIONS } from "./config/ai-config.js";

(() => {
  "use strict";

  const DATA = window.WATER_HEATER_DATA;
  const content = document.getElementById("dashboardContent");

  if (!DATA) {
    content.innerHTML = '<div class="empty-state"><div class="empty-state-inner"><h2>数据快照未读取</h2><p>请确认 data/water-heater-data.js 与页面位于同一项目中。</p></div></div>';
    return;
  }

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  const zip = (fields, row) => Object.fromEntries(fields.map((field, index) => [field, row[index]]));
  const products = DATA.products.map((row) => zip(DATA.productFields, row));
  const sales = DATA.sales.map((row) => {
    const record = zip(DATA.salesFields, row);
    record.product = products[record.productId] || {};
    return record;
  });
  const outbound = (DATA.outbound || []).map((row) => {
    const record = zip(DATA.outboundFields, row);
    record.product = products[record.productId] || {};
    return record;
  });
  const ovi = DATA.ovi.map((row) => zip(DATA.oviFields, row));
  const PRICE_BANDS = ["2000以下", "2000–2500", "2500–3000", "3000–3500", "3500–4000", "4000以上"];

  const TAB_DEFS = [
    ["category", "品类销售"],
    ["core", "核心型号"],
    ["outbound", "出库与动销"],
    ["income", "经营指标"],
    ["industry", "行业-奥维"],
    ["channel", "渠道效率"],
  ];

  const uniqueSorted = (values) => [...new Set(values.filter((value) => value !== "" && value != null))]
    .sort((a, b) => String(a).localeCompare(String(b), "zh-CN"));
  const dimValue = (record, key) => {
    if (key === "channel") return record.channel || "未标注";
    if (key === "business") return record.business || "未标注";
    if (key === "shape") return record.product.shape || "未分类";
    if (key === "series") return record.product.series || "未分系列";
    if (key === "core") return record.product.core ? "核心品" : "非核心品";
    if (key === "position") return record.product.position || "未标注";
    return "";
  };

  const FILTERS = {
    channel: { label: "渠道", options: uniqueSorted([...sales, ...outbound].map((row) => dimValue(row, "channel"))) },
    business: { label: "业务部", options: uniqueSorted(sales.map((row) => dimValue(row, "business"))) },
    shape: { label: "形态分类", options: uniqueSorted(sales.map((row) => dimValue(row, "shape"))) },
    series: { label: "系列", options: uniqueSorted(sales.map((row) => dimValue(row, "series"))) },
    core: { label: "核心品", options: ["核心品", "非核心品"] },
    position: { label: "产品定位", options: uniqueSorted(sales.map((row) => dimValue(row, "position"))) },
  };
  const SALES_FILTER_KEYS = ["channel", "business", "shape", "series", "core", "position"];

  const maxDate = DATA.meta.salesDateMax;
  const defaultStart = `${maxDate.slice(0, 7)}-01`;
  const state = {
    tab: "category",
    start: defaultStart,
    end: maxDate,
    priceLower: 2000,
    priceUpper: 4000,
    selections: Object.fromEntries(Object.entries(FILTERS).map(([key, spec]) => [key, new Set(spec.options)])),
  };
  const aiState = {
    open: false,
    chat: null,
  };
  const chatController = createChatController({ records: sales, getDashboardFilters: getCurrentDashboardFilters });

  const formatInteger = (value) => Math.round(Number(value || 0)).toLocaleString("zh-CN");
  const formatWan = (value) => `${Math.round(Number(value || 0) / 10000).toLocaleString("zh-CN")}万`;
  const formatCurrency = (value) => `¥${Math.round(Number(value || 0)).toLocaleString("zh-CN")}`;
  const formatDecimal = (value, digits = 1) => Number.isFinite(value) ? value.toFixed(digits) : "-";
  const signClass = (value) => !Number.isFinite(value) || value === 0 ? "neutral" : value > 0 ? "positive" : "negative";
  const formatSignedPct = (value, digits = 1) => Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%` : "-";
  const formatSignedPoint = (value, digits = 1) => Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}pct` : "-";
  const formatRate = (value, digits = 1) => Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : "-";
  const ratioChange = (current, prior) => Number.isFinite(prior) && prior !== 0 ? current / prior - 1 : NaN;

  const shiftYear = (iso, delta) => {
    const [year, month, day] = iso.split("-").map(Number);
    const shifted = new Date(Date.UTC(year + delta, month - 1, day));
    return shifted.toISOString().slice(0, 10);
  };

  function passesDimensionFilters(record) {
    return SALES_FILTER_KEYS.every((key) => state.selections[key].has(dimValue(record, key)));
  }

  function salesForRange(start, end, coreOnly = false) {
    return sales.filter((record) => (
      record.date >= start
      && record.date <= end
      && passesDimensionFilters(record)
      && (!coreOnly || record.product.core)
    ));
  }

  function outboundForRange(start, end) {
    const keys = ["channel", "shape", "series", "core", "position"];
    return outbound.filter((record) => (
      record.date >= start
      && record.date <= end
      && keys.every((key) => state.selections[key].has(dimValue(record, key)))
    ));
  }

  function outboundSummary(rows) {
    const qty = rows.reduce((sum, row) => sum + Number(row.qty || 0), 0);
    const dates = new Set(rows.map((row) => row.date));
    const productsCovered = new Set(rows.map((row) => row.productId)).size;
    const channelsCovered = new Set(rows.map((row) => row.channel || "未标注")).size;
    return {
      qty,
      days: dates.size,
      dailyAvg: dates.size ? qty / dates.size : NaN,
      productsCovered,
      channelsCovered,
      rows: rows.length,
    };
  }

  function metricSummary(rows) {
    const amount = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const qty = rows.reduce((sum, row) => sum + Number(row.qty || 0), 0);
    const accountingRows = rows.filter((row) => row.accounting != null);
    const accounting = accountingRows.reduce((sum, row) => sum + Number(row.accounting || 0), 0);
    const policyRows = rows.filter((row) => row.policy != null && Number.isFinite(Number(row.policy)));
    const fullPromoCoverage = rows.length > 0 && rows.every((row) => row.promo != null);
    const policy = policyRows.reduce((sum, row) => sum + Number(row.policy || 0), 0);
    const policySales = policyRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const policyQty = policyRows.reduce((sum, row) => sum + Number(row.qty || 0), 0);
    const promo = fullPromoCoverage ? rows.reduce((sum, row) => sum + Number(row.promo || 0), 0) : NaN;
    return {
      amount,
      qty,
      avgPrice: qty !== 0 ? amount / qty : NaN,
      salesIndex: accounting !== 0 ? amount / accounting : NaN,
      priceDeviation: policy !== 0 ? policySales / policy - 1 : NaN,
      accounting,
      policy,
      policySales,
      policyQty,
      policyRows: policyRows.length,
      policyCoverage: rows.length ? policyRows.length / rows.length : NaN,
      promo,
      rows: rows.length,
    };
  }

  function metricCard(label, value, context, changeValue, hint = "") {
    return `
      <article class="metric-card" title="${escapeHtml(hint)}">
        <div class="metric-label"><span>${escapeHtml(label)}</span>${hint ? '<span class="status-chip">口径</span>' : ""}</div>
        <strong class="metric-value">${escapeHtml(value)}</strong>
        <p class="metric-context ${signClass(changeValue)}">${escapeHtml(context)}</p>
      </article>`;
  }

  function renderSalesKpis(currentRows, priorRows) {
    const current = metricSummary(currentRows);
    const prior = metricSummary(priorRows);
    const amountChange = ratioChange(current.amount, prior.amount);
    const qtyChange = ratioChange(current.qty, prior.qty);
    const avgChange = ratioChange(current.avgPrice, prior.avgPrice);
    const indexDelta = Number.isFinite(current.salesIndex) && Number.isFinite(prior.salesIndex)
      ? current.salesIndex - prior.salesIndex : NaN;
    const deviationDelta = Number.isFinite(current.priceDeviation) && Number.isFinite(prior.priceDeviation)
      ? current.priceDeviation - prior.priceDeviation : NaN;

    return `<section class="metric-grid">
      ${metricCard("销售金额", formatCurrency(current.amount), `同比 ${formatSignedPct(amountChange)}`, amountChange, "筛选期内销售金额合计")}
      ${metricCard("销售台量", formatInteger(current.qty), `同比 ${formatSignedPct(qtyChange)}`, qtyChange, "筛选期内数量合计，含退货冲销")}
      ${metricCard("成交均价", Number.isFinite(current.avgPrice) ? formatCurrency(current.avgPrice) : "-", `同比 ${formatSignedPct(avgChange)}`, avgChange, "销售金额 ÷ 销售台量")}
      ${metricCard("销售指数", Number.isFinite(current.salesIndex) ? current.salesIndex.toFixed(3) : "-", `同比净值差 ${Number.isFinite(indexDelta) ? `${indexDelta >= 0 ? "+" : ""}${indexDelta.toFixed(3)}` : "-"}`, indexDelta, "销售金额 ÷ 核算价金额合计")}
      ${metricCard("价格偏差率", Number.isFinite(current.priceDeviation) ? `${(current.priceDeviation * 100).toFixed(1)}%` : "-", Number.isFinite(current.priceDeviation) ? `政策价覆盖 ${formatInteger(current.policyRows)}/${formatInteger(current.rows)} 行 · 同比净值差 ${formatSignedPoint(deviationDelta)}` : "当前筛选无有效政策价", deviationDelta, "按有政策价的销售行计算：销售金额 ÷ 政策价金额－1")}
    </section>`;
  }

  function groupRows(rows, keyFn) {
    const map = new Map();
    rows.forEach((row) => {
      const key = keyFn(row) || "未标注";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    });
    return map;
  }

  function ranking(currentRows, priorRows, keyFn, limit = 30) {
    const currentMap = groupRows(currentRows, keyFn);
    const priorMap = groupRows(priorRows, keyFn);
    return [...currentMap.entries()]
      .map(([name, rows]) => {
        const current = metricSummary(rows);
        const prior = metricSummary(priorMap.get(name) || []);
        return { name, ...current, yoy: ratioChange(current.amount, prior.amount), prior };
      })
      .sort((a, b) => b.amount - a.amount)
      .slice(0, limit);
  }

  function rankList(items, valueFormatter = (item) => formatWan(item.amount), changeFormatter = (item) => formatSignedPct(item.yoy)) {
    if (!items.length) return '<div class="empty-state"><div class="empty-state-inner"><h2>当前筛选无数据</h2><p>调整日期或分类筛选后再查看。</p></div></div>';
    const max = Math.max(...items.map((item) => Math.max(0, Number(item.amount || item.value || 0))), 1);
    return `<div class="rank-list">${items.map((item) => {
      const raw = Number(item.amount ?? item.value ?? 0);
      const width = Math.max(0, raw) / max * 100;
      const change = item.yoy ?? item.change;
      return `<div class="rank-row" style="--bar:${width.toFixed(1)}%">
        <span class="rank-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
        <span class="rank-value">${escapeHtml(valueFormatter(item))}</span>
        <span class="rank-change ${signClass(change)}">${escapeHtml(changeFormatter(item))}</span>
      </div>`;
    }).join("")}</div>`;
  }

  function panel(title, subtitle, body, id, options = {}) {
    return `<article class="panel ${options.className || ""}" id="${escapeHtml(id)}">
      <div class="panel-header">
        <div><h2 class="panel-title">${escapeHtml(title)}</h2>${subtitle ? `<p class="panel-subtitle">${escapeHtml(subtitle)}</p>` : ""}</div>
        <div class="panel-actions">${options.unit ? `<span class="unit-label">${escapeHtml(options.unit)}</span>` : ""}<button type="button" class="download-button" data-download-panel="${escapeHtml(id)}">下载 PNG</button></div>
      </div>
      ${body}
    </article>`;
  }

  function dailyTrend(currentRows, priorRows, valueMode = "amount") {
    const currentMap = groupRows(currentRows, (row) => row.date);
    const priorMap = groupRows(priorRows, (row) => row.date);
    return [...currentMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, rows]) => {
        const current = metricSummary(rows);
        const priorDay = shiftYear(day, -1);
        const prior = metricSummary(priorMap.get(priorDay) || []);
        const value = valueMode === "qty" ? current.qty : current.amount;
        const priorValue = valueMode === "qty" ? prior.qty : prior.amount;
        return { name: day, amount: value, yoy: ratioChange(value, priorValue) };
      });
  }

  function table(headers, rows, minWidth = 720) {
    return `<div class="table-wrap"><table class="data-table" style="min-width:${minWidth}px"><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
  }

  function renderCategory() {
    const currentRows = salesForRange(state.start, state.end);
    const priorRows = salesForRange(shiftYear(state.start, -1), shiftYear(state.end, -1));
    const trend = dailyTrend(currentRows, priorRows);
    const channels = ranking(currentRows, priorRows, (row) => dimValue(row, "channel"));
    const businesses = ranking(currentRows, priorRows, (row) => dimValue(row, "business"));
    const shapes = ranking(currentRows, priorRows, (row) => dimValue(row, "shape"));
    const totalAmount = metricSummary(currentRows).amount;
    const structureCards = shapes.slice(0, 4).map((item) => `<div class="structure-card"><span>${escapeHtml(item.name)}</span><strong>${formatWan(item.amount)}</strong><small class="${signClass(item.yoy)}">同比 ${formatSignedPct(item.yoy)}</small></div>`).join("");
    const structureRows = shapes.map((item) => {
      const share = totalAmount !== 0 ? item.amount / totalAmount : NaN;
      const indexDelta = Number.isFinite(item.salesIndex) && Number.isFinite(item.prior.salesIndex) ? item.salesIndex - item.prior.salesIndex : NaN;
      return `<tr><td>${escapeHtml(item.name)}</td><td>${formatWan(item.amount)}</td><td class="${signClass(item.yoy)}">${formatSignedPct(item.yoy)}</td><td>${Number.isFinite(share) ? `${(share * 100).toFixed(1)}%` : "-"}</td><td>${Number.isFinite(item.avgPrice) ? formatCurrency(item.avgPrice) : "-"}</td><td>${Number.isFinite(item.salesIndex) ? item.salesIndex.toFixed(3) : "-"}</td><td class="${signClass(indexDelta)}">${Number.isFinite(indexDelta) ? `${indexDelta >= 0 ? "+" : ""}${indexDelta.toFixed(3)}` : "-"}</td></tr>`;
    });

    return `${renderSalesKpis(currentRows, priorRows)}
      <section class="content-grid">
        ${panel("销售额分日趋势", "按支付日期汇总，与上年同期同日比较", rankList(trend, (item) => formatWan(item.amount)), "daily-sales", { unit: "单位 / 元" })}
        ${panel("形态结构", "严格使用产品索引表“分类”字段", `<div class="structure-cards">${structureCards || '<span class="neutral">当前筛选无分类数据</span>'}</div>${table(["形态分类", "金额", "同比", "占比", "均价", "销售指数", "指数净值差"], structureRows, 620)}`, "shape-structure")}
        ${panel("渠道销售排行", "金额降序，条形长度表示销售贡献", rankList(channels), "channel-ranking")}
        ${panel("业务部销售排行", "组织维度销售金额与同比", rankList(businesses), "business-ranking")}
      </section>`;
  }

  function renderCore() {
    const currentRows = salesForRange(state.start, state.end, true);
    const priorRows = salesForRange(shiftYear(state.start, -1), shiftYear(state.end, -1), true);
    const trend = dailyTrend(currentRows, priorRows, "qty");
    const series = ranking(currentRows, priorRows, (row) => dimValue(row, "series"));
    const models = ranking(currentRows, priorRows, (row) => row.product.name || row.product.code);
    const modelVolumes = [...models].sort((a, b) => b.qty - a.qty);
    const channels = ranking(currentRows, priorRows, (row) => dimValue(row, "channel"));
    const deviationRows = models.map((item) => {
      const deviation = item.priceDeviation;
      return `<tr><td>${escapeHtml(item.name)}</td><td>${Number.isFinite(item.avgPrice) ? formatCurrency(item.avgPrice) : "-"}</td><td>${Number.isFinite(item.policy) && item.policyQty !== 0 ? formatCurrency(item.policy / item.policyQty) : "-"}</td><td>${Number.isFinite(item.salesIndex) ? item.salesIndex.toFixed(3) : "-"}</td><td>${formatInteger(item.policyRows)}/${formatInteger(item.rows)}</td><td class="${signClass(deviation)}">${Number.isFinite(deviation) ? `${(deviation * 100).toFixed(1)}%` : "-"}</td></tr>`;
    });
    const seriesOrder = new Map(series.map((item, index) => [item.name, index]));
    const productFilterKeys = ["shape", "series", "core", "position"];
    const uniqueCoreProducts = new Map();
    products.forEach((product, productId) => {
      if (!product.core) return;
      const key = product.code || product.name;
      if (key && !uniqueCoreProducts.has(key)) uniqueCoreProducts.set(key, { product, productId });
    });
    const seriesModelItems = [...uniqueCoreProducts.values()]
      .filter(({ product }) => product.core && productFilterKeys.every((key) => state.selections[key].has(dimValue({ product }, key))))
      .map(({ product, productId }) => ({
        seriesName: product.series || "未分系列",
        modelName: product.name || product.code,
        code: product.code || "",
        ...metricSummary(currentRows.filter((row) => row.productId === productId)),
      }))
      .sort((a, b) => (seriesOrder.get(a.seriesName) ?? 999) - (seriesOrder.get(b.seriesName) ?? 999) || b.qty - a.qty);
    const totalCoreQty = metricSummary(currentRows).qty;
    const seriesModelRows = seriesModelItems.map((item) => `<tr data-search-row="${escapeHtml(`${item.seriesName} ${item.modelName} ${item.code}`.toLowerCase())}"><td>${escapeHtml(item.seriesName)}</td><td>${escapeHtml(item.modelName)}</td><td>${escapeHtml(item.code || "-")}</td><td>${formatInteger(item.qty)}</td><td>${formatWan(item.amount)}</td><td>${Number.isFinite(item.avgPrice) ? formatCurrency(item.avgPrice) : "-"}</td><td>${totalCoreQty ? `${(item.qty / totalCoreQty * 100).toFixed(1)}%` : "-"}</td></tr>`);
    const modelRows = seriesModelItems.map((item) => `<tr data-search-row="${escapeHtml(`${item.seriesName} ${item.modelName} ${item.code}`.toLowerCase())}"><td>${escapeHtml(item.seriesName)}</td><td>${escapeHtml(item.modelName)}</td><td>${escapeHtml(item.code || "-")}</td><td>${formatInteger(item.qty)}</td><td>${formatWan(item.amount)}</td><td>${Number.isFinite(item.accounting) && item.qty !== 0 ? formatCurrency(item.accounting / item.qty) : "-"}</td><td>${Number.isFinite(item.policy) && item.policyQty !== 0 ? formatCurrency(item.policy / item.policyQty) : "-"}</td><td>${Number.isFinite(item.avgPrice) ? formatCurrency(item.avgPrice) : "-"}</td><td>${Number.isFinite(item.salesIndex) ? item.salesIndex.toFixed(3) : "-"}</td></tr>`);

    return `${renderSalesKpis(currentRows, priorRows)}
      <section class="content-grid three-column">
        ${panel("核心型号分日趋势", `核心品标记来自索引表，去重后共 ${formatInteger(DATA.diagnostics.coreUniqueProducts || DATA.diagnostics.coreProducts)} 个型号`, rankList(trend, (item) => `${formatInteger(item.amount)}台`), "core-trend", { unit: "单位 / 台" })}
        ${panel("系列排行", "未维护系列的产品归入“未分系列”", rankList(series), "core-series")}
        ${panel("渠道贡献", "核心型号在各渠道的销售贡献", rankList(channels), "core-channel")}
        ${panel("价格偏差率排行", "按有政策价的销售行计算：销售金额 ÷ 政策价金额－1", table(["型号", "成交均价", "政策均价", "销售指数", "政策覆盖", "价格偏差率"], deviationRows, 760), "core-deviation", { className: "span-2" })}
        ${panel("型号销量排行", "按所选周期销量降序，补充核心型号销量维度", rankList(modelVolumes.slice(0, 15).map((item) => ({ ...item, amount: item.qty })), (item) => `${formatInteger(item.qty)}台`), "core-models")}
        ${panel("系列 × 型号销量", "展示所选周期内每个系列、每个核心型号的销量", table(["系列", "型号", "产品编码", "销量", "销售额", "成交均价", "销量占比"], seriesModelRows, 940), "series-model-volume", { className: "span-3" })}
        ${panel("核算价查询", "支持按系列、产品名称或编码搜索当前核心型号", `<div class="search-row"><input id="accountingSearch" type="search" placeholder="搜索系列、产品名称或编码" /></div>${table(["系列", "型号", "产品编码", "台量", "金额", "核算单价", "政策均价", "成交均价", "销售指数"], modelRows, 1060)}`, "accounting-query", { className: "span-3" })}
      </section>`;
  }

  function outboundRanking(currentRows, priorRows, keyFn, limit = 30) {
    const currentMap = groupRows(currentRows, keyFn);
    const priorMap = groupRows(priorRows, keyFn);
    return [...currentMap.entries()].map(([name, rows]) => {
      const current = outboundSummary(rows);
      const prior = outboundSummary(priorMap.get(name) || []);
      return { name, amount: current.qty, qty: current.qty, yoy: ratioChange(current.qty, prior.qty) };
    }).sort((a, b) => b.qty - a.qty).slice(0, limit);
  }

  function renderOutbound() {
    const currentRows = outboundForRange(state.start, state.end);
    const priorRows = outboundForRange(shiftYear(state.start, -1), shiftYear(state.end, -1));
    const current = outboundSummary(currentRows);
    const prior = outboundSummary(priorRows);
    const qtyChange = ratioChange(current.qty, prior.qty);
    const dailyChange = ratioChange(current.dailyAvg, prior.dailyAvg);
    const matchTotal = Number(DATA.diagnostics.outboundValidRows || 0);
    const matchRows = Number(DATA.diagnostics.outboundCodeMatched || 0) + Number(DATA.diagnostics.outboundNameMatched || 0);
    const matchRate = matchTotal ? matchRows / matchTotal : NaN;
    const currentByDate = groupRows(currentRows, (row) => row.date);
    const priorByDate = groupRows(priorRows, (row) => row.date);
    const trend = [...currentByDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, rows]) => {
      const qty = outboundSummary(rows).qty;
      const priorQty = outboundSummary(priorByDate.get(shiftYear(day, -1)) || []).qty;
      return { name: day, amount: qty, yoy: ratioChange(qty, priorQty) };
    });
    const shapes = outboundRanking(currentRows, priorRows, (row) => dimValue(row, "shape"));
    const series = outboundRanking(currentRows, priorRows, (row) => dimValue(row, "series"));
    const channels = outboundRanking(currentRows, priorRows, (row) => dimValue(row, "channel"));
    const totalQty = current.qty;
    const shapeRows = shapes.map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${formatInteger(item.qty)}</td><td>${totalQty ? `${(item.qty / totalQty * 100).toFixed(1)}%` : "-"}</td><td class="${signClass(item.yoy)}">${formatSignedPct(item.yoy)}</td></tr>`);

    return `<section class="metric-grid">
      ${metricCard("出库台量", formatInteger(current.qty), `同比 ${formatSignedPct(qtyChange)}`, qtyChange, "筛选期内出库总量合计")}
      ${metricCard("日均出库", Number.isFinite(current.dailyAvg) ? `${formatInteger(current.dailyAvg)}台` : "-", `同比 ${formatSignedPct(dailyChange)}`, dailyChange, "出库台量 ÷ 有出库记录的日期数")}
      ${metricCard("出库型号数", formatInteger(current.productsCovered), `有效记录 ${formatInteger(current.rows)} 行`, NaN, "筛选期内有出库记录的去重型号数")}
      ${metricCard("覆盖渠道", formatInteger(current.channelsCovered), `渠道贡献可下钻`, NaN, "使用国补调整后渠道，缺失时回退原渠道")}
      ${metricCard("产品匹配率", Number.isFinite(matchRate) ? `${(matchRate * 100).toFixed(2)}%` : "-", `未匹配 ${formatInteger(DATA.diagnostics.outboundUnmatchedRows || 0)} 行`, NaN, "出库产品编码或名称匹配产品索引表")}
    </section>
      <p class="availability-note">库存字段仍未提供，因此库存周转天数与销存比保持为空；本页只展示真实出库数据。</p>
      <section class="content-grid">
        ${panel("出库分日趋势", "按出库日期汇总，与上年同期同日比较", rankList(trend, (item) => `${formatInteger(item.amount)}台`), "outbound-trend", { unit: "单位 / 台" })}
        ${panel("形态结构", "形态分类来自最新产品索引表", table(["形态分类", "出库台量", "占比", "同比"], shapeRows, 520), "outbound-shape")}
        ${panel("系列排行榜", "未维护系列的型号归入“未分系列”", rankList(series, (item) => `${formatInteger(item.qty)}台`), "outbound-series")}
        ${panel("渠道贡献榜", "使用国补调整后渠道口径", rankList(channels, (item) => `${formatInteger(item.qty)}台`), "outbound-channel")}
      </section>`;
  }

  function renderEmpty(kind) {
    const outbound = kind === "outbound";
    const title = outbound ? "出库与动销数据待补充" : "收入与毛利数据待补充";
    const message = outbound
      ? "当前文件夹未提供出库、库存或动销字段，因此本模块不展示推算值。"
      : "当前文件夹未提供收入、成本、费用或毛利字段，因此本模块保持空态。";
    const fields = outbound ? DATA.meta.unavailable.outbound : DATA.meta.unavailable.income;
    return `<section class="empty-state"><div class="empty-state-inner"><p class="eyebrow">No Fabricated Metrics</p><h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p><div class="required-fields">${fields.map((field) => `<span>${escapeHtml(field)}</span>`).join("")}</div></div></section>`;
  }

  function renderRuntimeMetrics() {
    const currentRows = salesForRange(state.start, state.end);
    const metrics = calculateMetrics(currentRows);
    const { summary, products: metricProducts, channels } = metrics;
    const topChannel = channels[0];
    const topProduct = metricProducts[0];
    const productRows = metricProducts.slice(0, 30).map((item) => `<tr>
      <td>${escapeHtml(item.name)}</td>
      <td>${formatWan(item.sales)}</td>
      <td>${formatInteger(item.quantity)}</td>
      <td>${formatRate(item.share)}</td>
      <td>${Number.isFinite(item.averagePrice) ? formatCurrency(item.averagePrice) : "-"}</td>
      <td>${Number.isFinite(item.policyPrice) ? formatCurrency(item.policyPrice) : "-"}</td>
      <td>${formatRate(item.discountDepth)}</td>
      <td>${Number.isFinite(item.priceIndex) ? item.priceIndex.toFixed(3) : "-"}</td>
    </tr>`);
    const channelRows = channels.map((item) => `<tr>
      <td>${escapeHtml(item.name)}</td>
      <td>${formatWan(item.sales)}</td>
      <td>${formatInteger(item.quantity)}</td>
      <td>${formatRate(item.share)}</td>
      <td>${Number.isFinite(item.averagePrice) ? formatCurrency(item.averagePrice) : "-"}</td>
      <td>${formatRate(item.discountDepth)}</td>
      <td>${Number.isFinite(item.priceIndex) ? item.priceIndex.toFixed(3) : "-"}</td>
    </tr>`);

    return `<p class="availability-note">当前数据没有成本字段，因此不展示或推算毛利。以下价格、折扣与贡献指标均由当前筛选记录实时计算。</p>
      <section class="metric-grid">
        ${metricCard("销售金额", formatCurrency(summary.salesAmount), `${formatInteger(summary.quantity)} 台`, summary.salesAmount, "销售金额合计")}
        ${metricCard("成交均价", formatCurrency(summary.avgSellingPrice), "销售金额 ÷ 销量", summary.avgSellingPrice, "运行时计算")}
        ${metricCard("折扣深度", formatRate(summary.discountDepth), `政策价覆盖 ${formatRate(summary.policyCoverage)}`, -summary.discountDepth, "1－销售金额÷政策价金额")}
        ${metricCard("价格指数", Number.isFinite(summary.priceIndex) ? summary.priceIndex.toFixed(3) : "-", "销售金额 ÷ 核算价金额", summary.priceIndex - 1, "沿用销售指数口径")}
        ${metricCard("头部渠道占比", topChannel ? formatRate(topChannel.share) : "-", topChannel?.name || "当前筛选无渠道", topChannel?.share, "渠道销售金额 ÷ 总销售金额")}
        ${metricCard("头部SKU贡献", topProduct ? formatRate(topProduct.share) : "-", topProduct?.name || "当前筛选无SKU", topProduct?.share, "SKU销售金额 ÷ 总销售金额")}
      </section>
      <section class="content-grid">
        ${panel("产品贡献与价格质量", "所有指标均由当前筛选记录在浏览器运行时计算", table(["型号", "销售额", "销量", "贡献度", "成交均价", "政策价", "折扣深度", "价格指数"], productRows, 1080), "runtime-product-metrics", { className: "span-2" })}
        ${panel("渠道结构与经营质量", "渠道占比、成交均价与折扣深度同口径对比", table(["渠道", "销售额", "销量", "渠道占比", "成交均价", "折扣深度", "价格指数"], channelRows, 900), "runtime-channel-metrics", { className: "span-2" })}
      </section>`;
  }

  function monthShift(month, delta) {
    const [year, value] = month.split("-").map(Number);
    const shifted = new Date(Date.UTC(year + delta, value - 1, 1));
    return shifted.toISOString().slice(0, 7);
  }

  function oviWindow() {
    const startMonth = state.start.slice(0, 7);
    const endMonth = state.end.slice(0, 7);
    let dateRows = ovi.filter((row) => row.month >= startMonth && row.month <= endMonth);
    let fallback = false;
    if (!dateRows.length) {
      const latest = DATA.meta.oviMonthMax;
      dateRows = ovi.filter((row) => row.month === latest);
      fallback = true;
    }
    const rows = dateRows.filter((row) => PRICE_BANDS.includes(row.priceBand));
    const months = uniqueSorted(rows.map((row) => row.month));
    const priorMonths = new Set(months.map((month) => monthShift(month, -1)));
    const priorRows = ovi.filter((row) => priorMonths.has(row.month) && PRICE_BANDS.includes(row.priceBand));
    return { rows, priorRows, months, fallback };
  }

  function rowsInPriceRange(rows) {
    const lower = Math.min(state.priceLower, state.priceUpper);
    const upper = Math.max(state.priceLower, state.priceUpper);
    return rows.filter((row) => {
      const price = Number(row.unitPrice);
      return Number.isFinite(price) && price >= lower && price <= upper;
    });
  }

  function summarizeOvi(rows) {
    return {
      sales: rows.reduce((sum, row) => sum + Number(row.sales || 0), 0),
      qty: rows.reduce((sum, row) => sum + Number(row.qty || 0), 0),
    };
  }

  function oviRanking(rows, priorRows, keyFn, brandOnly = false, limit = 30) {
    const currentRows = brandOnly ? rows.filter((row) => row.brand === DATA.meta.brand) : rows;
    const previousRows = brandOnly ? priorRows.filter((row) => row.brand === DATA.meta.brand) : priorRows;
    const current = groupRows(currentRows, keyFn);
    const prior = groupRows(previousRows, keyFn);
    return [...current.entries()].map(([name, groupedRows]) => {
      const now = summarizeOvi(groupedRows);
      const before = summarizeOvi(prior.get(name) || []);
      return { name, amount: now.sales, qty: now.qty, avgPrice: now.qty ? now.sales / now.qty : NaN, yoy: ratioChange(now.sales, before.sales) };
    }).sort((a, b) => b.amount - a.amount).slice(0, limit);
  }

  function renderIndustry() {
    const { rows, priorRows, months, fallback } = oviWindow();
    const market = summarizeOvi(rows);
    const brandRows = rows.filter((row) => row.brand === DATA.meta.brand);
    const brand = summarizeOvi(brandRows);
    const priorMarket = summarizeOvi(priorRows);
    const priorBrand = summarizeOvi(priorRows.filter((row) => row.brand === DATA.meta.brand));
    const salesShare = market.sales ? brand.sales / market.sales : NaN;
    const qtyShare = market.qty ? brand.qty / market.qty : NaN;
    const priorSalesShare = priorMarket.sales ? priorBrand.sales / priorMarket.sales : NaN;
    const priorQtyShare = priorMarket.qty ? priorBrand.qty / priorMarket.qty : NaN;
    const avgPrice = brand.qty ? brand.sales / brand.qty : NaN;
    const priorAvg = priorBrand.qty ? priorBrand.sales / priorBrand.qty : NaN;
    const rangeRows = rowsInPriceRange(rows);
    const priorRangeRows = rowsInPriceRange(priorRows);
    const rangeMarket = summarizeOvi(rangeRows);
    const rangeBrand = summarizeOvi(rangeRows.filter((row) => row.brand === DATA.meta.brand));
    const priorRangeMarket = summarizeOvi(priorRangeRows);
    const priorRangeBrand = summarizeOvi(priorRangeRows.filter((row) => row.brand === DATA.meta.brand));
    const rangeSalesShare = rangeMarket.sales ? rangeBrand.sales / rangeMarket.sales : NaN;
    const rangeQtyShare = rangeMarket.qty ? rangeBrand.qty / rangeMarket.qty : NaN;
    const priorRangeSalesShare = priorRangeMarket.sales ? priorRangeBrand.sales / priorRangeMarket.sales : NaN;
    const priorRangeQtyShare = priorRangeMarket.qty ? priorRangeBrand.qty / priorRangeMarket.qty : NaN;
    const lower = Math.min(state.priceLower, state.priceUpper);
    const upper = Math.max(state.priceLower, state.priceUpper);
    const rangeLabel = `${formatInteger(lower)}–${formatInteger(upper)}元`;
    const brandRanks = oviRanking(rows, priorRows, (row) => row.brand);
    const marketBrandCount = uniqueSorted(rows.map((row) => row.brand)).length;
    const rankIndex = brandRanks.findIndex((item) => item.name === DATA.meta.brand);
    const trendItems = months.map((month) => {
      const monthRows = rows.filter((row) => row.month === month);
      const monthMarket = summarizeOvi(monthRows);
      const monthBrand = summarizeOvi(monthRows.filter((row) => row.brand === DATA.meta.brand));
      const share = monthMarket.sales ? monthBrand.sales / monthMarket.sales : 0;
      return { name: month, value: share, amount: share, change: NaN };
    });
    const modelRanks = oviRanking(rows, priorRows, (row) => row.model || "未标注", true, 20);
    const priceBands = PRICE_BANDS.map((band) => {
      const bandRows = rows.filter((row) => row.priceBand === band);
      const priorBandRows = priorRows.filter((row) => row.priceBand === band);
      const bandMarket = summarizeOvi(bandRows);
      const priorBandMarket = summarizeOvi(priorBandRows);
      const bandBrand = summarizeOvi(bandRows.filter((row) => row.brand === DATA.meta.brand));
      return {
        name: band,
        amount: bandMarket.sales,
        qty: bandMarket.qty,
        avgPrice: bandMarket.qty ? bandMarket.sales / bandMarket.qty : NaN,
        mix: market.sales ? bandMarket.sales / market.sales : NaN,
        brandShare: bandMarket.sales ? bandBrand.sales / bandMarket.sales : NaN,
        yoy: ratioChange(bandMarket.sales, priorBandMarket.sales),
      };
    });
    const priceBandCards = priceBands.map((item) => `<div class="structure-card"><span>${escapeHtml(item.name)}</span><strong>${Number.isFinite(item.mix) ? `${(item.mix * 100).toFixed(1)}%` : "-"}</strong><small>市场均价 ${Number.isFinite(item.avgPrice) ? formatCurrency(item.avgPrice) : "-"}</small></div>`).join("");
    const priceBandRows = priceBands.map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${formatWan(item.amount)}</td><td>${formatInteger(item.qty)}</td><td>${Number.isFinite(item.mix) ? `${(item.mix * 100).toFixed(1)}%` : "-"}</td><td>${Number.isFinite(item.avgPrice) ? formatCurrency(item.avgPrice) : "-"}</td><td>${Number.isFinite(item.brandShare) ? `${(item.brandShare * 100).toFixed(1)}%` : "-"}</td><td class="${signClass(item.yoy)}">${formatSignedPct(item.yoy)}</td></tr>`);
    const volumeSegments = oviRanking(rows, priorRows, (row) => row.volumeSegment || "未标注", true, 12);
    const volumeRows = volumeSegments.map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${formatWan(item.amount)}</td><td>${formatInteger(item.qty)}</td><td>${Number.isFinite(item.avgPrice) ? formatCurrency(item.avgPrice) : "-"}</td><td class="${signClass(item.yoy)}">${formatSignedPct(item.yoy)}</td></tr>`);
    const modelRows = modelRanks.map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${formatInteger(item.qty)}</td><td>${formatWan(item.amount)}</td><td>${Number.isFinite(item.avgPrice) ? formatCurrency(item.avgPrice) : "-"}</td><td class="${signClass(item.yoy)}">${formatSignedPct(item.yoy)}</td></tr>`);
    const note = fallback ? `<p class="availability-note">销售筛选期没有对应奥维月份，行业模块已自动展示最新可用月份 ${escapeHtml(DATA.meta.oviMonthMax)}。</p>` : "";

    return `${note}<section class="price-range-panel">
      <div class="price-range-copy"><p class="eyebrow">Custom Price Range</p><h2>自定义价位段市占</h2><p>按奥维“单价”筛选，价格上下限均包含在区间内。</p></div>
      <div class="price-range-controls">
        <label class="range-field"><span>价格下限</span><input id="priceLower" type="number" min="0" step="100" value="${escapeHtml(state.priceLower)}" /></label>
        <span class="range-separator">至</span>
        <label class="range-field"><span>价格上限</span><input id="priceUpper" type="number" min="0" step="100" value="${escapeHtml(state.priceUpper)}" /></label>
        <button id="applyPriceRange" class="primary-action" type="button">计算市占</button>
        <button id="resetPriceRange" class="ghost-action" type="button">恢复默认</button>
      </div>
      <p class="price-range-summary">当前区间 ${escapeHtml(rangeLabel)}：市场销额 ${formatWan(rangeMarket.sales)}，${DATA.meta.brand}销额 ${formatWan(rangeBrand.sales)}。</p>
    </section>
      <section class="metric-grid">
      ${metricCard("销额市占", Number.isFinite(salesShare) ? `${(salesShare * 100).toFixed(1)}%` : "-", `同比净值差 ${formatSignedPoint(salesShare - priorSalesShare)}`, salesShare - priorSalesShare, "方太销额 ÷ 市场销额")}
      ${metricCard("销量市占", Number.isFinite(qtyShare) ? `${(qtyShare * 100).toFixed(1)}%` : "-", `同比净值差 ${formatSignedPoint(qtyShare - priorQtyShare)}`, qtyShare - priorQtyShare, "方太销量 ÷ 市场销量")}
      ${metricCard(`${rangeLabel}销额市占`, Number.isFinite(rangeSalesShare) ? `${(rangeSalesShare * 100).toFixed(1)}%` : "-", `同比净值差 ${formatSignedPoint(rangeSalesShare - priorRangeSalesShare)}`, rangeSalesShare - priorRangeSalesShare, "所选价格区间内方太销额 ÷ 市场销额")}
      ${metricCard(`${rangeLabel}销量市占`, Number.isFinite(rangeQtyShare) ? `${(rangeQtyShare * 100).toFixed(1)}%` : "-", `同比净值差 ${formatSignedPoint(rangeQtyShare - priorRangeQtyShare)}`, rangeQtyShare - priorRangeQtyShare, "所选价格区间内方太销量 ÷ 市场销量")}
      ${metricCard("品牌均价", Number.isFinite(avgPrice) ? formatCurrency(avgPrice) : "-", `同比 ${formatSignedPct(ratioChange(avgPrice, priorAvg))}`, ratioChange(avgPrice, priorAvg), "方太销额 ÷ 方太销量")}
      ${metricCard("品牌排名", rankIndex >= 0 ? `第 ${rankIndex + 1} 名` : "-", `市场品牌 ${formatInteger(marketBrandCount)} 个`, NaN, "按筛选期销额降序")}
    </section>
      <section class="content-grid">
        ${panel(months.length > 1 ? "品牌销额市占趋势" : "品牌销额市占", months.length > 1 ? "按奥维月份汇总" : `最新可用月份 ${months[0] || DATA.meta.oviMonthMax}`, rankList(trendItems, (item) => `${(item.value * 100).toFixed(1)}%`, () => ""), "ovi-share-trend")}
        ${panel("品牌排名", "燃气热水器线上市场，按销额降序展示 Top 30", rankList(brandRanks), "ovi-brand-ranking")}
        ${panel("型号单价与销量", `仅展示品牌配置：${DATA.meta.brand}；单价=型号销额÷型号销量`, table(["型号", "销量", "销额", "单价", "同比"], modelRows, 680), "ovi-model-ranking", { className: "span-2" })}
        ${panel("价位段结构", "产品定位已改为奥维成交均价价位段；边界按左闭右开划分", `<div class="structure-cards">${priceBandCards}</div>${table(["价位段", "市场销额", "市场销量", "销额结构", "市场均价", `${DATA.meta.brand}销额占比`, "同比"], priceBandRows, 820)}`, "ovi-price-bands", { className: "span-2" })}
        ${panel("升数段结构", "直接使用奥维“升数段”字段", table(["升数段", "销额", "销量", "均价", "同比"], volumeRows, 620), "ovi-volume", { className: "span-2" })}
      </section>`;
  }

  function renderChannel() {
    const currentRows = salesForRange(state.start, state.end);
    const priorRows = salesForRange(shiftYear(state.start, -1), shiftYear(state.end, -1));
    const items = ranking(currentRows, priorRows, (row) => dimValue(row, "channel"), 50);
    const rows = items.map((item) => {
      const indexDelta = Number.isFinite(item.salesIndex) && Number.isFinite(item.prior.salesIndex) ? item.salesIndex - item.prior.salesIndex : NaN;
      const policyCoverage = item.rows ? item.policyRows / item.rows : NaN;
      return `<tr><td>${escapeHtml(item.name)}</td><td>${formatWan(item.amount)}</td><td>${formatInteger(item.qty)}</td><td>${Number.isFinite(item.avgPrice) ? formatCurrency(item.avgPrice) : "-"}</td><td class="${signClass(item.yoy)}">${formatSignedPct(item.yoy)}</td><td>${Number.isFinite(item.salesIndex) ? item.salesIndex.toFixed(3) : "-"}</td><td class="${signClass(indexDelta)}">${Number.isFinite(indexDelta) ? `${indexDelta >= 0 ? "+" : ""}${indexDelta.toFixed(3)}` : "-"}</td><td>${Number.isFinite(item.priceDeviation) ? `${(item.priceDeviation * 100).toFixed(1)}%` : "-"}</td><td>${formatRate(policyCoverage)}</td><td>-</td></tr>`;
    });
    return `<p class="availability-note">当前数据没有成本与目标字段，因此不推算毛利率，目标完成率保持为空。</p>
      <section class="content-grid">
        ${panel("渠道经营效率", "销售与价格指标均来自有效销售数据", table(["渠道", "销售额", "台量", "均价", "同比", "销售指数", "指数净值差", "价格偏差率", "政策价覆盖率", "目标完成率"], rows, 1060), "channel-efficiency", { className: "span-2" })}
      </section>`;
  }

  function renderDashboard() {
    updateFilterContext();
    if (state.tab === "category") content.innerHTML = renderCategory();
    if (state.tab === "core") content.innerHTML = renderCore();
    if (state.tab === "outbound") content.innerHTML = renderOutbound();
    if (state.tab === "income") content.innerHTML = renderRuntimeMetrics();
    if (state.tab === "industry") content.innerHTML = renderIndustry();
    if (state.tab === "channel") content.innerHTML = renderChannel();
    attachDynamicEvents();
    renderFilterSummary();
    if (aiState.open) renderAiPanel();
  }

  function getCurrentDashboardFilters() {
    const selectedValues = (key) => state.selections[key].size === FILTERS[key].options.length ? [] : [...state.selections[key]];
    return {
      startDate: state.start,
      endDate: state.end,
      products: [],
      models: [],
      series: selectedValues("series"),
      channels: selectedValues("channel"),
      departments: selectedValues("business"),
    };
  }
  window.getCurrentDashboardFilters = getCurrentDashboardFilters;

  function formatAiAnswer(contentText) {
    return String(contentText || "").split("\n").map((line) => {
      const value = line.trim();
      if (!value) return "<span class=\"ai-answer-spacer\"></span>";
      if (/^#{1,3}\s/.test(value)) return `<h4>${escapeHtml(value.replace(/^#{1,3}\s*/, ""))}</h4>`;
      if (/^\d+[.、]\s*/.test(value)) return `<h4>${escapeHtml(value)}</h4>`;
      if (/^[-*•]\s+/.test(value)) return `<p class="ai-answer-bullet">${escapeHtml(value.replace(/^[-*•]\s+/, ""))}</p>`;
      return `<p>${escapeHtml(value)}</p>`;
    }).join("");
  }

  function renderChatMeta(meta = {}) {
    const filters = meta.filters || {};
    const products = (filters.products || []).length ? filters.products.join("、") : "全部产品";
    const channels = (filters.channels || []).length ? filters.channels.join("、") : "全部渠道";
    const comparison = meta.comparison?.type && meta.comparison.type !== "none" ? `对比 ${meta.comparison.startDate} 至 ${meta.comparison.endDate}` : "无对比";
    const source = meta.source === "deepseek" ? `DeepSeek · ${meta.model || "deepseek-chat"}` : "本地安全摘要";
    return `<div class="ai-message-meta"><span>${escapeHtml(source)}</span><span>${escapeHtml(`${filters.startDate || "-"} 至 ${filters.endDate || "-"}`)}</span><span>${escapeHtml(products)}</span><span>${escapeHtml(channels)}</span><span>${escapeHtml(comparison)}</span><span>${formatInteger(meta.rowCount)} 行</span></div>${meta.warning ? `<p class="ai-message-warning">${escapeHtml(meta.warning)}</p>` : ""}`;
  }

  function renderChatMessage(message) {
    if (message.role === "user") return `<article class="ai-message user"><div class="ai-message-role">你</div><div class="ai-message-body"><p>${escapeHtml(message.content)}</p></div></article>`;
    return `<article class="ai-message assistant ${message.error ? "error" : ""}"><div class="ai-message-role">AI</div><div class="ai-message-body">${formatAiAnswer(message.content)}${message.meta ? renderChatMeta(message.meta) : ""}</div></article>`;
  }

  function renderAiPanel() {
    const aiPanel = document.getElementById("ai-panel");
    const rows = salesForRange(state.start, state.end);
    const chat = aiState.chat || chatController.getState();
    const messages = chat.messages || [];
    const conversation = messages.length ? messages.map(renderChatMessage).join("") : `<div class="ai-chat-welcome"><strong>问我任何经营问题</strong><p>我会先把自然语言转成安全查询计划，在浏览器本地计算，再让 DeepSeek 解释结果。原始销售明细不会发送给模型。</p></div>`;

    aiPanel.hidden = false;
    aiPanel.innerHTML = `<div class="ai-panel-header">
      <div><p class="eyebrow">GTM AI Copilot</p><h2>AI经营对话</h2><p>当前看板范围 ${escapeHtml(state.start)} 至 ${escapeHtml(state.end)} · ${formatInteger(rows.length)} 条记录；明确提问条件优先于页面筛选。</p></div>
      <div class="ai-panel-actions"><button id="clearAiConversation" class="ghost-action" type="button" ${chat.running ? "disabled" : ""}>清空对话</button><button id="closeAiPanel" class="close-button" type="button">收起AI面板</button></div>
    </div>
    <div class="ai-scope-bar"><span>当前上下文</span><strong>${escapeHtml(state.start)} 至 ${escapeHtml(state.end)}</strong><span>${state.selections.channel.size === FILTERS.channel.options.length ? "全部渠道" : escapeHtml([...state.selections.channel].join("、"))}</span><span>会话记忆 ${Math.floor(messages.length / 2)} 轮</span><span>密钥由 Netlify 安全托管</span></div>
    <div class="ai-recommendations" aria-label="推荐问题">${RECOMMENDED_QUESTIONS.map((question) => `<button type="button" data-ai-question="${escapeHtml(question)}" ${chat.running ? "disabled" : ""}>${escapeHtml(question)}</button>`).join("")}</div>
    <section class="ai-chat-log" id="aiChatLog" aria-live="polite">${conversation}${chat.running ? `<div class="ai-thinking"><span class="ai-pulse"></span><span>正在理解问题、查询本地数据并生成回答…</span></div>` : ""}</section>
    ${chat.error ? `<p class="ai-chat-error">${escapeHtml(chat.error)}</p>` : ""}
    <form class="ai-composer" id="aiComposer">
      <label for="aiQuestion">经营问题</label>
      <textarea id="aiQuestion" rows="3" maxlength="500" placeholder="例如：18M2PRO最近表现如何？按京东和天猫拆一下。" ${chat.running ? "disabled" : ""}></textarea>
      <div><span>Enter发送 · Shift+Enter换行</span><button class="ai-action" type="submit" ${chat.running ? "disabled" : ""}>${chat.running ? "分析中…" : "发送"}</button></div>
    </form>
    <p class="ai-security-note">两阶段分析：DeepSeek只负责理解与解释，筛选、聚合、对比和异常计算均在本地白名单查询引擎完成；前端不保存API Key。</p>`;

    attachAiPanelEvents();
    requestAnimationFrame(() => { const log = document.getElementById("aiChatLog"); if (log) log.scrollTop = log.scrollHeight; });
  }

  function attachAiPanelEvents() {
    const aiPanel = document.getElementById("ai-panel");
    document.getElementById("closeAiPanel").addEventListener("click", () => {
      aiState.open = false;
      aiPanel.hidden = true;
      document.getElementById("openAiPanel").focus();
    });
    document.getElementById("clearAiConversation").addEventListener("click", () => chatController.clear());
    document.querySelectorAll("[data-ai-question]").forEach((button) => button.addEventListener("click", () => chatController.ask(button.dataset.aiQuestion)));
    const composer = document.getElementById("aiComposer");
    const question = document.getElementById("aiQuestion");
    composer.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = question.value.trim();
      if (!value) { question.focus(); return; }
      chatController.ask(value);
    });
    question.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); composer.requestSubmit(); }
    });
  }

  function openAiPanel() {
    aiState.open = true;
    aiState.chat = chatController.getState();
    renderAiPanel();
    document.getElementById("ai-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function updateFilterContext() {
    const industryMode = state.tab === "industry";
    document.getElementById("positionFilter").hidden = industryMode;
  }

  function renderTabs() {
    const tabs = document.getElementById("tabs");
    tabs.innerHTML = TAB_DEFS.map(([key, label]) => `<button type="button" class="tab-button ${state.tab === key ? "active" : ""}" data-tab="${key}" aria-pressed="${state.tab === key}">${label}</button>`).join("");
    tabs.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => {
      state.tab = button.dataset.tab;
      renderTabs();
      renderDashboard();
    }));
  }

  function filterButtonLabel(key) {
    const { label, options } = FILTERS[key];
    const selected = state.selections[key];
    if (selected.size === options.length) return `${label}：全部`;
    if (selected.size === 0) return `${label}：未选择`;
    if (selected.size === 1) return `${label}：${[...selected][0]}`;
    return `${label}：已选 ${selected.size}`;
  }

  function renderMultiFilter(containerId, key) {
    const container = document.getElementById(containerId);
    const spec = FILTERS[key];
    container.innerHTML = `<span class="filter-label">${escapeHtml(spec.label)}</span>
      <button type="button" class="filter-trigger" aria-haspopup="true" aria-expanded="false">${escapeHtml(filterButtonLabel(key))}</button>
      <div class="filter-menu" hidden>
        <input class="filter-search" type="search" placeholder="搜索${escapeHtml(spec.label)}" />
        <div class="filter-menu-actions"><button type="button" data-select-all>全选</button><button type="button" data-clear>清空</button></div>
        <div class="filter-options">${spec.options.map((option) => `<label class="filter-option" data-option-label="${escapeHtml(String(option).toLowerCase())}"><input type="checkbox" value="${escapeHtml(option)}" ${state.selections[key].has(option) ? "checked" : ""} /><span>${escapeHtml(option)}</span></label>`).join("")}</div>
      </div>`;

    const trigger = container.querySelector(".filter-trigger");
    const menu = container.querySelector(".filter-menu");
    const refresh = () => {
      trigger.textContent = filterButtonLabel(key);
      menu.querySelectorAll('input[type="checkbox"]').forEach((input) => { input.checked = state.selections[key].has(input.value); });
      renderDashboard();
    };
    trigger.addEventListener("click", () => {
      document.querySelectorAll(".filter-menu").forEach((other) => { if (other !== menu) other.hidden = true; });
      menu.hidden = !menu.hidden;
      trigger.setAttribute("aria-expanded", String(!menu.hidden));
    });
    menu.querySelector(".filter-search").addEventListener("input", (event) => {
      const query = event.target.value.trim().toLowerCase();
      menu.querySelectorAll(".filter-option").forEach((label) => { label.hidden = !label.dataset.optionLabel.includes(query); });
    });
    menu.querySelectorAll('input[type="checkbox"]').forEach((input) => input.addEventListener("change", () => {
      if (input.checked) state.selections[key].add(input.value);
      else state.selections[key].delete(input.value);
      refresh();
    }));
    menu.querySelector("[data-select-all]").addEventListener("click", () => {
      state.selections[key] = new Set(spec.options);
      refresh();
    });
    menu.querySelector("[data-clear]").addEventListener("click", () => {
      state.selections[key] = new Set();
      refresh();
    });
  }

  function renderFilterSummary() {
    if (state.tab === "industry") {
      const { rows, fallback } = oviWindow();
      const lower = Math.min(state.priceLower, state.priceUpper);
      const upper = Math.max(state.priceLower, state.priceUpper);
      document.getElementById("filterSummary").textContent = `当前行业-奥维命中 ${formatInteger(rows.length)} 条聚合记录；自定义价格区间 ${formatInteger(lower)}–${formatInteger(upper)} 元${fallback ? `；日期无对应奥维数据，使用 ${DATA.meta.oviMonthMax}` : ""}。`;
      return;
    }
    if (state.tab === "outbound") {
      const total = outboundForRange(state.start, state.end).length;
      document.getElementById("filterSummary").textContent = `当前筛选命中 ${formatInteger(total)} 行出库记录；业务部字段不在出库源表中，不参与本页筛选。`;
      return;
    }
    const total = salesForRange(state.start, state.end).length;
    const active = SALES_FILTER_KEYS.filter((key) => state.selections[key].size !== FILTERS[key].options.length).map((key) => FILTERS[key].label);
    document.getElementById("filterSummary").textContent = `当前筛选命中 ${formatInteger(total)} 行销售记录${active.length ? `；已限制：${active.join("、")}` : "；所有分类维度为全部"}。`;
  }

  function resetFilters() {
    state.start = defaultStart;
    state.end = maxDate;
    state.priceLower = 2000;
    state.priceUpper = 4000;
    Object.entries(FILTERS).forEach(([key, spec]) => { state.selections[key] = new Set(spec.options); });
    document.getElementById("startDate").value = state.start;
    document.getElementById("endDate").value = state.end;
    renderMultiFilter("channelFilter", "channel");
    renderMultiFilter("businessFilter", "business");
    renderMultiFilter("shapeFilter", "shape");
    renderMultiFilter("seriesFilter", "series");
    renderMultiFilter("coreFilter", "core");
    renderMultiFilter("positionFilter", "position");
    renderDashboard();
  }

  function attachDynamicEvents() {
    document.querySelectorAll("[data-download-panel]").forEach((button) => button.addEventListener("click", () => downloadPanel(button.dataset.downloadPanel)));
    const search = document.getElementById("accountingSearch");
    if (search) search.addEventListener("input", () => {
      const query = search.value.trim().toLowerCase();
      document.querySelectorAll("[data-search-row]").forEach((row) => { row.hidden = !row.dataset.searchRow.includes(query); });
    });
    const applyRange = document.getElementById("applyPriceRange");
    if (applyRange) applyRange.addEventListener("click", () => {
      const lower = Number(document.getElementById("priceLower").value);
      const upper = Number(document.getElementById("priceUpper").value);
      if (!Number.isFinite(lower) || !Number.isFinite(upper) || lower < 0 || upper < 0) {
        showToast("请输入有效的非负价格上下限");
        return;
      }
      state.priceLower = Math.min(lower, upper);
      state.priceUpper = Math.max(lower, upper);
      renderDashboard();
    });
    const resetRange = document.getElementById("resetPriceRange");
    if (resetRange) resetRange.addEventListener("click", () => {
      state.priceLower = 2000;
      state.priceUpper = 4000;
      renderDashboard();
    });
  }

  function downloadPanel(id) {
    const source = document.getElementById(id);
    if (!source) return;
    const lines = source.innerText.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 62);
    const canvas = document.createElement("canvas");
    canvas.width = 1600;
    canvas.height = Math.max(900, 180 + lines.length * 27);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fbf7f7";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#971d22";
    ctx.fillRect(0, 0, 18, canvas.height);
    ctx.fillStyle = "#b88338";
    ctx.font = "700 20px Arial";
    ctx.fillText("WATER HEATER COMMERCE INTELLIGENCE", 70, 62);
    ctx.fillStyle = "#181416";
    ctx.font = "800 36px Arial";
    ctx.fillText(lines.shift() || "经营看板", 70, 116);
    ctx.fillStyle = "#766a6e";
    ctx.font = "18px Arial";
    ctx.fillText(`筛选期：${state.start} 至 ${state.end} · 导出：${new Date().toLocaleString("zh-CN")}`, 70, 154);
    lines.forEach((line, index) => {
      ctx.fillStyle = index % 3 === 0 ? "#4c4044" : "#71656a";
      ctx.font = index % 3 === 0 ? "700 21px Arial" : "18px Arial";
      ctx.fillText(line.slice(0, 80), 70, 210 + index * 27);
    });
    const link = document.createElement("a");
    link.download = `${id}-${state.end}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    showToast("已按当前筛选导出 PNG");
  }

  let toastTimer;
  function showToast(message) {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
  }

  function renderDataTools() {
    const d = DATA.diagnostics;
    const diagnostics = [
      ["销售源行数", formatInteger(d.salesSourceRows)],
      ["有效销售行", formatInteger(d.salesValidRows)],
      ["编码匹配", formatInteger(d.codeMatched)],
      ["名称匹配", formatInteger(d.nameMatched)],
      ["未匹配行", formatInteger(d.unmatchedRows)],
      ["产品索引", formatInteger(d.productIndexRows)],
      ["核心品维护行", formatInteger(d.coreProducts)],
      ["核心型号去重", formatInteger(d.coreUniqueProducts || d.coreProducts)],
      ["未维护系列", formatInteger(d.missingSeriesProducts)],
      ["0 数量行", formatInteger(d.zeroQuantityRows)],
      ["0 核算价行", formatInteger(d.zeroAccountingRows)],
      ["政策价覆盖", formatInteger(d.policyAvailableRows)],
      ["2026 政策价匹配", formatInteger(d.policyMatchedSales2026)],
      ["有效出库行", formatInteger(d.outboundValidRows)],
      ["出库未匹配", formatInteger(d.outboundUnmatchedRows)],
      ["奥维明细", formatInteger(d.oviSourceRows)],
    ];
    document.getElementById("diagnosticGrid").innerHTML = diagnostics.map(([label, value]) => `<div class="diagnostic-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
    document.getElementById("diagnosticNotes").innerHTML = [
      `产品匹配率 ${((d.codeMatched + d.nameMatched) / d.salesValidRows * 100).toFixed(2)}%，未匹配产品 ${d.unmatchedProducts} 个。`,
      `索引表 144 个产品中，系列字段未维护 ${d.missingSeriesProducts} 个；页面统一显示“未分系列”。`,
      "销售指数按销售金额 ÷ 核算价金额合计计算；分母为 0 时显示“-”。",
      `2026 政策价由政策价参照表按月份和产品名称匹配，命中 ${formatInteger(d.policyMatchedSales2026)} 行；价格偏差率按匹配行销售金额 ÷ 政策价金额－1。`,
      `出库有效记录 ${formatInteger(d.outboundValidRows)} 行，产品匹配 ${formatInteger(d.outboundCodeMatched + d.outboundNameMatched)} 行。`,
      `奥维已更新至 ${DATA.meta.oviMonthMax}；单价取奥维“单价”字段，价位段仍按六档左闭右开边界划分。`,
    ].map((note) => `<p>${escapeHtml(note)}</p>`).join("");
  }

  function renderMethodology() {
    const items = [
      ["销售来源", `${DATA.meta.files[1]}；${DATA.meta.files[2]}。有效日期 ${DATA.meta.salesDateMin} 至 ${DATA.meta.salesDateMax}。`],
      ["产品分类", `${DATA.meta.files[0]}。系列、核心品、形态分类、定位、能效均直接取索引表。`],
      ["出库来源", `${DATA.meta.files[3]}。有效日期 ${DATA.meta.outboundDateMin} 至 ${DATA.meta.outboundDateMax}，渠道使用国补调整后口径。`],
      ["政策价来源", `${DATA.meta.files[4]}。按月份和产品名称匹配，非正政策价不参与。`],
      ["行业来源", `${DATA.meta.files[5]}。覆盖 ${DATA.meta.oviMonthMin} 至 ${DATA.meta.oviMonthMax}，品牌配置为“${DATA.meta.brand}”。`],
      ["价位段口径", "奥维单价字段与销额÷销量一致；固定结构分为2000以下、2000–2500、2500–3000、3000–3500、3500–4000、4000以上，自定义区间上下限均包含。"],
      ["同比口径", "销售与出库按上年同期同日；奥维按上年同期月份。分母为0或无同期时显示“-”。"],
      ["销售指数", "销售金额 ÷ 核算价金额合计。原始核算价字段已包含数量影响。"],
      ["价格偏差率", "按有政策价的销售行计算：销售金额 ÷ 对应月份政策价金额－1，结果保留1位小数。"],
      ["运行时经营指标", "折扣深度、价格指数、渠道占比和产品贡献度均由JS实时计算，不写入数据源；因缺少成本字段，不推算毛利。"],
      ["AI分析上下文", "DeepSeek负责查询规划与结果解释；本地引擎执行白名单筛选、聚合、对比和异常计算，仅发送压缩结果，不发送完整原始明细。"],
      ["AI密钥安全", "前端不保存API Key；部署后由Netlify环境变量DEEPSEEK_API_KEY注入Function代理。"],
      ["缺失处理", "库存、收入、成本、费用、目标、销售侧升数与区域等未提供字段不推算。"],
    ];
    document.getElementById("methodology").innerHTML = items.map(([title, text]) => `<div class="method-item"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(text)}</span></div>`).join("");
  }

  const drawer = document.getElementById("dataDrawer");
  function openDrawer() {
    drawer.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
    drawer.querySelector(".close-button").focus();
  }
  function closeDrawer() {
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
    document.getElementById("openDataTools").focus();
  }

  document.getElementById("openDataTools").addEventListener("click", openDrawer);
  document.getElementById("openAiPanel").addEventListener("click", openAiPanel);
  document.querySelectorAll("[data-close-drawer]").forEach((element) => element.addEventListener("click", closeDrawer));
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (drawer.classList.contains("open")) closeDrawer();
    if (aiState.open) {
      aiState.open = false;
      document.getElementById("ai-panel").hidden = true;
      document.getElementById("openAiPanel").focus();
    }
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".multi-filter")) document.querySelectorAll(".filter-menu").forEach((menu) => { menu.hidden = true; });
  });

  document.querySelectorAll("[data-upload]").forEach((input) => input.addEventListener("change", () => {
    const selected = [...document.querySelectorAll("[data-upload]")]
      .flatMap((field) => [...field.files].map((file) => `${field.dataset.upload}：${file.name}`));
    document.getElementById("uploadStatus").textContent = selected.length
      ? `已选择 ${selected.length} 个文件：${selected.join("；")}。静态看板不会自动上传文件，请重新运行数据构建脚本后刷新页面。`
      : "当前页面使用构建时的数据快照；选择新文件后会展示待刷新清单。";
  }));

  const startInput = document.getElementById("startDate");
  const endInput = document.getElementById("endDate");
  startInput.min = DATA.meta.salesDateMin;
  startInput.max = DATA.meta.salesDateMax;
  endInput.min = DATA.meta.salesDateMin;
  endInput.max = DATA.meta.salesDateMax;
  startInput.value = state.start;
  endInput.value = state.end;
  startInput.addEventListener("change", () => {
    state.start = startInput.value;
    if (state.start > state.end) { state.end = state.start; endInput.value = state.end; }
    renderDashboard();
  });
  endInput.addEventListener("change", () => {
    state.end = endInput.value;
    if (state.end < state.start) { state.start = state.end; startInput.value = state.start; }
    renderDashboard();
  });

  document.getElementById("moreFilters").addEventListener("click", (event) => {
    const secondary = document.getElementById("secondaryFilters");
    secondary.hidden = !secondary.hidden;
    event.currentTarget.setAttribute("aria-expanded", String(!secondary.hidden));
    event.currentTarget.textContent = secondary.hidden ? "更多筛选" : "收起筛选";
  });
  document.getElementById("resetFilters").addEventListener("click", resetFilters);

  document.getElementById("sourceLine").textContent = `【更新时间：${DATA.meta.generatedAt}】【读取文件：${DATA.meta.files.join(" / ")}】`;
  document.getElementById("freshnessPill").textContent = `销售截止 ${DATA.meta.salesDateMax}`;
  chatController.setOnChange((snapshot) => {
    aiState.chat = snapshot;
    if (aiState.open) renderAiPanel();
  });

  renderTabs();
  renderMultiFilter("channelFilter", "channel");
  renderMultiFilter("businessFilter", "business");
  renderMultiFilter("shapeFilter", "shape");
  renderMultiFilter("seriesFilter", "series");
  renderMultiFilter("coreFilter", "core");
  renderMultiFilter("positionFilter", "position");
  renderMethodology();
  renderDataTools();
  renderDashboard();
})();
