(async () => {
  if (window.BALANCE_MACHINE_DATA_READY) {
    await window.BALANCE_MACHINE_DATA_READY;
  }

  const data = window.BALANCE_MACHINE_DATA;
  if (!data || data.error) {
    document.body.innerHTML = `<main class="load-error"><strong>看板数据未加载</strong><p>${data?.error || "未找到数据快照"}</p></main>`;
    return;
  }

  const PERIODS = {
    ytd: {
      id: "ytd",
      indices: data.months.map((_, index) => index),
      label: `累计1月1日—${data.asOfMonth}月${data.asOfDay}日`,
      badge: "累计口径",
      description: `累计1月1日—${data.asOfMonth}月${data.asOfDay}日，同期统一取${data.compareYear}年相同日期。`,
    },
    pre: {
      id: "pre",
      indices: [0, 1, 2, 3].filter((index) => index < data.months.length),
      label: "新品前1—4月",
      badge: "新品上市前",
      description: `新品16N1形成销售前的1—4月，对比${data.compareYear}年同期。`,
    },
    post: {
      id: "post",
      indices: data.months.map((_, index) => index).filter((index) => index >= 4),
      label: `新品后5—${data.asOfMonth}月`,
      badge: "新品上市后",
      description: `16N1形成销售后的5月1日—${data.asOfMonth}月${data.asOfDay}日，对比${data.compareYear}年同期。`,
    },
    aug: {
      id: "aug",
      indices: [Math.max(0, data.asOfMonth - 1)],
      label: `${data.asOfMonth}月截至${data.asOfDay}日`,
      badge: `${data.asOfMonth}月短周期`,
      description: `${data.asOfMonth}月仅比较1—${data.asOfDay}日，对比${data.compareYear}年相同日期，不代表完整月结果。`,
    },
  };

  const ROWS = [
    { key: "overall", name: "平衡机整体", note: "三型号合计", models: ["D16E2", "D13E2", "16N1"], color: "brand" },
    { key: "cap16", name: "16升盘", note: "D16E2 + 16N1", models: ["D16E2", "16N1"], color: "gold" },
    { key: "16N1", name: "新品16N1", note: "2026年5月形成销售", models: ["16N1"], color: "brand" },
    { key: "D16E2", name: "D16E2", note: "16升存量型号", models: ["D16E2"], color: "blue" },
    { key: "D13E2", name: "D13E2", note: "13升型号", models: ["D13E2"], color: "teal" },
  ];

  const number = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });
  const percent = new Intl.NumberFormat("zh-CN", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    signDisplay: "exceptZero",
  });

  const sum = (values) => values.reduce((total, value) => total + value, 0);

  const amountLabel = (value) => `${(value / 10000).toFixed(1)}万`;
  const deltaLabel = (value) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value / 10000).toFixed(1)}万`;
  const changeLabel = (value) => `${value >= 0 ? "净增" : "净减"}${amountLabel(Math.abs(value))}`;
  const yoyLabel = (current, previous) => {
    if (previous <= 0) return current > 0 ? "新增" : "—";
    return `同比 ${percent.format(current / previous - 1)}`;
  };

  function metricsFor(row, period) {
    const months = period.indices.map((index) => data.months[index]);
    const amount2026 = sum(
      months.flatMap((month) => row.models.map((model) => month.models[model].amount2026)),
    );
    const amount2025 = sum(
      months.flatMap((month) => row.models.map((model) => month.models[model].amount2025)),
    );
    const qty2026 = sum(
      months.flatMap((month) => row.models.map((model) => month.models[model].qty2026)),
    );
    const qty2025 = sum(
      months.flatMap((month) => row.models.map((model) => month.models[model].qty2025)),
    );
    const trend = months.map((month) => ({
      label: month.label,
      value: sum(row.models.map((model) => month.models[model].amount2026)),
    }));
    return {
      amount2026,
      amount2025,
      qty2026,
      qty2025,
      delta: amount2026 - amount2025,
      yoy: amount2025 > 0 ? amount2026 / amount2025 - 1 : null,
      trend,
    };
  }

  function statusFor(row, metrics) {
    if (row.key === "16N1") {
      return metrics.amount2026 > 0
        ? { label: "新品放量", tone: "positive" }
        : { label: "尚未销售", tone: "neutral" };
    }
    if (row.key === "D13E2" && metrics.amount2025 <= 0 && metrics.amount2026 > 0) {
      return { label: "由负转正", tone: "positive" };
    }
    if (row.key === "D13E2" && metrics.yoy !== null && metrics.yoy > 1) {
      return { label: "低基增长", tone: "positive" };
    }
    if (metrics.yoy === null) return { label: "缺少基数", tone: "neutral" };
    if (metrics.yoy >= 0.1) return { label: row.key === "overall" ? "规模增长" : "结构增长", tone: "positive" };
    if (metrics.yoy > -0.05) return { label: "基本持平", tone: "warning" };
    if (metrics.yoy > -0.2) return { label: "小幅承压", tone: "warning" };
    return { label: row.key === "D16E2" ? "存量下滑" : "规模承压", tone: "negative" };
  }

  function growthPhrase(value) {
    if (value === null) return "缺少可比基数";
    if (value > 0.05) return `增长${percent.format(value)}`;
    if (value < -0.05) return `下降${percent.format(Math.abs(value)).replace("+", "")}`;
    return `基本持平（${percent.format(value)}）`;
  }

  function briefFor(period, allMetrics) {
    const overall = allMetrics.get("overall");
    const cap16 = allMetrics.get("cap16");
    const newProduct = allMetrics.get("16N1");
    const d16 = allMetrics.get("D16E2");
    const d13 = allMetrics.get("D13E2");
    const newShare = overall.amount2026 ? newProduct.amount2026 / overall.amount2026 : 0;
    if (period.id === "post") {
      const overallYoy = overall.yoy === null ? "—" : percent.format(overall.yoy);
      const cap16Yoy = cap16.yoy === null ? "—" : percent.format(cap16.yoy);
      return {
        title: `① 5月1日—${data.asOfMonth}月${data.asOfDay}日整体有效销售额${amountLabel(overall.amount2026)}元，同比 ${overallYoy}；16升合计${amountLabel(cap16.amount2026)}元，同比 ${cap16Yoy}，新品上市后16升盘实现扩张。`,
        detail: `② 16N1新增${amountLabel(newProduct.amount2026)}元，占当期销售${percent.format(newShare).replace("+", "")}；抵消D16E2减少${amountLabel(Math.abs(d16.delta))}元后，16升盘仍${changeLabel(cap16.delta)}元，16N1是核心增量来源。`,
        period,
      };
    }
    const overallPhrase = overall.yoy === null ? "缺少可比基数" : `同比${percent.format(overall.yoy)}`;
    const newPhrase = newProduct.amount2026 > 0
      ? `16N1占比${percent.format(newShare).replace("+", "")}`
      : "16N1尚未形成销售";
    const title = `整体${overallPhrase}，16升合计${growthPhrase(cap16.yoy)}；${newPhrase}。`;
    const detail = newProduct.amount2026 > 0
      ? `新品新增${amountLabel(newProduct.amount2026)}，D16E2变动${deltaLabel(d16.delta)}，D13E2变动${deltaLabel(d13.delta)}；整体${changeLabel(overall.delta)}。`
      : `D16E2变动${deltaLabel(d16.delta)}，D13E2变动${deltaLabel(d13.delta)}；整体${changeLabel(overall.delta)}。`;
    return { title, detail, period };
  }

  function trendMarkup(points, color) {
    const max = Math.max(...points.map((point) => point.value), 0);
    const bars = points
      .map((point) => {
        const height = max > 0 ? Math.max(7, (point.value / max) * 42) : 4;
        return `<i class="spark-bar spark-bar--${color}" style="height:${height.toFixed(1)}px" title="${point.label}：${amountLabel(point.value)}" aria-label="${point.label} ${amountLabel(point.value)}"></i>`;
      })
      .join("");
    return `<div class="spark-bars" role="img" aria-label="月度销售额变化">${bars}</div>`;
  }

  function renderRows(period, allMetrics) {
    const overall = allMetrics.get("overall");
    return ROWS.map((row) => {
      const metrics = allMetrics.get(row.key);
      const share = overall.amount2026 ? metrics.amount2026 / overall.amount2026 : 0;
      const status = statusFor(row, metrics);
      const deltaSub = metrics.amount2025 > 0 ? "较同期" : metrics.amount2026 > 0 ? "无可比基数" : "无变化";
      return `
        <tr class="matrix-row matrix-row--${row.color}">
          <th scope="row" data-label="对象">
            <span class="row-accent" aria-hidden="true"></span>
            <span class="object-name"><strong>${row.name}</strong><small>${row.note}</small></span>
          </th>
          <td data-label="2026销售额">
            <strong class="metric-primary">${amountLabel(metrics.amount2026)}</strong>
            <small class="metric-change ${metrics.yoy !== null && metrics.yoy >= 0 ? "is-positive" : metrics.yoy !== null ? "is-negative" : ""}">${yoyLabel(metrics.amount2026, metrics.amount2025)}</small>
          </td>
          <td data-label="2025同期">
            <strong class="metric-secondary">${amountLabel(metrics.amount2025)}</strong>
            <small>2025年同口径</small>
          </td>
          <td data-label="增量">
            <strong class="metric-secondary ${metrics.delta >= 0 ? "is-positive" : "is-negative"}">${deltaLabel(metrics.delta)}</strong>
            <small>${deltaSub}</small>
          </td>
          <td data-label="2026销量">
            <strong class="metric-secondary">${number.format(metrics.qty2026)}台</strong>
            <small>${metrics.qty2025 > 0 ? `同期${number.format(metrics.qty2025)}台` : "同期无销量"}</small>
          </td>
          <td data-label="销售额占比">
            <strong class="metric-secondary">${percent.format(share).replace("+", "")}</strong>
            <small>${row.key === "overall" ? "三型号整体" : "当前周期结构"}</small>
          </td>
          <td data-label="月度变化">${trendMarkup(metrics.trend, row.color)}</td>
          <td data-label="经营判断"><span class="status-tag status-tag--${status.tone}">${status.label}</span></td>
        </tr>
      `;
    }).join("");
  }

  function setText(selector, value) {
    const element = document.querySelector(selector);
    if (element) element.textContent = value;
  }

  function render(periodId) {
    const period = PERIODS[periodId] || PERIODS.ytd;
    const allMetrics = new Map(ROWS.map((row) => [row.key, metricsFor(row, period)]));
    const overall = allMetrics.get("overall");
    const newProduct = allMetrics.get("16N1");
    const cap16 = allMetrics.get("cap16");
    const cap13 = allMetrics.get("D13E2");
    const newShare = overall.amount2026 ? newProduct.amount2026 / overall.amount2026 : 0;
    const cap16Share = overall.amount2026 ? cap16.amount2026 / overall.amount2026 : 0;
    const cap13Share = overall.amount2026 ? cap13.amount2026 / overall.amount2026 : 0;

    const brief = briefFor(period, allMetrics);
    setText("[data-brief-period]", period.label);
    setText("[data-brief-title]", brief.title);
    setText("[data-brief-detail]", brief.detail);
    setText("[data-period-badge]", period.badge);
    setText("[data-period-description]", period.description);
    setText("[data-as-of]", data.asOf);
    setText("[data-kpi-sales]", amountLabel(overall.amount2026));
    setText("[data-kpi-sales-note]", `同期${amountLabel(overall.amount2025)}`);
    setText("[data-kpi-yoy]", overall.yoy === null ? "—" : percent.format(overall.yoy));
    setText("[data-kpi-yoy-note]", changeLabel(overall.delta));
    setText("[data-kpi-new-share]", percent.format(newShare).replace("+", ""));
    setText("[data-kpi-new-note]", newProduct.amount2026 > 0 ? `新增${amountLabel(newProduct.amount2026)}` : "尚未形成销售");
    setText("[data-kpi-capacity]", `${percent.format(cap16Share).replace("+", "")} / ${percent.format(cap13Share).replace("+", "")}`);
    setText(
      "[data-kpi-capacity-note]",
      cap16.yoy === null ? "16升缺少同期基数" : `16升同比${percent.format(cap16.yoy)}`,
    );
    setText("[data-trend-title]", period.id === "ytd" ? "1—8月变化" : `${period.label}变化`);
    setText("[data-matrix-foot]", `${period.label}：月度柱高按每行自身峰值归一化，仅用于看变化形态；鼠标悬停可查看当月销售额。`);

    const d16 = allMetrics.get("D16E2");
    const d13 = allMetrics.get("D13E2");
    const d13Evidence = d13.delta > 0
      ? `D13E2贡献${deltaLabel(d13.delta)}增量`
      : d13.delta < 0
        ? `D13E2同比减少${amountLabel(Math.abs(d13.delta))}`
        : "D13E2与同期持平";
    let evidenceTitle = overall.delta >= 0
      ? Math.abs(cap16.yoy ?? 1) <= 0.05
        ? `整体增长并非来自16升盘扩张：16N1新增基本对冲D16E2下滑，${d13Evidence}`
        : `本周期整体${changeLabel(overall.delta)}，16N1是最主要的新增来源；${d13Evidence}`
      : `本周期整体${changeLabel(overall.delta)}，主要缺口来自D16E2；${d13Evidence}${d13.delta > 0 ? "，部分对冲下滑" : ""}`;
    let evidenceDetail = "";
    if (period.id === "post") {
      const overallYoy = overall.yoy === null ? "—" : percent.format(overall.yoy);
      const cap16Yoy = cap16.yoy === null ? "—" : percent.format(cap16.yoy);
      evidenceTitle = `新品上市后，平衡机销售${amountLabel(overall.amount2026)}元、同比${overallYoy}；16升销售${amountLabel(cap16.amount2026)}元、同比${cap16Yoy}，16升盘实现扩张。`;
      evidenceDetail = `16N1销售${amountLabel(newProduct.amount2026)}元、占比${percent.format(newShare).replace("+", "")}，带动16升${changeLabel(cap16.delta)}元，是核心增量来源。`;
    }
    setText("[data-evidence-title]", evidenceTitle);
    setText("[data-evidence-detail]", evidenceDetail);
    setText("[data-evidence-d16]", deltaLabel(d16.delta));
    setText("[data-evidence-new]", deltaLabel(newProduct.delta));
    setText("[data-evidence-d13]", deltaLabel(d13.delta));
    setText("[data-evidence-total-label]", overall.delta >= 0 ? "整体净增" : "整体净减");
    setText("[data-evidence-overall]", deltaLabel(overall.delta));

    const evidenceDetailElement = document.querySelector("[data-evidence-detail]");
    if (evidenceDetailElement) evidenceDetailElement.hidden = !evidenceDetail;
    document.querySelector("[data-evidence-list]")?.classList.toggle("is-single", !evidenceDetail);

    document.querySelectorAll("[data-evidence-d16], [data-evidence-new], [data-evidence-d13], [data-evidence-overall]").forEach((element) => {
      const value = element.textContent || "";
      element.classList.toggle("is-positive", value.startsWith("+"));
      element.classList.toggle("is-negative", value.startsWith("−"));
    });

    const body = document.querySelector("[data-matrix-body]");
    if (body) body.innerHTML = renderRows(period, allMetrics);

    document.querySelectorAll("[data-period]").forEach((button) => {
      const active = button.dataset.period === period.id;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
  }

  document.querySelectorAll("[data-period]").forEach((button) => {
    button.addEventListener("click", () => render(button.dataset.period));
  });
  document.querySelectorAll("[data-period]").forEach((button) => {
    const period = PERIODS[button.dataset.period];
    if (period) button.textContent = period.label;
  });
  document.querySelector("[data-print]")?.addEventListener("click", () => window.print());

  render("ytd");
})();
