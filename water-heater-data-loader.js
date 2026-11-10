(() => {
  "use strict";

  const baseParts = [
    "water-heater-data-001b9cb36435-00.txt"
];
  const oviParts = [
    "ovi-data-e86dcd43796c-00.txt",
    "ovi-data-e86dcd43796c-01.txt",
    "ovi-data-e86dcd43796c-02.txt",
    "ovi-data-e86dcd43796c-03.txt"
];
  const assetBase = new URL(".", document.currentScript.src);

  async function readPacked(parts) {
    if (typeof DecompressionStream !== "function") {
      throw new Error("当前浏览器不支持数据解压，请使用最新版 Chrome、Edge 或 Safari。");
    }

    const responses = await Promise.all(parts.map((path) => fetch(new URL(path, assetBase))));
    const failed = responses.find((response) => !response.ok);
    if (failed) throw new Error(`数据分片读取失败：${failed.status}`);

    const encoded = (await Promise.all(responses.map((response) => response.text()))).join("");
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return JSON.parse(await new Response(stream).text());
  }

  window.WATER_HEATER_DATA_READY = readPacked(baseParts).then((data) => {
    window.WATER_HEATER_DATA = data;
    return data;
  });

  let oviPromise;
  window.ensureOviData = async () => {
    await window.WATER_HEATER_DATA_READY;
    if (window.WATER_HEATER_DATA.ovi.length) return window.WATER_HEATER_DATA.ovi;
    if (!oviPromise) oviPromise = readPacked(oviParts).then((rows) => {
      window.WATER_HEATER_DATA.ovi = rows;
      return rows;
    }).catch((error) => { oviPromise = undefined; throw error; });
    return oviPromise;
  };
})();
