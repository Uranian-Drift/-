(() => {
  "use strict";

  const version = "20260826b";
  const parts = [
    "water-heater-data-00.txt",
    "water-heater-data-01.txt",
    "water-heater-data-02.txt"
];

  window.WATER_HEATER_DATA_READY = (async () => {
    if (typeof DecompressionStream !== "function") {
      throw new Error("当前浏览器不支持数据解压，请使用最新版 Chrome、Edge 或 Safari。");
    }

    const responses = await Promise.all(parts.map((path) => fetch(`${path}?v=${version}`)));
    const failed = responses.find((response) => !response.ok);
    if (failed) throw new Error(`数据分片读取失败：${failed.status}`);

    const encoded = (await Promise.all(responses.map((response) => response.text()))).join("");
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    window.WATER_HEATER_DATA = JSON.parse(await new Response(stream).text());
    return window.WATER_HEATER_DATA;
  })();
})();
