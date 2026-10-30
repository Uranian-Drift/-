import {createDatasets,filterRows,pivot,getMetric,chartAggregate,chartDisplay,comparisonPivot,emptyBucket,addRow} from './engine.mjs?v=20261030n1a';

const source=window.WATER_HEATER_DATA,income=window.WATER_HEATER_INCOME_DATA;
const datasets=createDatasets(source,income);
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=(v,d=0)=>new Intl.NumberFormat('zh-CN',{minimumFractionDigits:d,maximumFractionDigits:d}).format(v);
const colors=['#ad2533','#466b91','#c5914a','#789c86','#86678d'];
const savedKey='fotile-self-bi-views-v1';
const monthEnd=m=>{const [y,n]=m.split('-').map(Number);return `${m}-${String(new Date(y,n,0).getDate()).padStart(2,'0')}`;};
let dataset=datasets.sales,state,filtered=[],pivotData=null,comparison=null,drillScope=null,activeTab='pivot',toastTimer,modalCleanup=null;
const states=new Map();
const collapsedRows=new Set();

function dimension(id){return dataset.dimensions.find(f=>f.id===id);}
function measure(id){return dataset.measures.find(f=>f.id===id);}
function field(id){return dimension(id)||measure(id);}
function defaultState(ds){
  const year=ds.timeMax.slice(0,4);
  const dateStart=ds.id==='target'?ds.rows[0]?.[0]?.slice(0,7)+'-01':ds.id==='price'?ds.timeMin:year+'-01-01';
  const cols=ds.id==='sales'||ds.id==='income'||ds.id==='market'?['quarter']:[...ds.defaults.cols];
  return {dataset:ds.id,rows:[...ds.defaults.rows],cols,measures:[...ds.defaults.measures],filters:[],dateStart,dateEnd:ds.timeMax.length===7?monthEnd(ds.timeMax):ds.timeMax,sort:'desc',sortBy:null,unit:'wan',compare:['sales','income','market'].includes(ds.id)?'yoy':'none',chart:{...ds.defaults.chart},title:'经营数据即席分析'};
}
function validState(ds,s){
  const d=new Set(ds.dimensions.map(f=>f.id)),m=new Set(ds.measures.map(f=>f.id));
  return {...defaultState(ds),...s,dataset:ds.id,rows:(s.rows||[]).filter(x=>d.has(x)).slice(0,3),cols:(s.cols||[]).filter(x=>d.has(x)).slice(0,2),measures:(s.measures||[]).filter(x=>m.has(x)).slice(0,5),filters:(s.filters||[]).filter(x=>d.has(x.field)).map(x=>({field:x.field,values:Array.isArray(x.values)?x.values.map(String):[]})).slice(0,8),compare:['none','yoy','pop'].includes(s.compare)?s.compare:defaultState(ds).compare,sortBy:s.sortBy&&['label','cell','total','prior','delta'].includes(s.sortBy.scope)&&(s.sortBy.scope==='label'?d.has(s.sortBy.metric):m.has(s.sortBy.metric))?s.sortBy:null,chart:{...ds.defaults.chart,...(s.chart||{})}};
}
function formatValue(metricId,value,{unit=state.unit,short=false}={}){
  if(value===null||value===undefined||!Number.isFinite(value))return '—';
  const f=measure(metricId);if(!f)return num(value,2);
  if(f.format==='index')return num(value,3);
  if(f.format==='percent')return num(value*100,1)+'%';
  if(f.format==='integer')return num(value,0);
  if(f.format==='price')return (short?'':'¥')+num(value,0);
  if(f.format==='currency')return unit==='wan'?num(value/10000,short?1:2)+(short?'万':''):num(value,short?0:2);
  return num(value,2);
}
function metricLabel(id){const f=measure(id);return f?f.label+(f.format==='currency'?`（${state.unit==='wan'?'万元':'元'}）`:''):id;}
function metricHint(id,bucket){return id==='salesIndex'&&bucket?`销售金额 ${num(bucket.amount,2)} 元 ÷ 核算价金额合计 ${num(bucket.accounting,2)} 元；净销量 ${num(bucket.qty)} 台${bucket.qty<=0||bucket.amount<=0||bucket.accounting<=0?'。净销量或金额非正，指数不展示':''}`:'';}
function timeLabel(ds){return `${ds.timeMin}—${ds.timeMax}`;}
function toast(msg){const el=$('toast');el.textContent=msg;el.classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.add('hidden'),3000);}
function saveStateToMap(){states.set(dataset.id,structuredClone(state));}

function renderDatasetList(){
  $('datasetSelect').innerHTML=Object.values(datasets).map(d=>`<option value="${d.id}">${d.label}</option>`).join('');
  $('datasetSelect').value=dataset.id;
  $('datasetMeta').innerHTML=`<strong>${num(dataset.rows.length)}</strong> 行 · ${esc(timeLabel(dataset))}<br><span class="grain">${esc(dataset.grain)}</span>`;
  $('fieldFooter').textContent=`${dataset.dimensions.length} 个维度 · ${dataset.measures.length} 个指标`;
}
function renderFields(){
  const q=$('fieldSearch').value.trim().toLowerCase();
  const groups=new Map();
  for(const f of [...dataset.dimensions,...dataset.measures]){
    if(q&&!`${f.label} ${f.id} ${f.note||''}`.toLowerCase().includes(q))continue;
    const g=f.kind==='measure'?'统计指标':f.group;
    if(!groups.has(g))groups.set(g,[]);groups.get(g).push(f);
  }
  $('fieldList').innerHTML=[...groups].map(([name,fields])=>`<div class="field-group"><div class="field-group-title">${esc(name)}<b>${fields.length}</b></div>${fields.map(f=>`<div class="field-item ${f.kind==='measure'?'measure':''}" draggable="true" data-field="${esc(f.id)}" title="${esc(f.note||'拖入分析区')}"><span class="field-symbol">${f.kind==='measure'?'Σ':'▦'}</span><span>${esc(f.label)}</span><span class="add">＋</span></div>`).join('')}</div>`).join('')||'<div class="saved-empty">没有匹配的字段</div>';
}
function zoneItems(zone){
  if(zone==='filters')return state.filters.map(x=>x.field);
  if(zone==='chartX')return state.chart.x?[state.chart.x]:[];
  if(zone==='chartY')return state.chart.y?[state.chart.y]:[];
  if(zone==='chartSeries')return state.chart.series?[state.chart.series]:[];
  return state[zone]||[];
}
function renderZones(){
  const placeholders={rows:'拖入行维度',cols:'拖入列维度（可留空）',measures:'拖入统计指标',filters:'拖入筛选字段',chartX:'拖入维度',chartY:'拖入指标',chartSeries:'可留空'};
  for(const zone of ['rows','cols','measures','filters','chartX','chartY','chartSeries']){
    const ids=zoneItems(zone),el=document.querySelector(`[data-zone="${zone}"]`);if(!el)continue;
    el.innerHTML=ids.length?ids.map(id=>{
      const f=field(id);if(!f)return '';
      const flt=zone==='filters'?state.filters.find(x=>x.field===id):null,selected=flt?.values?.length;
      return `<span class="chip ${f.kind==='measure'?'measure':''} ${zone==='filters'?'filter':''} ${selected?'active-filter':''}" draggable="true" data-field="${esc(id)}" data-from="${zone}"><span class="chip-label" data-open-filter="${zone==='filters'?esc(id):''}">${esc(f.label)}${selected?` · ${selected} 项`:''}</span>${zone==='filters'?'<span class="chip-arrow" data-open-filter="'+esc(id)+'">▼</span>':''}<button class="chip-close" data-remove="${esc(id)}" data-zone="${zone}" aria-label="移除 ${esc(f.label)}">×</button></span>`;
    }).join(''):`<span class="zone-placeholder">${placeholders[zone]}</span>`;
  }
  $('dateStart').value=state.dateStart||'';$('dateEnd').value=state.dateEnd||'';
  $('unitSelect').value=state.unit;$('sortSelect').value=state.sortBy?'custom':state.sort;$('chartType').value=state.chart.type;$('compareSelect').value=state.compare;
}
function compareLabel(){return state.compare==='yoy'?'同比':'上期';}
function compareValue(id,current,prior){
  if(current===null||prior===null||!Number.isFinite(current)||!Number.isFinite(prior))return '—';
  if(measure(id)?.format==='index')return current>=0&&prior>=0?`${current-prior>=0?'+':''}${num(current-prior,3)}`:'—';
  if(measure(id)?.format==='percent')return current>=0&&prior>=0?`${current-prior>=0?'+':''}${num((current-prior)*100,1)} 个百分点`:'—';
  if(prior<=0||current<0)return '—';
  return `${current/prior-1>=0?'+':''}${num((current/prior-1)*100,1)}%`;
}
function metricOrZero(bucket,id,total){
  if(bucket)return getMetric(dataset,bucket,id,total);
  return ['amount','income','incomeTaxEq','qty','sales','accounting','recordCount'].includes(id)?0:null;
}
function compareGroup(row){
  if(!comparison?.available)return null;
  if(!state.rows.length)return comparison.pivot.all;
  const key=JSON.stringify(row.parts);
  return row.kind==='subtotal'?comparison.pivot.subtotals.get(key)?.bucket:comparison.pivot.rowGroups.find(x=>x.key===key)?.bucket;
}
function renderQuickRanges(){
  const latest=dataset.timeMax.length===7?monthEnd(dataset.timeMax):dataset.timeMax;
  const year=latest.slice(0,4),prev=String(Number(year)-1);
  const ranges=[{id:'latest',label:`${year} 年累计`,from:`${year}-01-01`,to:latest},{id:'previous',label:`${prev} 全年`,from:`${prev}-01-01`,to:`${prev}-12-31`},{id:'all',label:'全部时间',from:dataset.timeMin.length===7?dataset.timeMin+'-01':dataset.timeMin,to:latest}];
  if(dataset.timeField==='date')ranges.splice(1,0,{id:'last30',label:'最近 30 天',from:new Date(new Date(latest+'T12:00:00').getTime()-29*864e5).toISOString().slice(0,10),to:latest});
  $('quickRanges').innerHTML=ranges.map(r=>`<button class="quick-range ${state.dateStart===r.from&&state.dateEnd===r.to?'active':''}" data-range="${r.id}" data-from="${r.from}" data-to="${r.to}">${r.label}</button>`).join('');
}
function renderCards(){
  const b=pivotData.all,ids=dataset.id==='sales'?['amount','qty','avgPrice','salesIndex']:dataset.id==='income'?['income','incomeTaxEq','qty','unitIncome']:dataset.id==='market'?['sales','qty','avgPrice','recordCount']:dataset.id==='target'?['amount','qty','unitTarget','recordCount']:['meanPrice','minPrice','maxPrice','recordCount'];
  $('metricCards').innerHTML=ids.map(id=>{
    const current=getMetric(dataset,b,id,b),prior=comparison?.available?getMetric(dataset,comparison.pivot.all,id,comparison.pivot.all):null;
    const foot=state.compare==='none'?measure(id)?.note||'当前筛选范围':comparison?.available?`${compareLabel()} ${formatValue(id,prior,{short:true})} · ${measure(id)?.format==='index'?'净值差 ':''}${compareValue(id,current,prior)}`:`${compareLabel()}数据不足`;
    return `<article class="metric-card" title="${esc(metricHint(id,b)||measure(id)?.note||'')}"><div class="metric-card-label"><span>${esc(measure(id)?.label||id)}</span><span>↗</span></div><div class="metric-card-value">${formatValue(id,current,{short:true})}</div><div class="metric-card-foot">${esc(foot)}</div></article>`;
  }).join('');
}
function sortButton(label,scope,metric='',colKey=''){
  const active=state.sortBy?.scope===scope&&state.sortBy?.metric===metric&&state.sortBy?.colKey===colKey;
  return `<button class="sort-head ${active?'active':''}" data-sort-scope="${scope}" data-sort-metric="${esc(metric)}" data-sort-col="${esc(colKey)}" title="按此列排序；再次点击切换方向">${esc(label)}<span aria-hidden="true">${active?(state.sortBy.direction==='asc'?' ↑':' ↓'):' ↕'}</span></button>`;
}
function hierarchyRows(allExpanded=false){
  const leaves=pivotData.rowGroups;
  const result=[],first=state.measures[0]||dataset.measures[0].id;
  const score=item=>{
    const rule=state.sortBy,metric=rule?.metric||first;
    if(!rule)return getMetric(dataset,item.bucket,metric,pivotData.all);
    if(rule.scope==='label')return null;
    const isSubtotal=item.parts.length<state.rows.length;
    const currentBucket=rule.scope==='cell'?(isSubtotal?pivotData.subtotalCell(item.key,rule.colKey):pivotData.cell(item.key,rule.colKey)):item.bucket;
    if(rule.scope==='prior'||rule.scope==='delta'){
      if(!comparison?.available)return null;
      const priorBucket=compareGroup({...item,kind:isSubtotal?'subtotal':'leaf'});
      const prior=metricOrZero(priorBucket,metric,comparison.pivot.all);
      if(rule.scope==='prior')return prior;
      const current=getMetric(dataset,item.bucket,metric,pivotData.all);
      if(current===null||prior===null||!Number.isFinite(current)||!Number.isFinite(prior))return null;
      if(measure(metric)?.format==='index'||measure(metric)?.format==='percent')return current-prior;
      return prior>0&&current>=0?current/prior-1:null;
    }
    return getMetric(dataset,currentBucket,metric,pivotData.all);
  };
  const sort=(a,b)=>{
    const label=a.parts.join('/').localeCompare(b.parts.join('/'),'zh-CN');
    if(state.sortBy?.scope==='label'){
      const index=state.rows.indexOf(state.sortBy.metric);
      const x=a.parts[index]??a.parts.join('/'),y=b.parts[index]??b.parts.join('/');
      return (state.sortBy.direction==='desc'?-1:1)*(x.localeCompare(y,'zh-CN')||label);
    }
    if(!state.sortBy&&state.sort==='label')return label;
    const x=score(a),y=score(b);
    if(x===null||!Number.isFinite(x))return y===null||!Number.isFinite(y)?label:1;
    if(y===null||!Number.isFinite(y))return -1;
    return (state.sortBy?.direction==='asc'||!state.sortBy&&state.sort==='asc'?1:-1)*(x-y)||label;
  };
  if(state.rows.length<2)return [...leaves].sort(sort).map(r=>({...r,kind:'leaf',depth:state.rows.length}));
  function visit(parts,depth,subset){
    if(depth===state.rows.length-1){for(const leaf of [...subset].sort(sort))result.push({...leaf,kind:'leaf',depth:state.rows.length});return;}
    const groups=new Map();for(const leaf of subset){const key=JSON.stringify(leaf.parts.slice(0,depth+1));if(!groups.has(key))groups.set(key,[]);groups.get(key).push(leaf);}
    const prefixes=[...groups].map(([key,items])=>({...pivotData.subtotals.get(key),items})).sort(sort);
    for(const prefix of prefixes){result.push({...prefix,kind:'subtotal',depth:depth+1});if(allExpanded||!collapsedRows.has(prefix.key))visit(prefix.parts,depth+1,prefix.items);}
  }
  visit([],0,leaves);return result;
}
function renderPivot(){
  const root=$('pivotTable');if(!state.measures.length){root.innerHTML='<div class="empty-state">先把至少一个统计指标拖入「统计指标」区域</div>';return;}
  const allRows=pivotData.rowGroups,allCols=pivotData.colGroups;
  if(!allRows.length){root.innerHTML='<div class="empty-state">当前筛选条件下没有数据<br>请调整日期或筛选字段</div>';return;}
  const visibleRows=hierarchyRows(),rows=visibleRows.slice(0,120),cols=allCols.slice(0,24),m=state.measures,rowDims=state.rows,hasCompare=state.compare!=='none';
  let html='<table class="pivot-table"><thead>';
  if(state.cols.length){html+='<tr>'+rowDims.map((id,i)=>`<th class="dim-cell" rowspan="2">${sortButton(dimension(id)?.label||id,'label',id)}</th>`).join('');if(!rowDims.length)html+='<th class="dim-cell" rowspan="2">汇总</th>';
    html+=cols.map(c=>`<th colspan="${m.length}">${esc(c.parts.join(' / ')||'合计')}</th>`).join('');
    html+=`<th colspan="${m.length}">当前总计</th>`;
    if(hasCompare)html+=`<th colspan="${m.length*2}">${compareLabel()}对比</th>`;
    html+='<th rowspan="2">查看</th></tr><tr>'+cols.map(c=>m.map(id=>`<th>${sortButton(metricLabel(id),'cell',id,c.key)}</th>`).join('')).join('')+m.map(id=>`<th>${sortButton(metricLabel(id),'total',id)}</th>`).join('');
    if(hasCompare)html+=m.map(id=>`<th>${sortButton(`${compareLabel()} ${metricLabel(id)}`,'prior',id)}</th><th>${sortButton(measure(id)?.format==='index'?'指数净值差':measure(id)?.format==='percent'?'变化百分点':'变化率','delta',id)}</th>`).join('');
    html+='</tr>';
  }else{html+='<tr>'+rowDims.map(id=>`<th class="dim-cell">${sortButton(dimension(id)?.label||id,'label',id)}</th>`).join('');if(!rowDims.length)html+='<th class="dim-cell">汇总</th>';html+=m.map(id=>`<th>${sortButton(metricLabel(id),'total',id)}</th>`).join('');if(hasCompare)html+=m.map(id=>`<th>${sortButton(`${compareLabel()} ${metricLabel(id)}`,'prior',id)}</th><th>${sortButton(measure(id)?.format==='index'?'指数净值差':measure(id)?.format==='percent'?'变化百分点':'变化率','delta',id)}</th>`).join('');html+='<th>查看</th></tr>';}
  html+='</thead><tbody>';
  for(const r of rows){html+=`<tr class="${r.kind==='subtotal'?'subtotal-row':''}">`;
    if(rowDims.length){for(let i=0;i<rowDims.length;i++){
      let label=r.parts[i]??'';
      if(r.kind==='subtotal'&&i===r.depth-1)label=`<button class="fold-btn" data-collapse="${esc(r.key)}" aria-expanded="${!collapsedRows.has(r.key)}">${collapsedRows.has(r.key)?'▸':'▾'} ${esc(label)} 小计</button>`;
      else label=esc(label);
      html+=`<td class="dim-cell ${i===0?'sticky-dim':''}">${label}</td>`;
    }}else html+='<td class="dim-cell">全部数据</td>';
    for(const c of cols){const b=r.kind==='subtotal'?pivotData.subtotalCell(r.key,c.key):pivotData.cell(r.key,c.key);html+=m.map(id=>{const v=getMetric(dataset,b,id,pivotData.all);return `<td class="${v===null?'null':''}" title="${esc(metricHint(id,b))}">${formatValue(id,v)}</td>`;}).join('');}
    if(state.cols.length)html+=m.map(id=>`<td class="total-col" title="${esc(metricHint(id,r.bucket))}">${formatValue(id,getMetric(dataset,r.bucket,id,pivotData.all))}</td>`).join('');
    if(hasCompare){const priorBucket=compareGroup(r);html+=m.map(id=>{const current=getMetric(dataset,r.bucket,id,pivotData.all),prior=comparison?.available?metricOrZero(priorBucket,id,comparison.pivot.all):null;return `<td class="compare-col">${formatValue(id,prior)}</td><td class="compare-delta">${compareValue(id,current,prior)}</td>`;}).join('');}
    html+=`<td><button class="drill-btn" data-drill="${esc(JSON.stringify(r.parts))}">明细 →</button></td>`;
    html+='</tr>';
  }
  if(state.rows.length){html+='<tr class="grand">'+`<td class="dim-cell" colspan="${rowDims.length}">总计</td>`;
    for(const c of cols)html+=m.map(id=>`<td title="${esc(metricHint(id,c.bucket))}">${formatValue(id,getMetric(dataset,c.bucket,id,pivotData.all))}</td>`).join('');
    if(state.cols.length)html+=m.map(id=>`<td title="${esc(metricHint(id,pivotData.all))}">${formatValue(id,getMetric(dataset,pivotData.all,id,pivotData.all))}</td>`).join('');
    if(hasCompare)html+=m.map(id=>{const current=getMetric(dataset,pivotData.all,id,pivotData.all),prior=comparison?.available?getMetric(dataset,comparison.pivot.all,id,comparison.pivot.all):null;return `<td>${formatValue(id,prior)}</td><td>${compareValue(id,current,prior)}</td>`;}).join('');
    html+='<td></td>';
    html+='</tr>';
  }
  html+='</tbody></table>';root.innerHTML=html;
  $('tableSummary').textContent=`${num(allRows.length)} 个末级组合 · ${num(allCols.length)} 列组合 · 点击表头排序${state.rows.length>1?' · 点击小计可收起/展开':''}`;
  $('tableFoot').textContent=(visibleRows.length>rows.length||allCols.length>cols.length?`页面显示前 ${rows.length} 行、前 ${cols.length} 列组合；导出包含全部组合。`:'')+' 对比按所选日期同窗计算；'+(state.measures.includes('salesIndex')?'净销量、销售额或核算价金额合计非正时，销售指数显示「—」；悬停可核对分子分母。':'空值或分母为 0 显示「—」。');
}
function detailFields(){return dataset.id==='sales'?['date','shape','series','model','channel','business','store']:dataset.id==='income'?['month','business','channel']:dataset.id==='market'?['month','brand','model','volumeSegment','priceBand']:dataset.id==='target'?['month','shape','model']:['date','brand','model','benchmark'];}
function detailRows(){return drillScope?filtered.filter(row=>drillScope.parts.every((part,i)=>String(dataset.get(row,state.rows[i]))===part)):filtered;}
function renderDetail(){
  const records=detailRows();
  const dims=detailFields(),mets=dataset.measures.filter(m=>!['amountShare','salesShare','salesIndex','avgPrice','unitIncome','unitTarget','meanPrice','minPrice','maxPrice'].includes(m.id)).slice(0,3);
  $('detailSummary').textContent=`${drillScope?`下钻：${drillScope.parts.join(' / ')} · `:'筛选后 '}${num(records.length)} 行 · 预览前 100 行`;
  $('clearDrillBtn').classList.toggle('hidden',!drillScope);
  const header=dims.map(id=>`<th class="dim-cell">${esc(dimension(id)?.label||id)}</th>`).join('')+mets.map(m=>`<th>${esc(m.label)}</th>`).join('');
  const body=records.slice(0,100).map(r=>{const b=emptyBucket();addRow(dataset,b,r);return '<tr>'+dims.map(id=>`<td class="dim-cell">${esc(dataset.get(r,id))}</td>`).join('')+mets.map(m=>`<td>${formatValue(m.id,getMetric(dataset,b,m.id,b),{unit:'yuan'})}</td>`).join('')+'</tr>';}).join('');
  $('detailTable').innerHTML=`<table class="detail-table"><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`;
}
function svgText(x,y,text,cls='chart-axis',anchor='middle'){return `<text class="${cls}" x="${x}" y="${y}" text-anchor="${anchor}">${esc(text)}</text>`;}
function compactAxis(v,id){const f=measure(id);if(f?.format==='index')return num(v,2);if(f?.format==='percent')return num(v*100,0)+'%';if(f?.format==='price')return '¥'+num(v,0);if(Math.abs(v)>=10000000)return num(v/10000000,0)+'千万';if(Math.abs(v)>=10000)return num(v/10000,0)+'万';return num(v,0);}
function renderChart(){
  const el=$('chartSvg'),notice=$('chartNotice'),legend=$('chartLegend');const {x,y,series,type}=state.chart;
  if(!dimension(x)||!measure(y)){el.innerHTML='';notice.textContent='把维度拖到 X 横轴、指标拖到 Y 指标后即可绘图。';legend.innerHTML='';return;}
  let out=chartAggregate(dataset,filtered,x,y,dimension(series)?series:null);
  if(!out.points.length){el.innerHTML='';notice.textContent='当前筛选条件下没有可绘制的数据。';legend.innerHTML='';return;}
  const display=chartDisplay(dataset,out,x,y),points=display.points,seriesNames=display.series;
  const notices=[];
  if(display.omittedX)notices.push(`前 ${display.shownX} 类覆盖 ${display.coverage===null?'—':num(display.coverage*100,1)+'%'}，其余 ${display.omittedX} 类汇入「其他类别」`);
  if(display.omittedSeries)notices.push(`前 ${seriesNames.length-1} 个系列之外的 ${display.omittedSeries} 个系列汇入「其他系列」`);
  if(display.timeOmitted)notices.push(`时间轴显示最近 ${display.shownX} 期，共 ${display.totalX} 期；完整结果见透视表`);
  notice.textContent=notices.join('；');
  const W=Math.max(740,$('chartView').clientWidth-35),H=350,left=65,right=25,top=25,bottom=type==='horizontal'?35:77,plotW=W-left-right,plotH=H-top-bottom;
  el.setAttribute('viewBox',`0 0 ${W} ${H}`);
  const vals=points.flatMap(p=>seriesNames.map(s=>p.values[s]??0));const minVal=Math.min(0,...vals),maxVal=Math.max(0,...vals);const span=(maxVal-minVal)||1;
  let svg='';
  if(type==='horizontal'){
    const plotLeft=150,plotRight=50,pw=W-plotLeft-plotRight;const min=Math.min(0,...vals),max=Math.max(0,...vals),range=(max-min)||1,zeroX=plotLeft+pw*(0-min)/range;
    for(let i=0;i<=4;i++){const tx=plotLeft+pw*i/4;svg+=`<line class="chart-grid" x1="${tx}" y1="${top}" x2="${tx}" y2="${H-bottom}"/>${svgText(tx,H-10,compactAxis(min+range*i/4,y))}`;}
    const groupH=plotH/points.length,barH=Math.min(16,groupH/(seriesNames.length+1));
    points.forEach((p,i)=>{svg+=svgText(plotLeft-12,top+groupH*(i+.55),p.x.length>15?p.x.slice(0,14)+'…':p.x,'chart-axis','end');seriesNames.forEach((s,j)=>{const v=p.values[s]||0,xv=plotLeft+pw*(v-min)/range;svg+=`<rect x="${Math.min(zeroX,xv)}" y="${top+i*groupH+groupH*.18+j*barH}" width="${Math.max(1,Math.abs(xv-zeroX))}" height="${Math.max(2,barH-2)}" rx="2" fill="${colors[j%colors.length]}"><title>${esc(p.x)} / ${esc(s)}：${esc(formatValue(y,p.values[s],{short:true}))}</title></rect>`;});});
  }else{
    const yPos=v=>top+plotH-(v-minVal)/span*plotH;
    for(let i=0;i<=4;i++){const v=minVal+span*i/4,py=yPos(v);svg+=`<line class="chart-grid" x1="${left}" y1="${py}" x2="${W-right}" y2="${py}"/>${svgText(left-9,py+4,compactAxis(v,y),'chart-axis','end')}`;}
    const groupW=plotW/points.length;
    points.forEach((p,i)=>{const xMid=left+groupW*(i+.5);svg+=svgText(xMid,H-37,p.x.length>10?p.x.slice(0,9)+'…':p.x);});
    if(type==='line'){
      seriesNames.forEach((s,j)=>{let path='';points.forEach((p,i)=>{const v=p.values[s];if(v===undefined||v===null)return;const px=left+groupW*(i+.5),py=yPos(v);path+=(path?' L':'M')+px+' '+py;});svg+=`<path d="${path}" fill="none" stroke="${colors[j%colors.length]}" stroke-width="2.4"/>`;points.forEach((p,i)=>{const v=p.values[s];if(v===undefined||v===null)return;svg+=`<circle cx="${left+groupW*(i+.5)}" cy="${yPos(v)}" r="3.6" fill="${colors[j%colors.length]}"><title>${esc(p.x)} / ${esc(s)}：${esc(formatValue(y,v,{short:true}))}</title></circle>`;});});
    }else{
      const barW=Math.min(28,groupW*.72/seriesNames.length),gap=2;
      points.forEach((p,i)=>seriesNames.forEach((s,j)=>{const v=p.values[s];if(v===undefined||v===null)return;const x0=left+groupW*(i+.5)-(seriesNames.length*barW+(seriesNames.length-1)*gap)/2+j*(barW+gap),y0=yPos(Math.max(0,v)),height=Math.abs(yPos(v)-yPos(0));svg+=`<rect x="${x0}" y="${y0}" width="${barW}" height="${Math.max(1,height)}" rx="2" fill="${colors[j%colors.length]}"><title>${esc(p.x)} / ${esc(s)}：${esc(formatValue(y,v,{short:true}))}</title></rect>`;}));
    }
  }
  el.innerHTML=svg;
  legend.innerHTML=seriesNames.map((s,i)=>`<span class="legend-item"><i class="legend-swatch" style="background:${colors[i%colors.length]}"></i>${esc(s)}</span>`).join('');
}
function renderAll(){
  renderDatasetList();renderFields();renderZones();renderQuickRanges();
  $('sourceStrip').textContent=`${dataset.label}｜${dataset.note}`;
  $('footerSource').textContent=`快照生成 ${dataset.id==='income'?income.meta.generatedAt:source.meta.generatedAt} · 覆盖 ${timeLabel(dataset)}`;
  $('viewTitle').textContent=state.title||'经营数据即席分析';
  $('viewSubtitle').textContent=`${dataset.label} · ${dataset.grain}`;
  filtered=filterRows(dataset,state);pivotData=pivot(dataset,filtered,state);comparison=comparisonPivot(dataset,state);
  $('compareStatus').textContent=state.compare==='none'?'':comparison?.available?`当前 ${comparison.currentStart}—${comparison.currentEnd}；${compareLabel()} ${comparison.priorStart}—${comparison.priorEnd}，按时间字段对齐`:`${compareLabel()}范围超出数据覆盖或没有可比记录，显示「—」`;
  $('filterCount').textContent=`${num(filtered.length)} / ${num(dataset.rows.length)} 行符合条件`;
  $('resultSummary').textContent=`基于 ${num(filtered.length)} 行数据生成`;
  renderCards();renderPivot();if(activeTab==='chart')renderChart();if(activeTab==='detail')renderDetail();saveStateToMap();
}

function addField(id,zone){
  const f=field(id);if(!f)return;
  const wantsMeasure=['measures','chartY'].includes(zone),wantsDimension=!wantsMeasure;
  if((wantsMeasure&&f.kind!=='measure')||(wantsDimension&&f.kind!=='dimension')){toast(wantsMeasure?'这里需要统计指标':'这里需要维度字段');return;}
  if(zone==='chartX'){state.chart.x=id;}else if(zone==='chartY'){state.chart.y=id;}else if(zone==='chartSeries'){state.chart.series=id;}else if(zone==='filters'){
    if(!state.filters.some(x=>x.field===id))state.filters.push({field:id,values:[]});
  }else{
    if(state[zone].includes(id))return;
    if((zone==='rows'&&state.rows.length>=3)||(zone==='cols'&&state.cols.length>=2)||(zone==='measures'&&state.measures.length>=5)){toast('该区域已达到字段上限');return;}
    state[zone].push(id);
  }
  if(['rows','cols','measures'].includes(zone))state.sortBy=null;
  if(zone==='rows'||zone==='cols')drillScope=null;
  if(zone==='rows')collapsedRows.clear();
  renderAll();
}
function removeField(id,zone){
  if(zone==='filters')state.filters=state.filters.filter(x=>x.field!==id);
  else if(zone==='chartX')state.chart.x='';else if(zone==='chartY')state.chart.y='';else if(zone==='chartSeries')state.chart.series='';
  else state[zone]=state[zone].filter(x=>x!==id);
  if(['rows','cols','measures'].includes(zone))state.sortBy=null;
  if(zone==='rows'||zone==='cols')drillScope=null;
  if(zone==='rows')collapsedRows.clear();
  renderAll();
}
function switchDataset(id){if(!datasets[id])return;saveStateToMap();dataset=datasets[id];state=states.has(id)?validState(dataset,states.get(id)):defaultState(dataset);drillScope=null;collapsedRows.clear();$('fieldSearch').value='';renderAll();toast(`已切换到「${dataset.label}」`);}
function showModal(title,body,actions=[]){
  if(modalCleanup){modalCleanup();modalCleanup=null;}
  $('modalTitle').textContent=title;$('modalBody').innerHTML=body;
  $('modalActions').innerHTML=actions.map(a=>`<button class="button ${a.primary?'button-primary':'button-light'}" data-modal-action="${esc(a.id)}">${esc(a.label)}</button>`).join('');
  $('overlay').classList.remove('hidden');$('modal').classList.remove('hidden');
}
function closeModal(){if(modalCleanup){modalCleanup();modalCleanup=null;}$('overlay').classList.add('hidden');$('modal').classList.add('hidden');}
function sourceModal(){showModal(`${dataset.label} · 数据与口径`,`<p>${esc(dataset.note)}</p><dl class="info-grid"><dt>数据来源</dt><dd>${esc(dataset.source)}</dd><dt>数据粒度</dt><dd>${esc(dataset.grain)}</dd><dt>覆盖范围</dt><dd>${esc(timeLabel(dataset))}</dd><dt>记录条数</dt><dd>${num(dataset.rows.length)} 行</dd><dt>快照生成</dt><dd>${dataset.id==='income'?income.meta.generatedAt:source.meta.generatedAt}</dd><dt>指标公式</dt><dd>${dataset.measures.filter(m=>m.note).map(m=>`${esc(m.label)}：${esc(m.note)}`).join('<br>')}</dd></dl><p style="margin-top:14px;color:#9a6d73">本工作台直接使用 5.1 当前数据快照。刷新 5.1 的数据并重新打开页面后，这里会同步更新。</p>`,[{id:'close',label:'知道了',primary:true}]);}
function helpModal(){showModal('如何使用自助工作台',`<p>1. 左侧选择数据集；拖拽字段到「行维度」「列维度」「统计指标」「筛选字段」。直接点击左侧字段可快速加入行或指标。</p><p>2. 日期范围和筛选字段共同决定分析样本。同比同窗按去年相同起止日期计算；上期按相同天数或月数计算。若数据覆盖不足，显示「—」。</p><p>3. 透视表可逐级展开小计；点击任意指标表头可排序，再点一次切换方向；点「明细」查看组成记录。图表超出展示上限的分类会汇入「其他」。</p><p>4. 保存视图会把配置留在本机浏览器；导出 CSV 可在 Excel 中打开。切换数据集不会把不同口径的数据拼接在一起。</p>`,[{id:'close',label:'开始使用',primary:true}]);}
function templateModal(){
  const presets={
    sales:[['形态与季度经营',['shape','series'],['quarter'],['amount','qty','avgPrice'],'shape','amount','quarter'],['渠道月度趋势',['channel'],['month'],['amount','qty','salesIndex'],'month','amount','channel'],['型号与渠道结构',['model'],['channel'],['amount','qty','amountShare'],'model','amount','channel']],
    income:[['业务部季度收入',['business'],['quarter'],['income','qty','unitIncome'],'business','income','quarter'],['渠道月度归集',['channel'],['month'],['income','incomeTaxEq'],'month','income','channel']],
    market:[['品牌市场表现',['brand'],['quarter'],['sales','qty','salesShare'],'brand','sales','quarter'],['价位段月度结构',['priceBand'],['month'],['sales','qty','avgPrice'],'month','sales','priceBand'],['品牌与升数段',['brand'],['volumeSegment'],['sales','qty','salesShare'],'brand','sales','volumeSegment']],
    target:[['形态月度目标',['shape'],['month'],['amount','qty'],'month','amount','shape'],['型号月度目标',['model'],['month'],['amount','qty','unitTarget'],'month','amount','model']],
    price:[['对标型号与品牌',['benchmark','brand'],[],['meanPrice','minPrice','maxPrice'],'benchmark','meanPrice','brand'],['型号价格变化',['model'],['date'],['meanPrice','recordCount'],'date','meanPrice','model']]
  }[dataset.id];
  showModal('选择分析模板',`<p>从常见分析问题出发；应用后仍可继续拖拽字段、筛选和改图表。</p>${presets.map((p,i)=>`<button class="template-option" data-template="${i}"><span><strong>${esc(p[0])}</strong><small>行：${p[1].map(x=>dimension(x)?.label).join(' / ')}　列：${p[2].map(x=>dimension(x)?.label).join(' / ')||'无'}</small></span><b>→</b></button>`).join('')}`,[{id:'close',label:'关闭'}]);
  $('modalBody').onclick=e=>{const button=e.target.closest('[data-template]');if(!button)return;const p=presets[Number(button.dataset.template)];state.rows=[...p[1]];state.cols=[...p[2]];state.measures=[...p[3]];state.chart={type:/^(month|date)$/.test(p[4])?'line':'bar',x:p[4],y:p[5],series:p[6]};state.title=p[0];drillScope=null;collapsedRows.clear();closeModal();renderAll();toast(`已应用「${p[0]}」`);};
}
function filterModal(id){
  const f=dimension(id),target=state.filters.find(x=>x.field===id);if(!f||!target)return;
  const counts=new Map();for(const r of dataset.rows){const t=String(dataset.get(r,dataset.timeField));if(state.dateStart&&t<state.dateStart.slice(0,t.length))continue;if(state.dateEnd&&t>state.dateEnd.slice(0,t.length))continue;const v=String(dataset.get(r,id));counts.set(v,(counts.get(v)||0)+1);}
  const values=[...counts].sort((a,b)=>b[1]-a[1]);let selected=new Set(target.values);
  showModal(`筛选 · ${f.label}`,`<p>选择一个或多个值；不选择代表不限制该字段。共有 ${num(values.length)} 个可选值。</p><input type="search" id="filterSearch" placeholder="搜索选项"><div class="filter-options" id="filterOptions"></div>`,[{id:'clear',label:'清空筛选'},{id:'apply',label:'应用筛选',primary:true}]);
  const renderOptions=()=>{const q=$('filterSearch').value.trim().toLowerCase();$('filterOptions').innerHTML=values.filter(([v])=>v.toLowerCase().includes(q)).slice(0,500).map(([v,n])=>`<label class="filter-option"><input type="checkbox" value="${esc(v)}" ${selected.has(v)?'checked':''}><span>${esc(v)}</span><small>${num(n)}</small></label>`).join('')||'<div class="saved-empty" style="padding:12px">无匹配选项</div>';};
  renderOptions();$('filterSearch').addEventListener('input',renderOptions);
  $('filterOptions').addEventListener('change',e=>{if(e.target.matches('input[type=checkbox]'))e.target.checked?selected.add(e.target.value):selected.delete(e.target.value);});
  modalCleanup=()=>{};
  $('modalActions').onclick=e=>{const action=e.target.closest('[data-modal-action]')?.dataset.modalAction;if(action==='clear'){target.values=[];closeModal();renderAll();}else if(action==='apply'){target.values=[...selected];closeModal();renderAll();}};
}
function readSaved(){try{return JSON.parse(localStorage.getItem(savedKey)||'[]')}catch{return [];}}
function writeSaved(items){localStorage.setItem(savedKey,JSON.stringify(items));renderSaved();}
function renderSaved(){const items=readSaved();$('savedViews').innerHTML=items.length?items.map((it,i)=>`<div class="saved-item"><strong>${esc(it.name)}</strong><small>${esc(datasets[it.state.dataset]?.label||'数据集')} · ${esc(it.savedAt||'')}</small><button data-load="${i}">打开</button><button data-delete="${i}">删除</button></div>`).join(''):'<div class="saved-empty">还没有保存视图。搭建好分析后，点击「保存视图」。</div>';}
function saveModal(){showModal('保存当前视图',`<p>将行列、指标、日期、筛选与图表配置保存到本机浏览器。</p><input type="text" id="viewNameInput" maxlength="40" value="${esc(dataset.label)}分析 · ${new Date().toLocaleDateString('zh-CN')}">`,[{id:'cancel',label:'取消'},{id:'save',label:'保存视图',primary:true}]);$('viewNameInput').focus();$('viewNameInput').select();}
function toggleViews(force){const on=typeof force==='boolean'?force:!$('viewsPanel').classList.contains('open');$('viewsPanel').classList.toggle('open',on);if(on)renderSaved();}
function csvEscape(v){const s=String(v??'');return /[",\r\n]/.test(s)?`"${s.replaceAll('"','""')}"`:s;}
function csvMetric(id,value){if(value===null||value===undefined||!Number.isFinite(value))return '';const f=measure(id);if(f?.format==='index')return Number(value.toFixed(6));if(f?.format==='percent')return Number((value*100).toFixed(4));if(f?.format==='integer')return Math.round(value);return Number(value.toFixed(2));}
function csvMetricHeader(id){const f=measure(id);return `${f?.label||id}${f?.format==='currency'||f?.format==='price'?'（元）':f?.format==='percent'?'（%）':''}`;}
function downloadCsv(name,header,rows){const csv='\ufeff'+[header,...rows].map(row=>row.map(csvEscape).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
function pivotCsvRows(){const p=pivotData;if(!state.measures.length)return null;const cells=p.rowGroups.length*Math.max(1,p.colGroups.length)*state.measures.length;if(cells>300000)return null;
  const h=[...state.rows.map(id=>dimension(id)?.label||id)];if(!h.length)h.push('维度');
  const colList=state.cols.length?p.colGroups:[{key:JSON.stringify([]),parts:[]}];
  for(const c of colList)for(const id of state.measures)h.push([c.parts.join(' / '),csvMetricHeader(id)].filter(Boolean).join(' · '));
  if(state.cols.length)for(const id of state.measures)h.push(`总计 · ${csvMetricHeader(id)}`);
  if(state.compare!=='none')for(const id of state.measures){h.push(`${compareLabel()} · ${csvMetricHeader(id)}`);h.push(`${compareLabel()} · ${measure(id)?.format==='index'?'指数净值差':measure(id)?.format==='percent'?'变化百分点':'变化率（%）'}`);}
  const deltaNumber=(id,a,b)=>a===null||b===null||!Number.isFinite(a)||!Number.isFinite(b)?'':measure(id)?.format==='index'?Number((a-b).toFixed(6)):measure(id)?.format==='percent'?Number(((a-b)*100).toFixed(4)):b>0&&a>=0?Number(((a/b-1)*100).toFixed(4)):'';
  const rows=hierarchyRows(true).map(r=>{const values=[...r.parts.map((part,i)=>r.kind==='subtotal'&&i===r.depth-1?`${part} 小计`:part)];while(values.length<Math.max(1,state.rows.length))values.push('');if(!r.parts.length)values[0]='全部数据';
    for(const c of colList)for(const id of state.measures){const b=r.kind==='subtotal'?p.subtotalCell(r.key,c.key):p.cell(r.key,c.key);values.push(csvMetric(id,getMetric(dataset,b,id,p.all)));}
    if(state.cols.length)for(const id of state.measures)values.push(csvMetric(id,getMetric(dataset,r.bucket,id,p.all)));
    if(state.compare!=='none'){const priorBucket=compareGroup(r);for(const id of state.measures){const a=getMetric(dataset,r.bucket,id,p.all),b=comparison?.available?metricOrZero(priorBucket,id,comparison.pivot.all):null;values.push(csvMetric(id,b),deltaNumber(id,a,b));}}
    return values;});
  if(state.rows.length){const grand=['总计',...Array(Math.max(0,state.rows.length-1)).fill('')];for(const c of colList)for(const id of state.measures)grand.push(csvMetric(id,getMetric(dataset,c.bucket,id,p.all)));if(state.cols.length)for(const id of state.measures)grand.push(csvMetric(id,getMetric(dataset,p.all,id,p.all)));if(state.compare!=='none')for(const id of state.measures){const a=getMetric(dataset,p.all,id,p.all),b=comparison?.available?getMetric(dataset,comparison.pivot.all,id,comparison.pivot.all):null;grand.push(csvMetric(id,b),deltaNumber(id,a,b));}rows.push(grand);}
  return {h,rows};
}
function exportPivot(){const data=pivotCsvRows();if(!data){toast('组合过多，请先筛选缩小范围再导出');return;}downloadCsv(`${dataset.label}_透视分析_${new Date().toISOString().slice(0,10)}.csv`,data.h,data.rows);toast('已导出完整透视结果（原始元数值）');}
function exportDetail(){const records=detailRows();if(records.length>200000){toast('明细超过 20 万行，请先缩小范围');return;}const dims=detailFields(),mets=dataset.measures.filter(m=>!['amountShare','salesShare','salesIndex','avgPrice','unitIncome','unitTarget','meanPrice','minPrice','maxPrice'].includes(m.id)).slice(0,3);const header=[...dims.map(id=>dimension(id)?.label||id),...mets.map(m=>csvMetricHeader(m.id))];const rows=records.map(r=>{const b=emptyBucket();addRow(dataset,b,r);return [...dims.map(id=>dataset.get(r,id)),...mets.map(m=>csvMetric(m.id,getMetric(dataset,b,m.id,b)))];});downloadCsv(`${dataset.label}_当前明细_${new Date().toISOString().slice(0,10)}.csv`,header,rows);toast(`已导出 ${num(rows.length)} 行明细`);}
async function copyTable(){const data=pivotCsvRows();if(!data){toast('组合过多，请先筛选');return;}const tsv=[data.h,...data.rows].map(r=>r.join('\t')).join('\n');try{await navigator.clipboard.writeText(tsv);toast('透视表已复制，可粘贴到 Excel');}catch{toast('复制失败，请使用导出 CSV');}}

$('datasetSelect').addEventListener('change',e=>switchDataset(e.target.value));
$('fieldSearch').addEventListener('input',renderFields);
$('fieldList').addEventListener('click',e=>{const id=e.target.closest('[data-field]')?.dataset.field;if(id)addField(id,measure(id)?'measures':'rows');});
document.addEventListener('dragstart',e=>{const node=e.target.closest('[draggable=true][data-field]');if(!node)return;e.dataTransfer.setData('text/plain',JSON.stringify({id:node.dataset.field,from:node.dataset.from||'library'}));e.dataTransfer.effectAllowed='move';});
document.querySelectorAll('.dropzone').forEach(el=>{el.addEventListener('dragover',e=>{e.preventDefault();el.classList.add('dragover');});el.addEventListener('dragleave',()=>el.classList.remove('dragover'));el.addEventListener('drop',e=>{e.preventDefault();el.classList.remove('dragover');let item;try{item=JSON.parse(e.dataTransfer.getData('text/plain'));}catch{return;}const zone=el.dataset.zone,f=field(item.id);if(!f)return;const wantsMeasure=['measures','chartY'].includes(zone);if((wantsMeasure&&f.kind!=='measure')||(!wantsMeasure&&f.kind!=='dimension')){toast(wantsMeasure?'这里需要统计指标':'这里需要维度字段');return;}if(item.from===zone){if(['rows','cols','measures'].includes(zone)){const list=state[zone],old=list.indexOf(item.id),target=e.target.closest('.chip[data-field]')?.dataset.field;if(old>=0){list.splice(old,1);const next=target?list.indexOf(target):-1;list.splice(next>=0?next:list.length,0,item.id);renderAll();}}return;}if(['rows','cols','measures'].includes(zone)){const limit={rows:3,cols:2,measures:5}[zone];if(!state[zone].includes(item.id)&&state[zone].length>=limit){toast('该区域已达到字段上限');return;}}if(item.from!=='library')removeField(item.id,item.from);addField(item.id,zone);});});
document.addEventListener('click',e=>{const rm=e.target.closest('[data-remove]');if(rm){removeField(rm.dataset.remove,rm.dataset.zone);return;}const op=e.target.closest('[data-open-filter]');if(op?.dataset.openFilter){filterModal(op.dataset.openFilter);return;}const range=e.target.closest('[data-range]');if(range){state.dateStart=range.dataset.from;state.dateEnd=range.dataset.to;renderAll();return;}});
$('dateStart').addEventListener('change',e=>{state.dateStart=e.target.value;if(state.dateEnd&&state.dateStart>state.dateEnd)state.dateEnd=state.dateStart;renderAll();});
$('dateEnd').addEventListener('change',e=>{state.dateEnd=e.target.value;if(state.dateStart&&state.dateEnd<state.dateStart)state.dateStart=state.dateEnd;renderAll();});
$('unitSelect').addEventListener('change',e=>{state.unit=e.target.value;renderAll();});
$('sortSelect').addEventListener('change',e=>{state.sort=e.target.value;state.sortBy=e.target.value==='custom'?{scope:'total',metric:state.measures[0]||dataset.measures[0].id,colKey:'',direction:'desc'}:null;renderPivot();saveStateToMap();});
$('compareSelect').addEventListener('change',e=>{state.compare=e.target.value;renderAll();});
$('chartType').addEventListener('change',e=>{state.chart.type=e.target.value;renderChart();saveStateToMap();});
function switchTab(tab){activeTab=tab;document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x.dataset.tab===tab));for(const t of ['pivot','chart','detail'])$(`${t}View`).classList.toggle('hidden',t!==tab);if(tab==='chart')renderChart();if(tab==='detail')renderDetail();}
document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));
$('pivotTable').addEventListener('click',e=>{
  const header=e.target.closest('[data-sort-scope]');if(header){
    const next={scope:header.dataset.sortScope,metric:header.dataset.sortMetric||'',colKey:header.dataset.sortCol||'',direction:header.dataset.sortScope==='label'?'asc':'desc'};
    if(state.sortBy?.scope===next.scope&&state.sortBy?.metric===next.metric&&state.sortBy?.colKey===next.colKey)next.direction=state.sortBy.direction==='desc'?'asc':'desc';
    state.sortBy=next;state.sort='custom';$('sortSelect').value='custom';renderPivot();saveStateToMap();return;
  }
  const fold=e.target.closest('[data-collapse]');if(fold){const key=fold.dataset.collapse;collapsedRows.has(key)?collapsedRows.delete(key):collapsedRows.add(key);renderPivot();return;}
  const drill=e.target.closest('[data-drill]');if(drill){drillScope={parts:JSON.parse(drill.dataset.drill)};switchTab('detail');}
});
$('clearDrillBtn').onclick=()=>{drillScope=null;renderDetail();};
$('resetBtn').onclick=()=>{state=defaultState(dataset);drillScope=null;collapsedRows.clear();renderAll();toast('已恢复该数据集默认分析');};
$('exportBtn').onclick=exportPivot;$('detailExportBtn').onclick=exportDetail;$('copyBtn').onclick=copyTable;
$('saveBtn').onclick=saveModal;$('railViews').onclick=()=>toggleViews();$('openViewsBtn').onclick=()=>toggleViews();$('closeViews').onclick=()=>toggleViews(false);
$('savedViews').onclick=e=>{const load=e.target.closest('[data-load]'),del=e.target.closest('[data-delete]');const items=readSaved();if(load){const it=items[Number(load.dataset.load)];if(!it)return;switchDataset(it.state.dataset);state=validState(dataset,it.state);drillScope=null;collapsedRows.clear();renderAll();toggleViews(false);toast(`已打开「${it.name}」`);}else if(del){items.splice(Number(del.dataset.delete),1);writeSaved(items);toast('视图已删除');}};
$('sourceBtn').onclick=sourceModal;$('sourceStripBtn').onclick=sourceModal;$('helpBtn').onclick=helpModal;$('railHelp').onclick=helpModal;$('inlineHelpBtn').onclick=helpModal;
$('templateBtn').onclick=templateModal;
$('modalClose').onclick=closeModal;$('overlay').onclick=closeModal;
$('modalActions').addEventListener('click',e=>{const action=e.target.closest('[data-modal-action]')?.dataset.modalAction;if(!action)return;if(action==='cancel'||action==='close'){closeModal();return;}if(action==='save'){const name=$('viewNameInput')?.value.trim();if(!name){toast('请先输入视图名称');return;}const items=readSaved();items.unshift({name,state:structuredClone({...state,title:name}),savedAt:new Date().toLocaleString('zh-CN')});writeSaved(items.slice(0,30));state.title=name;closeModal();renderAll();toast('视图已保存到本机浏览器');}});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();});
$('mobileFields').onclick=()=>$('fieldPanel').classList.add('open');$('closeFields').onclick=()=>$('fieldPanel').classList.remove('open');
window.addEventListener('resize',()=>{if(activeTab==='chart')renderChart();});
state=defaultState(dataset);renderAll();
