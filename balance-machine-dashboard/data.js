window.BALANCE_MACHINE_DATA_READY = (async () => {
  if (window.WATER_HEATER_DATA_READY) {
    await window.WATER_HEATER_DATA_READY;
  }

  const source = window.WATER_HEATER_DATA;
  if (!source?.sales?.length || !source?.products?.length) {
    window.BALANCE_MACHINE_DATA = { error: "统一销售数据快照未加载" };
    return window.BALANCE_MACHINE_DATA;
  }

  const MODEL_CODES = {
    D16E2: "1004000900013",
    D13E2: "1004000500236",
    "16N1": "1004001800005",
  };
  const MODEL_KEYS = Object.keys(MODEL_CODES);
  const productField = Object.fromEntries(source.productFields.map((field, index) => [field, index]));
  const salesField = Object.fromEntries(source.salesFields.map((field, index) => [field, index]));
  const productIdsByModel = new Map(MODEL_KEYS.map((model) => [model, new Set()]));

  source.products.forEach((product, productId) => {
    const code = String(product[productField.code] ?? "");
    MODEL_KEYS.forEach((model) => {
      if (code === MODEL_CODES[model]) productIdsByModel.get(model).add(productId);
    });
  });

  const modelByProductId = new Map();
  productIdsByModel.forEach((productIds, model) => {
    productIds.forEach((productId) => modelByProductId.set(productId, model));
  });

  const asOf = source.meta?.salesDateMax || "";
  const [asOfYear, asOfMonth, asOfDay] = asOf.split("-").map(Number);
  const compareYear = asOfYear - 1;
  const months = Array.from({ length: asOfMonth }, (_, index) => {
    const month = index + 1;
    return {
      month,
      label: month === asOfMonth ? `${month}月1—${asOfDay}日` : `${month}月`,
      models: Object.fromEntries(
        MODEL_KEYS.map((model) => [
          model,
          { amount2025: 0, qty2025: 0, amount2026: 0, qty2026: 0 },
        ]),
      ),
    };
  });

  source.sales.forEach((row) => {
    const model = modelByProductId.get(Number(row[salesField.productId]));
    if (!model) return;
    const date = String(row[salesField.date] ?? "");
    const [year, month, day] = date.split("-").map(Number);
    if (![compareYear, asOfYear].includes(year)) return;
    if (month < 1 || month > asOfMonth) return;
    if (month === asOfMonth && day > asOfDay) return;
    const target = months[month - 1].models[model];
    const suffix = year === asOfYear ? "2026" : "2025";
    target[`amount${suffix}`] += Number(row[salesField.amount] || 0);
    target[`qty${suffix}`] += Number(row[salesField.qty] || 0);
  });

  window.BALANCE_MACHINE_DATA = {
    asOf,
    asOfYear,
    compareYear,
    asOfMonth,
    asOfDay,
    generatedAt: source.meta?.generatedAt || "",
    source: {
      2025: "热水器25年有效销售.xlsx",
      2026: "26年有效销售数据.xlsx",
    },
    definitions: {
      newProduct: "16N1",
      capacity16: "D16E2 + 16N1",
      capacity13: "D13E2",
      metric: "有效销售额",
    },
    months,
  };
  return window.BALANCE_MACHINE_DATA;
})();
