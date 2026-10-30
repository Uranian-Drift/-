const round = (n, digits = 2) => Math.round((n + Number.EPSILON) * 10 ** digits) / 10 ** digits;
export function volumeReward(qty, target, cap) {
  return qty * 10 >= target * 7 ? round(cap * Math.min(qty / target, 1)) : 0;
}

export function storeKey(row, stores) {
  const hits = stores.filter(s => Object.entries(s.match).some(([key, values]) => values.includes(String(row[key] || '').trim())));
  if (hits.length > 1) throw new Error('店铺归属重叠');
  return hits[0]?.key || null;
}

export function summarize(data, cfg) {
  const fields = data.salesFields;
  if (!['date','productId','channel','business','store','amount','qty'].every(f => fields.includes(f))) throw new Error('销售字段不兼容');
  const products = data.products.map(row => Object.fromEntries(data.productFields.map((f,i) => [f,row[i]])));
  const ids = new Set(products.flatMap((p,i) => cfg.productCodes.includes(String(p.code)) ? [i] : []));
  if (!cfg.productCodes.every(code => products.some((p,i) => ids.has(i) && String(p.code) === code))) throw new Error('型号匹配不完整');
  const stores = cfg.stores, year = cfg.year;
  const sourceStart = data.meta.salesDateMin, sourceEnd = data.meta.salesDateMax;
  const agg = new Map(); let matchedRows = 0;
  for (const raw of data.sales) {
    const r = Object.fromEntries(fields.map((f,i) => [f,raw[i]]));
    if (!ids.has(r.productId) || !r.date.startsWith(`${year}-`)) continue;
    const key = storeKey(r, stores);
    if (!key) continue;
    const qty = Number(r.qty), amount = Number(r.amount);
    if (!Number.isFinite(qty) || !Number.isFinite(amount)) throw new Error('销售数值无效');
    const bucketKey = `${key}:${+r.date.slice(5,7)}`;
    const bucket = agg.get(bucketKey) || {qty:0,amount:0};
    bucket.qty += qty; bucket.amount += amount;
    agg.set(bucketKey,bucket); matchedRows++;
  }
  const period = month => {
    const start = `${year}-${String(month).padStart(2,'0')}-01`;
    const end = `${year}-${String(month).padStart(2,'0')}-${new Date(Date.UTC(year,month,0)).getUTCDate()}`;
    return {start,end,available:sourceEnd >= start && sourceStart <= start};
  };
  const stats = (key,month) => {
    if (!period(month).available) return {qty:null,amount:null,avgPrice:null,available:false};
    const b = agg.get(`${key}:${month}`) || {qty:0,amount:0};
    const qty = round(b.qty,6), amount = round(b.amount);
    return {qty,amount,avgPrice:qty > 0 ? round(amount/qty) : null,available:true};
  };
  const months = cfg.months.map(month => {
    const p = period(month), ref = stats('jd-self',month);
    const rows = stores.map(store => {
      const s = stats(store.key,month), target = store.targets[month];
      const threshold = Math.ceil(target*7/10), qty = s.qty;
      const potential = p.available ? volumeReward(qty,target,cfg.monthlyReward) : null;
      const priceOk = ref.avgPrice == null || s.avgPrice == null ? null : s.amount/s.qty+1e-9 >= ref.amount/ref.qty;
      const reward = !p.available ? null : potential === 0 || priceOk === false ? 0 : priceOk ? potential : null;
      return {...s,key:store.key,label:store.label,shortLabel:store.shortLabel || store.label,channel:store.channel,
        target,threshold,completion:p.available ? qty/target : null,
        gap:p.available ? Math.max(0,round(threshold-qty,6)) : null,
        fullGap:p.available ? Math.max(0,round(target-qty,6)) : null,
        volumeReward:potential,reward,priceOk,rewardAtThreshold:round(cfg.monthlyReward*threshold/target)};
    }).sort((a,b)=>(b.completion || 0)-(a.completion || 0) || a.key.localeCompare(b.key));
    return {month,...p,asOf:p.available ? (p.end < sourceEnd ? p.end : sourceEnd) : null,
      complete:p.available && sourceEnd>=p.end,referencePrice:ref.avgPrice,rows};
  });
  const qstart=`${year}-09-01`, qend=`${year}-11-30`, qavailable=sourceEnd>=qstart && sourceStart<=qstart;
  const quarterRows=stores.map(store=>{
    const monthly=months.map(m=>m.rows.find(r=>r.key===store.key));
    const target=Object.values(store.targets).reduce((a,b)=>a+b,0);
    const qty=qavailable ? monthly.reduce((sum,r)=>sum+(r.qty || 0),0) : null;
    const baselineAvailable=[5,6].every(m=>period(m).available && sourceEnd>=period(m).end);
    const base=baselineAvailable ? round(stats(store.key,5).qty+stats(store.key,6).qty,6) : null;
    const qpotential=qavailable ? volumeReward(qty,target,cfg.quarterReward) : null;
    const monthlyPotential=qavailable ? round(monthly.reduce((sum,r)=>sum+(r.volumeReward || 0),0)) : null;
    const threshold=Math.ceil(target*7/10);
    return {key:store.key,label:store.label,channel:store.channel,qty,target,threshold,
      completion:qavailable ? qty/target : null,gap:qavailable ? Math.max(0,threshold-qty) : null,
      excess:qavailable ? qty-target : null,volumeReward:qpotential,monthlyVolumeReward:monthlyPotential,
      bestVolumeReward:qavailable ? Math.max(qpotential,monthlyPotential) : null,
      baselineQty:base,baselineMonthlyAvg:base==null ? null : base/2};
  }).sort((a,b)=>(b.excess || 0)-(a.excess || 0));
  return {meta:{title:cfg.title,year,salesDateMax:sourceEnd,sourceGeneratedAt:data.meta.generatedAt,
      productLabel:cfg.productLabel,sourceTitle:data.meta.title || 'AI经营看板',refreshMode:'on-open-or-refresh',storeCount:stores.length},
    months,quarter:{start:qstart,end:qend,asOf:qavailable ? (sourceEnd<qend ? sourceEnd : qend) : null,
      complete:sourceEnd>=qend,available:qavailable,rows:quarterRows},
    rules:{monthlyReward:cfg.monthlyReward,quarterReward:cfg.quarterReward,top1:2200,top2:1200,growth:2200},
    source:{snapshot:'AI经营看板5.1 / water-heater-data.js',targetSource:'用户提供的2026年9—11月激励方案',
      quantityDefinition:'指定两个产品编码的有效销售数量净值，保留退货冲减。',
      priceDefinition:'同一月份、同一型号范围，销售额÷净销量；参考京东自营。',
      douyinScope:'仅渠道=抖音直营；不含抖音代销。',matchedRows}};
}
