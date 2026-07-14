const text = (value, fallback = "未标注") => {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
};

const numeric = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const uniqueSorted = (values) => [...new Set(values.filter(Boolean))]
  .sort((a, b) => String(a).localeCompare(String(b), "zh-CN"));

const monthOf = (value) => String(value || "").slice(0, 7);

function productDimensions(product = {}) {
  const shape = text(product.shape, "未分类");
  return {
    model: text(product.name || product.code, "未标注型号"),
    productCode: text(product.code, "未标注编码"),
    series: text(product.series, "未分系列"),
    shape,
    newShape: ["通品", "效率品", "未分类"].includes(shape) ? "其他" : shape,
    core: product.core ? "核心品" : "非核心品",
    category: text(product.category, "未分类目"),
    modelClass: text(product.modelClass, "未分类"),
    diffClass: text(product.diffClass, "未分类"),
    position: text(product.position, "未标注定位"),
    level: text(product.level, "未标注等级"),
    efficiency: text(product.efficiency, "未标注能效"),
    energy: text(product.energy, "未标注品类"),
    capacity: text(product.capacity, "未标注升数"),
  };
}

function normalizeSales(rows = []) {
  return rows.map((row) => ({
    dataset: "sales",
    date: row.date,
    month: monthOf(row.date),
    channel: text(row.channel, "未标注渠道"),
    business: text(row.business, "未标注业务部"),
    store: text(row.store, "未标注店铺"),
    amount: numeric(row.amount) ?? 0,
    qty: numeric(row.qty) ?? 0,
    accounting: numeric(row.accounting),
    policy: numeric(row.policy),
    promo: numeric(row.promo),
    ...productDimensions(row.product),
  }));
}

function normalizeOutbound(rows = []) {
  return rows.map((row) => ({
    dataset: "outbound",
    date: row.date,
    month: monthOf(row.date),
    channel: text(row.channel, "未标注渠道"),
    amount: numeric(row.amount) ?? 0,
    qty: numeric(row.qty) ?? 0,
    accounting: numeric(row.accounting),
    ...productDimensions(row.product),
    position: text(row.position || row.product?.position, "未标注定位"),
  }));
}

function normalizeOvi(rows = [], brand = "方太") {
  return rows.map((row) => ({
    dataset: "ovi",
    date: `${row.month}-01`,
    month: row.month,
    brand: text(row.brand, "未标注品牌"),
    model: text(row.model, "未标注型号"),
    volumeSegment: text(row.volumeSegment, "未标注升数段"),
    priceBand: text(row.priceBand, "未标注价位段"),
    unitPrice: numeric(row.unitPrice),
    qty: numeric(row.qty) ?? 0,
    sales: numeric(row.sales) ?? 0,
    isOurBrand: text(row.brand, "未标注品牌") === brand,
  }));
}

export const DIMENSION_DEFINITIONS = Object.freeze({
  date: { label: "日期", datasets: ["sales", "outbound"] },
  month: { label: "月份", datasets: ["sales", "outbound", "ovi"] },
  model: { label: "型号", datasets: ["sales", "outbound", "ovi"] },
  productCode: { label: "产品编码", datasets: ["sales", "outbound"] },
  series: { label: "系列", datasets: ["sales", "outbound"] },
  shape: { label: "原始形态", datasets: ["sales", "outbound"] },
  newShape: { label: "新版形态", datasets: ["sales", "outbound"] },
  core: { label: "核心品", datasets: ["sales", "outbound"] },
  category: { label: "索引分类", datasets: ["sales", "outbound"] },
  position: { label: "产品定位", datasets: ["sales", "outbound"] },
  channel: { label: "渠道", datasets: ["sales", "outbound"] },
  business: { label: "业务部", datasets: ["sales"] },
  store: { label: "店铺", datasets: ["sales"] },
  brand: { label: "品牌", datasets: ["ovi"] },
  priceBand: { label: "价位段", datasets: ["ovi"] },
  volumeSegment: { label: "升数段", datasets: ["ovi"] },
});

export function createSemanticLayer({ sales = [], outbound = [], ovi = [], meta = {} } = {}) {
  const brand = meta.brand || "方太";
  const sources = {
    sales: normalizeSales(sales),
    outbound: normalizeOutbound(outbound),
    ovi: normalizeOvi(ovi, brand),
  };
  const catalog = {};
  Object.keys(DIMENSION_DEFINITIONS).forEach((dimension) => {
    catalog[dimension] = uniqueSorted(Object.values(sources).flatMap((rows) => rows.map((row) => row[dimension])));
  });
  return {
    brand,
    meta: {
      generatedAt: meta.generatedAt || null,
      salesDateMin: meta.salesDateMin || sources.sales[0]?.date || null,
      salesDateMax: meta.salesDateMax || sources.sales.at(-1)?.date || null,
      outboundDateMin: meta.outboundDateMin || sources.outbound[0]?.date || null,
      outboundDateMax: meta.outboundDateMax || sources.outbound.at(-1)?.date || null,
      oviMonthMin: meta.oviMonthMin || sources.ovi[0]?.month || null,
      oviMonthMax: meta.oviMonthMax || sources.ovi.at(-1)?.month || null,
      rowCounts: Object.fromEntries(Object.entries(sources).map(([key, rows]) => [key, rows.length])),
    },
    sources,
    catalog,
    dimensions: DIMENSION_DEFINITIONS,
  };
}

export default createSemanticLayer;
