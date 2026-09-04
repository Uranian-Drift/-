// Shared cohort for the 16N1 store-volume table and its sales-share denominator.
export const N1_MAIN_STORES = Object.freeze([
  { key: "jd-self", label: "京东自营" },
  { key: "jd-second", label: "自营二店" },
  { key: "jd-pop", label: "京东POP" },
  { key: "tmall-official", label: "天猫官旗" },
  { key: "tmall-heater", label: "天猫热旗" },
  { key: "douyin", label: "抖音" },
]);

export function n1MainStoreKey(row) {
  const store = String(row.store || "").trim();
  const channel = String(row.channel || "").trim();
  const business = String(row.business || "").trim();
  if (store === "北京京东世纪贸易有限公司") return "jd-self";
  if (store === "北京京东世纪贸易有限公司（方太自营二店）") return "jd-second";
  // Official POP customer/account aliases share this exact source channel.
  // Do not include 京东POP代销 or 京东自营代销.
  if (channel === "京东POP") return "jd-pop";
  if (channel === "天猫官旗" || store === "方太官方旗舰店（天猫）") return "tmall-official";
  if (store === "广州七叶枫（天猫品旗）") return "tmall-heater";
  // Retain the dashboard's existing Douyin business scope, across all its stores.
  if (business === "抖音业务部") return "douyin";
  return "";
}
