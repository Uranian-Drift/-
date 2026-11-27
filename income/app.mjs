const percent = new Intl.NumberFormat("zh-CN", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
const signedPercent = new Intl.NumberFormat("zh-CN", { style: "percent", signDisplay: "exceptZero", minimumFractionDigits: 1, maximumFractionDigits: 1 });
const money = new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signedMoney = new Intl.NumberFormat("zh-CN", { signDisplay: "exceptZero", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const amountLabel = (amount) => amount === null ? "—" : money.format(amount / 10000);
const rateLabel = (rate) => rate === null ? "—" : percent.format(rate);
const divide = (amount, base) => amount !== null && base > 0 ? amount / base : null;
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);

const PLATFORM_GROUPS = [
  { name: "规模型平台", platforms: [
    { name: "京东纯零售", channels: ["京东自营纯零售", "京东纯零售", "京东POP", "京东POP代销", "京东自营代销", "京东代销"], note: "已识别渠道 · 京东自营待拆分" },
    { name: "淘宝", channels: ["淘宝业务", "天猫官旗", "天猫品旗", "天猫代销", "天猫自营", "天猫优品"], note: "含天猫及淘宝渠道" },
  ] },
  { name: "发展型平台", platforms: [
    { name: "抖音、小红书、视频号、快手", channels: ["抖音直营", "抖音代销", "抖音官旗", "抖音代运营", "小红书", "微信视频号", "快手", "快手官旗", "快手代销"] },
  ] },
  { name: "伴随型平台", platforms: [
    { name: "拼多多", channels: ["拼多多"] },
    { name: "唯品会", channels: ["唯品会"] },
    { name: "E商城", channels: ["E商城"] },
  ] },
  { name: "管控型平台", platforms: [
    { name: "京东企业购", channels: ["京东企业购", "京东自营企业购"], noteWhenMissing: "财务明细待拆分" },
    { name: "销售拓展", channels: ["新平台", "社群", "电购", "有赞", "国美"] },
    { name: "苏宁业务", channels: ["苏宁业务", "苏宁自营", "苏宁POP", "天猫苏宁"] },
  ] },
];

function monthsBetween(start, end) {
  const cursor = new Date(`${start}-01T00:00:00Z`);
  const months = [];
  for (let month = start; month <= end; month = cursor.toISOString().slice(0, 7)) {
    months.push(month);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

function monthEnd(month) {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
}

function monthPeriod(months) {
  if (!months.length) return "—";
  if (months.length === 1) return months[0];
  const continuous = monthsBetween(months[0], months.at(-1)).length === months.length;
  return continuous ? `${months[0]} 至 ${months.at(-1)}` : months.join("、");
}

function metricPeriod(months) {
  const [year, first] = months[0].split("-").map(Number);
  const [lastYear, last] = months.at(-1).split("-").map(Number);
  if (year !== lastYear || months.length !== last - first + 1) return monthPeriod(months);
  return first === last ? `${year}年${first}月` : `${year}年${first}–${last}月`;
}

function indexMonthly(rows) {
  const index = new Map();
  for (const [month, channel, amount] of rows) {
    if (!index.has(month)) index.set(month, new Map());
    const channels = index.get(month);
    channels.set(channel, (channels.get(channel) ?? 0) + amount);
  }
  return index;
}

function sumAmounts(amounts) {
  const recorded = amounts.filter((amount) => amount !== undefined);
  return recorded.length ? recorded.reduce((total, amount) => total + amount, 0) : null;
}

function incomeByName(index, months) {
  const result = new Map();
  for (const month of months) {
    for (const [name, amount] of index.get(month) ?? []) {
      result.set(name, (result.get(name) ?? 0) + amount);
    }
  }
  return result;
}

function summarizeChanges(income, departments, months) {
  const priorMonths = months.map((month) => `${Number(month.slice(0, 4)) - 1}${month.slice(4)}`);
  const comparable = priorMonths.length && priorMonths.every((month) => income.has(month));
  const priorPeriod = comparable ? priorMonths : [];
  const channelNow = incomeByName(income, months);
  const channelPrior = incomeByName(income, priorPeriod);
  const departmentNow = incomeByName(departments, months);
  const departmentPrior = incomeByName(departments, priorPeriod);
  const channelNames = [...new Set([...channelNow.keys(), ...channelPrior.keys()])];
  const allIncome = sumAmounts([...channelNow.values()]);

  function change(current, prior) {
    const delta = current !== null && prior !== null ? current - prior : null;
    return { current, prior, delta, yoy: divide(delta, prior), share: divide(current, allIncome) };
  }
  function channelChange(names) {
    return change(sumAmounts(names.map((name) => channelNow.get(name))), sumAmounts(names.map((name) => channelPrior.get(name))));
  }

  const departmentRows = [...new Set([...departmentNow.keys(), ...departmentPrior.keys()])]
    .map((name) => ({ name, ...change(departmentNow.get(name) ?? null, departmentPrior.get(name) ?? null) }))
    .sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0) || (b.current ?? 0) - (a.current ?? 0) || a.name.localeCompare(b.name, "zh-CN"));
  const classified = new Set(PLATFORM_GROUPS.flatMap((group) => group.platforms.flatMap((platform) => platform.channels)));
  const pendingRetail = { name: "京东自营（纯零售与企业购待拆分）", channels: ["京东自营"] };
  const other = channelNames.filter((name) => name !== "京东自营" && !classified.has(name));
  const pendingGroup = { name: "待拆分或归类", platforms: [pendingRetail, { name: "其他未归类渠道", channels: other }] };
  const platformGroups = [...PLATFORM_GROUPS, pendingGroup].map(({ name, platforms }) => ({
    name,
    ...channelChange(platforms.flatMap((platform) => platform.channels)),
    platforms: platforms.map((platform) => {
      const values = channelChange(platform.channels);
      return {
        name: platform.name, ...values,
        note: platform.note ?? (values.current === null ? platform.noteWhenMissing : undefined),
      };
    }),
  }));
  return { months, priorMonths: priorPeriod, total: channelChange(channelNames), departmentRows, platformGroups };
}

export function createIncomeModel(snapshot, sales, salesDateMin, salesDateMax) {
  const incomeByMonth = indexMonthly(snapshot.rows);
  const departmentByMonth = indexMonthly(snapshot.departments ?? []);
  const salesByMonth = indexMonthly(sales.map((row) => [row.date.slice(0, 7), row.channel?.trim() || "未标注", row.amount]));
  const incomeMonths = [...incomeByMonth.keys()].sort();
  const firstMonth = [salesDateMin.slice(0, 7), incomeMonths[0]].sort()[0];
  const lastMonth = [salesDateMax.slice(0, 7), incomeMonths.at(-1)].sort().at(-1);
  const months = monthsBetween(firstMonth, lastMonth);
  const salesComplete = (month) => `${month}-01` >= salesDateMin && monthEnd(month) <= salesDateMax;
  const comparable = (month) => salesComplete(month) && incomeByMonth.has(month);
  const defaultEnd = months.filter((month) => month <= snapshot.reviewedThrough && comparable(month)).at(-1)
    ?? months.find(comparable) ?? months.at(-1);
  const defaultStart = months.find((month) => month.slice(0, 4) === defaultEnd.slice(0, 4));
  const annualChannels = new Map();
  for (const month of months.filter(comparable)) {
    const year = month.slice(0, 4);
    if (!annualChannels.has(year)) annualChannels.set(year, { sales: new Set(), income: new Set() });
    const yearChannels = annualChannels.get(year);
    for (const channel of salesByMonth.get(month)?.keys() ?? []) yearChannels.sales.add(channel);
    for (const channel of incomeByMonth.get(month).keys()) yearChannels.income.add(channel);
  }

  // 2025 income used one 京东代销 category while sales split the consignment categories.
  const legacyJd = new Set(["京东自营", "京东自营代销", "京东POP", "京东POP代销", "京东代销"]);
  function hasChannelMismatch(month, channel) {
    if (!channel || !comparable(month)) return false;
    if (!salesByMonth.get(month)?.has(channel) && !incomeByMonth.get(month)?.has(channel)) return false;
    const year = month.slice(0, 4);
    const coverage = annualChannels.get(year);
    return channel === "未标注" || (year === "2025" && legacyJd.has(channel))
      || !coverage.sales.has(channel) || !coverage.income.has(channel);
  }

  function amountsFor(period, scope) {
    const salesAmounts = [];
    const incomeAmounts = [];
    for (const month of period) {
      const s = salesByMonth.get(month);
      const i = incomeByMonth.get(month);
      if (scope) {
        for (const channel of scope) {
          salesAmounts.push(s?.get(channel));
          incomeAmounts.push(i?.get(channel));
        }
      } else {
        salesAmounts.push(...(s?.values() ?? []));
        incomeAmounts.push(...(i?.values() ?? []));
      }
    }
    return { sales: sumAmounts(salesAmounts), income: sumAmounts(incomeAmounts) };
  }

  function analyze(start, end, channel, scope = null) {
    const selected = months.filter((month) => month >= start && month <= end);
    const matched = selected.filter(comparable);
    const unmatched = selected.filter((month) => !comparable(month));
    const period = matched.length ? matched : selected;
    const all = amountsFor(period, null);
    const total = scope ? amountsFor(period, scope) : all;
    const channelNames = (range) => new Set(range.flatMap((month) => [
      ...(salesByMonth.get(month)?.keys() ?? []), ...(incomeByMonth.get(month)?.keys() ?? []),
    ]));
    const channels = channelNames(period);
    const visible = (name) => !scope || scope.has(name);
    const rows = [...channels].filter(visible).map((name) => {
      const { sales, income } = amountsFor(period, [name]);
      const salesShare = divide(sales, all.sales);
      const incomeShare = divide(income, all.income);
      const mismatch = matched.some((month) => hasChannelMismatch(month, name));
      const canCompare = matched.length && !mismatch;
      return {
        name, sales, income, salesShare, incomeShare, mismatch,
        rate: canCompare ? divide(income, sales) : null,
        delta: canCompare && salesShare !== null && incomeShare !== null ? incomeShare - salesShare : null,
      };
    }).sort((a, b) => (b.income ?? -Infinity) - (a.income ?? -Infinity) || (b.sales ?? 0) - (a.sales ?? 0) || a.name.localeCompare(b.name, "zh-CN"));

    const availableChannels = [...channelNames(selected)].sort((a, b) => a.localeCompare(b, "zh-CN"));
    const trendChannels = availableChannels.filter(visible);
    const focus = trendChannels.includes(channel) ? channel : "";
    const trendScope = focus ? [focus] : scope;
    const isMismatched = (month, names) => names && [...names].some((name) => hasChannelMismatch(month, name));
    const mismatch = matched.some((month) => isMismatched(month, scope));
    const monthly = selected.map((month) => {
      const { sales, income } = amountsFor([month], trendScope);
      const mismatch = isMismatched(month, trendScope);
      return {
        month, sales, income, mismatch,
        rate: comparable(month) && !mismatch ? divide(income, sales) : null,
        pendingIncome: !incomeByMonth.has(month),
        pendingClose: incomeByMonth.has(month) && month > snapshot.reviewedThrough,
        incompleteSales: !salesComplete(month),
      };
    });
    const salesShare = divide(total.sales, all.sales);
    const incomeShare = divide(total.income, all.income);
    const canCompare = matched.length && !mismatch;
    return {
      rows,
      total: {
        ...total, salesShare, incomeShare, mismatch,
        rate: canCompare ? divide(total.income, total.sales) : null,
        delta: canCompare && salesShare !== null && incomeShare !== null ? incomeShare - salesShare : null,
      },
      monthly, matched, availableChannels, trendChannels, focus,
      pendingIncome: selected.filter((month) => !incomeByMonth.has(month)),
      pendingClose: selected.filter((month) => incomeByMonth.has(month) && month > snapshot.reviewedThrough),
      salesOutsideComparison: matched.length ? amountsFor(unmatched, scope).sales : null,
    };
  }

  const incomeChanges = (start, end) => summarizeChanges(incomeByMonth, departmentByMonth, incomeMonths.filter((month) => month >= start && month <= end));
  return {
    months, defaultStart, defaultEnd, latestIncome: incomeMonths.at(-1),
    lastClosedMonth: incomeMonths.filter((month) => month <= snapshot.reviewedThrough).at(-1),
    analyze, incomeChanges,
  };
}

function metric(title, value, detail) {
  return `<article class="income-metric"><span>${title}</span><strong>${value}</strong><small>${detail}</small></article>`;
}

function shareCell(value) {
  if (value === null) return "—";
  const width = Math.max(0, Math.min(value, 1)) * 100;
  return `<span class="income-share-value">${rateLabel(value)}<span class="income-share-track" aria-hidden="true"><i style="width:${width}%"></i></span></span>`;
}

function pointLabel(delta) {
  if (delta === null) return "—";
  const points = Math.round(delta * 1000) / 10;
  return `${points > 0 ? "+" : ""}${points.toFixed(1)} 个百分点`;
}

function channelTable(view, selected, scopeLabel, expanded) {
  const { total, rows } = view;
  const amounts = (row) => `<td>${amountLabel(row.sales)}</td><td>${amountLabel(row.income)}</td><td>${rateLabel(row.rate)}</td><td>${shareCell(row.incomeShare)}</td>
    ${expanded ? `<td>${rateLabel(row.salesShare)}</td><td>${pointLabel(row.delta)}</td>` : ""}`;
  return `<table class="income-table income-channel-table${expanded ? " income-extra-columns" : ""}">
    <thead><tr><th scope="col">渠道</th><th scope="col">销售额</th><th scope="col">收入额</th><th scope="col">转收入率</th><th scope="col">收入占比</th>${expanded ? '<th scope="col">销售占比</th><th scope="col">占比差</th>' : ""}</tr></thead>
    <tbody><tr class="income-total"><th scope="row">${scopeLabel}${total.mismatch ? "<small>渠道口径待核</small>" : ""}</th>${amounts(total)}</tr>
    ${rows.map((row) => {
      const name = escapeHtml(row.name);
      const note = row.mismatch ? '<small>渠道口径待核</small>' : "";
      const active = selected === row.name;
      return `<tr${active ? ' class="income-selected"' : ""}><th scope="row"><button type="button" class="income-channel-button" data-income-channel="${name}" aria-expanded="${active}" aria-controls="income-trend">${name}</button>${note}</th>${amounts(row)}</tr>`;
    }).join("")}</tbody>
  </table>`;
}

function monthlyTable(monthly) {
  const amounts = monthly.flatMap(({ sales, income }) => [sales, income]).filter((value) => value !== null);
  const low = Math.min(0, ...amounts);
  const high = Math.max(0, ...amounts);
  const span = high - low || 1;
  const zero = -low / span * 100;
  const bar = (value, type) => {
    const start = (Math.min(value, 0) - low) / span * 100;
    const width = Math.abs(value) / span * 100;
    return `<td><div class="income-month-amount"><span>${amountLabel(value)}</span><span class="income-month-track" style="--income-zero:${zero}%" aria-hidden="true">${value === null ? "" : `<i class="${type}" style="left:${start}%;width:${width}%"></i>`}</span></div></td>`;
  };
  return `<table class="income-table income-month-table">
    <thead><tr><th scope="col">月份</th><th scope="col">有效销售额（万）</th><th scope="col">不含税收入（万）</th><th scope="col">转收入率</th></tr></thead>
    <tbody>${monthly.map((row) => {
      const marks = [row.pendingIncome ? "收入待更新" : "", row.pendingClose ? "关账待确认" : "", row.incompleteSales ? "销售未满月" : "", row.mismatch ? "渠道口径待核" : ""].filter(Boolean);
      return `<tr><th scope="row">${row.month}${marks.length ? `<small>${marks.join(" · ")}</small>` : ""}</th>${bar(row.sales, "sales")}${bar(row.income, "income")}<td>${rateLabel(row.rate)}</td></tr>`;
    }).join("")}</tbody>
  </table>`;
}

function changeTable(rows, dimension, openGroups = null) {
  const cell = (value, formatted) => {
    const tone = value > 0 ? " income-up" : value < 0 ? " income-down" : "";
    return `<td class="${tone.trim()}">${value === null ? "—" : formatted}</td>`;
  };
  const line = (row, name = escapeHtml(row.name), className = "") => `<tr class="${className}"><th scope="row">${name}${row.note ? `<small>${escapeHtml(row.note)}</small>` : ""}</th>
    <td>${amountLabel(row.current)}</td>${cell(row.delta, signedMoney.format(row.delta / 10000))}${cell(row.yoy, signedPercent.format(row.yoy))}
    <td>${shareCell(row.share)}</td><td>${amountLabel(row.prior)}</td></tr>`;
  const body = openGroups ? rows.map((row, index) => {
    const id = `income-platform-group-${index}`;
    const open = openGroups.has(index);
    const toggle = `<button type="button" class="income-group-toggle" data-income-group="${index}" aria-expanded="${open}" aria-controls="${id}">${escapeHtml(row.name)}</button>`;
    return `<tbody>${line(row, toggle, "income-group")}</tbody>
      <tbody id="${id}"${open ? "" : " hidden"}>${row.platforms.map((platform) => line(platform, escapeHtml(platform.name), "income-platform")).join("")}</tbody>`;
  }).join("") : `<tbody>${rows.map((row) => line(row)).join("")}</tbody>`;
  return `<table class="income-table income-change-table">
    <thead><tr><th scope="col">${dimension}</th><th scope="col">本期收入</th><th scope="col">增减额</th><th scope="col">同比</th><th scope="col">收入占比</th><th scope="col">同期收入</th></tr></thead>
    ${body}
  </table>`;
}

export async function mountIncome(container, { sales, salesDateMin, salesDateMax }) {
  const url = new URL("./data.json", import.meta.url);
  url.search = new URL(import.meta.url).search;
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) throw new Error(`收入数据读取失败 (${response.status})`);
  const snapshot = await response.json();
  if (!snapshot.rows?.length) throw new Error("收入数据为空");
  const model = createIncomeModel(snapshot, sales, salesDateMin, salesDateMax);
  let start = model.defaultStart;
  let end = model.defaultEnd;
  let channel = "";
  let scope = null;
  let trendOpen = false;
  let extraColumns = false;
  const openGroups = new Set();
  const monthOptions = model.months.map((month) => `<option value="${month}">${month}</option>`).join("");
  const incomeFreshness = model.lastClosedMonth ? `收入已关账至 ${model.lastClosedMonth}` : `收入有数至 ${model.latestIncome}`;
  const views = [
    { id: "income-channel-view", label: "渠道转化" },
    { id: "income-departments", label: "业务部变化" },
    { id: "income-platforms", label: "平台结构" },
  ];
  container.innerHTML = `
    <section class="panel income-header" aria-labelledby="income-title">
      <div class="income-header-title"><h2 id="income-title">收入经营</h2><p>${incomeFreshness}</p></div>
      <div class="income-controls">
        <div class="income-presets" role="group" aria-label="快捷周期">
          <button type="button" data-income-period="ytd">年累</button>
          <button type="button" data-income-period="latest">${model.lastClosedMonth ? "最新关账月" : "最新收入月"}</button>
        </div>
        <details class="income-custom-period"><summary>自定义月份</summary>
          <div class="income-custom-controls">
            <label>起始月 <select id="income-start">${monthOptions}</select></label>
            <label>结束月 <select id="income-end">${monthOptions}</select></label>
            <div class="income-presets" role="group" aria-label="所选月份的周期">
              <button type="button" data-income-period="month">单月</button>
              <button type="button" data-income-period="quarter">所在季度</button>
            </div>
          </div>
        </details>
      </div>
      <div id="income-status" class="income-status" aria-live="polite"></div>
      <div id="income-metrics" class="income-metrics"></div>
      <p id="income-insight" class="income-insight" hidden></p>
    </section>
    <div class="income-view-tabs" role="tablist" aria-label="收入分析视图">
      ${views.map(({ id, label }) => `<button type="button" role="tab" id="${id}-tab" data-income-view="${id}" aria-controls="${id}">${label}</button>`).join("")}
    </div>
    <section id="income-channel-view" class="panel income-panel" role="tabpanel" aria-labelledby="income-channel-view-tab">
      <div class="income-panel-heading">
        <div><h3>渠道转化与收入结构</h3><p>收入占比以同期全渠道收入为分母。金额单位为万元。</p></div>
        <div class="income-channel-controls">
          <details id="income-channel-filter" class="income-channel-filter">
            <summary id="income-filter-label">渠道：全部</summary>
            <div class="income-channel-menu">
              <div class="filter-menu-actions">
                <button type="button" data-income-select="all">全选</button>
                <button type="button" data-income-select="clear">清空</button>
              </div>
              <div id="income-channel-options" class="filter-options" role="group" aria-label="筛选渠道"></div>
            </div>
          </details>
          <button id="income-total-trend" type="button" aria-expanded="false" aria-controls="income-trend">合计趋势</button>
          <button id="income-column-toggle" type="button" aria-pressed="false" aria-controls="income-channels">更多列</button>
        </div>
      </div>
      <p id="income-channel-period" class="income-channel-period"></p>
      <div id="income-channels" class="income-table-scroll" role="region" aria-label="渠道对比表" tabindex="0"></div>
      <section id="income-trend" class="income-trend" aria-labelledby="income-trend-title" hidden>
        <div class="income-panel-heading">
          <div><h3 id="income-trend-title" tabindex="-1">月度销售与收入</h3><p>销售按支付月，收入按审核月。</p></div>
          <div class="income-channel-controls"><label>趋势渠道 <select id="income-channel"></select></label><button id="income-close-trend" type="button">收起趋势</button></div>
        </div>
        <div id="income-monthly" class="income-table-scroll" role="region" aria-label="月度趋势明细" tabindex="0"></div>
      </section>
    </section>
    <section id="income-departments" class="panel income-panel" role="tabpanel" aria-labelledby="income-departments-tab" hidden>
      <div class="income-panel-heading"><div><h3>业务部收入变化</h3><p class="income-change-period"></p><p>按收入增减额的绝对值排序。</p></div></div>
      <p class="income-scroll-hint">横向滑动查看收入占比和同期收入</p>
      <div id="income-department-table" class="income-table-scroll" role="region" aria-label="业务部收入同比表" tabindex="0"></div>
    </section>
    <section id="income-platforms" class="panel income-panel" role="tabpanel" aria-labelledby="income-platforms-tab" hidden>
      <div class="income-panel-heading"><div><h3>平台收入结构</h3><p class="income-change-period"></p><p id="income-platform-coverage"></p></div></div>
      <p class="income-scroll-hint">横向滑动查看收入占比和同期收入</p>
      <div id="income-platform-table" class="income-table-scroll" role="region" aria-label="平台分类收入同比表" tabindex="0"></div>
    </section>
    <details class="income-method"><summary>数据来源与计算口径</summary>
      <p>收入来源为 ${snapshot.sources.map(escapeHtml).join("、")} 中的「不含税金额」。销售沿用 5.1 有效销售口径。</p>
      <p>转收入率＝不含税收入 ÷ 含税有效销售额。跨月审核、退货冲销会影响单月金额关系。占比差＝收入内占比−销售占比。</p>
      <p>渠道按来源中的同名口径对齐。无法确认对应关系的渠道仍纳入各自总额，渠道转化和占比差留空。</p>
      <p>业务部沿用各年收入源表的业务部门。平台分类按图示归并渠道，销售拓展包含新平台、社群和历史电购等渠道。京东自营的纯零售与企业购合计收入列在「待拆分或归类」。</p>
    </details>`;

  const startInput = container.querySelector("#income-start");
  const endInput = container.querySelector("#income-end");
  const channelInput = container.querySelector("#income-channel");
  const filter = container.querySelector("#income-channel-filter");
  const filterLabel = container.querySelector("#income-filter-label");
  const filterOptions = container.querySelector("#income-channel-options");
  const status = container.querySelector("#income-status");
  const metrics = container.querySelector("#income-metrics");
  const insight = container.querySelector("#income-insight");
  const channelPeriod = container.querySelector("#income-channel-period");
  const totalTrend = container.querySelector("#income-total-trend");
  const columnToggle = container.querySelector("#income-column-toggle");
  const trend = container.querySelector("#income-trend");
  const trendTitle = container.querySelector("#income-trend-title");
  const closeTrend = container.querySelector("#income-close-trend");
  const channels = container.querySelector("#income-channels");
  const monthly = container.querySelector("#income-monthly");
  const changePeriods = container.querySelectorAll(".income-change-period");
  const coverage = container.querySelector("#income-platform-coverage");
  const departmentTable = container.querySelector("#income-department-table");
  const platformTable = container.querySelector("#income-platform-table");
  const viewButtons = Array.from(container.querySelectorAll("[data-income-view]"));
  let availableChannels = [];
  let optionKey = "";
  let changeKey = "";

  function activateView(id) {
    for (const button of viewButtons) {
      const selected = button.dataset.incomeView === id;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
      container.querySelector(`#${button.dataset.incomeView}`).hidden = !selected;
    }
  }

  function renderPeriod() {
    const nextKey = `${start}/${end}`;
    if (changeKey === nextKey) return;
    changeKey = nextKey;
    const view = model.incomeChanges(start, end);
    const salesView = model.analyze(start, end, "");
    const incomePeriod = view.months.length ? `审核月份 ${monthPeriod(view.months)}` : "所选月份收入待更新";
    const prior = view.priorMonths.length ? ` · 同期 ${monthPeriod(view.priorMonths)}` : "";
    const overviewRange = view.months.length ? metricPeriod(view.months) : incomePeriod;
    const overviewPrior = view.priorMonths.length ? ` · 同期 ${metricPeriod(view.priorMonths)}` : "";
    const notes = [];
    if (salesView.pendingClose.length) notes.push(`${monthPeriod(salesView.pendingClose)} 关账待确认`);
    if (view.months.length && salesView.pendingIncome.length) notes.push(`${monthPeriod(salesView.pendingIncome)} 收入待更新`);
    if (salesView.salesOutsideComparison !== null) notes.push(`${amountLabel(salesView.salesOutsideComparison)} 万元销售在可比月份之外`);
    status.innerHTML = `<strong>全渠道 · ${overviewRange}${overviewPrior}</strong>${notes.map((note) => `<span>${note}</span>`).join("")}`;

    const incomeDetail = view.total.yoy !== null ? `同比 ${signedPercent.format(view.total.yoy)}` : (view.months.length ? "暂无可比同期" : "收入待更新");
    const salesDetail = salesView.matched.length ? `${metricPeriod(salesView.matched)} · 可比月份` : `已有销售 · 截至 ${salesDateMax}`;
    const rateDetail = salesView.matched.length ? "不含税收入 ÷ 含税销售额" : "暂无完整可比月份";
    metrics.innerHTML = metric("不含税收入（万）", amountLabel(view.total.current), incomeDetail)
      + metric("有效销售额（万）", amountLabel(salesView.total.sales), salesDetail)
      + metric("销售转收入率", rateLabel(salesView.total.rate), rateDetail);
    const direction = Math.sign(view.total.delta);
    const drivers = view.departmentRows.filter((row) => Math.sign(row.delta) === direction && row.delta).slice(0, 2);
    insight.hidden = !view.priorMonths.length || !drivers.length;
    insight.textContent = drivers.length ? `${direction < 0 ? "主要减量" : "主要增量"} · ${drivers.map((row) => `${row.name} ${signedMoney.format(row.delta / 10000)} 万元`).join("、")}` : "";

    for (const label of changePeriods) label.textContent = `全渠道 · ${incomePeriod}${prior} · 金额单位：万元`;
    const pending = view.platformGroups.at(-1);
    const pendingShare = pending.share === null ? "" : `，占全渠道 ${rateLabel(pending.share)}`;
    coverage.textContent = pending.current === null ? "" : `待拆分或归类 ${amountLabel(pending.current)} 万元${pendingShare}。点分类查看平台明细。`;
    const empty = '<p class="income-empty">所选月份暂无收入数据。</p>';
    departmentTable.innerHTML = view.departmentRows.length ? changeTable(view.departmentRows, "业务部") : empty;
    platformTable.innerHTML = view.months.length ? changeTable(view.platformGroups, "平台分类", openGroups) : empty;
  }

  function render() {
    const view = model.analyze(start, end, channel, scope);
    channel = view.focus;
    availableChannels = view.availableChannels;
    const optionNames = [...new Set([...availableChannels, ...(scope ?? [])])].sort((a, b) => a.localeCompare(b, "zh-CN"));
    const nextKey = JSON.stringify(optionNames);
    if (optionKey !== nextKey) {
      filterOptions.innerHTML = optionNames.map((name) => `<label class="filter-option"><input type="checkbox" value="${escapeHtml(name)}"><span>${escapeHtml(name)}</span></label>`).join("");
      optionKey = nextKey;
    }
    for (const input of filterOptions.querySelectorAll("input")) input.checked = !scope || scope.has(input.value);
    filterLabel.textContent = scope ? `渠道：已选 ${scope.size} 项` : "渠道：全部";

    startInput.value = start;
    endInput.value = end;
    const options = view.trendChannels.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`);
    const scopeLabel = scope ? "所选渠道合计" : "全部渠道";
    channelInput.innerHTML = [`<option value="">${scopeLabel}</option>`, ...options].join("");
    channelInput.disabled = !options.length;
    channelInput.value = channel;
    const comparison = view.matched.length ? `可比月份 ${monthPeriod(view.matched)}` : "暂无完整可比月份";
    const unmatchedSales = view.salesOutsideComparison === null ? "" : ` · 另有 ${amountLabel(view.salesOutsideComparison)} 万元销售，见月度趋势`;
    channelPeriod.textContent = comparison + unmatchedSales;
    const empty = scope?.size === 0 ? "请在上方勾选渠道。" : "所选渠道在该期间暂无记录。";
    const emptyMessage = `<p class="income-empty">${empty}</p>`;
    trendOpen = trendOpen && options.length > 0;
    trend.hidden = !trendOpen;
    totalTrend.disabled = !options.length;
    totalTrend.setAttribute("aria-expanded", String(trendOpen));
    columnToggle.setAttribute("aria-pressed", String(extraColumns));
    columnToggle.textContent = extraColumns ? "收起附加列" : "更多列";
    channels.innerHTML = view.rows.length ? channelTable(view, trendOpen ? channel : "", scopeLabel, extraColumns) : emptyMessage;
    monthly.innerHTML = trendOpen ? monthlyTable(view.monthly) : "";
    renderPeriod();
  }

  function setTrend(open, name, restoreFocus = false) {
    trendOpen = open;
    channel = name;
    render();
    if (trendOpen) {
      trendTitle.focus({ preventScroll: true });
      trendTitle.scrollIntoView({ block: "start" });
    } else if (restoreFocus) {
      const trigger = Array.from(channels.querySelectorAll("[data-income-channel]")).find((button) => button.dataset.incomeChannel === name);
      (trigger ?? totalTrend).focus();
    }
  }

  container.addEventListener("change", (event) => {
    if (event.target === startInput) {
      start = startInput.value;
      if (start > end) end = start;
    } else if (event.target === endInput) {
      end = endInput.value;
      if (end < start) start = end;
    } else if (event.target === channelInput) {
      channel = channelInput.value;
    } else if (filterOptions.contains(event.target)) {
      const input = event.target;
      scope ??= new Set(availableChannels);
      if (input.checked) scope.add(input.value);
      else scope.delete(input.value);
      if (scope.size === availableChannels.length && availableChannels.every((name) => scope.has(name))) scope = null;
      channel = "";
    }
    render();
  });
  container.addEventListener("click", (event) => {
    const target = event.target;
    const tab = target.closest("[data-income-view]");
    if (tab) {
      activateView(tab.dataset.incomeView);
      return;
    }
    const group = target.closest("[data-income-group]");
    if (group) {
      const index = Number(group.dataset.incomeGroup);
      const open = !openGroups.has(index);
      if (open) openGroups.add(index);
      else openGroups.delete(index);
      group.setAttribute("aria-expanded", String(open));
      container.querySelector(`#${group.getAttribute("aria-controls")}`).hidden = !open;
      return;
    }
    if (target === columnToggle) {
      extraColumns = !extraColumns;
      render();
      return;
    }
    if (target === totalTrend) {
      setTrend(!trendOpen || Boolean(channel), "");
      return;
    }
    if (target === closeTrend) {
      setTrend(false, channel, true);
      return;
    }
    const picked = target.closest("[data-income-select]")?.dataset.incomeSelect;
    if (picked) {
      scope = picked === "all" ? null : new Set();
      channel = "";
      render();
      return;
    }
    const preset = target.closest("[data-income-period]")?.dataset.incomePeriod;
    const selected = target.closest("[data-income-channel]")?.dataset.incomeChannel;
    if (selected) {
      setTrend(!trendOpen || channel !== selected, selected, true);
      return;
    }
    if (!preset) return;
    if (preset === "latest") start = end = model.lastClosedMonth ?? model.latestIncome;
    if (preset === "month") start = end;
    if (preset === "ytd") start = model.months.find((month) => month.slice(0, 4) === end.slice(0, 4));
    if (preset === "quarter") {
      const [year, month] = end.split("-");
      const first = Math.floor((Number(month) - 1) / 3) * 3 + 1;
      const boundary = (number) => `${year}-${String(number).padStart(2, "0")}`;
      const quarter = model.months.filter((value) => value >= boundary(first) && value <= boundary(first + 2));
      start = quarter[0];
      end = quarter.at(-1);
    }
    render();
  });
  container.querySelector(".income-view-tabs").addEventListener("keydown", (event) => {
    const active = viewButtons.indexOf(event.target);
    if (active < 0) return;
    const moves = { ArrowLeft: active - 1, ArrowRight: active + 1, Home: 0, End: viewButtons.length - 1 };
    if (!(event.key in moves)) return;
    event.preventDefault();
    const next = viewButtons[(moves[event.key] + viewButtons.length) % viewButtons.length];
    activateView(next.dataset.incomeView);
    next.focus();
  });
  document.addEventListener("click", (event) => {
    if (filter.open && !filter.contains(event.target)) filter.open = false;
  });
  filter.addEventListener("keydown", (event) => {
    if (filter.open && event.key === "Escape") {
      filter.open = false;
      filterLabel.focus();
    }
  });
  const linkedView = views.find((view) => `#${view.id}` === location.hash);
  activateView(linkedView?.id ?? views[0].id);
  render();
}
