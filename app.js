import { createDeepChatController } from "./ai/deep-chat-controller.js?v=20260731a";
import { AI_MODES, RECOMMENDED_QUESTIONS } from "./config/ai-config.js?v=20260731a";

if (window.WATER_HEATER_DATA_READY) {
  try {
    await window.WATER_HEATER_DATA_READY;
  } catch (error) {
    console.error("数据快照解压失败", error);
  }
}

(() => {
  "use strict";

  const DATA = window.WATER_HEATER_DATA;
  const INCOME_DATA = window.WATER_HEATER_INCOME_DATA || null;
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
  const incomeCurrent = INCOME_DATA ? INCOME_DATA.current.map((row) => zip(INCOME_DATA.fields, row)) : [];
  const incomePrior = INCOME_DATA ? INCOME_DATA.prior.map((row) => zip(INCOME_DATA.fields, row)) : [];
  const products = DATA.products.map((row) => zip(DATA.productFields, row));
  const sales = DATA.sales.map((row) => {
    const record = zip(DATA.salesFields, row);
    record.product = products[record.productId] || {};
    return record;
  });
  const ovi = DATA.ovi.map((row) => zip(DATA.oviFields, row));
  const targets = (DATA.targets || []).map((row) => zip(DATA.targetFields || [], row));
  const competitorPrices = (DATA.priceMonitor || []).map((row) => zip(DATA.priceMonitorFields || [], row));
  const PRICE_BANDS = ["2000以下", "2000–2500", "2500–3000", "3000–3500", "3500–4000", "4000以上"];

  const TAB_DEFS = [
    ["overview", "经营总览"],
    ["category", "品类销售"],
    ["channel", "渠道效率"],
    ["income", "收入经营"],
    ["store", "店铺效率"],
    ["core", "型号效率"],
    ["industry", "行业-奥维"],
  ];

  const uniqueSorted = (values) => [...new Set(values.filter((value) => value !== "" && value != null))]
    .sort((a, b) => String(a).localeCompare(String(b), "zh-CN"));
  const SHAPE_BREAKDOWN_MODES = {
    newClassification: {
      label: "新版形态分类",
      subtitle: "蝶翼和平衡机保持原分类；未分类、通品与效率品合并为其他",
      column: "新版形态分类",
    },
    original: {
      label: "原始形态",
      subtitle: "严格使用产品索引表“分类”字段",
      column: "形态分类",
    },
  };
  const storeValue = (record) => {
    if (String(record.channel || "").trim() === "天猫官旗") return "方太官方旗舰店（天猫）";
    return record.store || "未标注店铺";
  };
  const dimValue = (record, key) => {
    if (key === "channel") return record.channel || "未标注";
    if (key === "business") return record.business || "未标注";
    if (key === "shape") return record.product.shape || "未分类";
    if (key === "series") return record.product.series || "未分系列";
    if (key === "core") return record.product.core ? "核心品" : "非核心品";
    if (key === "position") return record.product.position || "未标注";
    return "";
  };
  const shapeStructureValue = (record) => {
    const shape = dimValue(record, "shape");
    if (state.splitButterfly && shape === "蝶翼") {
      const series = String(record.product.series || "").trim().toUpperCase();
      if (series === "M2") return "蝶翼 18L（M2系列）";
      if (series === "M0" || series === "M1") return "蝶翼 16L（M0/M1系列）";
      return "蝶翼 未标注升数";
    }
    if (state.shapeBreakdownMode === "newClassification" && (shape === "未分类" || shape === "通品" || shape === "效率品")) return "其他";
    return shape;
  };
  const LOW_PRIORITY_SHAPES = new Set(["通品", "效率品", "未分类", "其他"]);
  const isLowPriorityShape = (name) => LOW_PRIORITY_SHAPES.has(String(name || "").trim());
  const focusShapeItems = (items) => items.filter((item) => !isLowPriorityShape(item.name));
  const sortShapesByPriority = (items) => [...items].sort((a, b) => {
    const priorityDelta = Number(isLowPriorityShape(a.name)) - Number(isLowPriorityShape(b.name));
    return priorityDelta || b.amount - a.amount;
  });
  const focusRowsByShape = (rows) => rows.filter((row) => !isLowPriorityShape(shapeStructureValue(row)));

  const FILTERS = {
    channel: { label: "渠道", options: uniqueSorted(sales.map((row) => dimValue(row, "channel"))) },
    business: { label: "业务部", options: uniqueSorted(sales.map((row) => dimValue(row, "business"))) },
    shape: { label: "形态分类", options: uniqueSorted(sales.map((row) => dimValue(row, "shape"))) },
    series: { label: "系列", options: uniqueSorted(sales.map((row) => dimValue(row, "series"))) },
    core: { label: "核心品", options: ["核心品", "非核心品"] },
    position: { label: "产品定位", options: uniqueSorted(sales.map((row) => dimValue(row, "position"))) },
  };
  const SALES_FILTER_KEYS = ["channel", "business", "shape", "series", "core", "position"];

  const maxDate = DATA.meta.salesDateMax;
  const defaultStart = `${maxDate.slice(0, 7)}-01`;
  const incomeDefaultStart = INCOME_DATA?.meta?.incomeDateMin || `${maxDate.slice(0, 4)}-01-01`;
  const incomeDefaultEnd = INCOME_DATA?.meta?.incomeDateMax || maxDate;
  const requestedTab = new URLSearchParams(window.location.search).get("tab");
  const initialTab = TAB_DEFS.some(([key]) => key === requestedTab) ? requestedTab : "overview";
  const initialIncomeMode = initialTab === "income";
  const state = {
    tab: initialTab,
    start: initialIncomeMode ? incomeDefaultStart : defaultStart,
    end: initialIncomeMode ? incomeDefaultEnd : maxDate,
    salesStart: defaultStart,
    salesEnd: maxDate,
    incomeStart: incomeDefaultStart,
    incomeEnd: incomeDefaultEnd,
    priceLower: 2000,
    priceUpper: 4000,
    shapeBreakdownMode: "newClassification",
    splitButterfly: false,
    expandedShapeDetails: new Set(),
    showShapeAmountDelta: true,
    showOperatingFocus: true,
    n1TrendMetric: "qty",
    priceImpactDimension: "model",
    priceImpactSort: "absolute",
    showPriceImpactDetail: true,
    storeSelected: "",
    storeSort: "desc",
    modelScope: "core",
    selectedModel: "",
    compareModels: [],
    priceFocus: {
      "18M2": "18M2PRO",
      "16M1": "16M1PRO",
    },
    selections: Object.fromEntries(Object.entries(FILTERS).map(([key, spec]) => [key, new Set(spec.options)])),
  };
  const aiState = {
    open: false,
    chat: null,
    mode: (() => { try { return localStorage.getItem("WATER_HEATER_AI_MODE_V47") || "deep"; } catch { return "deep"; } })(),
    contextOpen: false,
  };
  const chatController = createDeepChatController({
    dataSources: { sales, ovi, meta: DATA.meta },
    getDashboardFilters: getCurrentDashboardFilters,
    getBusinessContext: getSavedAiBusinessContext,
  });

  const formatInteger = (value) => Math.round(Number(value || 0)).toLocaleString("zh-CN");
  const formatWan = (value) => {
    const rounded = Math.round(Number(value || 0) / 10000);
    return `${Object.is(rounded, -0) ? 0 : rounded.toLocaleString("zh-CN")}万`;
  };
  const formatCurrency = (value) => `¥${Math.round(Number(value || 0)).toLocaleString("zh-CN")}`;
  const formatSignedWan = (value) => {
    if (!Number.isFinite(value)) return "-";
    const rounded = Math.round(value / 10000);
    const prefix = rounded > 0 ? "+" : rounded < 0 ? "−" : "";
    return `${prefix}${Math.abs(rounded).toLocaleString("zh-CN")}万`;
  };
  const formatSignedCurrency = (value) => {
    if (!Number.isFinite(value)) return "-";
    const rounded = Math.round(value);
    const prefix = rounded > 0 ? "+" : rounded < 0 ? "−" : "";
    return `${prefix}¥${Math.abs(rounded).toLocaleString("zh-CN")}`;
  };
  const formatDecimal = (value, digits = 1) => Number.isFinite(value) ? value.toFixed(digits) : "-";
  const signClass = (value) => !Number.isFinite(value) || value === 0 ? "neutral" : value > 0 ? "positive" : "negative";
  const formatSignedPct = (value, digits = 1) => Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%` : "-";
  const formatSignedPoint = (value, digits = 1) => Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}pct` : "-";
  const formatRate = (value, digits = 1) => Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : "-";
  const ratioChange = (current, prior) => Number.isFinite(prior) && prior !== 0 ? current / prior - 1 : NaN;
  const toDate = (iso) => new Date(`${iso}T00:00:00Z`);
  const toIso = (date) => date.toISOString().slice(0, 10);
  const shiftDays = (iso, days) => {
    const date = toDate(iso);
    date.setUTCDate(date.getUTCDate() + days);
    return toIso(date);
  };

  const shiftYear = (iso, delta) => {
    const [year, month, day] = iso.split("-").map(Number);
    const shifted = new Date(Date.UTC(year + delta, month - 1, day));
    return shifted.toISOString().slice(0, 10);
  };

  const monthStartIso = (iso) => `${String(iso || "").slice(0, 7)}-01`;
  const monthEndIso = (iso) => {
    const [year, month] = String(iso || "").slice(0, 7).split("-").map(Number);
    return Number.isFinite(year) && Number.isFinite(month)
      ? toIso(new Date(Date.UTC(year, month, 0)))
      : iso;
  };

  function switchDateContext(nextTab) {
    const wasIncome = state.tab === "income";
    const willBeIncome = nextTab === "income";
    if (wasIncome === willBeIncome) return;
    if (wasIncome) {
      state.incomeStart = state.start;
      state.incomeEnd = state.end;
      state.start = state.salesStart;
      state.end = state.salesEnd;
    } else {
      state.salesStart = state.start;
      state.salesEnd = state.end;
      state.start = state.incomeStart;
      state.end = state.incomeEnd;
    }
  }

  function passesDimensionFilters(record, ignoredKeys = []) {
    const ignored = new Set(ignoredKeys);
    return SALES_FILTER_KEYS.every((key) => ignored.has(key) || state.selections[key].has(dimValue(record, key)));
  }

  function salesForRange(start, end, coreOnly = false, ignoredKeys = []) {
    return sales.filter((record) => (
      record.date >= start
      && record.date <= end
      && passesDimensionFilters(record, ignoredKeys)
      && (!coreOnly || record.product.core)
    ));
  }

  function metricSummary(rows) {
    const amount = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const qty = rows.reduce((sum, row) => sum + Number(row.qty || 0), 0);
    const accountingRows = rows.filter((row) => row.accounting != null);
    const accounting = accountingRows.reduce((sum, row) => sum + Number(row.accounting || 0), 0);
    const policyRows = rows.filter((row) => row.policy != null && Number.isFinite(Number(row.policy)) && Number(row.policy) !== 0);
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
      priceDeviation: policySales !== 0 ? policy / policySales - 1 : NaN,
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
    const currentCore = metricSummary(currentRows.filter((row) => row.product.core));
    const priorCore = metricSummary(priorRows.filter((row) => row.product.core));
    const amountChange = ratioChange(current.amount, prior.amount);
    const qtyChange = ratioChange(current.qty, prior.qty);
    const avgChange = ratioChange(current.avgPrice, prior.avgPrice);
    const coreChange = ratioChange(currentCore.amount, priorCore.amount);
    const coreShare = current.amount ? currentCore.amount / current.amount : NaN;
    const indexDelta = Number.isFinite(current.salesIndex) && Number.isFinite(prior.salesIndex)
      ? current.salesIndex - prior.salesIndex : NaN;

    return `<section class="metric-grid">
      ${metricCard("销售金额", formatCurrency(current.amount), `同比 ${formatSignedPct(amountChange)}`, amountChange, "筛选期内销售金额合计")}
      ${metricCard("销售台量", formatInteger(current.qty), `同比 ${formatSignedPct(qtyChange)}`, qtyChange, "筛选期内数量合计，含退货冲销")}
      ${metricCard("成交均价", Number.isFinite(current.avgPrice) ? formatCurrency(current.avgPrice) : "-", `同比 ${formatSignedPct(avgChange)}`, avgChange, "销售金额 ÷ 销售台量")}
      ${metricCard("销售指数", Number.isFinite(current.salesIndex) ? current.salesIndex.toFixed(3) : "-", `同比净值差 ${Number.isFinite(indexDelta) ? `${indexDelta >= 0 ? "+" : ""}${indexDelta.toFixed(3)}` : "-"}`, indexDelta, "销售金额 ÷ 核算价金额合计")}
      ${metricCard("M1&M2&N核心品销售额", formatCurrency(currentCore.amount), `占比 ${formatRate(coreShare)} · 同比 ${formatSignedPct(coreChange)}`, coreChange, "M1/M2/N系列核心品标记来自产品索引表")}
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

  const modelKeyOfProduct = (product = {}) => String(product.code || product.name || "").trim();
  const modelKeyOfRecord = (record) => modelKeyOfProduct(record?.product);
  const modelLabel = (item) => `${item.product.series || "未分系列"}｜${item.product.name || item.product.code || item.key}`;
  const MODEL_PRIOR_REFERENCE_RULES = [
    {
      label: "02-MS16T1",
      matchesCurrent: (product = {}) => /(?:^|-)16M1(?:-|$)/i.test(String(product.name || "")),
      matchesPrior: (product = {}) => /02-MS16T1/i.test(String(product.name || "")),
    },
    {
      label: "MS16T2",
      matchesCurrent: (product = {}) => /16M1Pro/i.test(String(product.name || "")),
      matchesPrior: (product = {}) => /MS16T2/i.test(String(product.name || "")),
    },
    {
      label: "X16F1",
      matchesCurrent: (product = {}) => /16F2Max/i.test(String(product.name || "")),
      matchesPrior: (product = {}) => /X16F1/i.test(String(product.name || "")),
    },
  ];
  const modelPriorReferenceRule = (product = {}) => MODEL_PRIOR_REFERENCE_RULES.find((rule) => rule.matchesCurrent(product));

  function modelCatalog(currentRows, priorRows, scope = "all") {
    const scoped = (rows) => scope === "core" ? rows.filter((row) => row.product.core) : rows;
    const currentMap = groupRows(scoped(currentRows).filter((row) => modelKeyOfRecord(row)), modelKeyOfRecord);
    const priorMap = groupRows(scoped(priorRows).filter((row) => modelKeyOfRecord(row)), modelKeyOfRecord);
    const keys = new Set([...currentMap.keys(), ...priorMap.keys()]);
    return [...keys].map((key) => {
      const currentModelRows = currentMap.get(key) || [];
      const priorModelRows = priorMap.get(key) || [];
      const source = currentModelRows[0] || priorModelRows[0];
      const current = metricSummary(currentModelRows);
      const prior = metricSummary(priorModelRows);
      return {
        key,
        product: source?.product || {},
        currentRows: currentModelRows,
        priorRows: priorModelRows,
        current,
        prior,
        amountYoy: ratioChange(current.amount, prior.amount),
        qtyYoy: ratioChange(current.qty, prior.qty),
      };
    }).sort((a, b) => b.current.amount - a.current.amount || b.current.qty - a.current.qty || modelLabel(a).localeCompare(modelLabel(b), "zh-CN"));
  }

  function modelCatalogWithPriorReferences(currentRows, priorRows, scope = "all", priorReferenceRows = priorRows) {
    const referenceCandidates = priorReferenceRows.filter((row) => modelKeyOfRecord(row));
    return modelCatalog(currentRows, priorRows, scope).map((item) => {
      const rule = item.currentRows.length ? modelPriorReferenceRule(item.product) : null;
      if (!rule) return item;
      const mappedPriorRows = referenceCandidates.filter((row) => rule.matchesPrior(row.product));
      const prior = metricSummary(mappedPriorRows);
      return {
        ...item,
        priorRows: mappedPriorRows,
        prior,
        amountYoy: ratioChange(item.current.amount, prior.amount),
        qtyYoy: ratioChange(item.current.qty, prior.qty),
        priorReference: rule.label,
      };
    });
  }

  function median(values) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return NaN;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
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
      .sort(([a], [b]) => b.localeCompare(a))
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
    const textHeaders = new Set(["日期", "店铺", "渠道", "业务部", "系列", "形态", "形态分类", "形态 / 升数", "新版形态分类", "型号", "产品编码", "经营分层", "主渠道", "主力渠道", "价位段", "升数段"]);
    const centerHeaders = new Set(["排名", "优先级", "层级", "核心品", "状态"]);
    const columnKinds = headers.map((header) => centerHeaders.has(header) ? "center" : textHeaders.has(header) ? "text" : "number");
    const decoratedRows = rows.map((row) => {
      let columnIndex = 0;
      return row.replace(/<td([^>]*)>/g, (_match, attributes = "") => {
        const classMatch = attributes.match(/\sclass="([^"]*)"/);
        const existingClass = classMatch?.[1] || "";
        const preservedAttributes = attributes.replace(/\sclass="[^"]*"/, "");
        const cellClass = `table-cell-${columnKinds[columnIndex] || "number"} table-column-${columnIndex}`;
        columnIndex += 1;
        return `<td${preservedAttributes} class="${existingClass ? `${existingClass} ` : ""}${cellClass}">`;
      });
    });
    return `<div class="table-wrap"><table class="data-table" style="min-width:${minWidth}px"><thead><tr>${headers.map((header, index) => `<th class="table-cell-${columnKinds[index]} table-column-${index}">${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${decoratedRows.join("")}</tbody></table></div>`;
  }

  function storeSummaries(rows) {
    return [...groupRows(rows, storeValue).entries()]
      .map(([name, groupedRows]) => ({ name, ...metricSummary(groupedRows) }))
      .sort((a, b) => b.amount - a.amount || String(a.name).localeCompare(String(b.name), "zh-CN"));
  }

  function ensureStoreSelection(rows) {
    const stores = storeSummaries(rows);
    if (!stores.length) {
      state.storeSelected = "";
      return stores;
    }
    if (!state.storeSelected || !stores.some((item) => item.name === state.storeSelected)) {
      state.storeSelected = stores[0].name;
    }
    return stores;
  }

  function productStructureRows(storeRows, priorStoreRows) {
    const currentMap = groupRows(storeRows, (row) => String(row.productId));
    const priorMap = groupRows(priorStoreRows, (row) => String(row.productId));
    const total = metricSummary(storeRows).amount;
    const direction = state.storeSort === "asc" ? 1 : -1;
    return [...currentMap.entries()]
      .map(([productId, rows]) => {
        const product = rows[0]?.product || {};
        const current = metricSummary(rows);
        const prior = metricSummary(priorMap.get(productId) || []);
        return {
          productId,
          series: product.series || "未分系列",
          shape: product.shape || "未分类",
          name: product.name || product.code || "未识别产品",
          code: product.code || "",
          ...current,
          share: total ? current.amount / total : NaN,
          yoy: ratioChange(current.amount, prior.amount),
        };
      })
      .sort((a, b) => direction * (a.amount - b.amount) || String(a.name).localeCompare(String(b.name), "zh-CN"));
  }

  function renderStore() {
    const currentRows = salesForRange(state.start, state.end);
    const priorRows = salesForRange(shiftYear(state.start, -1), shiftYear(state.end, -1));
    const stores = ensureStoreSelection(currentRows);
    if (!stores.length) {
      return '<div class="empty-state"><div class="empty-state-inner"><h2>当前筛选无店铺数据</h2><p>调整日期或分类筛选后再查看。</p></div></div>';
    }

    const selectedStore = state.storeSelected;
    const storeRows = currentRows.filter((row) => storeValue(row) === selectedStore);
    const priorStoreRows = priorRows.filter((row) => storeValue(row) === selectedStore);
    const current = metricSummary(storeRows);
    const prior = metricSummary(priorStoreRows);
    const overall = metricSummary(currentRows);
    const amountChange = ratioChange(current.amount, prior.amount);
    const qtyChange = ratioChange(current.qty, prior.qty);
    const avgChange = ratioChange(current.avgPrice, prior.avgPrice);
    const storeShare = overall.amount ? current.amount / overall.amount : NaN;
    const productsByStore = productStructureRows(storeRows, priorStoreRows);
    const series = ranking(storeRows, priorStoreRows, (row) => dimValue(row, "series"), 30);
    const shapes = ranking(storeRows, priorStoreRows, shapeStructureValue, 30);
    const channels = ranking(storeRows, priorStoreRows, (row) => dimValue(row, "channel"), 20);
    const topSeries = series[0];
    const topSeriesShare = topSeries && current.amount ? topSeries.amount / current.amount : NaN;
    const selectedRank = stores.findIndex((item) => item.name === selectedStore);

    const options = stores.map((item) => `<option value="${escapeHtml(item.name)}" ${item.name === selectedStore ? "selected" : ""}>${escapeHtml(item.name)}（${formatWan(item.amount)}）</option>`).join("");
    const productRows = productsByStore.map((item) => `<tr data-search-row="${escapeHtml(`${item.series} ${item.shape} ${item.name} ${item.code}`.toLowerCase())}">
      <td>${escapeHtml(item.series)}</td>
      <td>${escapeHtml(item.shape)}</td>
      <td>${escapeHtml(item.name)}</td>
      <td>${escapeHtml(item.code || "-")}</td>
      <td>${formatInteger(item.qty)}</td>
      <td>${formatCurrency(item.amount)}</td>
      <td>${Number.isFinite(item.share) ? `${(item.share * 100).toFixed(1)}%` : "-"}</td>
      <td>${Number.isFinite(item.avgPrice) ? formatCurrency(item.avgPrice) : "-"}</td>
      <td class="${signClass(item.yoy)}">${formatSignedPct(item.yoy)}</td>
    </tr>`);
    const storeRankRows = stores.slice(0, 30).map((item, index) => `<tr class="${item.name === selectedStore ? "highlight-row" : ""}">
      <td>${index + 1}</td>
      <td>${escapeHtml(item.name)}</td>
      <td>${formatCurrency(item.amount)}</td>
      <td>${formatInteger(item.qty)}</td>
      <td>${Number.isFinite(item.avgPrice) ? formatCurrency(item.avgPrice) : "-"}</td>
      <td>${overall.amount ? `${(item.amount / overall.amount * 100).toFixed(1)}%` : "-"}</td>
    </tr>`);

    return `<section class="store-control-panel glass">
      <div class="store-control-copy"><p class="eyebrow">Store Drilldown</p><h2>店铺维度分析</h2><p>店铺来自销售 Excel 的客户字段；所有产品结构会跟随日期、渠道、业务部、形态、系列等全局筛选变化。</p></div>
      <div class="store-controls">
        <label class="range-field store-select-field"><span>选择店铺</span><select id="storeSelect">${options}</select></label>
        <label class="range-field"><span>产品排序</span><select id="storeSort"><option value="desc" ${state.storeSort === "desc" ? "selected" : ""}>销售额：多到少</option><option value="asc" ${state.storeSort === "asc" ? "selected" : ""}>销售额：少到多</option></select></label>
      </div>
      <p class="price-range-summary">当前店铺：${escapeHtml(selectedStore)}；在当前筛选下排名第 ${selectedRank + 1} / ${formatInteger(stores.length)}。</p>
    </section>
    <section class="metric-grid">
      ${metricCard("店铺销售额", formatCurrency(current.amount), `同比 ${formatSignedPct(amountChange)}`, amountChange, "所选店铺在筛选期内销售金额")}
      ${metricCard("店铺销量", formatInteger(current.qty), `同比 ${formatSignedPct(qtyChange)}`, qtyChange, "所选店铺在筛选期内销售台量")}
      ${metricCard("店铺均价", Number.isFinite(current.avgPrice) ? formatCurrency(current.avgPrice) : "-", `同比 ${formatSignedPct(avgChange)}`, avgChange, "店铺销售额 ÷ 店铺销量")}
      ${metricCard("店铺内SKU数", formatInteger(productsByStore.length), `有效明细 ${formatInteger(current.rows)} 行`, NaN, "所选店铺有销售记录的型号数")}
      ${metricCard("店铺销售占比", Number.isFinite(storeShare) ? `${(storeShare * 100).toFixed(1)}%` : "-", "占当前全局筛选销售额", storeShare, "店铺销售额 ÷ 当前筛选销售额")}
      ${metricCard("主力系列", topSeries ? topSeries.name : "-", topSeries ? `店铺内 ${formatRate(topSeriesShare)}` : "当前无系列数据", topSeriesShare, "按店铺内销售额最高系列")}
    </section>
    <section class="content-grid">
      ${panel("店铺产品结构", "按产品销售额排序；占比为型号销售额 ÷ 所选店铺销售额", `<div class="search-row"><input id="storeProductSearch" type="search" placeholder="搜索系列、形态、型号或编码" /></div>${table(["系列", "形态", "型号", "产品编码", "销量", "销售额", "店铺内占比", "成交均价", "同比"], productRows, 1180)}`, "store-product-structure", { className: "span-2" })}
      ${panel("店铺销售排名", "当前全局筛选下各店铺销售额降序，当前店铺高亮", table(["排名", "店铺", "销售额", "销量", "均价", "全局占比"], storeRankRows, 920), "store-ranking", { className: "span-2" })}
      ${panel("店铺系列结构", "所选店铺内按系列拆分销售贡献", rankList(series), "store-series")}
      ${panel("店铺形态结构", "形态口径继承品类页的蝶翼拆分开关", rankList(shapes), "store-shape")}
      ${panel("店铺渠道结构", "同一店铺在不同渠道下的销售贡献", rankList(channels), "store-channel")}
    </section>`;
  }

  function focusCard(label, value, context, tone = "neutral") {
    return `<div class="focus-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small class="${tone}">${escapeHtml(context)}</small>
    </div>`;
  }

  function renderOperatingFocus(currentRows, priorRows, shapes) {
    if (!state.showOperatingFocus) {
      return `<section class="focus-panel focus-panel-collapsed glass">
        <div class="focus-copy">
          <p class="eyebrow">4.6 Operating Focus</p>
          <h2>经营重点已隐藏</h2>
          <p>需要时可重新展开，不影响下面各模块数据展示。</p>
        </div>
        <button class="focus-toggle-button" data-toggle-operating-focus type="button">显示经营重点</button>
      </section>`;
    }
    const focusRows = focusRowsByShape(currentRows);
    const focusPriorRows = focusRowsByShape(priorRows);
    const focus = metricSummary(focusRows);
    const focusPrior = metricSummary(focusPriorRows);
    const focusChange = ratioChange(focus.amount, focusPrior.amount);
    const focusShapes = focusShapeItems(shapes).filter((item) => item.amount || item.qty);
    const topShape = focusShapes[0];
    const weakShape = [...focusShapes].filter((item) => Number.isFinite(item.yoy)).sort((a, b) => a.yoy - b.yoy)[0];
    const focusModels = ranking(focusRows, focusPriorRows, (row) => row.product.name || row.product.code, 8);
    const focusChannels = ranking(focusRows, focusPriorRows, (row) => dimValue(row, "channel"), 8);
    const topModel = focusModels[0];
    const topChannel = focusChannels[0];
    const focusShare = metricSummary(currentRows).amount ? focus.amount / metricSummary(currentRows).amount : NaN;
    const actions = [
      weakShape ? `优先看 ${weakShape.name}：同比 ${formatSignedPct(weakShape.yoy)}，判断是渠道还是型号拖累。` : "重点形态暂无明显下滑，继续看核心型号结构。",
      topModel ? `重点型号先看 ${topModel.name}：销售额 ${formatWan(topModel.amount)}，同比 ${formatSignedPct(topModel.yoy)}。` : "当前筛选下暂无重点型号贡献。",
      topChannel ? `重点渠道先看 ${topChannel.name}：贡献 ${formatWan(topChannel.amount)}。` : "当前筛选下暂无重点渠道贡献。",
      "通品 / 效率品 / 未分类保留在完整明细里监控，不作为首页动作重点。",
    ];
    return `<section class="focus-panel glass">
      <div class="focus-copy">
        <p class="eyebrow">4.6 Operating Focus</p>
        <h2>经营重点</h2>
        <p>首页优先展示重点形态和核心型号，减少通品、效率品、未分类对判断的干扰。</p>
        <button class="focus-toggle-button" data-toggle-operating-focus type="button">隐藏经营重点</button>
      </div>
      <div class="focus-cards">
        ${focusCard("重点形态销售额", formatCurrency(focus.amount), `占总销售 ${formatRate(focusShare)} · 同比 ${formatSignedPct(focusChange)}`, signClass(focusChange))}
        ${focusCard("主力形态", topShape ? topShape.name : "-", topShape ? `${formatWan(topShape.amount)} · 同比 ${formatSignedPct(topShape.yoy)}` : "当前无重点形态", signClass(topShape?.yoy))}
        ${focusCard("主力型号", topModel ? topModel.name : "-", topModel ? `${formatWan(topModel.amount)} · 同比 ${formatSignedPct(topModel.yoy)}` : "当前无重点型号", signClass(topModel?.yoy))}
        ${focusCard("主力渠道", topChannel ? topChannel.name : "-", topChannel ? `${formatWan(topChannel.amount)} · 同比 ${formatSignedPct(topChannel.yoy)}` : "当前无重点渠道", signClass(topChannel?.yoy))}
      </div>
      <ul class="focus-actions">${actions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </section>`;
  }

  function renderDataHealthPanel() {
    const d = DATA.diagnostics || {};
    const matchBase = Number(d.salesValidRows || 0);
    const matchRate = matchBase ? (Number(d.codeMatched || 0) + Number(d.nameMatched || 0)) / matchBase : NaN;
    const policyRate = matchBase ? Number(d.policyAvailableRows || 0) / matchBase : NaN;
    const healthItems = [
      ["销售截止", DATA.meta.salesDateMax],
      ["奥维月份", DATA.meta.oviMonthMax],
      ["政策价覆盖", formatRate(policyRate, 1)],
      ["产品匹配率", formatRate(matchRate, 2)],
      ["未匹配行", formatInteger(d.unmatchedRows)],
      ["未维护系列", formatInteger(d.missingSeriesProducts)],
      ["店铺数", formatInteger(d.storeCount)],
    ];
    const notes = [
      Number(d.unmatchedRows || 0) > 0 ? `有 ${formatInteger(d.unmatchedRows)} 行销售未匹配产品索引，建议更新索引表。` : "销售产品索引匹配正常。",
      Number(d.missingSeriesProducts || 0) > 0 ? `仍有 ${formatInteger(d.missingSeriesProducts)} 个产品未维护系列。` : "系列字段维护完整。",
      Number.isFinite(policyRate) && policyRate < 0.8 ? `政策价覆盖 ${formatRate(policyRate)}，解读政策相关指标时要留意样本覆盖。` : "政策价覆盖相对稳定。",
    ];
    return panel("数据体检", "每次更新 Excel 后先看这里，判断数据能不能放心用", `
      <div class="health-grid">${healthItems.map(([label, value]) => `<div class="health-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}</div>
      <ul class="focus-actions health-notes">${notes.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    `, "data-health", { className: "span-2" });
  }

  function priceImpactSpec(dimension) {
    const specs = {
      model: {
        label: "型号",
        key: (row) => modelKeyOfRecord(row) || "未匹配型号",
        name: (rows, key) => rows[0]?.product?.name || rows[0]?.product?.code || key,
        drill: "model",
      },
      series: {
        label: "系列",
        key: (row) => dimValue(row, "series"),
        name: (_rows, key) => key,
        drill: "",
      },
      shape: {
        label: "形态",
        key: (row) => shapeStructureValue(row),
        name: (_rows, key) => key,
        drill: "",
      },
      channel: {
        label: "渠道",
        key: (row) => dimValue(row, "channel"),
        name: (_rows, key) => key,
        drill: "channel",
      },
      store: {
        label: "店铺",
        key: (row) => storeValue(row),
        name: (_rows, key) => key,
        drill: "store",
      },
    };
    return specs[dimension] || specs.model;
  }

  function buildPriceImpact(currentRows, priorRows, dimension) {
    const spec = priceImpactSpec(dimension);
    const currentTotal = metricSummary(currentRows);
    const priorTotal = metricSummary(priorRows);
    const currentMap = groupRows(currentRows, spec.key);
    const priorMap = groupRows(priorRows, spec.key);
    const keys = new Set([...currentMap.keys(), ...priorMap.keys()]);
    const rows = [...keys].map((key) => {
      const currentGroupRows = currentMap.get(key) || [];
      const priorGroupRows = priorMap.get(key) || [];
      const current = metricSummary(currentGroupRows);
      const prior = metricSummary(priorGroupRows);
      const currentHasQty = Math.abs(current.qty) > 1e-9;
      const priorHasQty = Math.abs(prior.qty) > 1e-9;
      const currentObservedPrice = currentHasQty ? current.amount / current.qty : NaN;
      const priorObservedPrice = priorHasQty ? prior.amount / prior.qty : NaN;
      if (!Number.isFinite(currentObservedPrice) && !Number.isFinite(priorObservedPrice)) return null;
      const currentPrice = Number.isFinite(currentObservedPrice) ? currentObservedPrice : priorObservedPrice;
      const priorPrice = Number.isFinite(priorObservedPrice) ? priorObservedPrice : currentObservedPrice;
      const currentShare = currentTotal.qty ? current.qty / currentTotal.qty : 0;
      const priorShare = priorTotal.qty ? prior.qty / priorTotal.qty : 0;
      const priceEffect = (currentPrice - priorPrice) * (currentShare + priorShare) / 2;
      const mixEffect = (currentShare - priorShare) * (currentPrice + priorPrice) / 2;
      const sourceRows = currentGroupRows.length ? currentGroupRows : priorGroupRows;
      return {
        key,
        name: spec.name(sourceRows, key),
        dimension: spec.label,
        drill: spec.drill,
        current,
        prior,
        currentObservedPrice,
        priorObservedPrice,
        currentPrice,
        priorPrice,
        currentShare,
        priorShare,
        shareDelta: currentShare - priorShare,
        priceYoy: ratioChange(currentObservedPrice, priorObservedPrice),
        priceEffect,
        mixEffect,
        totalEffect: priceEffect + mixEffect,
        status: !priorHasQty && currentHasQty ? "新增" : priorHasQty && !currentHasQty ? "退出" : "持续",
      };
    }).filter(Boolean);
    const currentAvg = currentTotal.avgPrice;
    const priorAvg = priorTotal.avgPrice;
    const avgDelta = Number.isFinite(currentAvg) && Number.isFinite(priorAvg) ? currentAvg - priorAvg : NaN;
    let priceEffect = rows.reduce((sum, item) => sum + item.priceEffect, 0);
    let mixEffect = rows.reduce((sum, item) => sum + item.mixEffect, 0);
    const reconciliation = Number.isFinite(avgDelta) ? avgDelta - priceEffect - mixEffect : 0;
    if (Number.isFinite(reconciliation) && Math.abs(reconciliation) >= 0.05) {
      rows.push({
        key: "__reconciliation__",
        name: "退货/零数量金额调整",
        dimension: spec.label,
        drill: "",
        current: metricSummary([]),
        prior: metricSummary([]),
        currentObservedPrice: NaN,
        priorObservedPrice: NaN,
        currentPrice: NaN,
        priorPrice: NaN,
        currentShare: NaN,
        priorShare: NaN,
        shareDelta: NaN,
        priceYoy: NaN,
        priceEffect: 0,
        mixEffect: reconciliation,
        totalEffect: reconciliation,
        status: "口径调整",
      });
      mixEffect += reconciliation;
    }
    priceEffect = Number.isFinite(priceEffect) ? priceEffect : NaN;
    mixEffect = Number.isFinite(mixEffect) ? mixEffect : NaN;
    return { spec, rows, currentAvg, priorAvg, avgDelta, priceEffect, mixEffect };
  }

  function priceImpactDrillControl(item, content, className = "") {
    if (!item.drill) return `<span class="${className}">${content}</span>`;
    return `<button type="button" class="price-impact-link ${className}" data-price-impact-drill="${escapeHtml(item.drill)}" data-price-impact-key="${escapeHtml(item.key)}">${content}</button>`;
  }

  function priceImpactDriverList(items, emptyText) {
    if (!items.length) return `<p class="price-impact-empty">${escapeHtml(emptyText)}</p>`;
    const max = Math.max(...items.map((item) => Math.abs(item.totalEffect)), 1);
    return `<div class="price-impact-driver-list">${items.map((item) => {
      const width = Math.max(5, Math.abs(item.totalEffect) / max * 100);
      return `<div class="price-impact-driver ${signClass(item.totalEffect)}" style="--impact-bar:${width.toFixed(1)}%">
        <div>${priceImpactDrillControl(item, escapeHtml(item.name))}<small>自身价格 ${formatSignedCurrency(item.priceEffect)} · 结构 ${formatSignedCurrency(item.mixEffect)}</small></div>
        <strong>${formatSignedCurrency(item.totalEffect)}</strong>
      </div>`;
    }).join("")}</div>`;
  }

  function renderPriceImpact(currentRows, priorRows) {
    const dimensions = [
      ["model", "按型号"],
      ["series", "按系列"],
      ["shape", "按形态"],
      ["channel", "按渠道"],
      ["store", "按店铺"],
    ];
    const sortModes = [
      ["absolute", "影响绝对值"],
      ["positive", "正向贡献"],
      ["negative", "负向贡献"],
    ];
    const result = buildPriceImpact(currentRows, priorRows, state.priceImpactDimension);
    if (!Number.isFinite(result.currentAvg) || !Number.isFinite(result.priorAvg)) {
      return `<section class="content-grid price-impact-section">${panel("成交均价影响拆解", "需要本期与同期均存在有效销量后才能计算", '<div class="empty-state"><div class="empty-state-inner"><h2>当前筛选无法计算均价影响</h2><p>请调整日期或分类筛选后再查看。</p></div></div>', "price-impact", { className: "span-2" })}</section>`;
    }
    const positive = result.rows.filter((item) => item.totalEffect > 0.005).sort((a, b) => b.totalEffect - a.totalEffect).slice(0, 5);
    const negative = result.rows.filter((item) => item.totalEffect < -0.005).sort((a, b) => a.totalEffect - b.totalEffect).slice(0, 5);
    let detailItems = [...result.rows];
    if (state.priceImpactSort === "positive") detailItems = detailItems.filter((item) => item.totalEffect > 0).sort((a, b) => b.totalEffect - a.totalEffect);
    else if (state.priceImpactSort === "negative") detailItems = detailItems.filter((item) => item.totalEffect < 0).sort((a, b) => a.totalEffect - b.totalEffect);
    else detailItems.sort((a, b) => Math.abs(b.totalEffect) - Math.abs(a.totalEffect));
    const detailRows = detailItems.map((item) => `<tr>
      <td>${priceImpactDrillControl(item, escapeHtml(item.name))}</td><td><span class="impact-status ${item.status === "新增" ? "new" : item.status === "退出" ? "exit" : ""}">${escapeHtml(item.status)}</span></td>
      <td>${Number.isFinite(item.currentObservedPrice) ? formatCurrency(item.currentObservedPrice) : "-"}</td><td>${Number.isFinite(item.priorObservedPrice) ? formatCurrency(item.priorObservedPrice) : "-"}</td><td class="${signClass(item.priceYoy)}">${formatSignedPct(item.priceYoy)}</td>
      <td>${formatRate(item.currentShare)}</td><td>${formatRate(item.priorShare)}</td><td class="${signClass(item.shareDelta)}">${formatSignedPoint(item.shareDelta)}</td>
      <td class="${signClass(item.priceEffect)}">${formatSignedCurrency(item.priceEffect)}</td><td class="${signClass(item.mixEffect)}">${formatSignedCurrency(item.mixEffect)}</td><td class="${signClass(item.totalEffect)}"><strong>${formatSignedCurrency(item.totalEffect)}</strong></td>
    </tr>`);
    const dominant = Math.abs(result.priceEffect) >= Math.abs(result.mixEffect) ? "自身价格变化" : "销售结构变化";
    const direction = result.avgDelta >= 0 ? "上涨" : "下降";
    const topPositive = positive[0];
    const topNegative = negative[0];
    const narrative = `本期成交均价较同期${direction}${formatCurrency(Math.abs(result.avgDelta))}，其中自身价格影响${formatSignedCurrency(result.priceEffect)}，结构影响${formatSignedCurrency(result.mixEffect)}，主要由${dominant}驱动。${topPositive ? `最大正向贡献为${topPositive.name}（${formatSignedCurrency(topPositive.totalEffect)}）` : "暂无明显正向贡献"}；${topNegative ? `最大负向贡献为${topNegative.name}（${formatSignedCurrency(topNegative.totalEffect)}）` : "暂无明显负向贡献"}。`;
    const controls = `<div class="price-impact-controls">
      <div><span>分析维度</span><div class="price-impact-button-group">${dimensions.map(([key, label]) => `<button type="button" class="${state.priceImpactDimension === key ? "active" : ""}" data-price-impact-dimension="${key}" aria-pressed="${state.priceImpactDimension === key}">${label}</button>`).join("")}</div></div>
      <div><span>明细排序</span><div class="price-impact-button-group">${sortModes.map(([key, label]) => `<button type="button" class="${state.priceImpactSort === key ? "active" : ""}" data-price-impact-sort="${key}" aria-pressed="${state.priceImpactSort === key}">${label}</button>`).join("")}</div></div>
      <button type="button" class="price-impact-detail-toggle" data-toggle-price-impact-detail aria-expanded="${state.showPriceImpactDetail}">${state.showPriceImpactDetail ? "隐藏明细" : "显示明细"}</button>
    </div>`;
    const body = `${controls}
      <div class="price-impact-summary">
        <div><span>本期成交均价</span><strong>${formatCurrency(result.currentAvg)}</strong><small>销售金额 ÷ 销量</small></div>
        <div><span>同期成交均价</span><strong>${formatCurrency(result.priorAvg)}</strong><small>上年同期同日期</small></div>
        <div><span>均价增减</span><strong class="${signClass(result.avgDelta)}">${formatSignedCurrency(result.avgDelta)}</strong><small>${formatSignedPct(ratioChange(result.currentAvg, result.priorAvg))}</small></div>
        <div><span>自身价格影响</span><strong class="${signClass(result.priceEffect)}">${formatSignedCurrency(result.priceEffect)}</strong><small>同组均价变化贡献</small></div>
        <div><span>销售结构影响</span><strong class="${signClass(result.mixEffect)}">${formatSignedCurrency(result.mixEffect)}</strong><small>销量占比变化贡献</small></div>
      </div>
      <p class="price-impact-narrative">${escapeHtml(narrative)}</p>
      <div class="price-impact-driver-grid">
        <section><h3>均价正向贡献 Top 5</h3>${priceImpactDriverList(positive, "当前维度暂无正向贡献")}</section>
        <section><h3>均价负向贡献 Top 5</h3>${priceImpactDriverList(negative, "当前维度暂无负向贡献")}</section>
      </div>
      ${state.showPriceImpactDetail ? `<div class="price-impact-detail">${table([result.spec.label, "状态", "本期均价", "同期均价", "均价同比", "本期销量占比", "同期销量占比", "占比增减", "自身价格影响", "结构影响", "总影响"], detailRows, 1320)}</div>` : ""}
      <p class="price-impact-method">总影响＝自身价格影响＋销售结构影响；新增和退出项目的影响全部计入结构变化。退货或数量为0但金额不为0时单列口径调整。</p>`;
    return `<section class="content-grid price-impact-section">${panel("成交均价影响拆解", "解释整体均价为什么变化，以及谁在拉高或拉低大盘均价", body, "price-impact", { className: "span-2" })}</section>`;
  }

  const OVERVIEW_STORE_COLORS = ["#a71d27", "#d87842", "#b88a35", "#6c819d", "#6f536f", "#4f7a6d", "#8c8f9a"];

  const overviewShapeValue = (row) => {
    const shape = dimValue(row, "shape");
    if (shape === "蝶翼" || shape === "平衡机") return shape;
    return "其他";
  };

  const overviewRowsForRange = (start, end) => salesForRange(start, end, false, SALES_FILTER_KEYS);
  const modelText = (row) => `${row.product?.name || ""} ${row.product?.code || ""}`.toUpperCase().replaceAll(" ", "");
  const is16N1 = (row) => modelText(row).includes("16N1");
  const is18M2 = (row) => modelText(row).includes("18M2");
  const is16M1 = (row) => modelText(row).includes("16M1");
  const is16M1Prior = (row) => {
    const text = modelText(row);
    return text.includes("02-MS16T1") || text.includes("MS16T2");
  };
  const is18M2Pro = (row) => modelText(row).includes("18M2PRO");
  const is16M1Pro = (row) => modelText(row).includes("16M1PRO");

  function monthKeysInRange(start, end) {
    const first = new Date(Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 1, 1));
    const last = new Date(Date.UTC(Number(end.slice(0, 4)), Number(end.slice(5, 7)) - 1, 1));
    const months = [];
    for (let cursor = first; cursor <= last; cursor.setUTCMonth(cursor.getUTCMonth() + 1)) months.push(toIso(cursor).slice(0, 7));
    return months;
  }

  function targetSummaryForPeriod(start, end, shape = "") {
    const requestedMonths = monthKeysInRange(start, end);
    const months = new Set(requestedMonths);
    const availableMonths = new Set(targets.filter((item) => !shape || item.shape === shape).map((item) => item.month));
    const covered = requestedMonths.length > 0 && requestedMonths.every((month) => availableMonths.has(month));
    const rows = covered ? targets.filter((item) => months.has(item.month) && (!shape || item.shape === shape)) : [];
    const amount = rows.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const qty = rows.reduce((sum, item) => sum + Number(item.qty || 0), 0);
    let expected = 0;
    let expectedQty = 0;
    rows.forEach((item) => {
      const [year, month] = item.month.split("-").map(Number);
      const monthStart = `${item.month}-01`;
      const monthEnd = toIso(new Date(Date.UTC(year, month, 0)));
      const overlapStart = start > monthStart ? start : monthStart;
      const overlapEnd = end < monthEnd ? end : monthEnd;
      if (overlapStart > overlapEnd) return;
      const selectedDays = Math.round((toDate(overlapEnd) - toDate(overlapStart)) / 86400000) + 1;
      const daysInMonth = Number(monthEnd.slice(8, 10));
      expected += Number(item.amount || 0) * selectedDays / daysInMonth;
      expectedQty += Number(item.qty || 0) * selectedDays / daysInMonth;
    });
    return { amount, qty, expected, expectedQty, months: uniqueSorted(rows.map((item) => item.month)), covered };
  }

  const daysInclusive = (start, end) => Math.max(0, Math.round((toDate(end) - toDate(start)) / 86400000) + 1);

  function annualTargetPlan(year, end) {
    const amount = Number(DATA.targetMeta?.year) === year ? Number(DATA.targetMeta?.annualAmount || 0) : 0;
    const yearTargets = targets.filter((item) => String(item.month || "").startsWith(`${year}-`));
    const months = uniqueSorted(yearTargets.map((item) => item.month));
    const plannedH2 = yearTargets.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const residualBeforePlan = Math.max(0, amount - plannedH2);
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;
    let expected = 0;

    if (amount && months.length) {
      const firstPlanStart = `${months[0]}-01`;
      if (end < firstPlanStart) {
        expected = amount * daysInclusive(yearStart, end) / daysInclusive(yearStart, yearEnd);
      } else {
        expected = residualBeforePlan;
        months.forEach((monthKey) => {
          const monthRows = yearTargets.filter((item) => item.month === monthKey);
          const monthAmount = monthRows.reduce((sum, item) => sum + Number(item.amount || 0), 0);
          const [monthYear, month] = monthKey.split("-").map(Number);
          const monthStart = `${monthKey}-01`;
          const monthEnd = toIso(new Date(Date.UTC(monthYear, month, 0)));
          if (end >= monthEnd) expected += monthAmount;
          else if (end >= monthStart) expected += monthAmount * daysInclusive(monthStart, end) / Number(monthEnd.slice(8, 10));
        });
      }
    }

    return {
      amount,
      qty: 0,
      expected,
      expectedQty: 0,
      months: amount ? [`${year}全年`] : [],
      covered: Boolean(amount),
      periodStart: yearStart,
      periodEnd: yearEnd,
    };
  }

  function renderMonthlyTargetPlan(year, targetSource) {
    const yearTargets = targets.filter((item) => String(item.month || "").startsWith(`${year}-`));
    const months = uniqueSorted(yearTargets.map((item) => item.month));
    const rows = months.map((monthKey) => {
      const targetAmount = yearTargets
        .filter((item) => item.month === monthKey)
        .reduce((sum, item) => sum + Number(item.amount || 0), 0);
      const priorMonth = `${year - 1}-${monthKey.slice(5, 7)}`;
      const [priorYear, priorMonthNumber] = priorMonth.split("-").map(Number);
      const priorEnd = toIso(new Date(Date.UTC(priorYear, priorMonthNumber, 0)));
      const prior = metricSummary(overviewRowsForRange(`${priorMonth}-01`, priorEnd));
      const growth = ratioChange(targetAmount, prior.amount);
      return `<tr>
        <td>${Number(monthKey.slice(5, 7))}月</td>
        <td>${formatWan(targetAmount)}</td>
        <td class="${signClass(growth)}">${formatSignedPct(growth)}</td>
      </tr>`;
    });
    const annualAmount = Number(DATA.targetMeta?.annualAmount || 0);
    const priorAnnual = metricSummary(overviewRowsForRange(`${year - 1}-01-01`, `${year - 1}-12-31`));
    const annualGrowth = ratioChange(annualAmount, priorAnnual.amount);
    return `<div class="overview-monthly-target-plan">
      <div class="overview-monthly-target-head">
        <span>全年销售目标 <strong>${formatWan(annualAmount)}</strong></span>
        <span>较${year - 1}年 <strong class="${signClass(annualGrowth)}">${formatSignedPct(annualGrowth)}</strong></span>
      </div>
      ${table(["月份", "销售目标", "较同期增幅"], rows, 420)}
      <p>目标来源：《${escapeHtml(targetSource)}》；分月仅展示销售目标及其较上年同月有效销售的增幅。均价和销售指数不设置数值型目标，经营标准均为高于同期。</p>
    </div>`;
  }

  function renderExecutiveProgressCard(label, currentRows, priorRows, target, options = {}) {
    const current = metricSummary(currentRows);
    const prior = metricSummary(priorRows);
    const yoy = ratioChange(current.amount, prior.amount);
    const completion = target.amount ? current.amount / target.amount : NaN;
    const expectedCompletion = target.amount ? target.expected / target.amount : NaN;
    const scheduleGap = target.covered ? current.amount - target.expected : NaN;
    const remaining = target.covered ? Math.max(0, target.amount - current.amount) : NaN;
    const daysLeft = target.periodEnd ? Math.max(0, daysInclusive(shiftDays(state.end, 1), target.periodEnd)) : 0;
    const requiredDaily = Number.isFinite(remaining) && daysLeft > 0 ? remaining / daysLeft : NaN;
    const actualWidth = Number.isFinite(completion) ? Math.max(0, Math.min(100, completion * 100)) : 0;
    const expectedWidth = Number.isFinite(expectedCompletion) ? Math.max(0, Math.min(100, expectedCompletion * 100)) : 0;
    const statusText = !target.covered ? "目标未覆盖" : scheduleGap >= 0 ? "快于计划" : "落后计划";
    return `<article class="executive-progress-card ${options.featured ? "featured" : ""} ${Number.isFinite(scheduleGap) && scheduleGap < 0 ? "behind" : "on-track"}">
      <div class="executive-progress-heading"><span>${escapeHtml(label)}</span><small>${target.months.length ? escapeHtml(target.months.join(" / ")) : "无目标"}</small></div>
      <div class="executive-progress-value"><strong>${formatWan(current.amount)}</strong><span>目标 ${target.amount ? formatWan(target.amount) : "-"}</span></div>
      <div class="executive-progress-kpis">
        <span>完成率 <b>${formatRate(completion)}</b></span>
        <span>同比 <b class="${signClass(yoy)}">${formatSignedPct(yoy)}</b></span>
        <span>计划状态 <b class="${signClass(scheduleGap)}">${escapeHtml(statusText)}</b></span>
      </div>
      <div class="executive-pace-track" aria-label="实际完成率 ${escapeHtml(formatRate(completion))}，计划应达 ${escapeHtml(formatRate(expectedCompletion))}">
        <i style="width:${actualWidth.toFixed(1)}%"></i><b style="left:${expectedWidth.toFixed(1)}%"></b>
      </div>
      <div class="executive-pace-legend"><span>实际 ${formatRate(completion)}</span><span>截至今日计划应达 ${formatRate(expectedCompletion)}</span></div>
      <div class="executive-progress-footer">
        <span>计划应达<strong>${target.expected ? formatWan(target.expected) : "-"}</strong></span>
        <span>计划差额<strong class="${signClass(scheduleGap)}">${formatSignedWan(scheduleGap)}</strong></span>
        <span>${options.monthly ? `剩余${daysLeft}天需日均` : "年底前需日均"}<strong>${Number.isFinite(requiredDaily) ? formatWan(requiredDaily) : "-"}</strong></span>
      </div>
    </article>`;
  }

  function buildPriceDecisionMetrics(currentRows, priorRows, target, monthStart) {
    const current = metricSummary(currentRows);
    const prior = metricSummary(priorRows);
    const salesCompletion = target.amount ? current.amount / target.amount : NaN;
    const qtyCompletion = target.qty ? current.qty / target.qty : NaN;
    const salesPace = target.expected ? current.amount / target.expected - 1 : NaN;
    const qtyPace = target.expectedQty ? current.qty / target.expectedQty - 1 : NaN;
    const avgYoy = ratioChange(current.avgPrice, prior.avgPrice);
    const indexYoy = ratioChange(current.salesIndex, prior.salesIndex);
    const [year, month] = state.end.slice(0, 7).split("-").map(Number);
    const monthEnd = toIso(new Date(Date.UTC(year, month, 0)));
    const remainingDays = Math.max(0, daysInclusive(shiftDays(state.end, 1), monthEnd));
    const elapsedDays = Math.max(1, daysInclusive(monthStart, state.end));
    const remainingAmount = Math.max(0, target.amount - current.amount);
    const requiredQtyAtCurrentPrice = current.avgPrice > 0 ? remainingAmount / current.avgPrice : NaN;
    const currentDailyQty = current.qty / elapsedDays;
    const requiredDailyQty = remainingDays > 0 ? requiredQtyAtCurrentPrice / remainingDays : NaN;
    const requiredQtyMultiple = currentDailyQty > 0 ? requiredDailyQty / currentDailyQty : NaN;
    let actionTitle = "销售节奏接近计划";
    let actionText = `销售额较计划节奏 ${formatSignedPct(salesPace)}，台量较计划节奏 ${formatSignedPct(qtyPace)}。`;
    let actionClass = "steady";
    if (Number.isFinite(salesPace) && salesPace < -0.03) {
      actionTitle = `销售节奏落后 ${formatRate(Math.abs(salesPace))}`;
      actionText = `销售额较计划少 ${formatWan(Math.abs(current.amount - target.expected))}；台量较计划节奏 ${formatSignedPct(qtyPace)}，均价同比 ${formatSignedPct(avgYoy)}。`;
      actionClass = salesPace < -0.15 ? "risk" : "watch";
    }
    return {
      current, prior, salesCompletion, qtyCompletion, salesPace, qtyPace, avgYoy, indexYoy,
      remainingDays, remainingAmount, requiredQtyAtCurrentPrice, currentDailyQty, requiredDailyQty,
      requiredQtyMultiple, expectedAmount: target.expected, targetAmount: target.amount, targetQty: target.qty,
      actionTitle, actionText, actionClass,
    };
  }

  function renderPriceDecision(metrics) {
    const avgYoy = ratioChange(metrics.current.avgPrice, metrics.prior.avgPrice);
    return `<section class="overview-price-decision ${metrics.actionClass}">
      <div class="overview-decision-copy">
        <p class="eyebrow">Price &amp; Volume Decision</p>
        <div class="overview-decision-title"><h3>价量决策</h3><span>${escapeHtml(metrics.actionTitle)}</span></div>
        <p>${escapeHtml(metrics.actionText)}${Number.isFinite(metrics.requiredQtyMultiple) ? ` 按当前均价，剩余${metrics.remainingDays}天需再销售约${formatInteger(metrics.requiredQtyAtCurrentPrice)}台，日销量需达到当前的${metrics.requiredQtyMultiple.toFixed(1)}倍。` : ""}</p>
      </div>
      <div class="overview-decision-metrics">
        <div><span>销额完成率</span><strong>${formatRate(metrics.salesCompletion)}</strong><small>计划节奏 ${formatSignedPct(metrics.salesPace)}</small></div>
        <div><span>台量完成率</span><strong>${formatRate(metrics.qtyCompletion)}</strong><small>计划节奏 ${formatSignedPct(metrics.qtyPace)}</small></div>
        <div><span>当前均价</span><strong>${formatCurrency(metrics.current.avgPrice)}</strong><small>同比 ${formatSignedPct(avgYoy)}</small></div>
        <div><span>均价与指数标准</span><strong>高于同期</strong><small>不设置数值型目标</small></div>
      </div>
    </section>`;
  }

  function topStoreNames(currentRows, limit = 6) {
    return [...groupRows(currentRows, storeValue).entries()]
      .map(([name, rows]) => ({ name, amount: metricSummary(rows).amount }))
      .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, "zh-CN"))
      .slice(0, limit)
      .map((item) => item.name);
  }

  function renderOverviewStoreTable(currentRows, priorRows) {
    const leadingStores = topStoreNames(currentRows);
    const leadingSet = new Set(leadingStores);
    const storeBucket = (row) => leadingSet.has(storeValue(row)) ? storeValue(row) : "其他店铺";
    const currentMap = groupRows(currentRows, storeBucket);
    const priorMap = groupRows(priorRows, storeBucket);
    const order = [...leadingStores];
    if ((currentMap.get("其他店铺") || []).length || (priorMap.get("其他店铺") || []).length) order.push("其他店铺");
    const buildStoreRow = (name, grouped, priorGrouped, className = "") => {
      const current = metricSummary(grouped);
      const prior = metricSummary(priorGrouped);
      const yoy = ratioChange(current.amount, prior.amount);
      const shapeMetric = (shape) => {
        const shapeCurrent = metricSummary(grouped.filter((row) => overviewShapeValue(row) === shape));
        const shapePrior = metricSummary(priorGrouped.filter((row) => overviewShapeValue(row) === shape));
        return {
          current: shapeCurrent,
          prior: shapePrior,
          yoy: ratioChange(shapeCurrent.amount, shapePrior.amount),
          delta: shapeCurrent.amount - shapePrior.amount,
        };
      };
      const butterfly = shapeMetric("蝶翼");
      const balance = shapeMetric("平衡机");
      const other = shapeMetric("其他");
      const growthPull = Math.max(0, butterfly.delta) + Math.max(0, balance.delta);
      const otherDecline = Math.max(0, -other.delta);
      const coverage = otherDecline > 0 ? growthPull / otherDecline : NaN;
      let conclusion = "保持当前经营节奏";
      let health = "steady";
      if (otherDecline > 0 && coverage >= 1) {
        conclusion = yoy >= 0 ? "增长结构健康" : "新品已覆盖下滑";
        health = "good";
      } else if (otherDecline > 0 && coverage >= 0.7) {
        conclusion = "接近覆盖，继续补蝶翼";
        health = "watch";
      } else if (otherDecline > 0) {
        conclusion = "增长补位不足";
        health = "risk";
      } else if (yoy < 0) {
        conclusion = "整体经营仍需修复";
        health = "risk";
      } else {
        conclusion = "无需覆盖其他下滑";
        health = "good";
      }
      const metricCell = (item) => `<strong>${formatWan(item.current.amount)}</strong><small class="${signClass(item.yoy)}">${formatSignedPct(item.yoy)}</small>`;
      return `<tr class="${escapeHtml(className || (name === "其他店铺" ? "overview-muted-row" : ""))}">
        <td title="${escapeHtml(name)}">${escapeHtml(overviewStoreAlias(name))}</td>
        <td class="overview-channel-metric"><strong>${formatWan(current.amount)}</strong><small class="${signClass(yoy)}">${formatSignedPct(yoy)}</small></td>
        <td class="overview-channel-metric">${metricCell(butterfly)}</td>
        <td class="overview-channel-metric">${metricCell(balance)}</td>
        <td class="overview-channel-metric">${metricCell(other)}</td>
        <td><span class="overview-channel-conclusion ${health}">${escapeHtml(conclusion)}</span></td>
      </tr>`;
    };
    const rows = [
      buildStoreRow("电商整体", currentRows, priorRows, "overview-total-row"),
      ...order.map((name) => buildStoreRow(name, currentMap.get(name) || [], priorMap.get(name) || [])),
    ];
    return `${table(["电商整体＋前6店铺＋其他", "有效销售 / 同比", "蝶翼 / 同比", "平衡机 / 同比", "其他产品 / 同比", "经营状态"], rows, 620)}
      <p class="overview-channel-note">首行为电商整体；店铺按当前汇报周期有效销售额取前6，其余合并为“其他店铺”；同期严格沿用同一批店铺。</p>`;
  }

  function buildOverviewShapeStats(currentRows, priorRows, monthStart) {
    return ["蝶翼", "平衡机", "其他"].map((name) => {
      const current = metricSummary(currentRows.filter((row) => overviewShapeValue(row) === name));
      const prior = metricSummary(priorRows.filter((row) => overviewShapeValue(row) === name));
      const target = targetSummaryForPeriod(monthStart, state.end, name);
      return {
        name,
        current,
        prior,
        target,
        delta: current.amount - prior.amount,
        yoy: ratioChange(current.amount, prior.amount),
        completion: target.amount ? current.amount / target.amount : NaN,
        targetGap: target.covered ? current.amount - target.amount : NaN,
        priceToPrior: ratioChange(current.avgPrice, prior.avgPrice),
        indexToPrior: ratioChange(current.salesIndex, prior.salesIndex),
      };
    });
  }

  function renderShapeGrowthSnapshot(items, options = {}) {
    const eyebrow = options.eyebrow || "MONTHLY GROWTH SNAPSHOT";
    const title = options.title || "当月销售与同比";
    const description = options.description || "先看整体及各形态的销售增幅，再判断增长补位进度。";
    const variant = options.variant ? ` ${options.variant}` : "";
    const totalCurrent = items.reduce((sum, item) => sum + item.current.amount, 0);
    const totalPrior = items.reduce((sum, item) => sum + item.prior.amount, 0);
    const cards = [
      {
        name: "整体销售",
        amount: totalCurrent,
        yoy: ratioChange(totalCurrent, totalPrior),
        className: "overall",
      },
      ...items.map((item) => ({
        name: item.name,
        amount: item.current.amount,
        yoy: item.yoy,
        className: "",
      })),
    ];
    return `<section class="overview-shape-growth${variant}">
      <div class="overview-section-heading">
        <div><p class="eyebrow">${escapeHtml(eyebrow)}</p><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p></div>
      </div>
      <div class="overview-shape-growth-grid">
        ${cards.map((item) => `<article class="overview-shape-growth-card ${item.className}">
          <span>${escapeHtml(item.name)}</span>
          <strong>${formatWan(item.amount)}</strong>
          <small class="${signClass(item.yoy)}">同比 ${formatSignedPct(item.yoy)}</small>
        </article>`).join("")}
      </div>
    </section>`;
  }

  function renderShapeBridge(items, options = {}) {
    const eyebrow = options.eyebrow || "GROWTH REPLACEMENT BRIDGE";
    const title = options.title || "当月形态增长补位";
    const description = options.description || "直接看蝶翼与平衡机的增量，能否抵消其他产品下滑。";
    const periodLabel = options.periodLabel || "本月";
    const variant = options.variant ? ` ${options.variant}` : "";
    const totalCurrent = items.reduce((sum, item) => sum + item.current.amount, 0);
    const totalPrior = items.reduce((sum, item) => sum + item.prior.amount, 0);
    const netDelta = totalCurrent - totalPrior;
    const totalYoy = ratioChange(totalCurrent, totalPrior);
    const butterfly = items.find((item) => item.name === "蝶翼");
    const balance = items.find((item) => item.name === "平衡机");
    const other = items.find((item) => item.name === "其他");
    const growthPull = Math.max(0, butterfly?.delta || 0) + Math.max(0, balance?.delta || 0);
    const otherDecline = Math.max(0, -(other?.delta || 0));
    const coverage = otherDecline > 0 ? growthPull / otherDecline : NaN;
    const coverageText = otherDecline > 0 ? formatRate(coverage) : "无需覆盖";
    const coverageStatus = otherDecline === 0 ? "good" : coverage >= 1 ? "good" : coverage >= 0.7 ? "watch" : "risk";
    const term = (item, hint) => `<article class="overview-equation-term ${signClass(item?.delta)}">
      <span>${escapeHtml(item?.name || "-")}</span>
      <strong>${formatSignedWan(item?.delta)}</strong>
      <small>${escapeHtml(hint)} · ${escapeHtml(periodLabel)}${formatWan(item?.current?.amount || 0)} · 同比${formatSignedPct(item?.yoy)}</small>
    </article>`;
    return `<section class="overview-shape-bridge${variant}">
      <div class="overview-section-heading">
        <div><p class="eyebrow">${escapeHtml(eyebrow)}</p><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p></div>
        <div class="overview-bridge-result ${coverageStatus}"><span>增长覆盖率</span><strong>${escapeHtml(coverageText)}</strong><small>${escapeHtml(periodLabel)}总额 ${formatWan(totalCurrent)} · 同比 ${formatSignedPct(totalYoy)}</small></div>
      </div>
      <div class="overview-shape-equation">
        ${term(butterfly, "第一增长盘")}
        <b aria-hidden="true">＋</b>
        ${term(balance, "第二增长盘")}
        <b aria-hidden="true">＋</b>
        ${term(other, "收缩盘")}
        <b aria-hidden="true">＝</b>
        <article class="overview-equation-total ${signClass(netDelta)}"><span>整体净增减</span><strong>${formatSignedWan(netDelta)}</strong><small>${escapeHtml(periodLabel)}总额同比 ${formatSignedPct(totalYoy)} · 蝶翼与平衡机共拉动 ${formatSignedWan(growthPull)}</small></article>
      </div>
    </section>`;
  }

  function renderCompactShapeOverview(monthItems, annualItems) {
    const buildRow = (label, items) => {
      const totalCurrent = items.reduce((sum, item) => sum + item.current.amount, 0);
      const totalPrior = items.reduce((sum, item) => sum + item.prior.amount, 0);
      const netDelta = totalCurrent - totalPrior;
      const butterfly = items.find((item) => item.name === "蝶翼");
      const balance = items.find((item) => item.name === "平衡机");
      const other = items.find((item) => item.name === "其他");
      const growthPull = Math.max(0, butterfly?.delta || 0) + Math.max(0, balance?.delta || 0);
      const totalYoy = ratioChange(totalCurrent, totalPrior);
      const metric = (name, item, tone) => `<article class="overview-shape-metric ${tone}">
        <span>${escapeHtml(name)}</span>
        <strong>${formatWan(item?.current?.amount || 0)}</strong>
        <small class="${signClass(item?.yoy)}">同比 ${formatSignedPct(item?.yoy)}</small>
        <em class="${signClass(item?.delta)}">净增减 ${formatSignedWan(item?.delta)}</em>
      </article>`;
      return `<article class="overview-shape-period-card ${label === "当月" ? "current" : "annual"}">
        <header>
          <div><span>${escapeHtml(label)}盘面</span><small>有效销售总额</small></div>
          <div class="overview-shape-period-total"><strong>${formatWan(totalCurrent)}</strong><b class="${signClass(totalYoy)}">同比 ${formatSignedPct(totalYoy)}</b></div>
        </header>
        <div class="overview-shape-period-metrics">
          ${metric("蝶翼", butterfly, "butterfly")}
          ${metric("平衡机", balance, "balance")}
          ${metric("其他", other, "other")}
          <article class="overview-shape-metric net"><span>整体净增减</span><strong class="${signClass(netDelta)}">${formatSignedWan(netDelta)}</strong><small>蝶翼与平衡机拉动</small><em class="${signClass(growthPull)}">${formatSignedWan(growthPull)}</em></article>
        </div>
      </article>`;
    };
    return `<section class="overview-shape-compact">
      <div class="overview-section-heading"><div><p class="eyebrow">SHAPE GROWTH COMPACT VIEW</p><h3>形态销售与增长补位</h3><p>年累与当月分层呈现 · 截至 ${escapeHtml(state.end)} · 保留销售、同比和净增减。</p></div></div>
      <div class="overview-shape-period-grid">${buildRow("年累", annualItems)}${buildRow("当月", monthItems)}</div>
    </section>`;
  }

  function renderOverviewConclusion(priceMetrics, shapeItems) {
    const scheduleGap = Number.isFinite(priceMetrics.expectedAmount) ? priceMetrics.current.amount - priceMetrics.expectedAmount : NaN;
    const latestIncomeMonth = INCOME_DATA?.meta?.incomeMonthMax || "";
    const latestIncomeSalesRows = latestIncomeMonth
      ? sales.filter((row) => row.date.slice(0, 7) === latestIncomeMonth)
      : [];
    const latestIncomeRows = latestIncomeMonth
      ? incomeCurrent.filter((row) => row.month === latestIncomeMonth)
      : [];
    const latestIncome = latestIncomeMonth
      ? revenueSummary(latestIncomeSalesRows, latestIncomeRows)
      : null;
    const jdSelfOperatedChannels = new Set(["京东自营", "京东自营代销"]);
    const latestJdDirectIncome = latestIncomeMonth
      ? revenueSummary(
        latestIncomeSalesRows.filter((row) => dimValue(row, "channel") === "京东自营"),
        latestIncomeRows.filter((row) => row.channel === "京东自营"),
      )
      : null;
    const latestJdConsignmentIncome = latestIncomeMonth
      ? revenueSummary(
        latestIncomeSalesRows.filter((row) => dimValue(row, "channel") === "京东自营代销"),
        latestIncomeRows.filter((row) => row.channel === "京东自营代销"),
      )
      : null;
    const latestJdIncome = latestIncomeMonth
      ? revenueSummary(
        latestIncomeSalesRows.filter((row) => jdSelfOperatedChannels.has(dimValue(row, "channel"))),
        latestIncomeRows.filter((row) => jdSelfOperatedChannels.has(row.channel)),
      )
      : null;
    const latestOtherIncome = latestIncomeMonth
      ? revenueSummary(
        latestIncomeSalesRows.filter((row) => !jdSelfOperatedChannels.has(dimValue(row, "channel"))),
        latestIncomeRows.filter((row) => !jdSelfOperatedChannels.has(row.channel)),
      )
      : null;
    const latestIncomePeriod = latestIncomeMonth
      ? `${latestIncomeMonth.slice(0, 4)}年${Number(latestIncomeMonth.slice(5))}月`
      : "最新完整月";
    const currentMonthNumber = Number(state.end.slice(5, 7));
    const currentMonthLabel = `${state.end.slice(0, 4)}年${currentMonthNumber}月`;
    const focus = [...shapeItems].filter((item) => Number.isFinite(item.targetGap)).sort((a, b) => a.targetGap - b.targetGap)[0];
    const growthLeader = [...shapeItems].sort((a, b) => b.delta - a.delta)[0];
    const declineLeader = [...shapeItems].sort((a, b) => a.delta - b.delta)[0];
    const headline = Number.isFinite(scheduleGap) && scheduleGap < 0
      ? `${currentMonthLabel}较计划节奏少${formatWan(Math.abs(scheduleGap))}${focus ? `，${focus.name}距目标差${formatWan(Math.max(0, -focus.targetGap))}是首要缺口` : ""}`
      : `${currentMonthLabel}销售达到计划节奏${growthLeader?.delta > 0 ? `，${growthLeader.name}贡献${formatSignedWan(growthLeader.delta)}增量` : ""}`;
    const summary = `距月目标还差${formatWan(priceMetrics.remainingAmount)}，剩余${priceMetrics.remainingDays}天；${growthLeader ? `${growthLeader.name}${growthLeader.delta >= 0 ? "增加" : "减少"}${formatWan(Math.abs(growthLeader.delta))}` : ""}${declineLeader && declineLeader !== growthLeader ? `，${declineLeader.name}减少${formatWan(Math.abs(declineLeader.delta))}` : ""}。`;
    const priorityDetail = focus
      ? `${focus.name}补量，当前距月目标还差 ${formatWan(Math.max(0, -focus.targetGap))}`
      : declineLeader?.delta < 0
        ? `${declineLeader.name}修复，同比减少 ${formatWan(Math.abs(declineLeader.delta))}`
        : "保持当前增长结构";
    return `<section class="overview-command-summary">
      <div class="overview-command-head">
        <div><p class="eyebrow">Management Conclusion</p><h2>${escapeHtml(headline)}</h2><p>${escapeHtml(summary)}</p></div>
      </div>
      <div class="overview-command-actions">
        <article class="overview-kpi-card sales"><span>${currentMonthNumber}月销额</span><strong>${formatWan(priceMetrics.current.amount)} / ${formatWan(priceMetrics.targetAmount)}</strong><small>完成率 ${formatRate(priceMetrics.salesCompletion)} · 较计划节奏 ${formatSignedPct(priceMetrics.salesPace)}</small></article>
        <article class="overview-kpi-card qty"><span>${currentMonthNumber}月台量</span><strong>${formatInteger(priceMetrics.current.qty)} / ${formatInteger(priceMetrics.targetQty)}台</strong><small>完成率 ${formatRate(priceMetrics.qtyCompletion)} · 较计划节奏 ${formatSignedPct(priceMetrics.qtyPace)}</small></article>
        <article class="overview-kpi-card price"><span>${currentMonthNumber}月均价</span><strong>${formatCurrency(priceMetrics.current.avgPrice)}</strong><small>同期 ${formatCurrency(priceMetrics.prior.avgPrice)} · 目标：高于同期</small></article>
        <article class="overview-income-summary">
          <div class="overview-income-head">
            <div><span>最新完整收入月</span><b>${escapeHtml(latestIncomePeriod)}</b></div>
            <div><strong>${latestIncome ? formatWan(latestIncome.income) : "-"}</strong><small>全渠道收入 · 综合口径 ${latestIncome ? formatRate(latestIncome.financialRate) : "-"}</small></div>
          </div>
          <div class="overview-income-split">
            <div class="jd-group">
              <div class="income-group-head"><span>京东自营组合</span><b>${latestJdIncome ? formatWan(latestJdIncome.income) : "-"}</b><small>综合转化率 ${latestJdIncome ? formatRate(latestJdIncome.financialRate) : "-"}</small></div>
              <div class="income-subchannels">
                <div><span>京东自营</span><b>${latestJdDirectIncome ? formatWan(latestJdDirectIncome.income) : "-"}</b><small>转化率 ${latestJdDirectIncome ? formatRate(latestJdDirectIncome.financialRate) : "-"}</small></div>
                <div><span>京东自营代销</span><b>${latestJdConsignmentIncome ? formatWan(latestJdConsignmentIncome.income) : "-"}</b><small>转化率 ${latestJdConsignmentIncome ? formatRate(latestJdConsignmentIncome.financialRate) : "-"}</small></div>
              </div>
            </div>
            <div><span>其他渠道</span><b>${latestOtherIncome ? formatWan(latestOtherIncome.income) : "-"}</b><small>销售到收入转化率 ${latestOtherIncome ? formatRate(latestOtherIncome.financialRate) : "-"}</small></div>
          </div>
        </article>
      </div>
      <p class="overview-command-focus"><b>首要任务：</b>${escapeHtml(priorityDetail)}；${growthLeader ? `${escapeHtml(growthLeader.name)}当前净增减 ${formatSignedWan(growthLeader.delta)}` : ""}。</p>
    </section>`;
  }

  function isoDateRange(start, end) {
    const dates = [];
    for (let day = start; day <= end; day = shiftDays(day, 1)) dates.push(day);
    return dates;
  }

  const overviewStoreAlias = (name) => {
    const value = String(name || "").trim();
    if (value === "方太官方旗舰店（天猫）") return "天猫官旗";
    if (value.includes("方太自营二店")) return "京东热水器自营";
    if (value.includes("北京京东世纪贸易有限公司")) return "京东自营";
    if (value.includes("七叶枫") && value.includes("天猫")) return "天猫热旗·七叶枫";
    if (value.includes("河南信维")) return "京代POP·河南信维";
    if (value.length > 14) return `${value.slice(0, 13)}…`;
    return value;
  };

  function modelTargetPlan(model, dates) {
    const normalized = String(model || "").trim().toUpperCase();
    const rows = targets.filter((item) => String(item.model || "").trim().toUpperCase() === normalized);
    const monthMap = new Map();
    const monthQtyMap = new Map();
    rows.forEach((item) => {
      monthMap.set(item.month, (monthMap.get(item.month) || 0) + Number(item.amount || 0));
      monthQtyMap.set(item.month, (monthQtyMap.get(item.month) || 0) + Number(item.qty || 0));
    });
    const dailyTargets = dates.map((date) => {
      const [year, month] = date.slice(0, 7).split("-").map(Number);
      const monthAmount = monthMap.get(date.slice(0, 7)) || 0;
      const daysInMonth = Number(toIso(new Date(Date.UTC(year, month, 0))).slice(8, 10));
      return monthAmount / daysInMonth;
    });
    const dailyQtyTargets = dates.map((date) => {
      const [year, month] = date.slice(0, 7).split("-").map(Number);
      const monthQty = monthQtyMap.get(date.slice(0, 7)) || 0;
      const daysInMonth = Number(toIso(new Date(Date.UTC(year, month, 0))).slice(8, 10));
      return monthQty / daysInMonth;
    });
    const coveredMonths = uniqueSorted(dates.map((date) => date.slice(0, 7)).filter((month) => monthMap.has(month)));
    const fullTarget = coveredMonths.reduce((sum, month) => sum + Number(monthMap.get(month) || 0), 0);
    const fullQtyTarget = coveredMonths.reduce((sum, month) => sum + Number(monthQtyMap.get(month) || 0), 0);
    const planToDate = dailyTargets.reduce((sum, value) => sum + value, 0);
    const planQtyToDate = dailyQtyTargets.reduce((sum, value) => sum + value, 0);
    const lastCoveredMonth = coveredMonths.at(-1);
    const targetPeriodEnd = lastCoveredMonth
      ? toIso(new Date(Date.UTC(Number(lastCoveredMonth.slice(0, 4)), Number(lastCoveredMonth.slice(5, 7)), 0)))
      : "";
    return {
      dailyTargets,
      dailyQtyTargets,
      fullTarget,
      fullQtyTarget,
      planToDate,
      planQtyToDate,
      coveredMonths,
      targetPeriodEnd,
    };
  }

  function runningTotal(values) {
    let total = 0;
    return values.map((value) => {
      total += Number(value || 0);
      return total;
    });
  }

  function render16N1CumulativeChart(dates, actualDaily, targetDaily) {
    const actualCumulative = runningTotal(actualDaily);
    const targetCumulative = runningTotal(targetDaily);
    const max = Math.max(1, ...actualCumulative, ...targetCumulative);
    const width = 1080;
    const height = 300;
    const pad = { left: 66, right: 28, top: 22, bottom: 42 };
    const x = (index) => pad.left + (dates.length === 1 ? 0 : index / (dates.length - 1)) * (width - pad.left - pad.right);
    const y = (value) => pad.top + (max - value) / max * (height - pad.top - pad.bottom);
    const linePath = (values) => values.map((value, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
    const areaPath = actualCumulative.length
      ? `${linePath(actualCumulative)} L${x(actualCumulative.length - 1).toFixed(1)},${(height - pad.bottom).toFixed(1)} L${x(0).toFixed(1)},${(height - pad.bottom).toFixed(1)} Z`
      : "";
    const ticks = [0, 1, 2, 3, 4].map((index) => {
      const value = max * (4 - index) / 4;
      const ypos = y(value);
      return `<g><line x1="${pad.left}" x2="${width - pad.right}" y1="${ypos.toFixed(1)}" y2="${ypos.toFixed(1)}" class="overview-chart-grid"/><text x="${pad.left - 10}" y="${(ypos + 4).toFixed(1)}" text-anchor="end">${escapeHtml(formatWan(value))}</text></g>`;
    }).join("");
    const labelIndexes = [...new Set([0, Math.floor((dates.length - 1) / 4), Math.floor((dates.length - 1) / 2), Math.floor((dates.length - 1) * 3 / 4), dates.length - 1])].sort((a, b) => a - b);
    const xLabels = labelIndexes.map((index) => `<text x="${x(index).toFixed(1)}" y="${height - 13}" text-anchor="middle">${escapeHtml(dates[index].slice(5))}</text>`).join("");
    const actualDots = dates.length <= 31
      ? actualCumulative.map((value, index) => `<circle cx="${x(index).toFixed(1)}" cy="${y(value).toFixed(1)}" r="3.2" class="n1-actual-dot"><title>${escapeHtml(`${dates[index]} 累计有效销售 ${formatWan(value)}`)}</title></circle>`).join("")
      : "";
    const targetDots = dates.length <= 31
      ? targetCumulative.map((value, index) => `<circle cx="${x(index).toFixed(1)}" cy="${y(value).toFixed(1)}" r="2.4" class="n1-target-dot"><title>${escapeHtml(`${dates[index]} 计划应达 ${formatWan(value)}`)}</title></circle>`).join("")
      : "";
    return `<div class="n1-chart-card">
      <div class="n1-chart-title"><div><strong>累计有效销售 vs 计划节奏</strong><span>实际线高于计划线表示进度领先</span></div><div class="n1-inline-legend"><span class="actual">累计实际</span><span class="target">计划应达</span></div></div>
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="16N1累计有效销售与计划节奏对比">${ticks}${xLabels}<path d="${areaPath}" class="n1-actual-area"/><path d="${linePath(targetCumulative)}" class="n1-target-line"/><path d="${linePath(actualCumulative)}" class="n1-actual-line"/>${targetDots}${actualDots}</svg>
    </div>`;
  }

  function render16N1DailyStack(dates, storeItems) {
    const series = storeItems.map((item, index) => {
      const dailyMap = groupRows(item.rows, (row) => row.date);
      return {
        ...item,
        color: OVERVIEW_STORE_COLORS[index % OVERVIEW_STORE_COLORS.length],
        values: dates.map((day) => metricSummary(dailyMap.get(day) || []).qty),
      };
    });
    const totals = dates.map((_, index) => series.reduce((sum, item) => sum + Number(item.values[index] || 0), 0));
    const movingAverage = totals.map((_, index) => {
      const slice = totals.slice(Math.max(0, index - 6), index + 1);
      return slice.reduce((sum, value) => sum + value, 0) / Math.max(1, slice.length);
    });
    const positiveStacks = dates.map((_, dateIndex) => series.reduce((sum, item) => sum + Math.max(0, Number(item.values[dateIndex] || 0)), 0));
    const negativeStacks = dates.map((_, dateIndex) => series.reduce((sum, item) => sum + Math.min(0, Number(item.values[dateIndex] || 0)), 0));
    const max = Math.max(1, ...positiveStacks, ...movingAverage);
    const min = Math.min(0, ...negativeStacks, ...movingAverage);
    const range = max - min || 1;
    const width = 1080;
    const height = 330;
    const pad = { left: 66, right: 28, top: 22, bottom: 46 };
    const plotWidth = width - pad.left - pad.right;
    const x = (index) => pad.left + (index + 0.5) / dates.length * plotWidth;
    const y = (value) => pad.top + (max - value) / range * (height - pad.top - pad.bottom);
    const zeroY = y(0);
    const barWidth = Math.max(4, Math.min(24, plotWidth / Math.max(1, dates.length) * 0.66));
    const ticks = [0, 1, 2, 3, 4].map((index) => {
      const value = max - range * index / 4;
      const ypos = y(value);
      return `<g><line x1="${pad.left}" x2="${width - pad.right}" y1="${ypos.toFixed(1)}" y2="${ypos.toFixed(1)}" class="overview-chart-grid"/><text x="${pad.left - 10}" y="${(ypos + 4).toFixed(1)}" text-anchor="end">${escapeHtml(`${formatInteger(value)}台`)}</text></g>`;
    }).join("");
    const bars = dates.map((date, dateIndex) => {
      let positive = 0;
      let negative = 0;
      return series.map((item) => {
        const value = Number(item.values[dateIndex] || 0);
        const start = value >= 0 ? positive : negative;
        const end = start + value;
        if (value >= 0) positive = end;
        else negative = end;
        const top = Math.min(y(start), y(end));
        const rectHeight = Math.max(0.8, Math.abs(y(start) - y(end)));
        return `<rect x="${(x(dateIndex) - barWidth / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${rectHeight.toFixed(1)}" rx="2" fill="${item.color}"><title>${escapeHtml(`${date} ${item.name} ${formatInteger(value)}台`)}</title></rect>`;
      }).join("");
    }).join("");
    const averagePoints = movingAverage.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
    const labelIndexes = [...new Set([0, Math.floor((dates.length - 1) / 4), Math.floor((dates.length - 1) / 2), Math.floor((dates.length - 1) * 3 / 4), dates.length - 1])].sort((a, b) => a - b);
    const xLabels = labelIndexes.map((index) => `<text x="${x(index).toFixed(1)}" y="${height - 13}" text-anchor="middle">${escapeHtml(dates[index].slice(5))}</text>`).join("");
    const legend = series.map((item) => `<span><i style="background:${item.color}"></i>${escapeHtml(overviewStoreAlias(item.name))}</span>`).join("");
    return `<div class="n1-chart-card">
      <div class="n1-chart-title"><div><strong>分日有效台量与店铺贡献</strong><span>台量为销售数量净值，负数代表退货冲减；折线为7日移动平均</span></div><div class="n1-store-legend">${legend}<span class="moving"><i></i>7日台量均线</span></div></div>
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="16N1分日有效台量、店铺贡献与7日移动平均">${ticks}<line x1="${pad.left}" x2="${width - pad.right}" y1="${zeroY.toFixed(1)}" y2="${zeroY.toFixed(1)}" class="n1-zero-line"/>${xLabels}${bars}<polyline points="${averagePoints}" class="n1-moving-line"/></svg>
    </div>`;
  }

  function render16N1TrendSeriesChart(dates, series, featured = false, metric = "qty") {
    const amountMode = metric === "amount";
    const unit = amountMode ? "万" : "台";
    const formatTrendValue = (value) => amountMode ? formatDecimal(value, 1) : formatInteger(value);
    const width = featured ? 1080 : 300;
    const height = featured ? 172 : 128;
    const pad = { left: featured ? 44 : 26, right: featured ? 14 : 8, top: featured ? 22 : 18, bottom: featured ? 27 : 23 };
    const maxValue = Math.max(1, ...series.values);
    const minValue = Math.min(0, ...series.values);
    const range = maxValue - minValue || 1;
    const x = (index) => pad.left + (dates.length === 1 ? 0 : index / (dates.length - 1)) * (width - pad.left - pad.right);
    const y = (value) => pad.top + (maxValue - value) / range * (height - pad.top - pad.bottom);
    const points = series.values.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
    const gridValues = featured ? [0, maxValue / 2, maxValue] : [0, maxValue];
    const grid = gridValues.map((value) => `<g><line x1="${pad.left}" x2="${width - pad.right}" y1="${y(value).toFixed(1)}" y2="${y(value).toFixed(1)}" class="overview-chart-grid"/><text x="${pad.left - 7}" y="${(y(value) + 3).toFixed(1)}" text-anchor="end">${formatTrendValue(value)}</text></g>`).join("");
    const labels = series.values.map((value, index) => {
      const showLabel = value !== 0 || index === series.values.length - 1;
      const labelY = Math.max(8, y(value) - (index % 2 ? 5 : 9));
      return `<g><circle cx="${x(index).toFixed(1)}" cy="${y(value).toFixed(1)}" r="${featured ? 2.5 : 1.8}" fill="${series.color}"/>${showLabel ? `<text x="${x(index).toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle" class="n1-qty-data-label">${formatTrendValue(value)}</text>` : ""}<title>${escapeHtml(`${dates[index]} ${series.name} ${formatTrendValue(value)}${unit}`)}</title></g>`;
    }).join("");
    const dateIndexes = [...new Set([0, Math.floor((dates.length - 1) / 2), dates.length - 1])];
    const dateLabels = dateIndexes.map((index) => {
      const anchor = !featured && index === dates.length - 1 ? "end" : "middle";
      return `<text x="${x(index).toFixed(1)}" y="${height - 10}" text-anchor="${anchor}">${escapeHtml(dates[index].slice(5))}</text>`;
    }).join("");
    const areaPath = featured && series.values.length
      ? `M${x(0).toFixed(1)},${y(0).toFixed(1)} L${points.replaceAll(" ", " L")} L${x(series.values.length - 1).toFixed(1)},${y(0).toFixed(1)} Z`
      : "";
    const total = series.values.reduce((sum, value) => sum + value, 0);
    const average = total / Math.max(1, dates.length);
    return `<article class="n1-qty-trend-card ${featured ? "featured" : ""}" style="--series-color:${series.color}">
      <div class="n1-qty-card-head"><span>${escapeHtml(series.name)}</span><strong>${formatTrendValue(total)}${unit}</strong><small>日均 ${formatDecimal(average, 1)}${unit} · 30天累计</small></div>
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(series.name)}近30天每日销售${amountMode ? "额" : "台量"}趋势">${grid}${dateLabels}${areaPath ? `<path d="${areaPath}" class="n1-qty-feature-area"/>` : ""}<polyline points="${points}" fill="none" stroke="${series.color}" stroke-width="${featured ? 3 : 2.2}" stroke-linejoin="round" stroke-linecap="round"/>${labels}</svg>
    </article>`;
  }

  function render16N1RecentTrends() {
    const metric = state.n1TrendMetric === "amount" ? "amount" : "qty";
    const amountMode = metric === "amount";
    const trendStart = shiftDays(state.end, -29);
    const dates = isoDateRange(trendStart, state.end);
    const rows = overviewRowsForRange(trendStart, state.end).filter(is16N1);
    const dailyTotal = groupRows(rows, (row) => row.date);
    const channelGroups = groupRows(rows, (row) => dimValue(row, "channel"));
    const topChannels = [...channelGroups.entries()]
      .map(([name, channelRows]) => ({ name, rows: channelRows, metricValue: metricSummary(channelRows)[metric] }))
      .sort((a, b) => b.metricValue - a.metricValue)
      .slice(0, 4);
    const colors = ["#ad1f2b", "#376c87", "#267364", "#a66f17", "#765d8d"];
    const metricValue = (dailyRows) => {
      const summary = metricSummary(dailyRows || []);
      return amountMode ? summary.amount / 10000 : summary.qty;
    };
    const totalSeries = { name: "总计", color: colors[0], values: dates.map((date) => metricValue(dailyTotal.get(date))) };
    const channelSeries = topChannels.map((item, index) => {
      const daily = groupRows(item.rows, (row) => row.date);
      return { name: item.name, color: colors[index + 1], values: dates.map((date) => metricValue(daily.get(date))) };
    });
    return `<div class="n1-qty-trend-wrap">
      <div class="n1-qty-trend-heading"><div><strong>${amountMode ? "近30天日销售额" : "近30天日销台量"}</strong><span>${escapeHtml(trendStart)} 至 ${escapeHtml(state.end)} · 总计＋前四渠道 · ${amountMode ? "当日有效销售额（单位：万）" : "标注为当日有效台量"}</span></div><div class="n1-trend-heading-actions"><b>30D</b><button type="button" class="n1-trend-toggle ${amountMode ? "amount-active" : ""}" data-toggle-n1-trend aria-pressed="${amountMode}">${amountMode ? "切换台量" : "切换销售额"}</button></div></div>
      ${render16N1TrendSeriesChart(dates, totalSeries, true, metric)}
      <div class="n1-qty-channel-grid">${channelSeries.map((series) => render16N1TrendSeriesChart(dates, series, false, metric)).join("")}</div>
    </div>`;
  }

  function render16N1WarRoom(currentRows) {
    const monthStart = `${state.end.slice(0, 7)}-01`;
    const dates = isoDateRange(monthStart, state.end);
    const dailyMap = groupRows(currentRows, (row) => row.date);
    const actualDaily = dates.map((day) => metricSummary(dailyMap.get(day) || []).amount);
    if (!dates.length || actualDaily.every((value) => value === 0)) {
      return '<div class="empty-state"><div class="empty-state-inner"><h2>当前周期无16N1销售</h2><p>调整时间范围后再查看。</p></div></div>';
    }
    const current = metricSummary(currentRows);
    const year = state.end.slice(0, 4);
    const yearStart = `${year}-01-01`;
    const yearToDate = metricSummary(overviewRowsForRange(yearStart, state.end).filter(is16N1));
    const monthNumber = Number(state.end.slice(5, 7));
    const currentPeriodTitle = `${year}年${monthNumber}月当月销售数据`;
    const monthDailyQty = current.qty / Math.max(1, daysInclusive(monthStart, state.end));
    const recentStart = shiftDays(state.end, -6);
    const previousEnd = shiftDays(recentStart, -1);
    const previousStart = shiftDays(previousEnd, -6);
    const comparisonRows = overviewRowsForRange(previousStart, state.end).filter(is16N1);
    const recentRows = comparisonRows.filter((row) => row.date >= recentStart && row.date <= state.end);
    const previousRows = comparisonRows.filter((row) => row.date >= previousStart && row.date <= previousEnd);
    const recent = metricSummary(recentRows);
    const previous = metricSummary(previousRows);
    const recentQtyChange = ratioChange(recent.qty, previous.qty);

    const leadingStores = topStoreNames(currentRows, 5);
    const leadingSet = new Set(leadingStores);
    const storeBucket = (row) => leadingSet.has(storeValue(row)) ? storeValue(row) : "其他店铺";
    const currentStoreMap = groupRows(currentRows, storeBucket);
    const recentStoreMap = groupRows(recentRows, storeBucket);
    const previousStoreMap = groupRows(previousRows, storeBucket);
    const storeOrder = [...leadingStores];
    if (
      (currentStoreMap.get("其他店铺") || []).length
      || (recentStoreMap.get("其他店铺") || []).length
      || (previousStoreMap.get("其他店铺") || []).length
    ) storeOrder.push("其他店铺");
    const storeItems = storeOrder.map((name) => {
      const rows = currentStoreMap.get(name) || [];
      const storeCurrent = metricSummary(rows);
      const storeRecent = metricSummary(recentStoreMap.get(name) || []);
      const storePrevious = metricSummary(previousStoreMap.get(name) || []);
      return {
        name,
        rows,
        current: storeCurrent,
        recent: storeRecent,
        previous: storePrevious,
        change: ratioChange(storeRecent.amount, storePrevious.amount),
        qtyChange: ratioChange(storeRecent.qty, storePrevious.qty),
      };
    });
    const storeRows = storeItems.map((item, index) => `<tr class="${item.name === "其他店铺" ? "overview-muted-row" : ""}">
      <td title="${escapeHtml(item.name)}">${item.name === "其他店铺" ? "" : `<span class="n1-store-rank">${index + 1}</span>`}${escapeHtml(overviewStoreAlias(item.name))}</td>
      <td>${formatWan(item.current.amount)}</td>
      <td>${formatInteger(item.current.qty)}台</td>
      <td>${formatRate(current.amount ? item.current.amount / current.amount : NaN)}</td>
      <td>${formatInteger(item.recent.qty)}台</td>
      <td>${formatInteger(item.previous.qty)}台</td>
      <td class="${signClass(item.qtyChange)}">${formatSignedPct(item.qtyChange)}</td>
    </tr>`);
    const kpis = `<div class="n1-summary-stack">
      <div class="n1-ytd-banner">
        <div class="n1-ytd-title"><strong>${escapeHtml(year)}年累计销售数据</strong><span>${escapeHtml(yearStart)} 至 ${escapeHtml(state.end)}</span></div>
        <div class="n1-ytd-metric"><span>累计销售额</span><strong>${formatWan(yearToDate.amount)}</strong></div>
        <div class="n1-ytd-metric"><span>累计销售台量</span><strong>${formatInteger(yearToDate.qty)}台</strong></div>
        <div class="n1-ytd-metric"><span>累计均价</span><strong>${formatCurrency(yearToDate.avgPrice)}</strong></div>
      </div>
      <div class="n1-month-summary">
        <div class="n1-period-heading"><strong>${escapeHtml(currentPeriodTitle)}</strong><span>${escapeHtml(monthStart)} 至 ${escapeHtml(state.end)}</span></div>
        <div class="n1-kpi-grid">
          <article><span>16N1销售额</span><strong>${formatWan(current.amount)}</strong><small>当月累计</small></article>
          <article><span>16N1台量</span><strong>${formatInteger(current.qty)}台</strong><small>当月累计</small></article>
          <article><span>${monthNumber}月日销</span><strong>${formatDecimal(monthDailyQty, 1)}台/日</strong><small>${formatInteger(current.qty)}台 · ${escapeHtml(monthStart)} 至 ${escapeHtml(state.end)}</small></article>
          <article><span>${monthNumber}月均价</span><strong>${formatCurrency(current.avgPrice)}</strong><small>${formatWan(current.amount)} · ${escapeHtml(monthStart)} 至 ${escapeHtml(state.end)}</small></article>
        </div>
      </div>
    </div>`;
    const charts = render16N1RecentTrends();
    const storeTable = `<details class="overview-disclosure n1-store-table"><summary>查看16N1店铺贡献明细</summary><div class="overview-disclosure-body"><div class="n1-subheading"><div><strong>店铺贡献与台量动能</strong><span>按当前所选周期16N1有效销售额展示前5店铺，其余合并为其他店铺；近7日与前7日沿用同一批店铺</span></div><b class="${signClass(recentQtyChange)}">近7日 ${formatSignedPct(recentQtyChange)}</b></div>${table(["店铺", "累计销售", "累计有效台量", "销额占比", "近7日台量", "前7日台量", "台量变化"], storeRows, 920)}</div></details>`;
    return `<div class="n1-war-room">${kpis}${charts}${storeTable}</div>`;
  }

  function compactStoreRanking(currentRows, priorRows, limit = 6) {
    const currentMap = groupRows(currentRows, storeValue);
    const priorMap = groupRows(priorRows, storeValue);
    const keys = new Set(currentMap.keys());
    const items = [...keys].map((name) => {
      const rows = currentMap.get(name) || [];
      const priorGrouped = priorMap.get(name) || [];
      const current = metricSummary(rows);
      const prior = metricSummary(priorGrouped);
      return {
        name,
        rows,
        priorRows: priorGrouped,
        current,
        prior,
        yoy: ratioChange(current.amount, prior.amount),
        qtyYoy: ratioChange(current.qty, prior.qty),
      };
    }).sort((a, b) => b.current.amount - a.current.amount || b.prior.amount - a.prior.amount);
    const kept = items.slice(0, limit);
    const keptNames = new Set(kept.map((item) => item.name));
    const otherCurrentRows = items.slice(limit).flatMap((item) => item.rows);
    const otherPriorRows = [...priorMap.entries()]
      .filter(([name]) => !keptNames.has(name))
      .flatMap(([, rows]) => rows);
    if (otherCurrentRows.length || otherPriorRows.length) {
      const current = metricSummary(otherCurrentRows);
      const prior = metricSummary(otherPriorRows);
      kept.push({
        name: "其他店铺",
        rows: otherCurrentRows,
        priorRows: otherPriorRows,
        current,
        prior,
        yoy: ratioChange(current.amount, prior.amount),
        qtyYoy: ratioChange(current.qty, prior.qty),
      });
    }
    return kept;
  }

  function renderSeriesStoreTable(currentRows, priorRows, currentPredicate, priorPredicate = currentPredicate) {
    const scopedCurrent = currentRows.filter(currentPredicate);
    const scopedPrior = priorRows.filter(priorPredicate);
    const currentTotal = metricSummary(scopedCurrent);
    const priorTotal = metricSummary(scopedPrior);
    const totalAmountYoy = ratioChange(currentTotal.amount, priorTotal.amount);
    const totalQtyYoy = ratioChange(currentTotal.qty, priorTotal.qty);
    const periodMetric = (summary) => `<strong>${formatWan(summary.amount)}</strong><small>${formatInteger(summary.qty)}台</small>`;
    const rows = [
      `<tr class="overview-total-row"><td>合计</td><td class="overview-series-store-metric">${periodMetric(currentTotal)}</td><td class="overview-series-store-metric">${periodMetric(priorTotal)}</td><td class="${signClass(totalAmountYoy)}">${formatSignedPct(totalAmountYoy)}</td><td class="${signClass(totalQtyYoy)}">${formatSignedPct(totalQtyYoy)}</td></tr>`,
      ...compactStoreRanking(scopedCurrent, scopedPrior).map((item) => `<tr><td>${escapeHtml(item.name)}</td><td class="overview-series-store-metric">${periodMetric(item.current)}</td><td class="overview-series-store-metric">${periodMetric(item.prior)}</td><td class="${signClass(item.yoy)}">${formatSignedPct(item.yoy)}</td><td class="${signClass(item.qtyYoy)}">${formatSignedPct(item.qtyYoy)}</td></tr>`),
    ];
    return table(["店铺", "本期销售 / 台量", "同期销售 / 台量", "销售同比", "台量同比"], rows, 520);
  }

  function renderSeriesExecutiveSummary(currentRows, priorRows, currentPredicate, priorPredicate, label, modelScope) {
    const scopedCurrent = currentRows.filter(currentPredicate);
    const scopedPrior = priorRows.filter(priorPredicate);
    const current = metricSummary(scopedCurrent);
    const prior = metricSummary(scopedPrior);
    const yoy = ratioChange(current.amount, prior.amount);
    const qtyYoy = ratioChange(current.qty, prior.qty);
    const stores = compactStoreRanking(scopedCurrent, scopedPrior, 3);
    const maxAmount = Math.max(1, ...stores.map((item) => item.current.amount));
    const storeList = stores.map((item) => `<li>
      <div><span title="${escapeHtml(item.name)}">${escapeHtml(overviewStoreAlias(item.name))}</span><strong>${formatWan(item.current.amount)} · ${formatInteger(item.current.qty)}台</strong><small class="${signClass(item.yoy)}">${formatSignedPct(item.yoy)}</small></div>
      <i><b style="width:${Math.max(4, item.current.amount / maxAmount * 100).toFixed(1)}%"></b></i>
    </li>`).join("");
    const lead = stores[0];
    return `<article class="overview-series-summary-card">
      <div class="overview-series-summary-head">
        <div><span>${escapeHtml(label)}</span><small>${escapeHtml(modelScope)}</small></div>
        <b class="${signClass(yoy)}">${formatSignedPct(yoy)}</b>
      </div>
      <div class="overview-series-summary-value"><strong>${formatWan(current.amount)}</strong><span>同期 ${formatWan(prior.amount)}</span></div>
      <div class="overview-series-summary-qty"><span>有效台量 <b>${formatInteger(current.qty)}台</b></span><span>同期 ${formatInteger(prior.qty)}台</span><strong class="${signClass(qtyYoy)}">${formatSignedPct(qtyYoy)}</strong></div>
      <p>${lead ? `主力店铺 ${escapeHtml(overviewStoreAlias(lead.name))}，贡献 ${formatWan(lead.current.amount)} / ${formatInteger(lead.current.qty)}台` : "当前周期暂无销售"}</p>
      <ul class="overview-series-store-list">${storeList}</ul>
      <details class="overview-disclosure"><summary>查看完整店铺明细</summary><div class="overview-disclosure-body">${renderSeriesStoreTable(currentRows, priorRows, currentPredicate, priorPredicate)}</div></details>
    </article>`;
  }

  const PRICE_MONITOR_COLORS = ["#a71d27", "#d87842", "#b88a35", "#6c819d", "#4f7a6d", "#78507a"];

  function median(values) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return NaN;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function competitorPriceItems(rows) {
    const groups = groupRows(rows, (row) => `${row.brand}::${row.model}`);
    return [...groups.values()].map((grouped) => {
      const ordered = [...grouped].sort((a, b) => a.date.localeCompare(b.date));
      const latest = ordered.at(-1);
      const previous = ordered.length > 1 ? ordered.at(-2) : null;
      return {
        brand: latest.brand,
        model: latest.model,
        latestDate: latest.date,
        latestPrice: Number(latest.price || 0),
        previousPrice: previous ? Number(previous.price || 0) : NaN,
        change: previous ? ratioChange(Number(latest.price || 0), Number(previous.price || 0)) : NaN,
        rows: ordered,
      };
    }).sort((a, b) => b.latestPrice - a.latestPrice || a.model.localeCompare(b.model, "zh-CN"));
  }

  function renderCompetitorPriceTrend(rows, referenceLines) {
    const dates = uniqueSorted(rows.map((row) => row.date));
    const items = competitorPriceItems(rows);
    if (!dates.length || !items.length) return '<div class="empty-state"><div class="empty-state-inner"><h2>暂无竞品价格</h2><p>在价格监控表中补充日期价格后自动展示。</p></div></div>';
    const validReferenceLines = referenceLines.filter((line) => Number.isFinite(line.value));
    const width = 650;
    const height = 245;
    const pad = { left: 58, right: 22, top: 24, bottom: 38 };
    const observed = items.flatMap((item) => item.rows.map((row) => Number(row.price || 0))).filter((value) => value > 0);
    observed.push(...validReferenceLines.map((line) => line.value));
    const rawMin = Math.min(...observed);
    const rawMax = Math.max(...observed);
    const padding = Math.max(80, (rawMax - rawMin) * 0.12);
    const min = Math.max(0, rawMin - padding);
    const max = rawMax + padding;
    const range = max - min || 1;
    const x = (index) => pad.left + (dates.length === 1 ? (width - pad.left - pad.right) / 2 : index / (dates.length - 1) * (width - pad.left - pad.right));
    const y = (value) => pad.top + (max - value) / range * (height - pad.top - pad.bottom);
    const ticks = [0, 1, 2, 3, 4].map((index) => {
      const value = max - range * index / 4;
      const ypos = y(value);
      return `<g><line x1="${pad.left}" x2="${width - pad.right}" y1="${ypos.toFixed(1)}" y2="${ypos.toFixed(1)}" class="overview-chart-grid"/><text x="${pad.left - 8}" y="${(ypos + 4).toFixed(1)}" text-anchor="end">${escapeHtml(`¥${Math.round(value).toLocaleString("zh-CN")}`)}</text></g>`;
    }).join("");
    const labelIndexes = dates.length <= 6
      ? dates.map((_, index) => index)
      : [...new Set([0, Math.floor((dates.length - 1) / 2), dates.length - 1])];
    const xLabels = labelIndexes.map((index) => `<text x="${x(index).toFixed(1)}" y="${height - 11}" text-anchor="middle">${escapeHtml(dates[index].slice(5))}</text>`).join("");
    const series = items.map((item, itemIndex) => {
      const valueMap = new Map(item.rows.map((row) => [row.date, Number(row.price || 0)]));
      const points = dates.map((date, index) => valueMap.has(date) ? { index, date, value: valueMap.get(date) } : null).filter(Boolean);
      const path = points.map((point, index) => `${index ? "L" : "M"}${x(point.index).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ");
      const color = PRICE_MONITOR_COLORS[itemIndex % PRICE_MONITOR_COLORS.length];
      const dots = points.map((point) => `<circle cx="${x(point.index).toFixed(1)}" cy="${y(point.value).toFixed(1)}" r="3.5" fill="${color}"><title>${escapeHtml(`${point.date} ${item.brand} ${item.model} ${formatCurrency(point.value)}`)}</title></circle>`).join("");
      return `<path d="${path}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>${dots}`;
    }).join("");
    const priceReferenceLines = validReferenceLines.map((line) => `<line x1="${pad.left}" x2="${width - pad.right}" y1="${y(line.value).toFixed(1)}" y2="${y(line.value).toFixed(1)}" class="${line.kind === "pro" ? "competitor-pro-line" : "competitor-own-line"}"><title>${escapeHtml(`${line.label} ${formatCurrency(line.value)}`)}</title></line>`).join("");
    const legend = items.map((item, index) => `<span title="${escapeHtml(`${item.brand} ${item.model}`)}"><i style="background:${PRICE_MONITOR_COLORS[index % PRICE_MONITOR_COLORS.length]}"></i>${escapeHtml(item.model)} <b>${formatCurrency(item.latestPrice)}</b></span>`).join("");
    const referenceLegend = validReferenceLines.map((line) => `<span class="${line.kind === "pro" ? "pro" : "own"}"><i></i>${escapeHtml(line.label)} <b>${formatCurrency(line.value)}</b></span>`).join("");
    return `<div class="competitor-trend"><div class="competitor-trend-legend">${legend}${referenceLegend}</div><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="竞品价格趋势及我方均价线">${ticks}${xLabels}${priceReferenceLines}${series}</svg></div>`;
  }

  function renderCompetitiveSeriesCard(label, benchmark, currentRows, predicate, proPredicate, proLabel, isNodeProduct = false) {
    const rows = competitorPrices.filter((row) => row.benchmark === benchmark);
    const items = competitorPriceItems(rows);
    const own = metricSummary(currentRows.filter(predicate));
    const proOwn = metricSummary(currentRows.filter(proPredicate));
    const ownPrice = own.qty ? own.amount / own.qty : NaN;
    const proPrice = proOwn.qty ? proOwn.amount / proOwn.qty : NaN;
    const latestPrices = items.map((item) => item.latestPrice);
    const medianPrice = median(latestPrices);
    const minPrice = latestPrices.length ? Math.min(...latestPrices) : NaN;
    const maxPrice = latestPrices.length ? Math.max(...latestPrices) : NaN;
    const medianGap = ratioChange(ownPrice, medianPrice);
    const latestDate = items.map((item) => item.latestDate).sort().at(-1) || "";
    let actionClass = "steady";
    let action = "竞品价格接近，保持跟价监控";
    if (Number.isFinite(medianGap) && medianGap > 0.08) {
      actionClass = "risk";
      action = "我方高于竞品中位，节点前复核活动价";
    } else if (Number.isFinite(medianGap) && medianGap < -0.08) {
      actionClass = "protect";
      action = "我方低于竞品中位，优先保护价格";
    }
    const alertItem = [...items].filter((item) => Number.isFinite(item.change)).sort((a, b) => Math.abs(b.change) - Math.abs(a.change))[0];
    const alertText = alertItem
      ? `${alertItem.brand} ${alertItem.model} 最新变动 ${formatSignedPct(alertItem.change)}`
      : "当前仅1个监控日，补充后续价格即可识别波动";
    const tableRows = items.map((item) => {
      const gap = ratioChange(ownPrice, item.latestPrice);
      const gapClass = !Number.isFinite(gap) ? "" : gap > 0.05 ? "price-gap-risk" : gap < -0.05 ? "price-gap-low" : "price-gap-close";
      return `<tr>
        <td>${escapeHtml(item.brand)}</td>
        <td>${escapeHtml(item.model)}</td>
        <td>${formatCurrency(item.latestPrice)}</td>
        <td class="${signClass(item.change)}">${formatSignedPct(item.change)}</td>
        <td class="${gapClass}">${Number.isFinite(gap) ? formatSignedPct(gap) : "-"}</td>
      </tr>`;
    });
    return `<article class="competitive-series-card ${actionClass}">
      <div class="competitive-series-heading">
        <div><span>${escapeHtml(label)}</span><small>竞品监控截至 ${escapeHtml(latestDate || "-")}</small></div>
        <b>${escapeHtml(action)}</b>
      </div>
      <div class="competitive-price-kpis">
        <div><span>我方成交均价</span><strong>${Number.isFinite(ownPrice) ? formatCurrency(ownPrice) : "-"}</strong><small>取当前总览周期有效销售</small></div>
        <div><span>竞品中位价</span><strong>${Number.isFinite(medianPrice) ? formatCurrency(medianPrice) : "-"}</strong><small>我方价差 ${formatSignedPct(medianGap)}</small></div>
        <div><span>竞品最低价</span><strong>${Number.isFinite(minPrice) ? formatCurrency(minPrice) : "-"}</strong><small>区间 ${Number.isFinite(maxPrice) ? `${formatCurrency(minPrice)}–${formatCurrency(maxPrice)}` : "-"}</small></div>
        <div><span>最新价格异动</span><strong>${alertItem ? formatSignedPct(alertItem.change) : "-"}</strong><small>${escapeHtml(alertText)}</small></div>
      </div>
      ${renderCompetitorPriceTrend(rows, [
        { label: `${label}成交均价`, value: ownPrice, kind: "series" },
        { label: `${proLabel}成交均价`, value: proPrice, kind: "pro" },
      ])}
      <div class="competitive-price-table">${table(["品牌", "竞品型号", "最新价", "较上次", "我方较竞品"], tableRows, 520)}</div>
      <p class="competitive-price-guidance">${isNodeProduct ? "18M2为节点销售产品：核心竞品单次降价达到5%时，当天复核活动价、资源位和券补，不建议脱离竞品价格单独降价。" : "16M1处于强竞争强排机市场：优先保持主力店铺价格一致，竞品连续两次下调后再评估是否跟进，避免一次性价格扰动引发无效降价。"}</p>
    </article>`;
  }

  function renderCompetitivePriceRadar(currentRows) {
    if (!competitorPrices.length) {
      return '<div class="empty-state"><div class="empty-state-inner"><h2>暂无价格监控数据</h2><p>在“00-基础数据/价格监控/价格监控.xlsx”中补充竞品价格后重新生成即可。</p></div></div>';
    }
    return `<div class="competitive-price-radar">
      <div class="competitive-price-note"><strong>决策口径</strong><span>我方价格取所选周期真实成交均价；竞品价格取监控表最新有效价格。价格监控可晚于销售数据1天，两者日期分别标注。</span></div>
      <div class="competitive-price-grid">
        ${renderCompetitiveSeriesCard("18M2系列", "18M2", currentRows, is18M2, is18M2Pro, "18M2Pro", true)}
        ${renderCompetitiveSeriesCard("16M1系列", "16M1", currentRows, is16M1, is16M1Pro, "16M1Pro")}
      </div>
    </div>`;
  }

  const FOTILE_PRICE_LINE_COLORS = ["#a71d27", "#7b4fb2", "#b8860b"];
  const COMPETITOR_PRICE_BRAND_COLORS = {
    "美的": "#dc783e",
    "海尔": "#547a9e",
  };
  const normalizeMonitoredModel = (value) => String(value || "").trim().toUpperCase().replaceAll(" ", "");
  const isFotilePriceItem = (item) => String(item.brand || "").trim().includes("方太");
  const competitorPriceBrandColor = (brand) => COMPETITOR_PRICE_BRAND_COLORS[String(brand || "").trim()] || "#73808d";

  function renderFocusedPriceTrend(ownItems, competitorItems, focusItem) {
    const dates = uniqueSorted([...ownItems, ...competitorItems].flatMap((item) => item.rows.map((row) => row.date)));
    if (!dates.length || !ownItems.length) {
      return '<div class="empty-state"><div class="empty-state-inner"><h2>暂无价格监控数据</h2><p>请在对应系列工作表中补充方太与竞品每日价格。</p></div></div>';
    }
    const width = 650;
    const height = 255;
    const pad = { left: 58, right: 22, top: 24, bottom: 38 };
    const observed = [...ownItems, ...competitorItems]
      .flatMap((item) => item.rows.map((row) => Number(row.price || 0)))
      .filter((value) => value > 0);
    const rawMin = Math.min(...observed);
    const rawMax = Math.max(...observed);
    const padding = Math.max(80, (rawMax - rawMin) * 0.12);
    const min = Math.max(0, rawMin - padding);
    const max = rawMax + padding;
    const range = max - min || 1;
    const x = (index) => pad.left + (dates.length === 1
      ? (width - pad.left - pad.right) / 2
      : index / (dates.length - 1) * (width - pad.left - pad.right));
    const y = (value) => pad.top + (max - value) / range * (height - pad.top - pad.bottom);
    const ticks = [0, 1, 2, 3, 4].map((index) => {
      const value = max - range * index / 4;
      const ypos = y(value);
      return `<g><line x1="${pad.left}" x2="${width - pad.right}" y1="${ypos.toFixed(1)}" y2="${ypos.toFixed(1)}" class="overview-chart-grid"/><text x="${pad.left - 8}" y="${(ypos + 4).toFixed(1)}" text-anchor="end">${escapeHtml(`¥${Math.round(value).toLocaleString("zh-CN")}`)}</text></g>`;
    }).join("");
    const labelIndexes = dates.length <= 7
      ? dates.map((_, index) => index)
      : [...new Set([0, Math.floor((dates.length - 1) / 2), dates.length - 1])];
    const xLabels = labelIndexes.map((index) => `<text x="${x(index).toFixed(1)}" y="${height - 11}" text-anchor="middle">${escapeHtml(dates[index].slice(5))}</text>`).join("");
    const ownLines = ownItems.map((item, itemIndex) => {
      const valueMap = new Map(item.rows.map((row) => [row.date, Number(row.price || 0)]));
      const points = dates.map((date, index) => valueMap.has(date) ? {
        index,
        date,
        value: valueMap.get(date),
      } : null).filter(Boolean);
      const selected = item.model === focusItem.model;
      const color = FOTILE_PRICE_LINE_COLORS[itemIndex % FOTILE_PRICE_LINE_COLORS.length];
      if (points.length === 1) {
        const point = points[0];
        return `<line x1="${(x(point.index) - 12).toFixed(1)}" x2="${(x(point.index) + 12).toFixed(1)}" y1="${y(point.value).toFixed(1)}" y2="${y(point.value).toFixed(1)}" stroke="${color}" class="fotile-price-line ${selected ? "selected" : "muted"}"><title>${escapeHtml(`${point.date} 方太 ${item.model} ${formatCurrency(point.value)}`)}</title></line>`;
      }
      const path = points.map((point, index) => `${index ? "L" : "M"}${x(point.index).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ");
      return `<path d="${path}" fill="none" stroke="${color}" class="fotile-price-line ${selected ? "selected" : "muted"}"><title>${escapeHtml(`方太 ${item.model}价格线`)}</title></path>`;
    }).join("");
    const orderedCompetitors = [...competitorItems]
      .sort((a, b) => Math.abs(a.latestPrice - focusItem.latestPrice) - Math.abs(b.latestPrice - focusItem.latestPrice));
    const closestCompetitors = orderedCompetitors.slice(0, 3);
    const highlighted = new Set(closestCompetitors.map((item) => `${item.brand}::${item.model}`));
    const competitorDots = orderedCompetitors.map((item, itemIndex) => {
      const isHighlighted = highlighted.has(`${item.brand}::${item.model}`);
      const color = isHighlighted ? competitorPriceBrandColor(item.brand) : "#aeb5bd";
      return item.rows.map((row) => {
        const index = dates.indexOf(row.date);
        const isLatest = row.date === item.latestDate;
        const radius = isLatest && isHighlighted ? 7 : isHighlighted ? 6 : 5.3;
        const xPos = x(index).toFixed(1);
        const yPos = y(Number(row.price || 0)).toFixed(1);
        return `<g class="competitor-price-marker ${isHighlighted ? "highlighted" : "muted"}">
          <circle cx="${xPos}" cy="${yPos}" r="${radius}" fill="${color}" class="competitor-price-dot"/>
          <text x="${xPos}" y="${(Number(yPos) + 2.4).toFixed(1)}" text-anchor="middle" class="competitor-dot-index">${itemIndex + 1}</text>
          <title>${escapeHtml(`${itemIndex + 1}. ${row.date} ${item.brand} ${item.model} ${formatCurrency(row.price)}`)}</title>
        </g>`;
      }).join("");
    }).join("");
    const ownLegend = ownItems.map((item, index) => `<span class="fotile ${item.model === focusItem.model ? "selected" : ""}"><i style="--line-color:${FOTILE_PRICE_LINE_COLORS[index % FOTILE_PRICE_LINE_COLORS.length]}"></i>${escapeHtml(item.model)} <b>${formatCurrency(item.latestPrice)}</b></span>`).join("");
    const competitorLegend = orderedCompetitors.map((item, index) => {
      const isHighlighted = index < 3;
      const color = isHighlighted ? competitorPriceBrandColor(item.brand) : "#aeb5bd";
      return `<span class="competitor-model ${isHighlighted ? "highlighted" : "muted"}" title="${escapeHtml(`${item.brand} ${item.model}`)}"><i class="competitor-model-marker" style="--marker-color:${color}">${index + 1}</i>${escapeHtml(`${item.brand} ${item.model}`)} <b>${formatCurrency(item.latestPrice)}</b></span>`;
    }).join("");
    return `<div class="competitor-trend focused-price-trend">
      <div class="competitor-trend-legend">${ownLegend}${competitorLegend}</div>
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="方太价格线与竞品每日价格点">${ticks}${xLabels}${ownLines}${competitorDots}</svg>
    </div>`;
  }

  function renderFocusedPriceSeriesCard(label, benchmark, isNodeProduct = false) {
    const rows = competitorPrices.filter((row) => row.benchmark === benchmark);
    const items = competitorPriceItems(rows);
    const ownItems = items.filter(isFotilePriceItem);
    const competitorItems = items.filter((item) => !isFotilePriceItem(item));
    const preferred = state.priceFocus[benchmark];
    const focusItem = ownItems.find((item) => normalizeMonitoredModel(item.model) === normalizeMonitoredModel(preferred))
      || ownItems.find((item) => normalizeMonitoredModel(item.model).includes("PRO"))
      || ownItems[0];
    if (!focusItem) {
      return `<article class="competitive-series-card"><div class="empty-state"><div class="empty-state-inner"><h2>${escapeHtml(label)}暂无方太价格</h2></div></div></article>`;
    }
    if (state.priceFocus[benchmark] !== focusItem.model) state.priceFocus[benchmark] = focusItem.model;
    const rankedCompetitors = [...competitorItems]
      .sort((a, b) => Math.abs(a.latestPrice - focusItem.latestPrice) - Math.abs(b.latestPrice - focusItem.latestPrice));
    const closest = rankedCompetitors[0];
    const closestGapAmount = closest ? focusItem.latestPrice - closest.latestPrice : NaN;
    const closestGapRate = closest ? ratioChange(focusItem.latestPrice, closest.latestPrice) : NaN;
    const latestDate = items.map((item) => item.latestDate).sort().at(-1) || "";
    const biggestDrop = [...competitorItems]
      .filter((item) => Number.isFinite(item.change) && item.change < 0)
      .sort((a, b) => a.change - b.change)[0];
    let actionClass = "steady";
    let action = "价差可控，保持跟价监控";
    if (biggestDrop?.change <= -0.05) {
      actionClass = "risk";
      action = "竞品降价≥5%，当天复核活动价";
    } else if (Number.isFinite(closestGapRate) && closestGapRate > 0.05) {
      actionClass = "risk";
      action = "我方高于最近竞品，复核节点价格";
    } else if (biggestDrop?.change <= -0.03) {
      actionClass = "watch";
      action = "竞品降价3%–5%，准备跟价方案";
    } else if (Number.isFinite(closestGapRate) && closestGapRate < -0.08) {
      actionClass = "protect";
      action = "我方明显低于最近竞品，优先保护价格";
    }
    const tableRows = rankedCompetitors.slice(0, 4).map((item) => {
      const gap = ratioChange(focusItem.latestPrice, item.latestPrice);
      const gapClass = !Number.isFinite(gap) ? "" : gap > 0.05 ? "price-gap-risk" : gap < -0.05 ? "price-gap-low" : "price-gap-close";
      return `<tr>
        <td>${escapeHtml(item.brand)}</td>
        <td>${escapeHtml(item.model)}</td>
        <td>${formatCurrency(item.latestPrice)}</td>
        <td class="${signClass(item.change)}">${formatSignedPct(item.change)}</td>
        <td class="${gapClass}">${Number.isFinite(gap) ? formatSignedPct(gap) : "-"}</td>
      </tr>`;
    });
    return `<article class="competitive-series-card ${actionClass}">
      <div class="competitive-series-heading">
        <div><span>${escapeHtml(label)}</span><small>价格监控截至 ${escapeHtml(latestDate || "-")}</small></div>
        <b>${escapeHtml(action)}</b>
      </div>
      <div class="price-focus-control">
        <span>当前关注型号</span>
        <div>${ownItems.map((item) => `<button type="button" data-price-focus-series="${escapeHtml(benchmark)}" data-price-focus-model="${escapeHtml(item.model)}" class="${item.model === focusItem.model ? "active" : ""}" aria-pressed="${item.model === focusItem.model}">${escapeHtml(item.model)}</button>`).join("")}</div>
      </div>
      <div class="competitive-price-kpis">
        <div><span>方太当前价格</span><strong>${formatCurrency(focusItem.latestPrice)}</strong><small>${escapeHtml(focusItem.model)} · ${escapeHtml(focusItem.latestDate)}</small></div>
        <div><span>最近竞品价格</span><strong>${closest ? formatCurrency(closest.latestPrice) : "-"}</strong><small>${closest ? escapeHtml(`${closest.brand} ${closest.model}`) : "暂无竞品"}</small></div>
        <div><span>与最近竞品价差</span><strong class="${signClass(closestGapAmount)}">${Number.isFinite(closestGapAmount) ? formatSignedCurrency(closestGapAmount) : "-"}</strong><small>${formatSignedPct(closestGapRate)}</small></div>
        <div><span>竞品最大日降幅</span><strong class="${biggestDrop ? "negative" : ""}">${biggestDrop ? formatSignedPct(biggestDrop.change) : "-"}</strong><small>${biggestDrop ? escapeHtml(`${biggestDrop.brand} ${biggestDrop.model}`) : "暂无降价"}</small></div>
      </div>
      ${renderFocusedPriceTrend(ownItems, competitorItems, focusItem)}
      <div class="competitive-price-table">${table(["品牌", "核心竞品型号", "最新价", "日变动", `较${focusItem.model}`], tableRows, 520)}</div>
      <p class="competitive-price-guidance">${isNodeProduct ? "18M2为节点销售产品：核心竞品单日降价达到3%即准备活动价方案，达到5%当天复核活动价、资源位和券补。" : "16M1处于强竞争强排机市场：优先保持主力店铺价格一致；竞品连续降价或单日降幅达到5%后再决定是否跟进。"}</p>
    </article>`;
  }

  function renderFocusedPriceRadar() {
    if (!competitorPrices.length) {
      return '<div class="empty-state"><div class="empty-state-inner"><h2>暂无价格监控数据</h2><p>在“00-基础数据/价格监控/价格监控.xlsx”中补充竞品价格后重新生成即可。</p></div></div>';
    }
    return `<div class="competitive-price-radar focused-price-radar">
      <div class="competitive-price-note"><strong>阅读方式</strong><span>方太型号用连续价格线；竞品按与所选方太型号的价差由近到远编号，图中点与型号图例使用同一编号，前3个竞品高亮。</span></div>
      <div class="competitive-price-grid">
        ${renderFocusedPriceSeriesCard("18M2系列", "18M2", true)}
        ${renderFocusedPriceSeriesCard("16M1系列", "16M1")}
      </div>
    </div>`;
  }

  function renderFocusedPriceExecutiveCard(label, benchmark) {
    const rows = competitorPrices.filter((row) => row.benchmark === benchmark);
    const items = competitorPriceItems(rows);
    const ownItems = items.filter(isFotilePriceItem);
    const competitorItems = items.filter((item) => !isFotilePriceItem(item));
    const preferred = state.priceFocus[benchmark];
    const focusItem = ownItems.find((item) => normalizeMonitoredModel(item.model) === normalizeMonitoredModel(preferred))
      || ownItems.find((item) => normalizeMonitoredModel(item.model).includes("PRO"))
      || ownItems[0];
    if (!focusItem) return `<article class="overview-price-summary-card"><strong>${escapeHtml(label)}</strong><p>暂无方太价格数据</p></article>`;
    if (state.priceFocus[benchmark] !== focusItem.model) state.priceFocus[benchmark] = focusItem.model;
    const ranked = [...competitorItems].sort((a, b) => Math.abs(a.latestPrice - focusItem.latestPrice) - Math.abs(b.latestPrice - focusItem.latestPrice));
    const closest = ranked[0];
    const farthest = ranked.at(-1);
    const gapAmount = closest ? focusItem.latestPrice - closest.latestPrice : NaN;
    const gapRate = closest ? ratioChange(focusItem.latestPrice, closest.latestPrice) : NaN;
    const maxGapAmount = farthest ? focusItem.latestPrice - farthest.latestPrice : NaN;
    const maxGapRate = farthest ? ratioChange(focusItem.latestPrice, farthest.latestPrice) : NaN;
    const biggestDrop = [...competitorItems]
      .filter((item) => Number.isFinite(item.change) && item.change < 0)
      .sort((a, b) => a.change - b.change)[0];
    let actionClass = "steady";
    let action = "价差可控，保持跟价监控";
    if (biggestDrop?.change <= -0.05) {
      actionClass = "risk";
      action = "竞品降价≥5%，当天复核活动价";
    } else if (Number.isFinite(gapRate) && gapRate > 0.05) {
      actionClass = "risk";
      action = "我方高于最近竞品，复核节点价格";
    } else if (biggestDrop?.change <= -0.03) {
      actionClass = "watch";
      action = "竞品降价3%–5%，准备跟价方案";
    } else if (Number.isFinite(gapRate) && gapRate < -0.08) {
      actionClass = "protect";
      action = "我方明显低于最近竞品，优先保护价格";
    }
    return `<article class="overview-price-summary-card ${actionClass}">
      <div class="overview-price-summary-head">
        <div><span>${escapeHtml(label)}</span><small>监控截至 ${escapeHtml(focusItem.latestDate || "-")}</small></div>
        <b>${escapeHtml(action)}</b>
      </div>
      <div class="price-focus-control">
        <span>关注型号</span>
        <div>${ownItems.map((item) => `<button type="button" data-price-focus-series="${escapeHtml(benchmark)}" data-price-focus-model="${escapeHtml(item.model)}" class="${item.model === focusItem.model ? "active" : ""}" aria-pressed="${item.model === focusItem.model}">${escapeHtml(item.model)}</button>`).join("")}</div>
      </div>
      <div class="overview-price-summary-metrics">
        <div><span>我方价格</span><strong>${formatCurrency(focusItem.latestPrice)}</strong><small>${escapeHtml(focusItem.model)}</small></div>
        <div><span>最近竞品</span><strong>${closest ? formatCurrency(closest.latestPrice) : "-"}</strong><small>${closest ? escapeHtml(`${closest.brand} ${closest.model}`) : "暂无竞品"}</small></div>
        <div><span>最远竞品</span><strong>${farthest ? formatCurrency(farthest.latestPrice) : "-"}</strong><small>${farthest ? escapeHtml(`${farthest.brand} ${farthest.model}`) : "暂无竞品"}</small></div>
        <div><span>最大价差</span><strong class="${Number.isFinite(maxGapAmount) ? maxGapAmount > 0 ? "negative" : maxGapAmount < 0 ? "positive" : "" : ""}">${Number.isFinite(maxGapAmount) ? formatSignedCurrency(maxGapAmount) : "-"}</strong><small>${Number.isFinite(maxGapRate) ? `${maxGapAmount >= 0 ? "我方高于竞品" : "我方低于竞品"} ${formatRate(Math.abs(maxGapRate))}` : "-"}</small></div>
      </div>
    </article>`;
  }

  function renderOverviewTopModels(currentRows, priorRows) {
    const totalAmount = metricSummary(currentRows).amount;
    const models = modelCatalogWithPriorReferences(currentRows, priorRows, "all", priorRows)
      .filter((item) => item.current.amount > 0)
      .slice(0, 10);
    const rows = models.map((item, index) => {
      const model = item.product.name || item.product.code || item.key;
      const priorReference = item.priorReference
        ? `<small class="overview-top-model-reference">同期参照 ${escapeHtml(item.priorReference)}</small>`
        : "";
      return `<tr>
        <td>${index + 1}</td>
        <td><strong class="overview-top-model-name">${escapeHtml(model)}</strong>${priorReference}</td>
        <td>${escapeHtml(item.product.series || "未分系列")}</td>
        <td>${formatWan(item.current.amount)}</td>
        <td>${formatInteger(item.current.qty)}台</td>
        <td>${Number.isFinite(item.current.avgPrice) ? formatCurrency(item.current.avgPrice) : "-"}</td>
        <td>${formatWan(item.prior.amount)}</td>
        <td class="${signClass(item.amountYoy)}">${formatSignedPct(item.amountYoy)}</td>
        <td>${formatRate(totalAmount ? item.current.amount / totalAmount : NaN)}</td>
      </tr>`;
    });
    const monthLabel = `${state.end.slice(0, 4)}年${Number(state.end.slice(5, 7))}月`;
    return `<section class="overview-top-models">
      <div class="overview-top-models-head">
        <div><span>${escapeHtml(monthLabel)}销售型号 TOP10</span><small>${escapeHtml(`${state.end.slice(0, 7)}-01`)} 至 ${escapeHtml(state.end)}</small></div>
        <b>按有效销售额排序</b>
      </div>
      ${rows.length ? table(["排名", "型号", "系列", "销售额", "台量", "成交均价", "同期销售", "同比", "销售占比"], rows, 820) : '<div class="empty-state"><div class="empty-state-inner"><h2>当前周期暂无型号销售</h2></div></div>'}
    </section>`;
  }

  function renderFocusedPriceExecutive(currentRows, priorRows) {
    if (!competitorPrices.length) return renderFocusedPriceRadar();
    return `<div class="overview-price-summary-grid">
      ${renderFocusedPriceExecutiveCard("18M2系列", "18M2")}
      ${renderFocusedPriceExecutiveCard("16M1系列", "16M1")}
    </div>
    <details class="overview-disclosure overview-price-detail"><summary>展开价格曲线与竞品明细</summary><div class="overview-disclosure-body">${renderFocusedPriceRadar()}</div></details>
    ${renderOverviewTopModels(currentRows, priorRows)}`;
  }

  function renderOverviewScopeMap({ yearStart, monthStart, rollingStart, latestIncomeMonth }) {
    const latestIncomeLabel = latestIncomeMonth
      ? `${latestIncomeMonth.slice(0, 4)}年${Number(latestIncomeMonth.slice(5, 7))}月`
      : "暂无完整收入月";
    return `<section class="overview-scope-map" aria-label="经营总览时间口径">
      <div class="overview-scope-map-title"><p class="eyebrow">TIME SCOPE</p><h2>总览按截止日固定拆分</h2><span>不再使用任意开始日期混算各模块</span></div>
      <article class="annual"><span>年累</span><strong>${escapeHtml(yearStart)}—${escapeHtml(state.end)}</strong><small>进度、形态</small></article>
      <article class="monthly"><span>当月</span><strong>${escapeHtml(monthStart)}—${escapeHtml(state.end)}</strong><small>结论、店铺、系列、TOP10</small></article>
      <article class="rolling"><span>滚动30天</span><strong>${escapeHtml(rollingStart)}—${escapeHtml(state.end)}</strong><small>16N1日销与渠道趋势</small></article>
      <article class="snapshot"><span>最新完整快照</span><strong>收入 ${escapeHtml(latestIncomeLabel)}</strong><small>价格截至 ${escapeHtml(DATA.meta.priceMonitorDateMax || "-")}</small></article>
    </section>`;
  }

  function renderOverviewScopeSection(_index, _title, _period, _description, body, tone = "") {
    return `<section class="overview-scope-group ${escapeHtml(tone)}">
      <div class="overview-scope-body">${body}</div>
    </section>`;
  }

  function renderOverview() {
    const targetSource = DATA.meta.files.find((name) => String(name).includes("2026H2")) || "2026H2经营目标模拟器";
    const anchorYear = Number(state.end.slice(0, 4));
    const monthStart = `${state.end.slice(0, 7)}-01`;
    const yearStart = `${anchorYear}-01-01`;
    const rollingStart = shiftDays(state.end, -29);
    const annualCurrentRows = overviewRowsForRange(yearStart, state.end);
    const annualPriorRows = overviewRowsForRange(shiftYear(yearStart, -1), shiftYear(state.end, -1));
    const monthCurrentRows = overviewRowsForRange(monthStart, state.end);
    const monthPriorRows = overviewRowsForRange(shiftYear(monthStart, -1), shiftYear(state.end, -1));
    const [monthYear, monthNumber] = state.end.slice(0, 7).split("-").map(Number);
    const monthEnd = toIso(new Date(Date.UTC(monthYear, monthNumber, 0)));
    const annualTarget = annualTargetPlan(anchorYear, state.end);
    const monthTarget = {
      ...targetSummaryForPeriod(monthStart, state.end),
      periodStart: monthStart,
      periodEnd: monthEnd,
    };
    const shapeItems = buildOverviewShapeStats(monthCurrentRows, monthPriorRows, monthStart);
    const annualShapeItems = buildOverviewShapeStats(annualCurrentRows, annualPriorRows, yearStart);
    const priceMetrics = buildPriceDecisionMetrics(monthCurrentRows, monthPriorRows, monthTarget, monthStart);
    const n1Current = monthCurrentRows.filter(is16N1);
    const monthLabel = `${monthYear}年${monthNumber}月`;
    const annualPeriod = `${yearStart}—${state.end}`;
    const monthPeriod = `${monthStart}—${state.end}`;
    const rollingPeriod = `${rollingStart}—${state.end}`;
    const latestIncomeMonth = INCOME_DATA?.meta?.incomeMonthMax || "";
    const dualCycleBody = `<section class="overview-executive-progress">
        ${renderExecutiveProgressCard("全年累计销售进度", annualCurrentRows, annualPriorRows, annualTarget, { featured: true })}
        ${renderExecutiveProgressCard("当月累计销售进度", monthCurrentRows, monthPriorRows, monthTarget, { monthly: true })}
      </section>
      ${renderCompactShapeOverview(shapeItems, annualShapeItems)}
      <details class="overview-disclosure overview-method-details"><summary>查看目标与计划节奏口径</summary><div class="overview-disclosure-body">${renderMonthlyTargetPlan(anchorYear, targetSource)}</div></details>`;
    const seriesPanel = panel(`${monthLabel}重点系列`, "系列销售、台量、同比和主力店铺均为当月口径；完整店铺明细按需展开", `<div class="overview-series-summary-grid">${renderSeriesExecutiveSummary(monthCurrentRows, monthPriorRows, is18M2, is18M2, "18M2系列", "18M2 / 18M2Pro / 18M2Max")}${renderSeriesExecutiveSummary(monthCurrentRows, monthPriorRows, is16M1, is16M1Prior, "16M1系列", "本期 16M1 / 16M1Pro / 16M1L · 同期 02-MS16T1 / MS16T2")}</div>`, "overview-series-summary", { className: "overview-span-2" });
    const monthlyBreakdownBody = `<section class="overview-content-grid">
        ${panel(`${monthLabel}店铺经营`, "电商整体＋销售前6店铺＋其他；销售、同比和形态结构均为当月口径", renderOverviewStoreTable(monthCurrentRows, monthPriorRows), "overview-store-mix", { className: "overview-span-2" })}
      </section>`;
    const monitoringBody = `<section class="overview-content-grid">
        ${panel("16N1销售作战视图", `年累与${monthLabel}规模置顶；${monthNumber}月日销、均价与近30天前四渠道趋势单独标记`, render16N1WarRoom(n1Current), "overview-16n1-war-room", { className: "overview-span-2" })}
        ${seriesPanel}
        ${panel("价格监控与当月TOP10", `价格结论截至 ${DATA.meta.priceMonitorDateMax || "-"}；型号TOP10固定使用${monthLabel}数据`, renderFocusedPriceExecutive(monthCurrentRows, monthPriorRows), "overview-competitive-price", { className: "overview-span-2" })}
      </section>`;
    return `<div class="overview-page">
      ${renderOverviewScopeMap({ yearStart, monthStart, rollingStart, latestIncomeMonth })}
      ${renderOverviewScopeSection("01", "当月经营判断", monthPeriod, `${monthLabel}销售结论与目标节奏；收入卡单独标记最新完整审核月`, renderOverviewConclusion(priceMetrics, shapeItems), "monthly")}
      ${renderOverviewScopeSection("02", "年累与当月对照", `${annualPeriod} / ${monthPeriod}`, "只在适合比较的进度和形态模块中并排展示双周期", dualCycleBody, "dual")}
      ${renderOverviewScopeSection("03", "当月经营拆解", monthPeriod, "店铺、系列和型号排名全部固定为当月累计口径", monthlyBreakdownBody, "monthly")}
      ${renderOverviewScopeSection("04", "滚动趋势与最新监控", `${rollingPeriod} / 最新快照`, "滚动30天、最新完整收入月和价格监控日期不与年累或当月混算", monitoringBody, "rolling")}
    </div>`;
  }

  function renderCategory() {
    const currentRows = salesForRange(state.start, state.end);
    const priorRows = salesForRange(shiftYear(state.start, -1), shiftYear(state.end, -1));
    const priorModelReferenceRows = salesForRange(shiftYear(state.start, -1), shiftYear(state.end, -1), false, ["series", "core"]);
    const trend = dailyTrend(currentRows, priorRows);
    const categoryModels = modelCatalog(currentRows, priorRows, "all");
    const categoryComparableModels = modelCatalogWithPriorReferences(currentRows, priorRows, "all", priorModelReferenceRows);
    const shapeMode = SHAPE_BREAKDOWN_MODES[state.shapeBreakdownMode] || SHAPE_BREAKDOWN_MODES.original;
    const shapes = sortShapesByPriority(ranking(currentRows, priorRows, shapeStructureValue));
    const totalAmount = metricSummary(currentRows).amount;
    const cardShapes = shapes.filter((item) => item.name !== "未分类" && Number(item.amount || 0) !== 0);
    const isShapeDrillable = (name) => state.shapeBreakdownMode === "newClassification"
      && (name === "其他" || name === "平衡机" || name.startsWith("蝶翼"));
    const structureCards = cardShapes.map((item) => {
      const drillable = isShapeDrillable(item.name);
      if (drillable) {
        const expanded = state.expandedShapeDetails.has(item.name);
        return `<button class="structure-card shape-drilldown-card ${expanded ? "expanded" : ""}" type="button" data-toggle-shape-detail="${escapeHtml(item.name)}" aria-expanded="${expanded}"><span>${escapeHtml(item.name)}</span><strong>${formatWan(item.amount)}</strong><small class="${signClass(item.yoy)}">同比 ${formatSignedPct(item.yoy)}</small><em>${expanded ? "收起型号明细" : "查看型号明细"}</em></button>`;
      }
      return `<div class="structure-card"><span>${escapeHtml(item.name)}</span><strong>${formatWan(item.amount)}</strong><small class="${signClass(item.yoy)}">同比 ${formatSignedPct(item.yoy)}</small></div>`;
    }).join("");
    const shapeModeSelector = `<div class="shape-mode-controls">
      <div class="shape-mode-row"><span>分类口径</span><div class="shape-mode-bar" role="group" aria-label="形态分类口径">
        ${Object.entries(SHAPE_BREAKDOWN_MODES).map(([mode, spec]) => `<button type="button" class="shape-mode-button ${state.shapeBreakdownMode === mode ? "active" : ""}" data-shape-breakdown="${escapeHtml(mode)}">${escapeHtml(spec.label)}</button>`).join("")}
      </div></div>
      <div class="shape-mode-row secondary"><span>蝶翼展示</span><div class="shape-mode-bar" role="group" aria-label="蝶翼升数展示">
        <button type="button" class="shape-mode-button ${!state.splitButterfly ? "active" : ""}" data-butterfly-split="combined">合并展示</button>
        <button type="button" class="shape-mode-button ${state.splitButterfly ? "active" : ""}" data-butterfly-split="split">拆分18L/16L</button>
      </div></div>
      ${state.shapeBreakdownMode === "newClassification" ? `<div class="shape-mode-row secondary"><span>销售额增减</span><div class="shape-mode-bar" role="group" aria-label="销售额增减列显示设置">
        <button type="button" class="shape-mode-button ${state.showShapeAmountDelta ? "active" : ""}" data-shape-amount-delta="show">显示</button>
        <button type="button" class="shape-mode-button ${!state.showShapeAmountDelta ? "active" : ""}" data-shape-amount-delta="hide">隐藏</button>
      </div></div>` : ""}
    </div>`;
    const originalStructureRows = shapes.map((item) => {
      const share = totalAmount !== 0 ? item.amount / totalAmount : NaN;
      const indexDelta = Number.isFinite(item.salesIndex) && Number.isFinite(item.prior.salesIndex) ? item.salesIndex - item.prior.salesIndex : NaN;
      const priority = isLowPriorityShape(item.name) ? "监控" : "重点";
      return `<tr><td>${escapeHtml(item.name)}</td><td><span class="priority-chip ${priority === "重点" ? "primary" : ""}">${priority}</span></td><td>${formatWan(item.amount)}</td><td class="${signClass(item.yoy)}">${formatSignedPct(item.yoy)}</td><td>${Number.isFinite(share) ? `${(share * 100).toFixed(1)}%` : "-"}</td><td>${Number.isFinite(item.avgPrice) ? formatCurrency(item.avgPrice) : "-"}</td><td>${Number.isFinite(item.salesIndex) ? item.salesIndex.toFixed(3) : "-"}</td><td class="${signClass(indexDelta)}">${Number.isFinite(indexDelta) ? `${indexDelta >= 0 ? "+" : ""}${indexDelta.toFixed(3)}` : "-"}</td></tr>`;
    });
    const mergedShapeRows = (rows) => rows.filter((row) => {
      const shape = dimValue(row, "shape");
      return shape === "未分类" || shape === "通品" || shape === "效率品";
    });
    const matchesShapeModel = (row, keyword) => `${row.product.name || ""} ${row.product.code || ""}`.toUpperCase().includes(keyword);
    const mergedCurrentRows = mergedShapeRows(currentRows);
    const mergedPriorRows = mergedShapeRows(priorRows);
    const x16f1CurrentRows = mergedCurrentRows.filter((row) => matchesShapeModel(row, "X16F1"));
    const x16f1PriorRows = mergedPriorRows.filter((row) => matchesShapeModel(row, "X16F1"));
    const p16d3CurrentRows = mergedCurrentRows.filter((row) => matchesShapeModel(row, "P16D3"));
    const p16d3PriorRows = mergedPriorRows.filter((row) => matchesShapeModel(row, "P16D3"));
    const isWatchedShapeModel = (row) => matchesShapeModel(row, "X16F1") || matchesShapeModel(row, "P16D3");
    const otherShapeDetailGroups = [
      { name: "X16F1", currentRows: x16f1CurrentRows, priorRows: x16f1PriorRows },
      { name: "P16D3", currentRows: p16d3CurrentRows, priorRows: p16d3PriorRows },
      { name: "其余产品", currentRows: mergedCurrentRows.filter((row) => !isWatchedShapeModel(row)), priorRows: mergedPriorRows.filter((row) => !isWatchedShapeModel(row)) },
    ];
    const shapeRowsByName = (rows, name) => rows.filter((row) => shapeStructureValue(row) === name);
    const butterflyDetailRules = [
      (value) => value.includes("-16M1-"),
      (value) => value.includes("-02-MS16T1-"),
      (value) => value.includes("-16M1PRO-"),
      (value) => value.includes("-MS16T2-"),
      (value) => value.includes("-18M2-"),
      (value) => value.includes("-18M2PRO-"),
      (value) => value.includes("-18M2MAX-"),
    ];
    const butterflyDetailRank = (model) => {
      const source = `${model.product.name || ""} ${model.product.code || ""}`
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      const searchable = `-${source}-`;
      return butterflyDetailRules.findIndex((matches) => matches(searchable));
    };
    const detailGroupsForShape = (name) => {
      if (name === "其他") return otherShapeDetailGroups;
      const shapeCurrentRows = shapeRowsByName(currentRows, name);
      const shapePriorRows = shapeRowsByName(priorRows, name);
      const shapeModels = modelCatalog(shapeCurrentRows, shapePriorRows, "all");
      if (name.startsWith("蝶翼")) {
        const rankedModels = shapeModels.map((model) => ({ model, rank: butterflyDetailRank(model) }));
        const selectedGroups = rankedModels
          .filter((item) => item.rank >= 0)
          .sort((a, b) => a.rank - b.rank || b.model.current.amount - a.model.current.amount)
          .map(({ model }) => ({
            name: model.product.name || model.product.code || model.key,
            currentRows: model.currentRows,
            priorRows: model.priorRows,
          }));
        const remainingModels = rankedModels.filter((item) => item.rank < 0).map((item) => item.model);
        if (remainingModels.length) {
          selectedGroups.push({
            name: "其余产品",
            currentRows: remainingModels.flatMap((model) => model.currentRows),
            priorRows: remainingModels.flatMap((model) => model.priorRows),
          });
        }
        return selectedGroups;
      }
      return shapeModels.map((model) => ({
        name: model.product.name || model.product.code || model.key,
        currentRows: model.currentRows,
        priorRows: model.priorRows,
      }));
    };
    const newStructureRows = shapes.flatMap((item) => {
      const totalShare = totalAmount ? item.amount / totalAmount : NaN;
      const amountDelta = Math.round(item.amount) - Math.round(item.prior.amount);
      const qtyYoy = ratioChange(item.qty, item.prior.qty);
      const drillable = isShapeDrillable(item.name);
      const expanded = drillable && state.expandedShapeDetails.has(item.name);
      const nameCell = drillable
        ? `<button type="button" class="shape-table-toggle" data-toggle-shape-detail="${escapeHtml(item.name)}" aria-expanded="${expanded}"><span>${escapeHtml(item.name)}</span><em>${expanded ? "收起明细" : "展开明细"}</em></button>`
        : escapeHtml(item.name);
      const amountDeltaCell = state.showShapeAmountDelta ? `<td class="${signClass(amountDelta)}">${formatSignedWan(amountDelta)}</td>` : "";
      const parentRow = `<tr class="shape-parent-row ${drillable ? "shape-drillable-row" : ""}"><td>${nameCell}</td><td>${formatWan(item.amount)}</td><td>${formatWan(item.prior.amount)}</td>${amountDeltaCell}<td class="${signClass(item.yoy)}">${formatSignedPct(item.yoy)}</td><td>${formatInteger(item.qty)}</td><td>${formatInteger(item.prior.qty)}</td><td class="${signClass(qtyYoy)}">${formatSignedPct(qtyYoy)}</td><td>${formatRate(totalShare)}</td><td>${drillable ? "100.0%" : "-"}</td><td>${Number.isFinite(item.avgPrice) ? formatCurrency(item.avgPrice) : "-"}</td><td>${Number.isFinite(item.salesIndex) ? item.salesIndex.toFixed(3) : "-"}</td></tr>`;
      if (!expanded) return [parentRow];
      const childRows = detailGroupsForShape(item.name).map((detail) => {
        const current = metricSummary(detail.currentRows);
        const prior = metricSummary(detail.priorRows);
        const detailAmountDelta = Math.round(current.amount) - Math.round(prior.amount);
        const amountYoy = ratioChange(current.amount, prior.amount);
        const detailQtyYoy = ratioChange(current.qty, prior.qty);
        const detailTotalShare = totalAmount ? current.amount / totalAmount : NaN;
        const innerShare = item.amount ? current.amount / item.amount : NaN;
        const detailAmountDeltaCell = state.showShapeAmountDelta ? `<td class="${signClass(detailAmountDelta)}">${formatSignedWan(detailAmountDelta)}</td>` : "";
        return `<tr class="shape-detail-child"><td><span class="shape-child-label">${escapeHtml(detail.name)}</span></td><td>${formatWan(current.amount)}</td><td>${formatWan(prior.amount)}</td>${detailAmountDeltaCell}<td class="${signClass(amountYoy)}">${formatSignedPct(amountYoy)}</td><td>${formatInteger(current.qty)}</td><td>${formatInteger(prior.qty)}</td><td class="${signClass(detailQtyYoy)}">${formatSignedPct(detailQtyYoy)}</td><td>${formatRate(detailTotalShare)}</td><td>${formatRate(innerShare)}</td><td>${Number.isFinite(current.avgPrice) ? formatCurrency(current.avgPrice) : "-"}</td><td>${Number.isFinite(current.salesIndex) ? current.salesIndex.toFixed(3) : "-"}</td></tr>`;
      });
      return [parentRow, ...childRows];
    });
    const newStructureHeaders = [shapeMode.column, "本期销售额", "同期销售额", ...(state.showShapeAmountDelta ? ["销售额增减"] : []), "销售同比", "本期销量", "同期销量", "销量同比", "总盘占比", "分类内占比", "均价", "销售指数"];
    const structureTable = state.shapeBreakdownMode === "newClassification"
      ? `<div class="new-shape-table">${table(newStructureHeaders, newStructureRows, state.showShapeAmountDelta ? 1380 : 1270)}</div>`
      : table([shapeMode.column, "优先级", "金额", "同比", "占比", "均价", "销售指数", "指数净值差"], originalStructureRows, 720);
    const shapeModeDescription = `${shapeMode.subtitle}；蝶翼${state.splitButterfly ? "按M2=18L、M0/M1=16L拆分" : "合并展示"}${state.shapeBreakdownMode === "newClassification" ? "；蝶翼、平衡机与其他均可独立展开型号明细" : ""}`;
    const modelRows = categoryComparableModels.map((item, index) => {
      const amountYoy = ratioChange(item.current.amount, item.prior.amount);
      const avgPriceYoy = ratioChange(item.current.avgPrice, item.prior.avgPrice);
      const indexDelta = Number.isFinite(item.current.salesIndex) && Number.isFinite(item.prior.salesIndex)
        ? item.current.salesIndex - item.prior.salesIndex : NaN;
      const share = totalAmount ? item.current.amount / totalAmount : NaN;
      const searchText = `${item.product.series || ""} ${item.product.shape || ""} ${item.product.name || ""} ${item.product.code || item.key}`.toLowerCase();
      const modelName = item.product.name || item.product.code || item.key;
      const priorReference = item.priorReference ? `<small class="model-prior-reference">同期参照：${escapeHtml(item.priorReference)}</small>` : "";
      return `<tr data-category-model-row="${escapeHtml(searchText)}"><td>${index + 1}</td><td><button type="button" class="model-detail-link" data-open-model-detail="${escapeHtml(item.key)}" title="进入${escapeHtml(modelName)}型号分析">${escapeHtml(modelName)}</button>${priorReference}</td><td>${formatWan(item.current.amount)}</td><td>${formatWan(item.prior.amount)}</td><td class="${signClass(amountYoy)}">${formatSignedPct(amountYoy)}</td><td>${formatInteger(item.current.qty)}</td><td>${Number.isFinite(item.current.avgPrice) ? formatCurrency(item.current.avgPrice) : "-"}</td><td>${Number.isFinite(item.prior.avgPrice) ? formatCurrency(item.prior.avgPrice) : "-"}</td><td class="${signClass(avgPriceYoy)}">${formatSignedPct(avgPriceYoy)}</td><td>${Number.isFinite(item.current.salesIndex) ? item.current.salesIndex.toFixed(3) : "-"}</td><td class="${signClass(indexDelta)}">${Number.isFinite(indexDelta) ? `${indexDelta >= 0 ? "+" : ""}${indexDelta.toFixed(3)}` : "-"}</td><td>${formatRate(share)}</td><td>${escapeHtml(item.product.shape || "未分类")}</td><td>${escapeHtml(item.product.code || "-")}</td><td>${escapeHtml(item.product.series || "未分系列")}</td><td>${item.product.core ? "核心品" : "非核心品"}</td></tr>`;
    });
    const modelDetail = `<div class="search-row"><input id="categoryModelSearch" type="search" placeholder="搜索型号、编码、系列或形态" /></div>${table(["排名", "型号", "销售额", "同期销售", "销售同比", "销量", "成交均价", "同期均价", "均价同比", "销售指数", "指数净值差", "销售占比", "形态分类", "产品编码", "系列", "核心品"], modelRows, 1540)}`;

    return `${renderSalesKpis(currentRows, priorRows)}
      <section class="content-grid">
        ${panel("销售额分日趋势", "按支付日期汇总，与上年同期同日比较", rankList(trend, (item) => formatWan(item.amount)), "daily-sales", { unit: "单位 / 元" })}
        ${panel("形态结构", shapeModeDescription, `${shapeModeSelector}<div class="structure-cards">${structureCards || '<span class="neutral">当前筛选无形态数据</span>'}</div>${structureTable}`, "shape-structure")}
        ${panel("型号经营明细", `当前共 ${formatInteger(categoryComparableModels.length)} 个型号，默认按销售额从高到低排列；指定型号按对应同期参照型号对比`, modelDetail, "category-model-detail", { className: "span-2" })}
        ${renderDataHealthPanel()}
      </section>
      ${renderPriceImpact(currentRows, priorRows)}`;
  }

  function renderCore() {
    const currentBaseRows = salesForRange(state.start, state.end, false, ["core"]);
    const priorBaseRows = salesForRange(shiftYear(state.start, -1), shiftYear(state.end, -1), false, ["core"]);
    const priorModelReferenceRows = salesForRange(shiftYear(state.start, -1), shiftYear(state.end, -1), false, ["series", "core"]);
    const catalog = modelCatalogWithPriorReferences(currentBaseRows, priorBaseRows, state.modelScope, priorModelReferenceRows);
    const catalogMap = new Map(catalog.map((item) => [item.key, item]));
    if (!catalogMap.has(state.selectedModel)) state.selectedModel = catalog[0]?.key || "";
    state.compareModels = state.compareModels.filter((key) => key !== state.selectedModel && catalogMap.has(key)).slice(0, 2);

    const scopeButtons = `<div class="model-scope-switch" role="group" aria-label="型号范围">
      <button type="button" class="${state.modelScope === "core" ? "active" : ""}" data-model-scope="core">核心品</button>
      <button type="button" class="${state.modelScope === "all" ? "active" : ""}" data-model-scope="all">全部型号</button>
    </div>`;
    if (!catalog.length) {
      return `<section class="model-control-panel glass"><div><p class="eyebrow">Model Intelligence</p><h2>型号分析</h2><p>当前范围没有可分析型号。</p></div>${scopeButtons}</section>
        <section class="empty-state"><div class="empty-state-inner"><h2>当前筛选无型号数据</h2><p>请调整日期、渠道、业务部、形态、系列或产品定位。</p></div></section>`;
    }

    const selected = catalogMap.get(state.selectedModel);
    const current = selected.current;
    const prior = selected.prior;
    const allCurrent = metricSummary(currentBaseRows);
    const allPrior = metricSummary(priorBaseRows);
    const amountChange = ratioChange(current.amount, prior.amount);
    const qtyChange = ratioChange(current.qty, prior.qty);
    const avgPriceChange = ratioChange(current.avgPrice, prior.avgPrice);
    const modelShare = allCurrent.amount ? current.amount / allCurrent.amount : NaN;
    const priorModelShare = allPrior.amount ? prior.amount / allPrior.amount : NaN;
    const shareChange = Number.isFinite(modelShare) && Number.isFinite(priorModelShare) ? modelShare - priorModelShare : NaN;
    const indexDelta = Number.isFinite(current.salesIndex) && Number.isFinite(prior.salesIndex) ? current.salesIndex - prior.salesIndex : NaN;
    const policyPrice = current.policyQty ? current.policy / current.policyQty : NaN;
    const activeStores = new Set(selected.currentRows.map(storeValue).filter((name) => name !== "未标注店铺")).size;

    const modelOptions = catalog.map((item) => `<option value="${escapeHtml(item.key)}" ${item.key === selected.key ? "selected" : ""}>${escapeHtml(`${modelLabel(item)}（${formatInteger(item.current.qty)}台）`)}</option>`).join("");
    const compareCandidates = catalog.filter((item) => item.key !== selected.key && !state.compareModels.includes(item.key));
    const compareOptions = compareCandidates.map((item) => `<option value="${escapeHtml(item.key)}">${escapeHtml(modelLabel(item))}</option>`).join("");
    const compareChips = state.compareModels.map((key) => {
      const item = catalogMap.get(key);
      return `<span class="compare-chip">${escapeHtml(item ? modelLabel(item) : key)}<button type="button" data-remove-model-compare="${escapeHtml(key)}">移除</button></span>`;
    }).join("");
    const controlPanel = `<section class="model-control-panel glass">
      <div class="model-control-copy"><p class="eyebrow">Model Intelligence</p><h2>型号分析</h2><p>核心品为默认范围；切换到全部型号后可分析任一有销售记录的型号。</p></div>
      <div class="model-control-grid">
        <div><span class="filter-label">型号范围</span>${scopeButtons}</div>
        <label class="range-field"><span>搜索型号</span><input id="modelSearch" type="search" placeholder="输入型号、编码或系列" /></label>
        <label class="range-field"><span>选择型号</span><select id="modelSelect">${modelOptions}</select></label>
      </div>
      <div class="model-compare-bar">
        <div><strong>型号对比</strong><span>当前型号已自动加入，可再添加 ${Math.max(0, 2 - state.compareModels.length)} 个</span></div>
        <select id="compareModelSelect" ${!compareCandidates.length || state.compareModels.length >= 2 ? "disabled" : ""}><option value="">选择对比型号</option>${compareOptions}</select>
        <button type="button" class="ghost-action" data-add-model-compare ${!compareCandidates.length || state.compareModels.length >= 2 ? "disabled" : ""}>加入对比</button>
        <div class="compare-chips">${compareChips || '<span class="neutral">尚未添加对比型号</span>'}</div>
      </div>
      <p class="model-identity"><strong>${escapeHtml(selected.product.name || selected.key)}</strong><span>${escapeHtml(selected.product.code || "无编码")}</span><span>${escapeHtml(selected.product.series || "未分系列")}</span><span>${escapeHtml(selected.product.shape || "未分类")}</span><span>${selected.product.core ? "核心品" : "非核心品"}</span>${selected.priorReference ? `<span class="model-prior-reference-chip">同期参照：${escapeHtml(selected.priorReference)}</span>` : ""}</p>
    </section>`;

    const currentDailyMap = groupRows(selected.currentRows, (row) => row.date);
    const priorDailyMap = groupRows(selected.priorRows, (row) => row.date);
    const dailyRows = [...currentDailyMap.entries()].sort(([a], [b]) => b.localeCompare(a)).slice(0, 10).map(([date, rows]) => {
      const day = metricSummary(rows);
      const priorDay = metricSummary(priorDailyMap.get(shiftYear(date, -1)) || []);
      return `<tr><td>${escapeHtml(date)}</td><td>${formatWan(day.amount)}</td><td>${formatInteger(day.qty)}</td><td>${Number.isFinite(day.avgPrice) ? formatCurrency(day.avgPrice) : "-"}</td><td class="${signClass(ratioChange(day.amount, priorDay.amount))}">${formatSignedPct(ratioChange(day.amount, priorDay.amount))}</td><td class="${signClass(ratioChange(day.qty, priorDay.qty))}">${formatSignedPct(ratioChange(day.qty, priorDay.qty))}</td></tr>`;
    });

    const selectedChannelMap = groupRows(selected.currentRows, (row) => dimValue(row, "channel"));
    const priorChannelMap = groupRows(selected.priorRows, (row) => dimValue(row, "channel"));
    const totalChannelMap = groupRows(currentBaseRows, (row) => dimValue(row, "channel"));
    const channelNames = new Set([...totalChannelMap.keys(), ...selectedChannelMap.keys(), ...priorChannelMap.keys()]);
    const channelItems = [...channelNames].map((name) => {
      const rows = selectedChannelMap.get(name) || [];
      const currentChannel = metricSummary(rows);
      const priorChannel = metricSummary(priorChannelMap.get(name) || []);
      const channelTotal = metricSummary(totalChannelMap.get(name) || []);
      const modelChannelContribution = current.amount ? currentChannel.amount / current.amount : NaN;
      const channelPenetration = channelTotal.amount ? currentChannel.amount / channelTotal.amount : NaN;
      const fitIndex = Number.isFinite(channelPenetration) && Number.isFinite(modelShare) && modelShare !== 0 ? channelPenetration / modelShare : NaN;
      const stores = new Set(rows.map(storeValue).filter((value) => value !== "未标注店铺")).size;
      return {
        name,
        current: currentChannel,
        prior: priorChannel,
        channelTotal,
        modelChannelContribution,
        channelPenetration,
        fitIndex,
        stores,
        storeAvgQty: stores ? currentChannel.qty / stores : NaN,
        amountYoy: ratioChange(currentChannel.amount, priorChannel.amount),
        qtyYoy: ratioChange(currentChannel.qty, priorChannel.qty),
        opportunityScore: Number.isFinite(fitIndex) ? channelTotal.amount * Math.max(0, 1 - fitIndex) : 0,
      };
    }).sort((a, b) => b.current.amount - a.current.amount || b.channelTotal.amount - a.channelTotal.amount);
    const topChannel = channelItems.find((item) => item.current.amount > 0);
    const fitChannel = [...channelItems].filter((item) => item.current.amount > 0 && Number.isFinite(item.fitIndex)).sort((a, b) => b.fitIndex - a.fitIndex)[0];
    const opportunityChannel = [...channelItems].filter((item) => item.channelTotal.amount > 0 && Number.isFinite(item.fitIndex) && item.fitIndex < 1).sort((a, b) => b.opportunityScore - a.opportunityScore)[0];
    const channelRows = channelItems.map((item) => `<tr>
      <td>${escapeHtml(item.name)}</td><td>${formatWan(item.current.amount)}</td><td>${formatInteger(item.current.qty)}</td><td>${Number.isFinite(item.current.avgPrice) ? formatCurrency(item.current.avgPrice) : "-"}</td>
      <td class="${signClass(item.amountYoy)}">${formatSignedPct(item.amountYoy)}</td><td class="${signClass(item.qtyYoy)}">${formatSignedPct(item.qtyYoy)}</td>
      <td>${formatRate(item.modelChannelContribution)}</td><td>${formatRate(item.channelPenetration)}</td><td>${Number.isFinite(item.fitIndex) ? item.fitIndex.toFixed(2) : "-"}</td>
      <td>${formatInteger(item.stores)}</td><td>${Number.isFinite(item.storeAvgQty) ? formatDecimal(item.storeAvgQty, 1) : "-"}</td><td>${Number.isFinite(item.current.salesIndex) ? item.current.salesIndex.toFixed(3) : "-"}</td>
    </tr>`);

    const currentStoreMap = groupRows(selected.currentRows, storeValue);
    const priorStoreMap = groupRows(selected.priorRows, storeValue);
    const storeItems = [...currentStoreMap.entries()].map(([name, rows]) => {
      const currentStore = metricSummary(rows);
      const priorStore = metricSummary(priorStoreMap.get(name) || []);
      const channel = [...groupRows(rows, (row) => dimValue(row, "channel")).entries()]
        .map(([channelName, channelRows]) => ({ name: channelName, amount: metricSummary(channelRows).amount }))
        .sort((a, b) => b.amount - a.amount)[0]?.name || "未标注";
      return { name, channel, current: currentStore, prior: priorStore, contribution: current.amount ? currentStore.amount / current.amount : NaN, yoy: ratioChange(currentStore.amount, priorStore.amount) };
    }).sort((a, b) => b.current.amount - a.current.amount);
    const topStoreShare = storeItems[0]?.contribution;
    const storeRows = storeItems.slice(0, 50).map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.channel)}</td><td>${formatWan(item.current.amount)}</td><td>${formatInteger(item.current.qty)}</td><td>${formatRate(item.contribution)}</td><td>${Number.isFinite(item.current.avgPrice) ? formatCurrency(item.current.avgPrice) : "-"}</td><td class="${signClass(item.yoy)}">${formatSignedPct(item.yoy)}</td><td>${Number.isFinite(item.current.salesIndex) ? item.current.salesIndex.toFixed(3) : "-"}</td></tr>`);

    const compareKeys = [selected.key, ...state.compareModels].slice(0, 3);
    const compareRows = compareKeys.map((key) => {
      const item = catalogMap.get(key);
      const itemShare = allCurrent.amount ? item.current.amount / allCurrent.amount : NaN;
      const itemPolicyPrice = item.current.policyQty ? item.current.policy / item.current.policyQty : NaN;
      const itemStores = new Set(item.currentRows.map(storeValue).filter((value) => value !== "未标注店铺")).size;
      const itemTopChannel = ranking(item.currentRows, item.priorRows, (row) => dimValue(row, "channel"), 1)[0];
      return `<tr class="${key === selected.key ? "highlight-row" : ""}"><td>${escapeHtml(item.product.name || key)}</td><td>${escapeHtml(item.product.series || "未分系列")}</td><td>${formatWan(item.current.amount)}</td><td>${formatInteger(item.current.qty)}</td><td>${formatRate(itemShare)}</td><td>${Number.isFinite(item.current.avgPrice) ? formatCurrency(item.current.avgPrice) : "-"}</td><td>${Number.isFinite(itemPolicyPrice) ? formatCurrency(itemPolicyPrice) : "-"}</td><td>${Number.isFinite(item.current.salesIndex) ? item.current.salesIndex.toFixed(3) : "-"}</td><td>${formatInteger(itemStores)}</td><td>${escapeHtml(itemTopChannel?.name || "-")}</td><td class="${signClass(item.amountYoy)}">${formatSignedPct(item.amountYoy)}</td><td class="${signClass(item.qtyYoy)}">${formatSignedPct(item.qtyYoy)}</td></tr>`;
    });

    const modelContributions = catalog.map((item) => allCurrent.amount ? item.current.amount / allCurrent.amount : NaN);
    const contributionMedian = median(modelContributions.filter((value) => value > 0));
    const lifecycleLabel = (contribution, yoy) => {
      if (!Number.isFinite(yoy)) return "待观察";
      const highContribution = Number.isFinite(contributionMedian) && contribution >= contributionMedian;
      if (highContribution && yoy >= 0) return "增长核心";
      if (highContribution) return "核心承压";
      if (yoy >= 0) return "机会型号";
      return "长尾型号";
    };
    const allModelRows = catalog.map((item) => {
      const contribution = allCurrent.amount ? item.current.amount / allCurrent.amount : NaN;
      const itemPolicyPrice = item.current.policyQty ? item.current.policy / item.current.policyQty : NaN;
      const itemStores = new Set(item.currentRows.map(storeValue).filter((value) => value !== "未标注店铺")).size;
      const itemTopChannel = ranking(item.currentRows, item.priorRows, (row) => dimValue(row, "channel"), 1)[0];
      const layer = lifecycleLabel(contribution, item.amountYoy);
      return `<tr data-model-row="${escapeHtml(`${item.product.series || ""} ${item.product.shape || ""} ${item.product.name || ""} ${item.product.code || item.key}`.toLowerCase())}"><td>${escapeHtml(layer)}</td><td>${escapeHtml(item.product.series || "未分系列")}</td><td>${escapeHtml(item.product.name || item.key)}</td><td>${escapeHtml(item.product.code || "-")}</td><td>${formatWan(item.current.amount)}</td><td>${formatInteger(item.current.qty)}</td><td>${formatRate(contribution)}</td><td>${Number.isFinite(item.current.avgPrice) ? formatCurrency(item.current.avgPrice) : "-"}</td><td>${Number.isFinite(itemPolicyPrice) ? formatCurrency(itemPolicyPrice) : "-"}</td><td>${Number.isFinite(item.current.salesIndex) ? item.current.salesIndex.toFixed(3) : "-"}</td><td>${formatInteger(itemStores)}</td><td>${escapeHtml(itemTopChannel?.name || "-")}</td><td class="${signClass(item.amountYoy)}">${formatSignedPct(item.amountYoy)}</td><td class="${signClass(item.qtyYoy)}">${formatSignedPct(item.qtyYoy)}</td></tr>`;
    });

    return `${controlPanel}
      <section class="metric-grid">
        ${metricCard("型号销售额", formatCurrency(current.amount), `同比 ${formatSignedPct(amountChange)}`, amountChange, "所选型号销售金额")}
        ${metricCard("型号销量", formatInteger(current.qty), `同比 ${formatSignedPct(qtyChange)}`, qtyChange, "所选型号销售数量")}
        ${metricCard("型号销售占比", formatRate(modelShare), `同比净值差 ${formatSignedPoint(shareChange)}`, shareChange, "型号销售额 ÷ 当前筛选全部型号销售额")}
        ${metricCard("型号成交均价", Number.isFinite(current.avgPrice) ? formatCurrency(current.avgPrice) : "-", `同比 ${formatSignedPct(avgPriceChange)}`, avgPriceChange, "型号销售额 ÷ 型号销量")}
        ${metricCard("型号销售指数", Number.isFinite(current.salesIndex) ? current.salesIndex.toFixed(3) : "-", `同比净值差 ${Number.isFinite(indexDelta) ? `${indexDelta >= 0 ? "+" : ""}${indexDelta.toFixed(3)}` : "-"}`, indexDelta, "型号销售金额 ÷ 核算价金额")}
        ${metricCard("有销售店铺数", formatInteger(activeStores), `政策均价 ${Number.isFinite(policyPrice) ? formatCurrency(policyPrice) : "-"}`, activeStores, "筛选期内有该型号销售记录的去重店铺数")}
      </section>
      <section class="model-insight-grid">
        <div class="structure-card"><span>主力渠道</span><strong>${escapeHtml(topChannel?.name || "-")}</strong><small>${topChannel ? `${formatWan(topChannel.current.amount)} · 型号贡献 ${formatRate(topChannel.modelChannelContribution)}` : "当前无渠道销售"}</small></div>
        <div class="structure-card"><span>最适配渠道</span><strong>${escapeHtml(fitChannel?.name || "-")}</strong><small>${fitChannel ? `适配指数 ${formatDecimal(fitChannel.fitIndex, 2)}` : "当前无适配数据"}</small></div>
        <div class="structure-card"><span>优先机会渠道</span><strong>${escapeHtml(opportunityChannel?.name || "-")}</strong><small>${opportunityChannel ? `渠道规模 ${formatWan(opportunityChannel.channelTotal.amount)} · 当前占比 ${formatRate(opportunityChannel.channelPenetration)}` : "暂无明显渠道缺口"}</small></div>
        <div class="structure-card"><span>头部店铺集中度</span><strong>${formatRate(topStoreShare)}</strong><small>${storeItems[0] ? escapeHtml(storeItems[0].name) : "当前无店铺销售"}</small></div>
      </section>
      <section class="content-grid">
        ${panel("渠道销售效率", "适配指数=渠道内型号占比÷型号整体占比；大于1表示该渠道表现高于型号整体水平", table(["渠道", "销售额", "销量", "成交均价", "销售同比", "销量同比", "型号渠道贡献", "渠道内型号占比", "渠道适配指数", "销售店铺", "店均销量", "销售指数"], channelRows, 1480), "model-channel-efficiency", { className: "span-2" })}
        ${panel("店铺销售效率", `有销售店铺 ${formatInteger(activeStores)} 家；店均销量 ${activeStores ? formatDecimal(current.qty / activeStores, 1) : "-"} 台`, table(["店铺", "主渠道", "销售额", "销量", "型号贡献", "成交均价", "销售同比", "销售指数"], storeRows, 980), "model-store-efficiency", { className: "span-2" })}
        ${panel("型号对比", state.compareModels.length ? `当前共对比 ${formatInteger(compareKeys.length)} 个型号` : "可在上方再添加1—2个型号", table(["型号", "系列", "销售额", "销量", "销售占比", "成交均价", "政策均价", "销售指数", "销售店铺", "主力渠道", "销售同比", "销量同比"], compareRows, 1380), "model-comparison")}
        ${panel("型号近10天表现", "展示筛选周期内最近10个有销售记录的日期，按日期由近到远排列", table(["日期", "销售额", "销量", "成交均价", "销售同比", "销量同比"], dailyRows, 720), "model-daily")}
        ${panel(state.modelScope === "core" ? "核心型号经营明细" : "全部型号经营明细", "经营分层以当前型号销售贡献中位数和销售同比方向划分，仅用于快速定位", `<div class="search-row"><input id="allModelSearch" type="search" placeholder="搜索系列、形态、型号或编码" /></div>${table(["经营分层", "系列", "型号", "产品编码", "销售额", "销量", "销售占比", "成交均价", "政策均价", "销售指数", "销售店铺", "主力渠道", "销售同比", "销量同比"], allModelRows, 1640)}`, "all-model-detail", { className: "span-2" })}
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
    const brandRanks = oviRanking(rangeRows, priorRangeRows, (row) => row.brand);
    const marketBrandCount = uniqueSorted(rangeRows.map((row) => row.brand)).length;
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
      ${metricCard("品牌排名", rankIndex >= 0 ? `第 ${rankIndex + 1} 名` : "-", `${rangeLabel}市场品牌 ${formatInteger(marketBrandCount)} 个`, NaN, "按所选价格区间内品牌销额降序")}
    </section>
      <section class="content-grid">
        ${panel(months.length > 1 ? "品牌销额市占趋势" : "品牌销额市占", months.length > 1 ? "按奥维月份汇总" : `最新可用月份 ${months[0] || DATA.meta.oviMonthMax}`, rankList(trendItems, (item) => `${(item.value * 100).toFixed(1)}%`, () => ""), "ovi-share-trend")}
        ${panel("品牌排名", `燃气热水器线上市场，按${rangeLabel}区间销额降序展示 Top 30`, rankList(brandRanks), "ovi-brand-ranking")}
        ${panel("型号单价与销量", `仅展示品牌配置：${DATA.meta.brand}；单价=型号销额÷型号销量`, table(["型号", "销量", "销额", "单价", "同比"], modelRows, 680), "ovi-model-ranking", { className: "span-2" })}
        ${panel("价位段结构", "产品定位已改为奥维成交均价价位段；边界按左闭右开划分", `<div class="structure-cards">${priceBandCards}</div>${table(["价位段", "市场销额", "市场销量", "销额结构", "市场均价", `${DATA.meta.brand}销额占比`, "同比"], priceBandRows, 820)}`, "ovi-price-bands", { className: "span-2" })}
        ${panel("升数段结构", "直接使用奥维“升数段”字段", table(["升数段", "销额", "销量", "均价", "同比"], volumeRows, 620), "ovi-volume", { className: "span-2" })}
      </section>`;
  }

  function incomeRowsForRange(rows, start, end) {
    const startMonth = String(start).slice(0, 7);
    const endMonth = String(end).slice(0, 7);
    const businessAll = state.selections.business.size === FILTERS.business.options.length;
    const channelAll = state.selections.channel.size === FILTERS.channel.options.length;
    return rows.filter((row) => (
      row.month >= startMonth
      && row.month <= endMonth
      && (businessAll || state.selections.business.has(row.business || "未标注"))
      && (channelAll || state.selections.channel.has(row.channel || "未标注"))
    ));
  }

  function salesRowsForIncomeRange(start, end) {
    return sales.filter((row) => (
      row.date >= start
      && row.date <= end
      && state.selections.business.has(dimValue(row, "business"))
      && state.selections.channel.has(dimValue(row, "channel"))
    ));
  }

  function revenueSummary(salesRows, incomeRows) {
    const salesAmount = salesRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const incomeAmount = incomeRows.reduce((sum, row) => sum + Number(row.income || 0), 0);
    const incomeTaxEq = incomeRows.reduce((sum, row) => sum + Number(row.incomeTaxEq || 0), 0);
    const incomeQty = incomeRows.reduce((sum, row) => sum + Number(row.qty || 0), 0);
    return {
      sales: salesAmount,
      income: incomeAmount,
      incomeTaxEq,
      incomeQty,
      financialRate: salesAmount ? incomeAmount / salesAmount : NaN,
      comparableRate: salesAmount ? incomeTaxEq / salesAmount : NaN,
      conversionGap: salesAmount - incomeTaxEq,
    };
  }

  function incomePeriodLabel(start, end) {
    const [startYear, startMonth] = start.slice(0, 7).split("-").map(Number);
    const [endYear, endMonth] = end.slice(0, 7).split("-").map(Number);
    if (startYear === endYear) return startMonth === endMonth ? `${startMonth}月` : `${startMonth}—${endMonth}月`;
    return `${startYear}年${startMonth}月—${endYear}年${endMonth}月`;
  }

  function incomeMonthSequence(start, end) {
    const cursor = new Date(`${monthStartIso(start)}T00:00:00Z`);
    const last = new Date(`${monthStartIso(end)}T00:00:00Z`);
    const months = [];
    while (cursor <= last) {
      months.push(cursor.toISOString().slice(0, 7));
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return months;
  }

  function revenueGroupStats(currentSalesRows, priorSalesRows, currentIncomeRows, priorIncomeRows, dimension) {
    const salesKey = dimension === "business" ? (row) => dimValue(row, "business") : (row) => dimValue(row, "channel");
    const incomeKey = dimension === "business" ? (row) => row.business || "未标注" : (row) => row.channel || "未标注";
    const currentSalesGroups = groupRows(currentSalesRows, salesKey);
    const priorSalesGroups = groupRows(priorSalesRows, salesKey);
    const currentIncomeGroups = groupRows(currentIncomeRows, incomeKey);
    const priorIncomeGroups = groupRows(priorIncomeRows, incomeKey);
    const names = new Set([...currentSalesGroups.keys(), ...currentIncomeGroups.keys()]);
    return [...names].map((name) => {
      const current = revenueSummary(currentSalesGroups.get(name) || [], currentIncomeGroups.get(name) || []);
      const prior = revenueSummary(priorSalesGroups.get(name) || [], priorIncomeGroups.get(name) || []);
      const hasPriorSales = priorSalesGroups.has(name);
      const hasPriorIncome = priorIncomeGroups.has(name);
      return {
        name,
        ...current,
        prior,
        hasPriorSales,
        hasPriorIncome,
        salesYoY: ratioChange(current.sales, prior.sales),
        incomeYoY: ratioChange(current.income, prior.income),
        rateChange: hasPriorSales && hasPriorIncome && Number.isFinite(current.financialRate) && Number.isFinite(prior.financialRate)
          ? current.financialRate - prior.financialRate
          : NaN,
      };
    }).sort((a, b) => b.sales - a.sales || b.income - a.income);
  }

  function aggregateRevenueItems(items, name) {
    const salesAmount = items.reduce((sum, item) => sum + item.sales, 0);
    const incomeAmount = items.reduce((sum, item) => sum + item.income, 0);
    const taxEq = items.reduce((sum, item) => sum + item.incomeTaxEq, 0);
    const priorSales = items.reduce((sum, item) => sum + Number(item.prior?.sales || 0), 0);
    const priorIncome = items.reduce((sum, item) => sum + Number(item.prior?.income || 0), 0);
    const priorTaxEq = items.reduce((sum, item) => sum + Number(item.prior?.incomeTaxEq || 0), 0);
    const financialRate = salesAmount ? incomeAmount / salesAmount : NaN;
    const priorFinancialRate = priorSales ? priorIncome / priorSales : NaN;
    return {
      name,
      sales: salesAmount,
      income: incomeAmount,
      incomeTaxEq: taxEq,
      financialRate,
      comparableRate: salesAmount ? taxEq / salesAmount : NaN,
      prior: {
        sales: priorSales,
        income: priorIncome,
        incomeTaxEq: priorTaxEq,
        financialRate: priorFinancialRate,
      },
      hasPriorSales: items.some((item) => item.hasPriorSales),
      hasPriorIncome: items.some((item) => item.hasPriorIncome),
      salesYoY: ratioChange(salesAmount, priorSales),
      incomeYoY: ratioChange(incomeAmount, priorIncome),
      rateChange: Number.isFinite(financialRate) && Number.isFinite(priorFinancialRate) ? financialRate - priorFinancialRate : NaN,
    };
  }

  function renderIncomeMonthlyChart(months) {
    if (!months.length) return '<div class="empty-state"><div class="empty-state-inner"><h2>当前月份无收入数据</h2><p>调整月份范围后再查看。</p></div></div>';
    const width = 1120;
    const height = 340;
    const pad = { left: 62, right: 72, top: 36, bottom: 52 };
    const plotWidth = width - pad.left - pad.right;
    const plotHeight = height - pad.top - pad.bottom;
    const maxAmount = Math.max(...months.flatMap((item) => [item.sales, item.income]), 1) / 10000;
    const amountCeiling = Math.max(100, Math.ceil(maxAmount / 200) * 200);
    const rateCeiling = Math.max(1, Math.ceil(Math.max(...months.map((item) => item.cumulativeFinancialRate || 0), 1) * 10) / 10);
    const groupWidth = plotWidth / months.length;
    const barWidth = Math.min(34, groupWidth * .24);
    const amountY = (value) => pad.top + plotHeight - (value / amountCeiling) * plotHeight;
    const rateY = (value) => pad.top + plotHeight - (value / rateCeiling) * plotHeight;
    const ticks = [0, amountCeiling / 2, amountCeiling].map((tick) => {
      const y = amountY(tick);
      return `<line x1="${pad.left}" x2="${width - pad.right}" y1="${y}" y2="${y}" stroke="#dfe3e8"/><text x="${pad.left - 11}" y="${y + 4}" text-anchor="end" fill="#68707d" font-size="11">${tick.toFixed(0)}万</text>`;
    }).join("");
    const bars = months.map((item, index) => {
      const center = pad.left + groupWidth * (index + .5);
      const salesValue = item.sales / 10000;
      const incomeValue = item.income / 10000;
      const salesY = amountY(salesValue);
      const incomeY = amountY(incomeValue);
      return `<rect x="${center - barWidth - 3}" y="${salesY}" width="${barWidth}" height="${pad.top + plotHeight - salesY}" rx="4" fill="#ad1f2b" opacity=".88"/>
        <rect x="${center + 3}" y="${incomeY}" width="${barWidth}" height="${pad.top + plotHeight - incomeY}" rx="4" fill="#376c87" opacity=".86"/>
        <text x="${center - barWidth / 2 - 3}" y="${salesY - 7}" text-anchor="middle" fill="#861621" font-size="10" font-weight="700">${salesValue.toFixed(0)}</text>
        <text x="${center + barWidth / 2 + 3}" y="${incomeY - 7}" text-anchor="middle" fill="#376c87" font-size="10" font-weight="700">${incomeValue.toFixed(0)}</text>
        <text x="${center}" y="${height - 21}" text-anchor="middle" fill="#68707d" font-size="12">${Number(item.month.slice(5))}月</text>`;
    }).join("");
    const points = months.map((item, index) => [
      pad.left + groupWidth * (index + .5),
      rateY(item.cumulativeFinancialRate || 0),
      item.cumulativeFinancialRate,
    ]);
    const line = `<polyline points="${points.map(([x, y]) => `${x},${y}`).join(" ")}" fill="none" stroke="#267364" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>`;
    const dots = points.map(([x, y, value]) => `<circle cx="${x}" cy="${y}" r="4.5" fill="#267364" stroke="#fff" stroke-width="2"/><text x="${x}" y="${y - 12}" text-anchor="middle" fill="#267364" font-size="11" font-weight="700">${formatRate(value)}</text>`).join("");
    return `<div class="income-chart-legend"><span class="sales">销售</span><span class="income">不含税收入</span><span class="rate">累计销售到收入转化率</span></div><div class="chart-scroll"><svg class="income-monthly-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="销售、不含税收入与累计销售到收入转化率月度趋势">${ticks}${bars}${line}${dots}<text x="${width - pad.right + 10}" y="${pad.top + 4}" fill="#68707d" font-size="11">右轴 ${formatRate(rateCeiling)}</text></svg></div>`;
  }

  function renderIncome() {
    if (!INCOME_DATA) return '<div class="empty-state"><div class="empty-state-inner"><h2>收入数据未读取</h2><p>请先运行收入数据构建脚本。</p></div></div>';
    const periodStart = monthStartIso(state.start);
    const periodEnd = monthEndIso(state.end) > INCOME_DATA.meta.incomeDateMax ? INCOME_DATA.meta.incomeDateMax : monthEndIso(state.end);
    const priorStart = shiftYear(periodStart, -1);
    const priorEnd = shiftYear(periodEnd, -1);
    const currentSalesRows = salesRowsForIncomeRange(periodStart, periodEnd);
    const priorSalesRows = salesRowsForIncomeRange(priorStart, priorEnd);
    const currentIncomeRows = incomeRowsForRange(incomeCurrent, periodStart, periodEnd);
    const priorIncomeRows = incomeRowsForRange(incomePrior, priorStart, priorEnd);
    const current = revenueSummary(currentSalesRows, currentIncomeRows);
    const prior = revenueSummary(priorSalesRows, priorIncomeRows);
    const salesYoY = ratioChange(current.sales, prior.sales);
    const incomeYoY = ratioChange(current.income, prior.income);
    const financialRateChange = Number.isFinite(current.financialRate) && Number.isFinite(prior.financialRate) ? current.financialRate - prior.financialRate : NaN;
    const conversionGapRate = Number.isFinite(financialRateChange) ? Math.max(0, -financialRateChange) : NaN;
    const conversionGapAmount = Number.isFinite(conversionGapRate) ? current.sales * conversionGapRate : NaN;
    const businessItems = revenueGroupStats(currentSalesRows, priorSalesRows, currentIncomeRows, priorIncomeRows, "business");
    const channelItems = revenueGroupStats(currentSalesRows, priorSalesRows, currentIncomeRows, priorIncomeRows, "channel");
    const periodLabel = incomePeriodLabel(periodStart, periodEnd);

    const months = incomeMonthSequence(periodStart, periodEnd);
    let cumulativeSales = 0;
    let cumulativeIncome = 0;
    const monthly = months.map((month) => {
      const salesAmount = currentSalesRows.filter((row) => row.date.slice(0, 7) === month).reduce((sum, row) => sum + Number(row.amount || 0), 0);
      const rows = currentIncomeRows.filter((row) => row.month === month);
      const incomeAmount = rows.reduce((sum, row) => sum + Number(row.income || 0), 0);
      const incomeTaxEq = rows.reduce((sum, row) => sum + Number(row.incomeTaxEq || 0), 0);
      cumulativeSales += salesAmount;
      cumulativeIncome += incomeAmount;
      return { month, sales: salesAmount, income: incomeAmount, incomeTaxEq, cumulativeFinancialRate: cumulativeSales ? cumulativeIncome / cumulativeSales : NaN };
    });

    const businessRanking = businessItems.map((item) => {
      const gapRate = Number.isFinite(item.rateChange) ? Math.max(0, -item.rateChange) : NaN;
      return { ...item, gapAmount: Number.isFinite(gapRate) ? item.sales * gapRate : NaN };
    }).sort((a, b) => {
      const aGap = Number.isFinite(a.gapAmount) ? a.gapAmount : -1;
      const bGap = Number.isFinite(b.gapAmount) ? b.gapAmount : -1;
      return bGap - aGap || b.sales - a.sales;
    });
    const businessRows = businessRanking.map((item, index) => {
      const status = !Number.isFinite(item.rateChange) ? "无同期" : item.rateChange >= .02 ? "转化改善" : item.rateChange <= -.02 ? "转化下滑" : "转化基本稳定";
      const statusClass = status === "转化下滑" ? "risk" : status === "转化改善" ? "steady" : "watch";
      return `<article class="income-business-row">
        <span class="income-rank-index">${index + 1}</span>
        <div class="income-business-name"><strong>${escapeHtml(item.name)}</strong><span class="income-judgment ${statusClass}">${escapeHtml(status)}</span></div>
        <div><small>本期转化率</small><strong>${formatRate(item.financialRate)}</strong></div>
        <div><small>同比变化</small><strong class="${signClass(item.rateChange)}">${Number.isFinite(item.rateChange) ? formatSignedPoint(item.rateChange).replace("pct", "pp") : "-"}</strong></div>
        <div><small>不含税收入</small><strong>${formatWan(item.income)}</strong></div>
        <div><small>销售规模</small><strong>${formatWan(item.sales)}</strong></div>
        <div><small>转化缺口估算</small><strong class="${Number.isFinite(item.gapAmount) && item.gapAmount > 0 ? "negative" : "neutral"}">${Number.isFinite(item.gapAmount) ? formatWan(item.gapAmount) : "-"}</strong></div>
      </article>`;
    }).join("");

    const topChannels = channelItems.slice(0, 8);
    if (channelItems.length > 8) {
      const other = aggregateRevenueItems(channelItems.slice(8), "其他（含不可拆分同期）");
      const topPriorSales = topChannels.reduce((sum, item) => sum + (item.hasPriorIncome ? Number(item.prior?.sales || 0) : 0), 0);
      const topPriorIncome = topChannels.reduce((sum, item) => sum + Number(item.prior?.income || 0), 0);
      const topPriorTaxEq = topChannels.reduce((sum, item) => sum + Number(item.prior?.incomeTaxEq || 0), 0);
      other.prior.sales = Math.max(0, prior.sales - topPriorSales);
      other.prior.income = prior.income - topPriorIncome;
      other.prior.incomeTaxEq = prior.incomeTaxEq - topPriorTaxEq;
      other.prior.financialRate = other.prior.sales ? other.prior.income / other.prior.sales : NaN;
      other.hasPriorSales = true;
      other.hasPriorIncome = true;
      other.salesYoY = ratioChange(other.sales, other.prior.sales);
      other.incomeYoY = ratioChange(other.income, other.prior.income);
      other.rateChange = Number.isFinite(other.financialRate) && Number.isFinite(other.prior.financialRate)
        ? other.financialRate - other.prior.financialRate
        : NaN;
      topChannels.push(other);
    }
    const channelViews = topChannels.map((item) => {
      const judgment = Number.isFinite(item.rateChange) && item.rateChange <= -.05
        ? "同比转化下滑"
        : item.financialRate >= .8
          ? "转化较稳"
          : item.financialRate >= .6
            ? "关注转化"
            : "重点修复";
      const judgmentClass = judgment === "重点修复" || judgment === "同比转化下滑" ? "risk" : judgment === "转化较稳" ? "steady" : "watch";
      const priorSalesCell = item.hasPriorSales ? formatWan(item.prior.sales) : "-";
      const priorIncomeCell = item.hasPriorIncome ? formatWan(item.prior.income) : "-";
      const priorRateCell = item.hasPriorSales && item.hasPriorIncome ? formatRate(item.prior.financialRate) : "-";
      return { item, judgment, judgmentClass, priorSalesCell, priorIncomeCell, priorRateCell };
    });
    const channelDiagnosticRows = channelViews.map(({ item, judgment, judgmentClass }) => `<tr><td>${escapeHtml(item.name)}</td><td>${formatRate(item.financialRate)}</td><td class="${signClass(item.rateChange)}">${Number.isFinite(item.rateChange) ? formatSignedPoint(item.rateChange).replace("pct", "pp") : "-"}</td><td>${formatWan(item.income)}</td><td>${formatWan(item.sales)}</td><td><span class="income-judgment ${judgmentClass}">${escapeHtml(judgment)}</span></td></tr>`);
    const channelFullRows = channelViews.map(({ item, judgment, judgmentClass, priorSalesCell, priorIncomeCell, priorRateCell }) => `<tr><td>${escapeHtml(item.name)}</td><td>${formatWan(item.sales)}</td><td>${priorSalesCell}</td><td>${formatWan(item.income)}</td><td>${priorIncomeCell}</td><td>${formatRate(item.financialRate)}</td><td>${priorRateCell}</td><td class="${signClass(item.rateChange)}">${Number.isFinite(item.rateChange) ? formatSignedPoint(item.rateChange).replace("pct", "pp") : "-"}</td><td><span class="income-judgment ${judgmentClass}">${escapeHtml(judgment)}</span></td></tr>`);
    const channelCards = channelViews.map(({ item, judgment, judgmentClass }) => `<article class="income-channel-card">
      <div class="income-channel-card-head"><strong>${escapeHtml(item.name)}</strong><span class="income-judgment ${judgmentClass}">${escapeHtml(judgment)}</span></div>
      <dl><div><dt>本期转化率</dt><dd>${formatRate(item.financialRate)}</dd></div><div><dt>同比变化</dt><dd class="${signClass(item.rateChange)}">${Number.isFinite(item.rateChange) ? formatSignedPoint(item.rateChange).replace("pct", "pp") : "-"}</dd></div><div><dt>不含税收入</dt><dd>${formatWan(item.income)}</dd></div><div><dt>销售规模</dt><dd>${formatWan(item.sales)}</dd></div></dl>
    </article>`).join("");

    return `<div class="income-page">
      <section class="income-analysis-header">
        <div><p class="eyebrow">Revenue Analysis 5.1</p><h2>收入经营四层分析</h2></div>
        <p>${escapeHtml(periodLabel)} · 先看结果，再沿月度、业务部和渠道定位差距。</p>
      </section>
      <nav class="income-analysis-path" aria-label="收入分析路径">
        <a href="#income-result-layer"><span>1</span><strong>结果</strong><small>规模与转化</small></a>
        <a href="#income-monthly-trend"><span>2</span><strong>趋势</strong><small>月度节奏</small></a>
        <a href="#income-business-drivers"><span>3</span><strong>业务部</strong><small>问题定位</small></a>
        <a href="#income-channel-conversion"><span>4</span><strong>渠道</strong><small>落到对象</small></a>
      </nav>
      <section class="income-result-grid" id="income-result-layer">
        <article><small>累计销售</small><strong>${formatWan(current.sales)}</strong><span class="${signClass(salesYoY)}">同比 ${formatSignedPct(salesYoY)}</span></article>
        <article><small>不含税收入</small><strong>${formatWan(current.income)}</strong><span class="${signClass(incomeYoY)}">同比 ${formatSignedPct(incomeYoY)}</span></article>
        <article><small>销售到收入转化率</small><strong>${formatRate(current.financialRate)}</strong><span class="${signClass(financialRateChange)}">同比 ${Number.isFinite(financialRateChange) ? formatSignedPoint(financialRateChange).replace("pct", "pp") : "-"}</span></article>
        <article class="income-gap-card"><small>转化缺口参考</small><strong>${Number.isFinite(conversionGapAmount) ? formatWan(conversionGapAmount) : "-"}</strong><span>按本期销售 × 同期转化率差</span></article>
      </section>
      <details class="income-method-note"><summary>口径与时滞说明</summary><div><p><strong>销售到收入转化率</strong>＝不含税收入 ÷ 含税销售额。</p><p>${escapeHtml(INCOME_DATA.meta.timingNote)}</p><p>“转化缺口参考”仅是同口径估算，不等同于可直接追回的实际收入。</p></div></details>
      <section class="content-grid income-content-grid">
        ${panel("② 销售到收入月度节奏", "柱形看销售与不含税收入，折线看累计转化率；单月受审核时滞影响可超过100%", renderIncomeMonthlyChart(monthly), "income-monthly-trend", { className: "span-2" })}
        ${panel("③ 业务部定位", "按转化缺口参考从高到低排列；同时对照转化率、收入和销售规模", `<div class="income-business-ranking">${businessRows}</div>`, "income-business-drivers", { className: "span-2" })}
        ${panel("④ 渠道落点", "销售前8渠道＋其他；主视图优先显示转化、变化、收入、销售和判断", `<div class="income-channel-desktop">${table(["渠道", "本期转化率", "同比变化", "本期收入", "本期销售", "经营判断"], channelDiagnosticRows, 820)}</div><div class="income-channel-mobile">${channelCards}</div><details class="income-detail-disclosure"><summary>查看同期与完整口径</summary>${table(["渠道", "本期销售", "同期销售", "本期收入", "同期收入", "本期转化率", "同期转化率", "同比变化", "经营判断"], channelFullRows, 1180)}</details>`, "income-channel-conversion", { className: "span-2" })}
      </section>
    </div>`;
  }

  function renderChannel() {
    const currentRows = salesForRange(state.start, state.end);
    const priorRows = salesForRange(shiftYear(state.start, -1), shiftYear(state.end, -1));
    const items = ranking(currentRows, priorRows, (row) => dimValue(row, "channel"), 50);
    const businessItems = ranking(currentRows, priorRows, (row) => dimValue(row, "business"), 50);
    const channelRow = (item, className = "") => {
      const indexDelta = Number.isFinite(item.salesIndex) && Number.isFinite(item.prior.salesIndex) ? item.salesIndex - item.prior.salesIndex : NaN;
      const avgPriceYoy = ratioChange(item.avgPrice, item.prior.avgPrice);
      const channelShare = currentTotal.amount ? item.amount / currentTotal.amount : NaN;
      return `<tr${className ? ` class="${escapeHtml(className)}"` : ""}><td>${escapeHtml(item.name)}</td><td>${formatWan(item.amount)}</td><td>${formatRate(channelShare)}</td><td>${formatWan(item.prior.amount)}</td><td class="${signClass(item.yoy)}">${formatSignedPct(item.yoy)}</td><td>${formatInteger(item.qty)}</td><td>${Number.isFinite(item.avgPrice) ? formatCurrency(item.avgPrice) : "-"}</td><td>${Number.isFinite(item.prior.avgPrice) ? formatCurrency(item.prior.avgPrice) : "-"}</td><td class="${signClass(avgPriceYoy)}">${formatSignedPct(avgPriceYoy)}</td><td>${Number.isFinite(item.salesIndex) ? item.salesIndex.toFixed(3) : "-"}</td><td class="${signClass(indexDelta)}">${Number.isFinite(indexDelta) ? `${indexDelta >= 0 ? "+" : ""}${indexDelta.toFixed(3)}` : "-"}</td></tr>`;
    };
    const currentTotal = metricSummary(currentRows);
    const priorTotal = metricSummary(priorRows);
    const totalItem = {
      name: "整体",
      ...currentTotal,
      yoy: ratioChange(currentTotal.amount, priorTotal.amount),
      prior: priorTotal,
    };
    const rows = [
      channelRow(totalItem, "highlight-row"),
      ...items.map((item) => channelRow(item)),
    ];
    const businessRows = businessItems.map((item, index) => {
      const share = currentTotal.amount ? item.amount / currentTotal.amount : NaN;
      const avgPriceYoy = ratioChange(item.avgPrice, item.prior.avgPrice);
      const indexDelta = Number.isFinite(item.salesIndex) && Number.isFinite(item.prior.salesIndex)
        ? item.salesIndex - item.prior.salesIndex : NaN;
      return `<tr${index === 0 ? ' class="highlight-row"' : ""}><td>${index + 1}</td><td>${escapeHtml(item.name)}</td><td>${formatWan(item.amount)}</td><td>${formatRate(share)}</td><td>${formatWan(item.prior.amount)}</td><td class="${signClass(item.yoy)}">${formatSignedPct(item.yoy)}</td><td>${formatInteger(item.qty)}</td><td>${Number.isFinite(item.avgPrice) ? formatCurrency(item.avgPrice) : "-"}</td><td>${Number.isFinite(item.prior.avgPrice) ? formatCurrency(item.prior.avgPrice) : "-"}</td><td class="${signClass(avgPriceYoy)}">${formatSignedPct(avgPriceYoy)}</td><td>${Number.isFinite(item.salesIndex) ? item.salesIndex.toFixed(3) : "-"}</td><td class="${signClass(indexDelta)}">${Number.isFinite(indexDelta) ? `${indexDelta >= 0 ? "+" : ""}${indexDelta.toFixed(3)}` : "-"}</td></tr>`;
    });
    return `<p class="availability-note">当前数据没有成本字段，因此不推算毛利率；同期口径为上年同日期区间。</p>
      <section class="content-grid">
        ${panel("业务部经营排行", "按销售额从高到低排列；展示业务规模、同比、量价和销售指数", table(["排名", "业务部", "销售额", "业务占比", "同期销售", "销售同比", "台量", "均价", "同期均价", "均价同比", "销售指数", "指数净值差"], businessRows, 1320), "business-efficiency-ranking", { className: "span-2" })}
        ${panel("渠道经营效率", "渠道贡献、同期销售与价格指标均来自有效销售数据", table(["渠道", "销售额", "渠道占比", "同期销售", "销售同比", "台量", "均价", "同期均价", "均价同比", "销售指数", "指数净值差"], rows, 1160), "channel-efficiency", { className: "span-2" })}
      </section>`;
  }

  function renderDashboard() {
    updateFilterContext();
    if (state.tab === "overview") content.innerHTML = renderOverview();
    if (state.tab === "category") content.innerHTML = renderCategory();
    if (state.tab === "store") content.innerHTML = renderStore();
    if (state.tab === "core") content.innerHTML = renderCore();
    if (state.tab === "industry") content.innerHTML = renderIndustry();
    if (state.tab === "channel") content.innerHTML = renderChannel();
    if (state.tab === "income") content.innerHTML = renderIncome();
    attachDynamicEvents();
    renderFilterSummary();
    if (aiState.open) renderAiPanel();
  }

  const AI_BUSINESS_CONTEXT_KEY = "WATER_HEATER_AI_BUSINESS_CONTEXT_V47";

  function getSavedAiBusinessContext() {
    const fallback = { currentGoal: "", priorities: "", campaigns: "", constraints: "", notes: "" };
    try {
      const parsed = JSON.parse(localStorage.getItem(AI_BUSINESS_CONTEXT_KEY) || "{}");
      return { ...fallback, ...(parsed && typeof parsed === "object" ? parsed : {}) };
    } catch { return fallback; }
  }

  function saveAiBusinessContext(context) {
    try { localStorage.setItem(AI_BUSINESS_CONTEXT_KEY, JSON.stringify(context)); } catch { /* local memory unavailable */ }
    showToast("经营背景已保存，下一次分析会自动使用");
  }

  function getCurrentDashboardFilters() {
    const selectedValues = (key) => state.selections[key].size === FILTERS[key].options.length ? [] : [...state.selections[key]];
    return {
      startDate: state.start,
      endDate: state.end,
      models: state.tab === "core" && state.selectedModel ? [state.selectedModel] : [],
      series: selectedValues("series"),
      channels: selectedValues("channel"),
      shapes: selectedValues("shape"),
      core: selectedValues("core"),
      positions: selectedValues("position"),
      businesses: selectedValues("business"),
      departments: selectedValues("business"),
      stores: state.tab === "store" && state.storeSelected ? [state.storeSelected] : [],
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
    const products = (filters.models || []).length ? filters.models.join("、") : "全部型号";
    const channels = (filters.channels || []).length ? filters.channels.join("、") : "全部渠道";
    const mode = AI_MODES[meta.mode]?.label || AI_MODES[aiState.mode]?.label || "深度分析";
    const source = meta.source === "deepseek" ? `DeepSeek · ${meta.model || "deepseek-chat"}` : "本地证据分析";
    const review = meta.reviewed ? "已完成二次复核" : "未启用二次复核";
    const queryCount = Number(meta.queryCount || 0);
    return `<div class="ai-message-meta"><span>${escapeHtml(source)}</span><span>${escapeHtml(mode)}</span><span>${escapeHtml(`${filters.startDate || "-"} 至 ${filters.endDate || "-"}`)}</span><span>${escapeHtml(products)}</span><span>${escapeHtml(channels)}</span><span>${queryCount} 项证据查询</span><span>${escapeHtml(review)}</span></div>${meta.warning ? `<p class="ai-message-warning">${escapeHtml(meta.warning)}</p>` : ""}`;
  }

  function renderChatMessage(message) {
    if (message.role === "user") return `<article class="ai-message user"><div class="ai-message-role">你</div><div class="ai-message-body"><p>${escapeHtml(message.content)}</p></div></article>`;
    const followUps = (message.followUps || []).slice(0, 4);
    return `<article class="ai-message assistant ${message.error ? "error" : ""}"><div class="ai-message-role">AI</div><div class="ai-message-body">${formatAiAnswer(message.content)}${followUps.length ? `<div class="ai-followups">${followUps.map((item) => `<button type="button" data-ai-followup="${escapeHtml(item)}">${escapeHtml(item)}</button>`).join("")}</div>` : ""}${message.meta ? renderChatMeta(message.meta) : ""}</div></article>`;
  }

  function renderAiPanel() {
    const aiPanel = document.getElementById("ai-panel");
    const rows = salesForRange(state.start, state.end);
    const chat = aiState.chat || chatController.getState();
    const messages = chat.messages || [];
    const stage = chat.stage || { label: "等待提问", progress: 0 };
    const businessContext = getSavedAiBusinessContext();
    const conversation = messages.length ? messages.map(renderChatMessage).join("") : `<div class="ai-chat-welcome"><strong>把它当作经营分析师来用</strong><p>可以直接问“为什么”“问题在哪”“接下来怎么做”。4.7 会自动拆成多项查询，同时读取销售、奥维和产品索引，并对结论做第二遍复核。</p></div>`;
    const modeButtons = Object.entries(AI_MODES).map(([key, mode]) => `<button type="button" class="ai-mode-button ${aiState.mode === key ? "active" : ""}" data-ai-mode="${key}" ${chat.running ? "disabled" : ""}><strong>${escapeHtml(mode.label)}</strong><span>${escapeHtml(mode.description)}</span></button>`).join("");

    aiPanel.hidden = false;
    aiPanel.innerHTML = `<div class="ai-panel-header">
      <div><p class="eyebrow">GTM AI COPILOT 4.7</p><h2>深度经营分析</h2><p>当前范围 ${escapeHtml(state.start)} 至 ${escapeHtml(state.end)} · ${formatInteger(rows.length)} 条销售记录。你的问题会自动转成多项证据查询。</p></div>
      <div class="ai-panel-actions"><button id="toggleAiContext" class="ghost-action" type="button">${aiState.contextOpen ? "收起经营背景" : "编辑经营背景"}</button><button id="clearAiConversation" class="ghost-action" type="button" ${chat.running ? "disabled" : ""}>清空对话</button><button id="closeAiPanel" class="close-button" type="button">收起AI面板</button></div>
    </div>
    <div class="ai-mode-grid" aria-label="分析模式">${modeButtons}</div>
    <section class="ai-context-editor" ${aiState.contextOpen ? "" : "hidden"}>
      <div class="ai-context-heading"><div><strong>经营背景</strong><p>告诉AI近期目标、活动和约束，结论会更贴近实际业务。</p></div><button type="button" id="saveAiContext" class="ghost-action">保存背景</button></div>
      <div class="ai-context-fields">
        <label>当前目标<input id="aiContextGoal" value="${escapeHtml(businessContext.currentGoal || "")}" placeholder="例如：提升M2系列规模并守住价格"></label>
        <label>优先事项<input id="aiContextPriorities" value="${escapeHtml(businessContext.priorities || "")}" placeholder="例如：京东自营、M1/M2/N核心品"></label>
        <label>近期活动<input id="aiContextCampaigns" value="${escapeHtml(businessContext.campaigns || "")}" placeholder="例如：618返场、上新、渠道补贴"></label>
        <label>业务约束<input id="aiContextConstraints" value="${escapeHtml(businessContext.constraints || "")}" placeholder="例如：不能大幅降价、渠道节奏需稳定"></label>
        <label class="wide">补充说明<textarea id="aiContextNotes" rows="2" placeholder="可填写口径变化、异常订单、渠道特殊情况">${escapeHtml(businessContext.notes || "")}</textarea></label>
      </div>
    </section>
    <div class="ai-scope-bar"><span>数据范围</span><strong>${escapeHtml(state.start)} 至 ${escapeHtml(state.end)}</strong><span>${state.selections.channel.size === FILTERS.channel.options.length ? "全部渠道" : escapeHtml([...state.selections.channel].join("、"))}</span><span>销售 + 奥维 + 产品索引</span><span>会话记忆 ${Math.floor(messages.length / 2)} 轮</span><span>原始明细不发送</span></div>
    ${chat.running ? `<div class="ai-analysis-progress"><div><strong>${escapeHtml(stage.label || "正在分析")}</strong><span>${Math.round(stage.progress || 0)}%</span></div><div class="ai-progress-track"><i style="width:${Math.max(4, Math.min(100, Number(stage.progress || 0)))}%"></i></div></div>` : ""}
    <div class="ai-recommendations" aria-label="推荐问题">${RECOMMENDED_QUESTIONS.map((question) => `<button type="button" data-ai-question="${escapeHtml(question)}" ${chat.running ? "disabled" : ""}>${escapeHtml(question)}</button>`).join("")}</div>
    <section class="ai-chat-log" id="aiChatLog" aria-live="polite">${conversation}${chat.running ? `<div class="ai-thinking"><span class="ai-pulse"></span><span>${escapeHtml(stage.label || "正在分析")}</span></div>` : ""}</section>
    ${chat.error ? `<p class="ai-chat-error">${escapeHtml(chat.error)}</p>` : ""}
    <form class="ai-composer" id="aiComposer">
      <label for="aiQuestion">经营问题</label>
      <textarea id="aiQuestion" rows="4" maxlength="1000" placeholder="例如：结合销售和奥维，诊断本年M1/M2/N核心品增长质量，找出主要驱动、风险和未来30天动作。" ${chat.running ? "disabled" : ""}></textarea>
      <div><span>Enter发送 · Shift+Enter换行</span><button class="ai-action" type="submit" ${chat.running ? "disabled" : ""}>${chat.running ? "分析中…" : "开始深度分析"}</button></div>
    </form>
    <p class="ai-security-note">四阶段分析：理解问题 → 本地多查询取证 → 经营分析 → 独立复核。DeepSeek只接收聚合后的证据包，不接收订单级原始数据；前端不保存API Key。</p>`;

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
    document.getElementById("toggleAiContext").addEventListener("click", () => {
      aiState.contextOpen = !aiState.contextOpen;
      renderAiPanel();
    });
    document.querySelectorAll("[data-ai-mode]").forEach((button) => button.addEventListener("click", () => {
      aiState.mode = button.dataset.aiMode;
      localStorage.setItem("WATER_HEATER_AI_MODE_V47", aiState.mode);
      chatController.setMode(aiState.mode);
    }));
    document.querySelectorAll("[data-ai-question], [data-ai-followup]").forEach((button) => button.addEventListener("click", () => {
      const value = button.dataset.aiQuestion || button.dataset.aiFollowup;
      chatController.ask(value, { mode: aiState.mode });
    }));
    document.getElementById("saveAiContext").addEventListener("click", () => saveAiBusinessContext({
      currentGoal: document.getElementById("aiContextGoal").value.trim(),
      priorities: document.getElementById("aiContextPriorities").value.trim(),
      campaigns: document.getElementById("aiContextCampaigns").value.trim(),
      constraints: document.getElementById("aiContextConstraints").value.trim(),
      notes: document.getElementById("aiContextNotes").value.trim(),
    }));
    const composer = document.getElementById("aiComposer");
    const question = document.getElementById("aiQuestion");
    composer.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = question.value.trim();
      if (!value) { question.focus(); return; }
      chatController.ask(value, { mode: aiState.mode });
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
    const overviewMode = state.tab === "overview";
    const incomeMode = state.tab === "income";
    const industryMode = state.tab === "industry";
    const modelMode = state.tab === "core";
    ["channelFilter", "businessFilter"].forEach((id) => {
      document.getElementById(id).hidden = overviewMode;
    });
    ["shapeFilter", "seriesFilter"].forEach((id) => {
      document.getElementById(id).hidden = overviewMode || incomeMode;
    });
    document.getElementById("positionFilter").hidden = overviewMode || industryMode || incomeMode;
    document.getElementById("coreFilter").hidden = overviewMode || modelMode || incomeMode;
    document.getElementById("resetFilters").hidden = overviewMode;
    document.getElementById("globalFilterPanel").classList.toggle("overview-filter-mode", overviewMode);
    document.getElementById("globalFilterPanel").classList.toggle("income-filter-mode", incomeMode);
    const filterPanel = document.getElementById("globalFilterPanel");
    if (incomeMode && !filterPanel.dataset.incomeCompactInitialized) {
      const body = document.getElementById("filterPanelBody");
      const toggle = document.getElementById("toggleFilters");
      filterPanel.dataset.incomeCompactInitialized = "true";
      body.hidden = true;
      filterPanel.classList.add("collapsed");
      toggle.setAttribute("aria-expanded", "false");
      toggle.textContent = "显示筛选";
    }
    document.body.classList.toggle("overview-active", overviewMode);
    document.body.classList.toggle("income-active", incomeMode);
    document.querySelector("#globalFilterPanel h2").textContent = overviewMode ? "总览截止日" : incomeMode ? "收入筛选" : "全局筛选";
    document.querySelector("#globalFilterPanel .filter-panel-actions > span").textContent = overviewMode ? "固定呈现年累、当月和滚动30天" : incomeMode ? "按完整审核月份、业务部和渠道更新" : "所有模块同步更新";
    document.querySelectorAll('[data-date-preset="last7"], [data-date-preset="last30"]').forEach((button) => { button.hidden = incomeMode; });
    const rangeMin = incomeMode ? incomeDefaultStart : DATA.meta.salesDateMin;
    const rangeMax = incomeMode ? incomeDefaultEnd : DATA.meta.salesDateMax;
    const startInput = document.getElementById("startDate");
    const endInput = document.getElementById("endDate");
    const startField = startInput.closest(".field");
    const endField = endInput.closest(".field");
    const quickDateRow = document.querySelector(".quick-date-row");
    startField.hidden = overviewMode;
    quickDateRow.hidden = overviewMode;
    endField.querySelector("span").textContent = overviewMode ? "分析截止日" : "结束日期";
    startInput.min = rangeMin;
    startInput.max = rangeMax;
    endInput.min = rangeMin;
    endInput.max = rangeMax;
    startInput.value = state.start;
    endInput.value = state.end;
  }

  function renderTabs() {
    const tabs = document.getElementById("tabs");
    tabs.innerHTML = TAB_DEFS.map(([key, label]) => `<button type="button" class="tab-button ${state.tab === key ? "active" : ""}" data-tab="${key}" aria-pressed="${state.tab === key}">${label}</button>`).join("");
    tabs.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => {
      const nextTab = button.dataset.tab;
      switchDateContext(nextTab);
      state.tab = nextTab;
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
    if (state.tab === "overview") {
      const total = overviewRowsForRange(state.start, state.end).length;
      const anchorMonth = state.end.slice(0, 7);
      const monthCovered = targetSummaryForPeriod(`${anchorMonth}-01`, state.end).covered;
      document.getElementById("filterSummary").textContent = `当前明细范围命中 ${formatInteger(total)} 行有效销售记录；顶部销售进度锚定结束日，全年累计至 ${state.end}，当月目标：${monthCovered ? anchorMonth : "未维护"}。`;
      return;
    }
    if (state.tab === "income") {
      const periodStart = monthStartIso(state.start);
      const periodEnd = monthEndIso(state.end) > incomeDefaultEnd ? incomeDefaultEnd : monthEndIso(state.end);
      const salesRows = salesRowsForIncomeRange(periodStart, periodEnd);
      const rows = incomeRowsForRange(incomeCurrent, periodStart, periodEnd);
      const active = ["business", "channel"].filter((key) => state.selections[key].size !== FILTERS[key].options.length).map((key) => FILTERS[key].label);
      document.getElementById("filterSummary").textContent = `收入按完整审核月份统计：${periodStart.slice(0, 7)} 至 ${periodEnd.slice(0, 7)}；命中 ${formatInteger(salesRows.length)} 行销售、${formatInteger(rows.length)} 组收入汇总${active.length ? `；已限制：${active.join("、")}` : "；业务部和渠道均为全部"}。`;
      return;
    }
    if (state.tab === "industry") {
      const { rows, fallback } = oviWindow();
      const lower = Math.min(state.priceLower, state.priceUpper);
      const upper = Math.max(state.priceLower, state.priceUpper);
      document.getElementById("filterSummary").textContent = `当前行业-奥维命中 ${formatInteger(rows.length)} 条聚合记录；自定义价格区间 ${formatInteger(lower)}–${formatInteger(upper)} 元${fallback ? `；日期无对应奥维数据，使用 ${DATA.meta.oviMonthMax}` : ""}。`;
      return;
    }
    if (state.tab === "store") {
      const total = salesForRange(state.start, state.end).length;
      const storeRows = state.storeSelected ? salesForRange(state.start, state.end).filter((row) => storeValue(row) === state.storeSelected) : [];
      document.getElementById("filterSummary").textContent = `当前店铺维度命中 ${formatInteger(total)} 行销售记录；已选择店铺：${state.storeSelected || "无"}；店铺内产品排序：${state.storeSort === "asc" ? "少到多" : "多到少"}；店铺明细 ${formatInteger(storeRows.length)} 行。`;
      return;
    }
    const total = salesForRange(state.start, state.end).length;
    const active = SALES_FILTER_KEYS.filter((key) => state.selections[key].size !== FILTERS[key].options.length).map((key) => FILTERS[key].label);
    document.getElementById("filterSummary").textContent = `当前筛选命中 ${formatInteger(total)} 行销售记录${active.length ? `；已限制：${active.join("、")}` : "；所有分类维度为全部"}。`;
  }

  function resetFilters() {
    state.start = state.tab === "income" ? incomeDefaultStart : defaultStart;
    state.end = state.tab === "income" ? incomeDefaultEnd : maxDate;
    if (state.tab === "income") {
      state.incomeStart = state.start;
      state.incomeEnd = state.end;
    } else {
      state.salesStart = state.start;
      state.salesEnd = state.end;
    }
    state.priceLower = 2000;
    state.priceUpper = 4000;
    state.storeSelected = "";
    state.storeSort = "desc";
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

  function syncDateInputs() {
    document.getElementById("startDate").value = state.start;
    document.getElementById("endDate").value = state.end;
  }

  function setDatePreset(preset) {
    const contextMaxDate = state.tab === "income" ? incomeDefaultEnd : maxDate;
    const contextMinDate = state.tab === "income" ? incomeDefaultStart : DATA.meta.salesDateMin;
    const [year, month] = contextMaxDate.split("-").map(Number);
    if (preset === "month") {
      state.start = `${contextMaxDate.slice(0, 7)}-01`;
      state.end = contextMaxDate;
    } else if (preset === "yearToDate") {
      state.start = `${year}-01-01`;
      state.end = contextMaxDate;
    } else if (preset === "last7") {
      state.start = shiftDays(contextMaxDate, -6);
      state.end = contextMaxDate;
    } else if (preset === "last30") {
      state.start = shiftDays(contextMaxDate, -29);
      state.end = contextMaxDate;
    } else if (preset === "previousMonth") {
      state.start = toIso(new Date(Date.UTC(year, month - 2, 1)));
      state.end = toIso(new Date(Date.UTC(year, month - 1, 0)));
    }
    if (state.tab === "income") {
      state.start = monthStartIso(state.start);
      state.end = monthEndIso(state.end);
    }
    if (state.start < contextMinDate) state.start = contextMinDate;
    if (state.end > contextMaxDate) state.end = contextMaxDate;
    if (state.tab === "income") {
      state.incomeStart = state.start;
      state.incomeEnd = state.end;
    } else {
      state.salesStart = state.start;
      state.salesEnd = state.end;
    }
    syncDateInputs();
    renderDashboard();
  }

  function attachDynamicEvents() {
    document.querySelectorAll("[data-download-panel]").forEach((button) => button.addEventListener("click", () => downloadPanel(button.dataset.downloadPanel)));
    document.querySelectorAll("[data-price-focus-series]").forEach((button) => button.addEventListener("click", () => {
      const benchmark = button.dataset.priceFocusSeries;
      const model = button.dataset.priceFocusModel;
      if (!benchmark || !model || state.priceFocus[benchmark] === model) return;
      state.priceFocus[benchmark] = model;
      renderDashboard();
    }));
    document.querySelectorAll("[data-price-impact-dimension]").forEach((button) => button.addEventListener("click", () => {
      const dimension = button.dataset.priceImpactDimension;
      if (!priceImpactSpec(dimension) || state.priceImpactDimension === dimension) return;
      state.priceImpactDimension = dimension;
      renderDashboard();
    }));
    document.querySelectorAll("[data-price-impact-sort]").forEach((button) => button.addEventListener("click", () => {
      const mode = ["absolute", "positive", "negative"].includes(button.dataset.priceImpactSort) ? button.dataset.priceImpactSort : "absolute";
      if (state.priceImpactSort === mode) return;
      state.priceImpactSort = mode;
      renderDashboard();
    }));
    document.querySelectorAll("[data-toggle-price-impact-detail]").forEach((button) => button.addEventListener("click", () => {
      state.showPriceImpactDetail = !state.showPriceImpactDetail;
      renderDashboard();
    }));
    document.querySelectorAll("[data-price-impact-drill]").forEach((button) => button.addEventListener("click", () => {
      const type = button.dataset.priceImpactDrill;
      const key = button.dataset.priceImpactKey || "";
      if (!key) return;
      if (type === "model") {
        state.tab = "core";
        state.modelScope = "all";
        state.selectedModel = key;
        state.compareModels = [];
      } else if (type === "channel") {
        state.tab = "channel";
        state.selections.channel = new Set([key]);
        renderMultiFilter("channelFilter", "channel");
      } else if (type === "store") {
        state.tab = "store";
        state.storeSelected = key;
      } else return;
      renderTabs();
      renderDashboard();
      requestAnimationFrame(() => document.querySelector(type === "model" ? ".model-control-panel" : type === "store" ? ".store-control-panel" : ".content-grid")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }));
    document.querySelectorAll("[data-model-scope]").forEach((button) => button.addEventListener("click", () => {
      const scope = button.dataset.modelScope === "all" ? "all" : "core";
      if (scope === state.modelScope) return;
      state.modelScope = scope;
      state.selectedModel = "";
      state.compareModels = [];
      renderDashboard();
    }));
    const modelSearch = document.getElementById("modelSearch");
    const modelSelect = document.getElementById("modelSelect");
    if (modelSearch && modelSelect) modelSearch.addEventListener("input", () => {
      const query = modelSearch.value.trim().toLowerCase();
      [...modelSelect.options].forEach((option) => {
        option.hidden = Boolean(query) && !option.textContent.toLowerCase().includes(query);
      });
    });
    if (modelSelect) modelSelect.addEventListener("change", () => {
      state.selectedModel = modelSelect.value;
      state.compareModels = state.compareModels.filter((key) => key !== state.selectedModel);
      renderDashboard();
    });
    const addModelCompare = document.querySelector("[data-add-model-compare]");
    if (addModelCompare) addModelCompare.addEventListener("click", () => {
      const compareSelect = document.getElementById("compareModelSelect");
      const key = compareSelect?.value || "";
      if (!key || key === state.selectedModel || state.compareModels.includes(key) || state.compareModels.length >= 2) return;
      state.compareModels.push(key);
      renderDashboard();
    });
    document.querySelectorAll("[data-remove-model-compare]").forEach((button) => button.addEventListener("click", () => {
      state.compareModels = state.compareModels.filter((key) => key !== button.dataset.removeModelCompare);
      renderDashboard();
    }));
    const allModelSearch = document.getElementById("allModelSearch");
    if (allModelSearch) allModelSearch.addEventListener("input", () => {
      const query = allModelSearch.value.trim().toLowerCase();
      document.querySelectorAll("[data-model-row]").forEach((row) => { row.hidden = !row.dataset.modelRow.includes(query); });
    });
    const categoryModelSearch = document.getElementById("categoryModelSearch");
    if (categoryModelSearch) categoryModelSearch.addEventListener("input", () => {
      const query = categoryModelSearch.value.trim().toLowerCase();
      document.querySelectorAll("[data-category-model-row]").forEach((row) => { row.hidden = !row.dataset.categoryModelRow.includes(query); });
    });
    document.querySelectorAll("[data-open-model-detail]").forEach((button) => button.addEventListener("click", () => {
      state.tab = "core";
      state.modelScope = "all";
      state.selectedModel = button.dataset.openModelDetail;
      state.compareModels = [];
      renderTabs();
      renderDashboard();
      requestAnimationFrame(() => document.querySelector(".model-control-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }));
    document.querySelectorAll("[data-toggle-operating-focus]").forEach((button) => button.addEventListener("click", () => {
      state.showOperatingFocus = !state.showOperatingFocus;
      renderDashboard();
    }));
    document.querySelectorAll("[data-toggle-n1-trend]").forEach((button) => button.addEventListener("click", () => {
      state.n1TrendMetric = state.n1TrendMetric === "amount" ? "qty" : "amount";
      renderDashboard();
      requestAnimationFrame(() => document.querySelector("[data-toggle-n1-trend]")?.focus());
    }));
    document.querySelectorAll("[data-shape-breakdown]").forEach((button) => button.addEventListener("click", () => {
      const mode = button.dataset.shapeBreakdown;
      if (!SHAPE_BREAKDOWN_MODES[mode] || state.shapeBreakdownMode === mode) return;
      state.shapeBreakdownMode = mode;
      state.expandedShapeDetails.clear();
      renderDashboard();
    }));
    document.querySelectorAll("[data-butterfly-split]").forEach((button) => button.addEventListener("click", () => {
      const splitButterfly = button.dataset.butterflySplit === "split";
      if (state.splitButterfly === splitButterfly) return;
      state.splitButterfly = splitButterfly;
      state.expandedShapeDetails.clear();
      renderDashboard();
    }));
    document.querySelectorAll("[data-shape-amount-delta]").forEach((button) => button.addEventListener("click", () => {
      const showShapeAmountDelta = button.dataset.shapeAmountDelta === "show";
      if (state.showShapeAmountDelta === showShapeAmountDelta) return;
      state.showShapeAmountDelta = showShapeAmountDelta;
      renderDashboard();
    }));
    document.querySelectorAll("[data-toggle-shape-detail]").forEach((button) => button.addEventListener("click", () => {
      const name = button.dataset.toggleShapeDetail;
      if (!name) return;
      if (state.expandedShapeDetails.has(name)) state.expandedShapeDetails.delete(name);
      else state.expandedShapeDetails.add(name);
      renderDashboard();
    }));
    const search = document.getElementById("accountingSearch");
    if (search) search.addEventListener("input", () => {
      const query = search.value.trim().toLowerCase();
      document.querySelectorAll("[data-search-row]").forEach((row) => { row.hidden = !row.dataset.searchRow.includes(query); });
    });
    const storeProductSearch = document.getElementById("storeProductSearch");
    if (storeProductSearch) storeProductSearch.addEventListener("input", () => {
      const query = storeProductSearch.value.trim().toLowerCase();
      document.querySelectorAll("[data-search-row]").forEach((row) => { row.hidden = !row.dataset.searchRow.includes(query); });
    });
    const storeSelect = document.getElementById("storeSelect");
    if (storeSelect) storeSelect.addEventListener("change", () => {
      state.storeSelected = storeSelect.value;
      renderDashboard();
    });
    const storeSort = document.getElementById("storeSort");
    if (storeSort) storeSort.addEventListener("change", () => {
      state.storeSort = storeSort.value === "asc" ? "asc" : "desc";
      renderDashboard();
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
      ["2026 政策价行", formatInteger(d.policyAvailableRows2026)],
      ["政策价缺失行", formatInteger(d.missingPolicyRows)],
      ["店铺数量", formatInteger(d.storeCount)],
      ["店铺缺失行", formatInteger(d.missingStoreRows)],
      ["奥维明细", formatInteger(d.oviSourceRows)],
    ];
    document.getElementById("diagnosticGrid").innerHTML = diagnostics.map(([label, value]) => `<div class="diagnostic-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
    document.getElementById("diagnosticNotes").innerHTML = [
      `产品匹配率 ${((d.codeMatched + d.nameMatched) / d.salesValidRows * 100).toFixed(2)}%，未匹配产品 ${d.unmatchedProducts} 个。`,
      `索引表 144 个产品中，系列字段未维护 ${d.missingSeriesProducts} 个；页面统一显示“未分系列”。`,
      "销售指数按销售金额 ÷ 核算价金额合计计算；分母为 0 时显示“-”。",
      `政策价直接取销售明细“通用政策价(元)”字段，覆盖 ${formatInteger(d.policyAvailableRows)} 行。`,
      `店铺维度使用销售 Excel 的“客户名称/客户”字段；渠道字段为“天猫官旗”的方瑞、天猫优品、杭州多宝鱼、上海海亿等客户统一归并为“方太官方旗舰店（天猫）”。原始数据当前有效客户 ${formatInteger(d.storeCount)} 个，缺失 ${formatInteger(d.missingStoreRows)} 行。`,
      `奥维已更新至 ${DATA.meta.oviMonthMax}；单价取奥维“单价”字段，价位段仍按六档左闭右开边界划分。`,
    ].map((note) => `<p>${escapeHtml(note)}</p>`).join("");
  }

  function renderMethodology() {
    const items = [
      ["销售来源", `${DATA.meta.files[1]}；${DATA.meta.files[2]}。有效日期 ${DATA.meta.salesDateMin} 至 ${DATA.meta.salesDateMax}。`],
      ["收入来源", `${INCOME_DATA?.meta?.sources?.join("；") || "未加载"}。当前收入审核覆盖 ${INCOME_DATA?.meta?.incomeMonthMin || "-"} 至 ${INCOME_DATA?.meta?.incomeMonthMax || "-"}。`],
      ["收入转化率", "销售到收入转化率＝不含税收入÷含税销售额。销售按支付时间、收入按审核月份归集，单月可能受审核时滞影响，经营判断以累计口径为主。"],
      ["店铺维度", "店铺取销售 Excel 的客户字段，优先使用“客户名称”，缺失时回退“客户/店铺/客户编号”；渠道为“天猫官旗”的全部客户统一归并为“方太官方旗舰店（天猫）”；店铺内占比为型号销售额 ÷ 所选店铺销售额。"],
      ["产品分类", `${DATA.meta.files[0]}。系列、核心品、形态分类、定位、能效均直接取索引表。`],
      ["政策价来源", "直接取销售明细中的“通用政策价(元)”字段，不再使用旧政策价参照表按月份和产品名称匹配。"],
      ["行业来源", `${DATA.meta.files[4]}。覆盖 ${DATA.meta.oviMonthMin} 至 ${DATA.meta.oviMonthMax}，品牌配置为“${DATA.meta.brand}”。`],
      ["经营目标", `${DATA.meta.files.find((name) => String(name).includes("2026H2")) || "2026H2经营目标模拟器"}。全年目标取“分货盘总览”中热水器合计的26年全年预计；分月目标读取“06_经营模拟”的最终销量与最终销售额。均价与销售指数不设置数值型目标，判断标准均为高于同期。`],
      ["竞品价格", `${DATA.meta.files.find((name) => String(name).includes("价格监控")) || "价格监控.xlsx"}。严格按“18M2系列”和“16M1系列”工作表归类；方太型号价格显示为连续线，其他品牌显示为每日价格点，核心竞品按与所选方太型号的最新价差排序。`],
      ["价位段口径", "奥维单价字段与销额÷销量一致；固定结构分为2000以下、2000–2500、2500–3000、3000–3500、3500–4000、4000以上，自定义区间上下限均包含。"],
      ["同比口径", "销售按上年同期同日；奥维按上年同期月份。分母为0或无同期时显示“-”。"],
      ["销售指数", "销售金额 ÷ 核算价金额合计。原始核算价字段已包含数量影响。"],
      ["运行时派生指标", "价格指数、渠道占比和产品贡献度均由JS实时计算，不写入数据源；因缺少成本字段，不推算毛利。"],
      ["AI分析上下文", "DeepSeek负责查询规划与结果解释；本地引擎执行白名单筛选、聚合、对比和异常计算，仅发送压缩结果，不发送完整原始明细。"],
      ["AI密钥安全", "前端不保存API Key；部署后由Netlify环境变量DEEPSEEK_API_KEY注入Function代理。"],
      ["缺失处理", "成本、费用、渠道目标、目标市占、销售侧升数与区域等未提供字段不推算；收入只展示已审核月份。"],
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
    state.start = state.tab === "income" ? monthStartIso(startInput.value) : startInput.value;
    if (state.start > state.end) { state.end = state.start; endInput.value = state.end; }
    if (state.tab === "income") {
      state.incomeStart = state.start;
      state.incomeEnd = state.end;
      syncDateInputs();
    } else {
      state.salesStart = state.start;
      state.salesEnd = state.end;
    }
    renderDashboard();
  });
  endInput.addEventListener("change", () => {
    state.end = state.tab === "income" ? monthEndIso(endInput.value) : endInput.value;
    if (state.tab === "income" && state.end > incomeDefaultEnd) state.end = incomeDefaultEnd;
    if (state.end < state.start) { state.start = state.end; startInput.value = state.start; }
    if (state.tab === "income") {
      state.incomeStart = state.start;
      state.incomeEnd = state.end;
      syncDateInputs();
    } else {
      state.salesStart = state.start;
      state.salesEnd = state.end;
    }
    renderDashboard();
  });
  document.querySelectorAll("[data-date-preset]").forEach((button) => {
    button.addEventListener("click", () => setDatePreset(button.dataset.datePreset));
  });

  document.getElementById("resetFilters").addEventListener("click", resetFilters);

  const globalFilterPanel = document.getElementById("globalFilterPanel");
  const filterPanelBody = document.getElementById("filterPanelBody");
  const toggleFilters = document.getElementById("toggleFilters");
  toggleFilters.addEventListener("click", () => {
    const shouldHide = !filterPanelBody.hidden;
    filterPanelBody.hidden = shouldHide;
    globalFilterPanel.classList.toggle("collapsed", shouldHide);
    toggleFilters.setAttribute("aria-expanded", String(!shouldHide));
    toggleFilters.textContent = shouldHide ? "显示筛选" : "隐藏筛选";
    if (shouldHide) document.querySelectorAll(".filter-menu").forEach((menu) => { menu.hidden = true; });
  });

  document.getElementById("sourceLine").textContent = `数据快照 ${DATA.meta.generatedAt} · 销售 ${DATA.meta.salesDateMin} 至 ${DATA.meta.salesDateMax} · 收入 ${INCOME_DATA?.meta?.incomeMonthMax || "-"} · 奥维 ${DATA.meta.oviMonthMax || "-"} · 价格 ${DATA.meta.priceMonitorDateMax || "-"}`;
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
  renderDataTools();
  renderDashboard();
})();
