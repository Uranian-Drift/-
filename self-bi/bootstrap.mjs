const assetVersion = new URL(import.meta.url).searchParams.get('v') || 'local';
const dataVersion = new URLSearchParams(location.search).get('v') || assetVersion;

function loadScript(path) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${path}?v=${encodeURIComponent(dataVersion)}`;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`无法加载 ${path}`));
    document.head.append(script);
  });
}

try {
  if (window.parent !== window && window.parent.WATER_HEATER_DATA && window.parent.WATER_HEATER_INCOME_DATA) {
    window.WATER_HEATER_DATA = window.parent.WATER_HEATER_DATA;
    window.WATER_HEATER_INCOME_DATA = window.parent.WATER_HEATER_INCOME_DATA;
  } else {
    const dataScript = document.querySelector('meta[name="dashboard-data-script"]')?.content;
    if (!dataScript) throw new Error('缺少销售数据脚本配置');
    await loadScript(dataScript);
    await loadScript('../data/income-data.js');
  }
  if (window.WATER_HEATER_DATA_READY) await window.WATER_HEATER_DATA_READY;
  await import(`./app.mjs?v=${encodeURIComponent(assetVersion)}`);
} catch (error) {
  console.error('自助 BI 工作台初始化失败', error);
  document.body.innerHTML = '<main class="load-error"><h1>自助 BI 工作台暂时无法加载</h1><p>请刷新 5.1 页面后重试，并确认本地数据快照可用。</p></main>';
}
