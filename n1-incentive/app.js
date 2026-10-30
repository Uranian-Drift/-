import { summarize } from './engine.mjs?v=20261030n1a';
const $ = (id) => document.getElementById(id);
const embedded = window.parent !== window && new URLSearchParams(location.search).get('embedded') === '1';
const localPreview = ['localhost','127.0.0.1'].includes(location.hostname);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = (v, digits = 0) => v == null ? '—' : Number(v).toLocaleString('zh-CN', {maximumFractionDigits: digits});
const money = (v) => v == null ? '待核' : `¥${num(v, 2)}`;
const pct = (v) => v == null ? '—' : `${(v * 100).toFixed(1)}%`;
const params = new URLSearchParams(location.search);
const state = {data: null, month: ['9','10','11'].includes(params.get('month')) ? +params.get('month') : null,
  store: params.get('store') || 'all', tab: ['monthly','quarter','rules'].includes(params.get('tab')) ? params.get('tab') : 'monthly',
  public: params.get('public') === '1', loading: false, posterURL: null};
let toastTimer;

function toast(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3000);
}

function updateURL() {
  const p = new URLSearchParams();
  if (embedded) p.set('embedded', '1');
  p.set('month', state.month);
  if (state.store !== 'all') p.set('store', state.store);
  if (state.tab !== 'monthly') p.set('tab', state.tab);
  if (state.public) p.set('public', '1');
  history.replaceState(null, '', `${location.pathname}?${p}`);
}

function currentMonth() { return state.data.months.find(m => m.month === state.month); }
function filtered(rows) { return state.store === 'all' ? rows : rows.filter(r => r.key === state.store); }
function priceLabel(row) { return row.priceOk === true ? '均价达标' : row.priceOk === false ? '均价待提升' : '均价待核'; }
function priceTag(row) { return `<span class="price-tag ${row.priceOk === true ? 'ok' : row.priceOk === false ? 'warn' : 'unknown'}">${priceLabel(row)}</span>`; }
function rewardLabel(row) {
  if (row.qty == null) return '考核尚未开始';
  if (row.volumeReward === 0) return '未到起奖线';
  if (row.priceOk === false) return '均价未达要求';
  if (row.priceOk == null) return '待核均价条件';
  return '已满足当前条件';
}
function progress(completion, labels = false) {
  const width = Math.max(0, Math.min(100, (completion || 0) * 100));
  return `<div class="progress" role="progressbar" aria-label="销量目标完成率" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${width}" aria-valuetext="${pct(completion)}"><span class="fill" style="width:${width}%"></span>${labels ? `<span class="value-label" style="left:${Math.max(10, width)}%">${pct(completion)}</span>` : ''}</div>`;
}

function hero(m, rows) {
  if (!m.available) return `<section class="card hero"><div><span class="eyebrow">下一程，继续冲刺</span><h2 class="hero-title"><span>${state.month}月目标已就位</span></h2><p class="hero-sub">考核区间 ${m.start} — ${m.end}</p></div><div class="hero-bottom">源数据尚未覆盖本月，销量与奖励暂不计入。</div></section>`;
  const row = rows.find(r => r.gap > 0) || rows.find(r => r.priceOk !== true) || rows[0];
  if (!row) return '';
  let title, eyebrow, bottom;
  if (row.gap > 0) {
    eyebrow = state.store === 'all' ? '本月最接近起奖' : '下一站，进入奖励区';
    title = `<span>${esc(row.shortLabel)}，再冲</span><strong>${num(row.gap, 1)}</strong><b>台！</b>`;
    bottom = `<span>销量达到 ${num(row.threshold)} 台，奖励可达</span><strong>${money(row.rewardAtThreshold)}</strong><small>${row.priceOk === false ? '当前均价待提升，需同时达到均价要求' : row.priceOk === true ? '需在考核结束时继续满足均价条件' : '需同时满足均价条件'}</small>`;
  } else if (row.priceOk !== true) {
    eyebrow = '销量已达线，继续冲刺均价';
    title = `<span>${esc(row.shortLabel)}，销量已达线</span>`;
    bottom = `<span>按销量可对应</span><strong>${money(row.volumeReward)}</strong><small>均价条件${row.priceOk === false ? '尚未达标' : '待核实'}，当前奖励以表内测算为准</small>`;
  } else {
    eyebrow = row.completion >= 1 ? '满奖目标已达成' : '已进入奖励区，继续冲满奖';
    title = `<span>${esc(row.shortLabel)}，${row.completion >= 1 ? '目标达成！' : '再冲满奖！'}</span>`;
    bottom = `<span>当前测算奖励</span><strong>${money(row.reward)}</strong><small>${row.fullGap > 0 ? `再净增${num(row.fullGap)}台可冲800元满奖，需继续满足均价条件` : '以最终有效销量及均价核定'}</small>`;
  }
  return `<section class="card hero" data-hero-store="${row.key}"><div><span class="eyebrow">${eyebrow}</span><h2 class="hero-title">${title}</h2><p class="hero-sub">当前 <b>${num(row.qty, 1)}台</b> / 起奖 <b>${num(row.threshold)}台</b></p></div><div>${progress(row.completion, true)}<div class="scale-labels"><span>0%</span><span class="start-label">70% 起奖线</span><span>100% 满奖线</span></div></div><div class="hero-bottom">${bottom}</div></section>`;
}

function explainer() {
  return `<aside class="card reward-explainer"><h2>奖励怎么拿</h2><div class="reward-steps"><div class="reward-step"><span class="step-icon">↗</span><div><strong>＜70%</strong><span>继续蓄力，先冲起奖线</span></div></div><div class="reward-step"><span class="step-icon">◎</span><div><strong>70%—＜100%</strong><span>800元 × 完成率</span></div></div><div class="reward-step"><span class="step-icon">♜</span><div><strong>≥100%</strong><span>800元封顶</span></div></div></div></aside>`;
}

function monthlyTable(m, rows) {
  return `<section class="card"><div class="section-head"><div><h2>店铺冲刺进度</h2><p>按完成率排序 · 70%起奖，100%满奖</p></div><span class="badge">${state.month}月 · ${rows.length}家店</span></div>
  <div class="table-wrap"><table class="monthly-table" aria-label="${state.month}月店铺激励目标进度"><colgroup><col class="stock-col"><col class="qty-col"><col class="progress-col"><col class="threshold-col"><col class="gap-col"><col class="price-col"><col class="reward-col"></colgroup><thead><tr><th scope="col">店铺</th><th scope="col">净销量 / 目标</th><th scope="col">完成进度</th><th scope="col">起奖线</th><th scope="col">距起奖还差</th><th scope="col">均价条件</th><th scope="col">测算奖励</th></tr></thead><tbody>${rows.map((r, i) => `<tr class="${i === 0 ? 'featured' : ''}" data-store="${r.key}" data-qty="${r.qty ?? ''}" data-gap="${r.gap ?? ''}"><td class="store-cell"><span class="store-name">${esc(r.label)}</span><small>${esc(r.channel)}</small></td><td class="num qty-cell"><b>${num(r.qty, 1)}</b> / ${num(r.target)}台</td><td class="bar-cell"><div class="progress-cell">${progress(r.completion)}<b>${pct(r.completion)}</b></div></td><td class="num threshold-cell">${num(r.threshold)}台</td><td class="gap-cell"><span class="gap">${num(r.gap, 1)}<small>台</small></span></td><td class="price-cell">${m.available ? priceTag(r) : '<span class="price-tag unknown">未开始</span>'}<small>均价 ${r.avgPrice == null ? '—' : money(r.avgPrice)}</small></td><td class="reward-cell"><strong>${money(r.reward)}</strong><small>${rewardLabel(r)}</small></td></tr>`).join('')}</tbody></table></div>
  <p class="table-footnote">均价底线：京东自营本月 ${money(m.referencePrice)}；净销量包含退货冲减。测算奖励需同时通过销量与均价条件，最终按月末核定。</p></section>`;
}

function quarterStrip() {
  return `<section class="card quarter-preview"><div class="section-head"><div><h2>季度奖励</h2><p>9—11月累计核定 · 进行中，尚未产生最终获奖店铺</p></div><button class="text-button" data-go-quarter>查看季度进度 →</button></div><div class="quarter-strip"><div class="award-item"><span class="award-icon">♜</span><div class="award-title">超额贡献 TOP1<small>累计超目标绝对台量第一</small></div><span class="award-money">¥2,200</span></div><div class="award-item"><span class="award-icon">♙</span><div class="award-title">超额贡献 TOP2<small>累计超目标绝对台量第二</small></div><span class="award-money">¥1,200</span></div><div class="award-item"><span class="award-icon">↗</span><div class="award-title">增长率卓越奖<small>对比5—6月 · 待核定</small></div><span class="award-money">¥2,200</span></div></div></section>`;
}

function monthlyView() {
  const m = currentMonth(), rows = filtered(m.rows);
  const notice = !m.available ? '<p class="notice">本月尚未开始或源数据尚未覆盖，暂不显示销量与奖励；下方目标已按方案预置。</p>' : '';
  return `${notice}<div class="hero-grid">${hero(m, rows)}${explainer()}</div>${monthlyTable(m, rows)}${quarterStrip()}<p class="notes">起奖台量＝月度目标×70%，向上取整；销量与奖励均按 <strong>${esc(state.data.meta.productLabel)}</strong> 统计。月度与季度目标冲刺奖二选一、不重复。</p>`;
}

function quarterView() {
  const q = state.data.quarter, rows = filtered(q.rows);
  return `<div class="q-summary"><section class="card"><h3>超额贡献 TOP1</h3><strong>¥2,200</strong><p>按三个月累计超目标绝对台量排名。<br>${q.complete ? '期末数据已覆盖，待最终核定。' : '11月30日期末核定，当前仅展示累计进度。'}</p></section><section class="card"><h3>超额贡献 TOP2</h3><strong>¥1,200</strong><p>按三个月累计超目标绝对台量排名。<br>与目标完成率排名分别计算。</p></section><section class="card"><h3>增长率卓越奖</h3><strong>¥2,200</strong><p>已接入5—6月历史销量。<br>季度与两个月的增长率比较口径待确认，暂不排名。</p></section></div>
  <section class="card"><div class="section-head"><div><h2>9—11月累计冲刺</h2><p>截至 ${esc(q.asOf || '尚未开始')} · 累计目标按完整三个月计算</p></div><span class="badge">${q.complete ? '待最终核定' : '进行中'}</span></div><div class="table-wrap quarter-scroll"><table class="quarter-table" aria-label="9至11月季度奖励进度"><colgroup><col class="stock-col"><col><col><col><col><col><col><col></colgroup><thead><tr><th>店铺</th><th>累计净销量</th><th>累计目标</th><th>完成率</th><th>距70%还差</th><th>超目标台量</th><th>销量对应奖励¹</th><th>5—6月销量</th></tr></thead><tbody>${rows.map(r => `<tr data-quarter-store="${r.key}"><td><strong>${esc(r.label)}</strong><small>${esc(r.channel)}</small></td><td>${num(r.qty, 1)}台</td><td>${num(r.target)}台</td><td>${pct(r.completion)}</td><td>${num(r.gap, 1)}台</td><td class="${r.excess > 0 ? 'positive' : 'muted'}">${r.excess > 0 ? '+' : ''}${num(r.excess, 1)}台</td><td>${money(r.volumeReward)}<small>仅按销量，非应发金额</small></td><td>${num(r.baselineQty, 1)}台<small>月均 ${num(r.baselineMonthlyAvg, 1)}台</small></td></tr>`).join('')}</tbody></table></div><p class="table-footnote">¹季度销量对应奖励：完成率不足70%为0；70%—不足100%为2400元×完成率；100%及以上为2400元。发奖还须核定均价条件，并与月度目标冲刺奖二选一。负超额表示尚未完成三个月总目标。</p></section>
  <p class="notes">不按未结束月份外推销量，不把当前累计排序当作获奖名单。增长率奖暂保留历史基准，待明确比较期间及计算口径后核定。</p>`;
}

function rulesView() {
  const data = state.data;
  return `<section class="card rules"><span class="eyebrow">统一规则，公开进度</span><h2>激励规则与目标</h2><p>激励期：2026年9月1日—11月30日；9月、10月、11月分别核算月度目标冲刺奖。</p>
  <h3>月度目标冲刺奖</h3><div class="formula">完成率＜70%：0元<br>70%≤完成率＜100%：800元 × 完成率<br>完成率≥100%：800元封顶</div>
  <h3>先过销量线，再过均价线</h3><p>均价按同月、同一型号范围的有效销售额 ÷ 净销量计算，以京东自营当月均价为底线。低于底线的店铺不享受激励；均价不可计算时显示“待核”，不视为已达标。</p>
  <h3>各店铺月度目标 <span class="muted">· 单位：台</span></h3><div class="table-wrap"><table class="rules-table"><thead><tr><th>店铺</th><th>9月</th><th>10月</th><th>11月</th><th>三个月合计</th></tr></thead><tbody>${data.months[0].rows.map(r => {const values = data.months.map(m => m.rows.find(s => s.key === r.key).target);return `<tr><td>${esc(r.label)}</td>${values.map(v => `<td>${num(v)}</td>`).join('')}<td>${num(values.reduce((a,b) => a+b, 0))}</td></tr>`;}).join('')}</tbody></table></div>
  <h3>季度目标冲刺奖</h3><p>累计完成率不足70%无奖励；70%—不足100%，为2400元×累计完成率；100%及以上为2400元封顶。与月度目标冲刺奖二选一，不重复。</p>
  <h3>季度专项奖励</h3><ul><li>超额贡献TOP1：2200元；累计三个月超目标绝对销量第一。</li><li>超额贡献TOP2：1200元；累计三个月超目标绝对销量第二。</li><li>增长率卓越奖：2200元；与5—6月比较的销量增长率最高，具体跨期比较口径待确认。</li></ul>
  <details><summary>查看数据口径与更新方式</summary><p>数据来源：${esc(data.meta.sourceTitle)}。销售截止 ${esc(data.meta.salesDateMax)}，源快照生成日 ${esc(data.meta.sourceGeneratedAt)}。</p><p>当前沿用你提供的N1系列销量口径，包含16N1（编码1004001800005）及16N1MAX（编码1004001900010）。原方案文字为16N1；最终发奖时请按实际确认的适用型号核定。</p><p>店铺归集：京东自营及自营二店按源表客户名称匹配；天猫品旗仅七叶枫；天猫官旗按同名渠道归集；京东官旗按京东POP渠道归集，不含POP代销；抖音仅计抖音直营，不含抖音代销。</p><p>与AI经营看板共用同一份销售数据；打开或刷新主看板时同步。上线数据跟随主看板一起发布，无定时检查、无额外采集任务。</p></details></section>`;
}

function render() {
  if (!state.data) return;
  document.body.classList.toggle('public-mode', state.public);
  $('publicToggle').innerHTML = state.public ? '退出公示' : '<span aria-hidden="true">◉</span> 公示模式';
  $('publicToggle').setAttribute('aria-pressed', String(state.public));
  $('monthFilter').value = state.month;
  $('monthFilter').disabled = state.tab !== 'monthly';
  $('storeFilter').value = state.store;
  $('storeFilter').disabled = state.tab === 'rules';
  document.querySelectorAll('[data-tab]').forEach(b => {b.classList.toggle('active', b.dataset.tab === state.tab); b.setAttribute('aria-selected', String(b.dataset.tab === state.tab));});
  $('cutoff').textContent = `销售截至 ${state.data.meta.salesDateMax}`;
  $('scope').textContent = `${state.data.meta.productLabel} · 6家激励店铺 · 共用AI经营看板数据`;
  $('sourceFooter').textContent = `数据来源：${state.data.meta.sourceTitle} · 与主看板共用数据 · ${localPreview ? '本地预览' : '线上公示'}`;
  $('content').innerHTML = state.tab === 'quarter' ? quarterView() : state.tab === 'rules' ? rulesView() : monthlyView();
  document.querySelector('[data-go-quarter]')?.addEventListener('click', () => {state.tab = 'quarter'; render();});
  updateURL();
  if (embedded) window.parent.postMessage({type:'n1-incentive-public',active:state.public},location.origin);
}

async function load() {
  if (state.loading) return;
  state.loading = true;
  $('refresh').disabled = true;
  $('refresh').textContent = '正在同步…';
  try {
    const data = summarize(window.WATER_HEATER_DATA, window.N1_INCENTIVE_CONFIG);
    state.data = data;
    if (state.month == null) {
      const current = +data.meta.salesDateMax.slice(5, 7);
      state.month = data.months.some(m => m.month === current) ? current : data.months.filter(m => m.available).at(-1)?.month || 9;
    }
    const keys = new Set(data.months[0].rows.map(r => r.key));
    if (!keys.has(state.store)) state.store = 'all';
    $('storeFilter').innerHTML = '<option value="all">全部店铺</option>' + data.months[0].rows.map(r => `<option value="${esc(r.key)}">${esc(r.label)}</option>`).join('');
    $('error').hidden = true;
    document.querySelector('.status-dot').style.background = '';
    render();
  } catch (error) {
    $('error').textContent = state.data ? '暂未读到主看板的新数据，下面保留的是上次成功读取的结果。请在AI经营看板更新完成后刷新重试。' : '未能读取AI经营看板数据。请确认主看板数据已生成，再点击“刷新数据”。';
    $('error').hidden = false;
    document.querySelector('.status-dot').style.background = '#ad1f2b';
    if (!state.data) $('content').innerHTML = '<div class="card empty">数据尚未读取，暂不展示销量与奖励。</div>';
  } finally {
    state.loading = false;
    $('refresh').disabled = false;
    $('refresh').textContent = '↻ 刷新数据';
  }
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const input = document.createElement('textarea');
    input.value = text; input.style.position = 'fixed'; input.style.opacity = '0';
    document.body.append(input); input.select();
    const done = document.execCommand('copy'); input.remove();
    if (!done) throw new Error('无法写入剪贴板');
  }
}

function announcementText() {
  const isQuarter = state.tab === 'quarter';
  const m = currentMonth();
  const rows = filtered(isQuarter ? state.data.quarter.rows : m.rows);
  const asOf = isQuarter ? state.data.quarter.asOf : m.asOf;
  return [`【方太N1系列${isQuarter ? '9—11月累计' : `${state.month}月`}激励进度】`, `销量截止：${asOf || '考核尚未开始'}；口径：16N1＋16N1MAX`, ...rows.map(r => isQuarter ? `${r.label}：累计${num(r.qty)} / ${num(r.target)}台，完成率${pct(r.completion)}，距70%起奖线还差${num(r.gap)}台。` : `${r.label}：${num(r.qty)} / ${num(r.target)}台，完成率${pct(r.completion)}，距起奖还差${num(r.gap)}台；${r.qty == null ? '尚未开始' : priceLabel(r)}，当前测算奖励${money(r.reward)}。`), isQuarter ? '季度按期末数据核定，当前不代表获奖结果。' : '月度70%起奖，100%可达800元；奖励须同时满足均价条件。', '数据跟随AI经营看板，最终按激励规则核定。'].join('\n');
}

function rounded(ctx, x, y, w, h, radius, fill) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, radius); ctx.fillStyle = fill; ctx.fill();
}
function drawPoster() {
  const isQuarter = state.tab === 'quarter';
  const m = currentMonth(), q = state.data.quarter;
  const rows = filtered(isQuarter ? q.rows : m.rows);
  const canvas = document.createElement('canvas');
  const W = 1600, H = 400 + rows.length * 150;
  canvas.width = W * 1.5; canvas.height = H * 1.5;
  const ctx = canvas.getContext('2d'); ctx.scale(1.5, 1.5);
  const font = '"PingFang SC", "Microsoft YaHei", sans-serif';
  const text = (s, x, y, size = 22, color = '#20242b', weight = 400, align = 'left') => {ctx.font = `${weight} ${size}px ${font}`; ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(String(s), x, y);};
  ctx.fillStyle = '#f3f5f7'; ctx.fillRect(0,0,W,H);
  ctx.fillStyle = '#ad1f2b'; ctx.fillRect(0,0,W,148);
  text('FOTILE 方太', 54, 57, 28, '#fff', 650);
  text(`N1系列${isQuarter ? '季度累计' : `${state.month}月`}激励冲刺榜`, 54, 113, 38, '#fff', 650);
  text('店铺进度公示', W-54, 60, 23, '#fff', 500, 'right');
  text(`销量截止 ${isQuarter ? q.asOf || '尚未开始' : m.asOf || '尚未开始'}`, W-54, 108, 22, '#f4d8dd', 400, 'right');
  text('店铺 / 净销量与目标', 76, 199, 19, '#68707d');
  text('目标完成进度', 620, 199, 19, '#68707d');
  text('距70%起奖线', 1160, 199, 19, '#68707d', 400, 'center');
  text(isQuarter ? '销量对应奖励' : '当前测算奖励', W-76, 199, 19, '#68707d', 400, 'right');
  rows.forEach((r, i) => {
    const y = 222 + i * 150;
    rounded(ctx, 44, y, W-88, 134, 13, i === 0 ? '#fcf0f3' : '#fff');
    text(r.label, 76, y+43, 26, '#20242b', 600);
    text(`${num(r.qty, 1)} / ${num(r.target)} 台`, 76, y+87, 24, '#525c69');
    const bx = 620, bw = 275, by = y+55;
    rounded(ctx,bx,by,bw,12,6,'#e7e9ed');
    const fillW = bw*Math.max(0,Math.min(1,r.completion || 0));
    if (fillW > 0) rounded(ctx,bx,by,fillW,12,6,'#ad1f2b');
    ctx.beginPath();ctx.setLineDash([4,4]);ctx.moveTo(bx+bw*.7,by-13);ctx.lineTo(bx+bw*.7,by+25);ctx.strokeStyle='#ad1f2b';ctx.stroke();ctx.setLineDash([]);
    text(pct(r.completion), 1000, y+65, 26, '#ad1f2b', 650, 'right');
    text('70%', bx+bw*.7, by+43, 15, '#8b929d', 400, 'center');
    text(`${num(r.gap, 1)} 台`,1160,y+61,32,'#ad1f2b',650,'center');
    text(money(isQuarter ? r.volumeReward : r.reward),W-76,y+54,29,'#20242b',650,'right');
    text(isQuarter ? '非应发金额，均价待核' : r.qty == null ? '考核尚未开始' : `${priceLabel(r)} · ${rewardLabel(r)}`,W-76,y+91,16,'#68707d',400,'right');
  });
  const fy = 245 + rows.length * 150;
  text(isQuarter ? '季度进度按9—11月完整目标计算；专项奖期末核定，当前不代表获奖名单。' : `月度70%起奖，100%满奖800元；本月均价底线 ${money(m.referencePrice)}。`, 54, fy+20, 20, '#525c69',500);
  text('奖励须同时满足销量和均价条件；月度与季度目标冲刺奖二选一，不重复。',54,fy+57,19,'#68707d');
  text('统计口径：16N1＋16N1MAX · 含抖音直营，不含抖音代销 · 数据跟随AI经营看板',54,fy+94,18,'#68707d');
  return canvas;
}

async function makePoster() {
  if (!state.data || !$('error').hidden) { toast('请先成功读取最新数据，再生成战报'); return; }
  if (state.tab === 'rules') {toast('请先选择月度冲刺或季度奖项，再生成战报'); return;}
  $('exportPoster').disabled = true;
  try {
    await document.fonts.ready;
    const blob = await new Promise(resolve => drawPoster().toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('empty image');
    if (state.posterURL) URL.revokeObjectURL(state.posterURL);
    state.posterURL = URL.createObjectURL(blob);
    $('posterPreview').src = state.posterURL;
    $('posterDialog').showModal();
  } catch {toast('战报生成失败，请重试');}
  finally {$('exportPoster').disabled = false;}
}

$('monthFilter').addEventListener('change', e => {state.month = +e.target.value; render();});
$('storeFilter').addEventListener('change', e => {state.store = e.target.value; render();});
document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {state.tab = b.dataset.tab; render();}));
$('publicToggle').addEventListener('click', () => {state.public = !state.public; render();});
$('refresh').addEventListener('click', () => { if (embedded) window.parent.location.reload(); else location.reload(); });
$('exportPoster').addEventListener('click', makePoster);
$('closePoster').addEventListener('click', () => $('posterDialog').close());
$('posterDialog').addEventListener('click', e => {if(e.target === $('posterDialog')) {const r=e.target.getBoundingClientRect();if(e.clientX<r.left || e.clientX>r.right || e.clientY<r.top || e.clientY>r.bottom)e.target.close();}});
$('downloadPoster').addEventListener('click', () => {const a = document.createElement('a');a.href=state.posterURL;a.download=`方太N1激励_${state.tab === 'quarter' ? '9-11月累计' : `${state.month}月`}_${state.data.meta.salesDateMax}.png`;a.click();});
$('copyPosterText').addEventListener('click', async () => {try {await copyText(announcementText());toast('公示文案已复制');}catch{toast('复制失败，请使用下载战报');}});
$('copyLink').addEventListener('click', async () => {const url=new URL(location.href);url.searchParams.delete('embedded');url.searchParams.set('public','1');try{await copyText(url.toString());toast(localPreview ? '公示链接已复制，仅本机可打开；跨店分享请下载战报' : '公示链接已复制，可发给店铺人员查看');}catch{toast('复制失败，请下载公示战报');}});
if (embedded) {
  new ResizeObserver(() => window.parent.postMessage({type:'n1-incentive-height',height:document.body.offsetHeight},location.origin)).observe(document.body);
}
load();
