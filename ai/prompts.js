import { BUSINESS_CONTEXT } from "../config/business-context.js";
import { QUERY_WHITELIST } from "../config/ai-config.js";

export function buildPlannerMessages({ question, dashboardFilters, memory, catalog, supportedMetrics }) {
  const schema = {
    intent: "summary | compare | trend | diagnose_change | rank | anomaly | contribution | price_analysis | generate_report",
    resolvedQuestion: "补全上下文后的完整问题",
    filters: { startDate: null, endDate: null, products: [], series: [], models: [], channels: [], departments: [] },
    metrics: [], groupBy: [],
    comparison: { type: "none | previous_period | previous_month | previous_week | year_over_year", startDate: null, endDate: null },
    sort: [{ field: "", direction: "asc | desc" }], limit: 20, needsTrend: false, needsRawSamples: false,
  };
  return [
    {
      role: "system",
      content: `你是经营数据查询规划器。只返回一个严格JSON对象，禁止Markdown、解释、代码块。\n条件优先级：当前问题明确条件 > 当前看板筛选 > 最近对话条件 > 默认范围。\n不得生成SQL或JavaScript。只可使用以下白名单：${JSON.stringify(QUERY_WHITELIST)}\n输出Schema：${JSON.stringify(schema)}`,
    },
    {
      role: "user",
      content: JSON.stringify({ question, dashboardFilters, recentConversation: memory, catalog, supportedMetrics, businessContext: BUSINESS_CONTEXT }),
    },
  ];
}

export function buildAnswerMessages({ question, plan, result, insights }) {
  return [
    {
      role: "system",
      content: `你是方太燃气热水器电商GTM经营分析Copilot。必须只依据提供的数据结果回答。业务背景只能辅助解释，不得代替数据。明确区分数据事实、分析推断和策略建议。\n按以下结构输出中文：\n【结论】\n【数据依据】\n【原因拆解】\n【建议动作】\n【风险与限制】\n简单问题可以精简，但周报/经营总结需完整。结论先行，数字使用易读单位。若指标或数据不存在，直接说明，不得伪造毛利、同比或因果。必须说明实际使用的日期、产品、渠道和对比口径。`,
    },
    {
      role: "user",
      content: JSON.stringify({ question, plan, compressedQueryResult: result, insights, businessContext: BUSINESS_CONTEXT }),
    },
  ];
}
