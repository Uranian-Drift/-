const dim = (id, label, group = '经营维度') => ({ id, label, group, kind: 'dimension' });
const met = (id, label, format = 'currency', note = '') => ({ id, label, format, note, kind: 'measure' });

export function createDatasets(source, incomeSource) {
  const product = source.products;
  const incomeRows = [...incomeSource.prior, ...incomeSource.current];
  const specs = {
    sales: {
      id: 'sales', label: '销售明细', icon: '▦', rows: source.sales,
      timeField: 'date', timeMin: source.meta.salesDateMin, timeMax: source.meta.salesDateMax,
      source: '25 年及 26 年有效销售数据；型号、形态与核心品参照表',
      grain: '支付日期 × 产品 × 渠道 × 业务部 × 店铺 × 销售记录',
      note: '金额与数量为净值，包含退款负数。成交均价=销售额÷净销量；销售指数=销售金额÷核算价金额合计。净销量、销售额或核算额非正时不展示指数。',
      dimensions: [dim('year','年份','时间'),dim('quarter','季度','时间'),dim('month','月份','时间'),dim('date','日期','时间'),dim('shape','产品形态','产品'),dim('series','系列','产品'),dim('model','型号','产品'),dim('code','产品编码','产品'),dim('core','核心品','产品'),dim('efficiency','能效','产品'),dim('channel','渠道','渠道'),dim('business','业务部','渠道'),dim('store','店铺','渠道')],
      measures: [met('amount','销售额','currency','净销售金额'),met('qty','净销量','integer','售出与退款相抵后的净销量'),met('avgPrice','成交均价','price','销售额 ÷ 净销量'),met('accounting','核算额','currency','核算价金额合计，源字段已包含数量影响'),met('salesIndex','销售指数','index','销售金额 ÷ 核算价金额合计；净销量、销售额或核算额非正时不展示'),met('recordCount','记录数','integer','销售明细行数'),met('amountShare','销售额占比','percent','当前单元格销售额 ÷ 当前筛选范围总销售额')],
      defaults: { rows:['shape','series'], cols:['year'], measures:['amount','qty','avgPrice'], chart:{ type:'bar', x:'shape', y:'amount', series:'year' } },
      get(row, id) {
        const p = product[row[1]] || [];
        switch(id) {
          case 'date': return row[0]; case 'year': return row[0].slice(0,4);
          case 'quarter': return `${row[0].slice(0,4)} Q${Math.ceil(Number(row[0].slice(5,7))/3)}`;
          case 'month': return row[0].slice(0,7);
          case 'shape': return p[3] || '未分类'; case 'series': return p[2] || '未标注';
          case 'model': return p[1] || '未标注'; case 'code': return p[0] || '未标注';
          case 'core': return p[4] ? '核心品' : '非核心品'; case 'efficiency': return p[10] || '未标注';
          case 'channel': return row[2] || '未标注'; case 'business': return row[3] || '未标注';
          case 'store': return row[4] || '未标注'; default: return '';
        }
      },
      accumulate(b, r) { b.amount += Number(r[5])||0; b.qty += Number(r[6])||0; if(r[7]!==null&&r[7]!==undefined){const a=Number(r[7]);if(Number.isFinite(a))b.accounting+=a;} }
    },
    income: {
      id:'income', label:'收入归集', icon:'◫', rows:incomeRows,
      timeField:'month', timeMin:incomeSource.meta.priorMonthMin, timeMax:incomeSource.meta.incomeMonthMax,
      source:'2026 年 1—9 月收入、25 年销售和收入',
      grain:'审核月份 × 业务部 × 渠道',
      note:'收入按审核月份归集，销售按支付日期归集；两者不是订单级一一对应，不在此工作台混合求比。',
      dimensions:[dim('year','年份','时间'),dim('quarter','季度','时间'),dim('month','月份','时间'),dim('business','业务部','经营维度'),dim('channel','渠道','经营维度')],
      measures:[met('income','收入','currency','审核归集收入'),met('incomeTaxEq','含税等价收入','currency','源表含税等价收入'),met('qty','归集数量','integer','收入源表数量'),met('unitIncome','单台收入','price','收入 ÷ 归集数量'),met('recordCount','记录数','integer','收入归集行数')],
      defaults:{rows:['business','channel'],cols:['year'],measures:['income','qty','unitIncome'],chart:{type:'bar',x:'business',y:'income',series:'year'}},
      get(r,id) { const m=r[0]; switch(id) {case 'year':return m.slice(0,4);case 'quarter':return `${m.slice(0,4)} Q${Math.ceil(Number(m.slice(5,7))/3)}`;case 'month':return m;case 'business':return r[1]||'未标注';case 'channel':return r[2]||'未标注';default:return '';} },
      accumulate(b,r) { b.income+=Number(r[3])||0;b.incomeTaxEq+=Number(r[4])||0;b.qty+=Number(r[5])||0; }
    },
    market: {
      id:'market', label:'奥维市场', icon:'◉', rows:source.ovi,
      timeField:'month', timeMin:source.meta.oviMonthMin, timeMax:source.meta.oviMonthMax,
      source:'奥维数据.xlsx（5.1 看板生成快照）',
      grain:'月份 × 品牌 × 型号 × 升数段 × 价位段',
      note:'奥维市场样本与方太销售明细不是同一订单来源。市场均价按销额÷销量重算；品牌份额仅对当前筛选范围计算。',
      dimensions:[dim('year','年份','时间'),dim('quarter','季度','时间'),dim('month','月份','时间'),dim('brand','品牌','市场维度'),dim('model','型号','市场维度'),dim('volumeSegment','升数段','市场维度'),dim('priceBand','价位段','市场维度')],
      measures:[met('sales','市场销额','currency','奥维销额'),met('qty','市场销量','integer','奥维销量'),met('avgPrice','市场均价','price','市场销额 ÷ 市场销量'),met('salesShare','销额占比','percent','当前单元格销额 ÷ 当前筛选范围总销额'),met('recordCount','记录数','integer','聚合数据行数')],
      defaults:{rows:['brand'],cols:['year'],measures:['sales','qty','salesShare'],chart:{type:'bar',x:'brand',y:'sales',series:'year'}},
      get(r,id) {const m=r[0];switch(id){case 'year':return m.slice(0,4);case 'quarter':return `${m.slice(0,4)} Q${Math.ceil(Number(m.slice(5,7))/3)}`;case 'month':return m;case 'brand':return r[1]||'未标注';case 'model':return r[2]||'未标注';case 'volumeSegment':return r[3]||'未标注';case 'priceBand':return r[4]||'未标注';default:return '';}},
      accumulate(b,r){b.sales+=Number(r[7])||0;b.qty+=Number(r[6])||0;}
    },
    target: {
      id:'target', label:'经营目标', icon:'◎', rows:source.targets,
      timeField:'month', timeMin:'2026-01', timeMax:'2026-12',
      source:'2026H2 热水器经营目标模拟器',
      grain:'月份 × 型号 × 形态',
      note:'这是规划/模拟目标，不是已实现销售；请勿与实际销售直接相加。',
      dimensions:[dim('year','年份','时间'),dim('quarter','季度','时间'),dim('month','月份','时间'),dim('model','型号','产品'),dim('shape','产品形态','产品')],
      measures:[met('amount','目标销售额','currency','模拟目标金额'),met('qty','目标销量','integer','模拟目标数量'),met('unitTarget','目标单价','price','目标销售额 ÷ 目标销量'),met('recordCount','记录数','integer','目标表行数')],
      defaults:{rows:['shape','model'],cols:['month'],measures:['amount','qty'],chart:{type:'line',x:'month',y:'amount',series:'shape'}},
      get(r,id){const m=r[0];switch(id){case 'year':return m.slice(0,4);case 'quarter':return `${m.slice(0,4)} Q${Math.ceil(Number(m.slice(5,7))/3)}`;case 'month':return m;case 'model':return r[1]||'未标注';case 'shape':return r[2]||'未标注';default:return '';}},
      accumulate(b,r){b.amount+=Number(r[3])||0;b.qty+=Number(r[4])||0;}
    },
    price: {
      id:'price', label:'价格监控', icon:'◇', rows:source.priceMonitor,
      timeField:'date', timeMin:source.meta.priceMonitorDateMin, timeMax:source.meta.priceMonitorDateMax,
      source:'价格监控.xlsx',
      grain:'采样日期 × 品牌 × 型号 × 对标型号',
      note:'价格为页面采样值；均价为样本算术平均，非成交均价，也不能代替销售明细中的实际成交价。',
      dimensions:[dim('year','年份','时间'),dim('month','月份','时间'),dim('date','采样日期','时间'),dim('brand','品牌','价格维度'),dim('model','型号','价格维度'),dim('benchmark','对标型号','价格维度')],
      measures:[met('meanPrice','样本均价','price','采样价格的算术平均'),met('minPrice','最低采样价','price','当前筛选范围最低值'),met('maxPrice','最高采样价','price','当前筛选范围最高值'),met('recordCount','样本数','integer','有效价格样本条数')],
      defaults:{rows:['benchmark','brand'],cols:[],measures:['meanPrice','minPrice','maxPrice'],chart:{type:'bar',x:'benchmark',y:'meanPrice',series:'brand'}},
      get(r,id){const d=r[0];switch(id){case 'year':return d.slice(0,4);case 'month':return d.slice(0,7);case 'date':return d;case 'brand':return r[1]||'未标注';case 'model':return r[2]||'未标注';case 'benchmark':return r[3]||'未标注';default:return '';}},
      accumulate(b,r){const p=Number(r[4]);if(Number.isFinite(p)){b.priceSum+=p;b.priceCount++;b.minPrice=Math.min(b.minPrice,p);b.maxPrice=Math.max(b.maxPrice,p);}}
    }
  };
  return specs;
}

export function emptyBucket(){return {recordCount:0,amount:0,qty:0,accounting:0,income:0,incomeTaxEq:0,sales:0,priceSum:0,priceCount:0,minPrice:Infinity,maxPrice:-Infinity};}
export function addRow(dataset,bucket,row){bucket.recordCount++;dataset.accumulate(bucket,row);return bucket;}
export function mergeBucket(target,source){
  for(const key of ['recordCount','amount','qty','accounting','income','incomeTaxEq','sales','priceSum','priceCount'])target[key]+=source[key];
  target.minPrice=Math.min(target.minPrice,source.minPrice);
  target.maxPrice=Math.max(target.maxPrice,source.maxPrice);
  return target;
}
export function getMetric(dataset,bucket,id,total=emptyBucket()){
  if(!bucket)return null;
  switch(id){
    case 'recordCount':return bucket.recordCount;
    case 'amountShare':return total.amount ? bucket.amount/total.amount : null;
    case 'salesShare':return total.sales ? bucket.sales/total.sales : null;
    case 'avgPrice':return bucket.qty ? (dataset.id==='market'?bucket.sales:bucket.amount)/bucket.qty : null;
    case 'unitIncome':return bucket.qty ? bucket.income/bucket.qty : null;
    case 'unitTarget':return bucket.qty ? bucket.amount/bucket.qty : null;
    case 'salesIndex':return bucket.qty>0&&bucket.amount>0&&bucket.accounting>0 ? bucket.amount/bucket.accounting : null;
    case 'meanPrice':return bucket.priceCount ? bucket.priceSum/bucket.priceCount : null;
    case 'minPrice':return Number.isFinite(bucket.minPrice)?bucket.minPrice:null;
    case 'maxPrice':return Number.isFinite(bucket.maxPrice)?bucket.maxPrice:null;
    default:return Number.isFinite(bucket[id])?bucket[id]:null;
  }
}

export function filterRows(dataset,state){
  const result=[];const filters=state.filters||[];
  const start=state.dateStart||'';const end=state.dateEnd||'';
  for(const row of dataset.rows){
    const t=String(dataset.get(row,dataset.timeField));
    if(start && t<start.slice(0,t.length))continue;
    if(end && t>end.slice(0,t.length))continue;
    let keep=true;
    for(const filter of filters){if(filter.values?.length && !filter.values.includes(String(dataset.get(row,filter.field)))){keep=false;break;}}
    if(keep)result.push(row);
  }
  return result;
}

export function aggregate(dataset,rows){const b=emptyBucket();for(const row of rows)addRow(dataset,b,row);return b;}

export function pivot(dataset,rows,state){
  const rowDims=state.rows||[],colDims=state.cols||[];
  const rowMap=new Map(),colMap=new Map(),cells=new Map(),subtotals=new Map(),subtotalCells=new Map();
  const all=emptyBucket();
  for(const row of rows){
    const rv=rowDims.map(f=>String(dataset.get(row,f)));const cv=colDims.map(f=>String(dataset.get(row,f)));
    const rk=JSON.stringify(rv),ck=JSON.stringify(cv),cellKey=`${rk}\u0001${ck}`;
    if(!rowMap.has(rk))rowMap.set(rk,{key:rk,parts:rv,bucket:emptyBucket()});
    if(!colMap.has(ck))colMap.set(ck,{key:ck,parts:cv,bucket:emptyBucket()});
    if(!cells.has(cellKey))cells.set(cellKey,emptyBucket());
    addRow(dataset,rowMap.get(rk).bucket,row);
    addRow(dataset,colMap.get(ck).bucket,row);
    addRow(dataset,cells.get(cellKey),row);
    for(let depth=1;depth<rv.length;depth++){
      const prefix=rv.slice(0,depth),pk=JSON.stringify(prefix),subCellKey=`${pk}\u0001${ck}`;
      if(!subtotals.has(pk))subtotals.set(pk,{key:pk,parts:prefix,bucket:emptyBucket()});
      if(!subtotalCells.has(subCellKey))subtotalCells.set(subCellKey,emptyBucket());
      addRow(dataset,subtotals.get(pk).bucket,row);
      addRow(dataset,subtotalCells.get(subCellKey),row);
    }
    addRow(dataset,all,row);
  }
  const first=state.measures?.[0]||dataset.measures[0].id;
  const sort=(a,b)=>{
    if(state.sort==='label')return a.parts.join(' / ').localeCompare(b.parts.join(' / '),'zh-CN');
    const x=getMetric(dataset,a.bucket,first,all)||0,y=getMetric(dataset,b.bucket,first,all)||0;
    return state.sort==='asc'?x-y:y-x;
  };
  const rowGroups=[...rowMap.values()].sort(sort),colGroups=[...colMap.values()].sort((a,b)=>a.parts.join(' / ').localeCompare(b.parts.join(' / '),'zh-CN'));
  return {rowGroups,colGroups,cells,subtotals,subtotalCells,all,filteredCount:rows.length,
    cell(rowKey,colKey){return cells.get(`${rowKey}\u0001${colKey}`)||null;},
    subtotalCell(rowKey,colKey){return subtotalCells.get(`${rowKey}\u0001${colKey}`)||null;}};
}

const dateOnly=s=>String(s).slice(0,10);
const utcDate=s=>new Date(`${dateOnly(s)}T12:00:00Z`);
const isoDate=d=>d.toISOString().slice(0,10);
const monthIndex=s=>Number(s.slice(0,4))*12+Number(s.slice(5,7))-1;
const fromMonthIndex=n=>`${String(Math.floor(n/12)).padStart(4,'0')}-${String(n%12+1).padStart(2,'0')}`;
const shiftMonth=(s,n)=>fromMonthIndex(monthIndex(s)+n);
const shiftDay=(s,n)=>{const d=utcDate(s);d.setUTCDate(d.getUTCDate()+n);return isoDate(d);};
const shiftYear=(s,n)=>{const year=Number(s.slice(0,4))+n,month=Number(s.slice(5,7)),day=Number(s.slice(8,10));return `${year}-${String(month).padStart(2,'0')}-${String(Math.min(day,new Date(Date.UTC(year,month,0)).getUTCDate())).padStart(2,'0')}`;};

export function comparisonRange(dataset,state){
  const mode=state.compare||'none';if(mode==='none')return null;
  const monthly=dataset.timeField==='month';
  const currentStart=(state.dateStart||dataset.timeMin).slice(0,monthly?7:10);
  const currentEnd=(state.dateEnd||dataset.timeMax).slice(0,monthly?7:10);
  if(!currentStart||!currentEnd||currentStart>currentEnd)return null;
  let priorStart,priorEnd,shift;
  if(mode==='yoy'){
    priorStart=monthly?shiftMonth(currentStart,-12):shiftYear(currentStart,-1);
    priorEnd=monthly?shiftMonth(currentEnd,-12):shiftYear(currentEnd,-1);
    shift=t=>monthly?shiftMonth(t,12):shiftYear(t,1);
  }else if(mode==='pop'){
    if(monthly){const count=monthIndex(currentEnd)-monthIndex(currentStart)+1;priorStart=shiftMonth(currentStart,-count);priorEnd=shiftMonth(currentEnd,-count);shift=t=>shiftMonth(t,count);}
    else{const count=Math.round((utcDate(currentEnd)-utcDate(currentStart))/864e5)+1;priorStart=shiftDay(currentStart,-count);priorEnd=shiftDay(currentEnd,-count);shift=t=>shiftDay(t,count);}
  }else return null;
  return {mode,currentStart,currentEnd,priorStart,priorEnd,shift,available:priorStart>=dataset.timeMin&&priorEnd<=dataset.timeMax};
}

export function comparisonPivot(dataset,state){
  const range=comparisonRange(dataset,state);if(!range)return null;
  if(!range.available)return {...range,rows:[],pivot:null};
  const aligned={...dataset,get(row,id){
    if(['date','month','year','quarter'].includes(id)){
      const t=range.shift(String(dataset.get(row,dataset.timeField)));
      if(id==='date')return t;
      if(id==='month')return t.slice(0,7);
      if(id==='year')return t.slice(0,4);
      return `${t.slice(0,4)} Q${Math.ceil(Number(t.slice(5,7))/3)}`;
    }
    return dataset.get(row,id);
  }};
  const rows=filterRows(aligned,{...state,dateStart:range.currentStart,dateEnd:range.currentEnd});
  return {...range,rows,pivot:rows.length?pivot(aligned,rows,state):null,available:rows.length>0};
}

export function chartAggregate(dataset,rows,xField,yField,seriesField){
  const xMap=new Map(),seriesSet=new Set();const all=aggregate(dataset,rows);
  for(const row of rows){
    const x=String(dataset.get(row,xField));const series=seriesField?String(dataset.get(row,seriesField)):'合计';
    if(!xMap.has(x))xMap.set(x,new Map());
    const bucketMap=xMap.get(x);if(!bucketMap.has(series))bucketMap.set(series,emptyBucket());
    addRow(dataset,bucketMap.get(series),row);seriesSet.add(series);
  }
  const series=[...seriesSet].sort((a,b)=>a.localeCompare(b,'zh-CN'));
  const points=[...xMap].map(([x,map])=>{const bucket=emptyBucket();for(const b of map.values())mergeBucket(bucket,b);return {x,buckets:map,bucket,values:Object.fromEntries([...map].map(([s,b])=>[s,getMetric(dataset,b,yField,all)])),total:getMetric(dataset,bucket,yField,all)||0};});
  points.sort((a,b)=>/^(year|quarter|month|date)$/.test(xField)?a.x.localeCompare(b.x):b.total-a.total);
  return {points,series,all};
}

export function chartDisplay(dataset,chart,xField,yField,{topX=11,topSeries=4,timeLimit=12}={}){
  const timeAxis=/^(year|quarter|month|date)$/.test(xField);
  const original=chart.points,chosen=timeAxis?original.slice(-timeLimit):original.slice(0,topX);
  const omitted=timeAxis?[]:original.slice(topX);
  const seriesTotals=new Map();
  for(const point of original)for(const [name,bucket] of point.buckets){if(!seriesTotals.has(name))seriesTotals.set(name,emptyBucket());mergeBucket(seriesTotals.get(name),bucket);}
  const seriesRank=[...seriesTotals].sort((a,b)=>(getMetric(dataset,b[1],yField,chart.all)||0)-(getMetric(dataset,a[1],yField,chart.all)||0));
  const shownSeries=seriesRank.slice(0,topSeries).map(([name])=>name),otherSeries=seriesRank.slice(topSeries).map(([name])=>name);
  const series=otherSeries.length?[...shownSeries,'其他系列']:shownSeries;
  const pointFrom=(x,buckets)=>{
    const values={};for(const name of shownSeries)if(buckets.has(name))values[name]=getMetric(dataset,buckets.get(name),yField,chart.all);
    if(otherSeries.length){const b=emptyBucket();for(const name of otherSeries)if(buckets.has(name))mergeBucket(b,buckets.get(name));if(b.recordCount)values['其他系列']=getMetric(dataset,b,yField,chart.all);}
    return {x,values};
  };
  const points=chosen.map(p=>pointFrom(p.x,p.buckets));
  if(omitted.length){const buckets=new Map();for(const point of omitted)for(const [name,b] of point.buckets){if(!buckets.has(name))buckets.set(name,emptyBucket());mergeBucket(buckets.get(name),b);}points.push(pointFrom('其他类别',buckets));}
  const basis=dataset.id==='market'?'sales':dataset.id==='income'?'income':dataset.id==='price'?'recordCount':'amount';
  const shownTotal=chosen.reduce((sum,p)=>sum+(p.bucket[basis]||0),0),allTotal=chart.all[basis]||0;
  const coverage=allTotal>0?shownTotal/allTotal:null;
  return {points,series,omittedX:omitted.length,omittedSeries:otherSeries.length,timeOmitted:timeAxis?Math.max(0,original.length-chosen.length):0,shownX:chosen.length,totalX:original.length,coverage,basis};
}
