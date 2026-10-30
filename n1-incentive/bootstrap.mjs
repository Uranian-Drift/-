const assetVersion = new URL(import.meta.url).searchParams.get('v') || 'local';
const dataVersion = new URLSearchParams(location.search).get('v') || assetVersion;
if (new URLSearchParams(location.search).get('embedded') === '1') document.body.classList.add('embedded');

try {
  if (window.parent !== window && window.parent.WATER_HEATER_DATA) {
    window.WATER_HEATER_DATA = window.parent.WATER_HEATER_DATA;
  } else {
    const source = document.querySelector('meta[name="dashboard-data-script"]')?.content;
    if (!source) throw new Error('缺少销售数据配置');
    await new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src=`${source}?v=${encodeURIComponent(dataVersion)}`;
      script.onload=resolve;script.onerror=reject;document.head.append(script);
    });
    if (window.WATER_HEATER_DATA_READY) await window.WATER_HEATER_DATA_READY;
  }
  const response=await fetch(`./config.json?v=${encodeURIComponent(assetVersion)}`,{cache:'no-store'});
  if (!response.ok) throw new Error('目标配置不可读取');
  window.N1_INCENTIVE_CONFIG=await response.json();
  await import(`./app.js?v=${encodeURIComponent(assetVersion)}`);
} catch {
  document.getElementById('error').hidden=false;
  document.getElementById('error').textContent='激励进度暂时无法读取，请刷新AI经营看板后重试。';
  document.getElementById('content').textContent='数据未就绪，暂不展示销量与奖励。';
}
