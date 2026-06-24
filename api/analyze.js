import { createDataQueryEngine } from "../engine/data-query-engine.js";
import { generateInsights } from "../engine/insight-engine.js";
import { buildFallbackPlan } from "../ai/query-planner.js";
import { generateAnswer } from "../ai/answer-generator.js";
import { callDeepSeek } from "../llm/provider.js";

export function prepareAnalysis(records = [], plan = null) {
  const engine = createDataQueryEngine(records);
  const dates = records.map((row) => row?.date).filter(Boolean).sort();
  const safePlan = plan || buildFallbackPlan({
    question: "当前经营表现如何？",
    dashboardFilters: { startDate: dates[0] || null, endDate: dates[dates.length - 1] || null },
    memory: [],
    catalog: { products: engine.catalog, channels: [] },
    dataRange: { startDate: dates[0] || null, endDate: dates[dates.length - 1] || null },
  });
  const result = engine.execute(safePlan);
  return { plan: safePlan, result, insights: generateInsights(result) };
}

export async function analyzeData(records = [], question = "当前经营表现如何？", options = {}) {
  const prepared = prepareAnalysis(records, options.plan);
  const answer = await generateAnswer({
    question,
    plan: prepared.plan,
    result: prepared.result,
    insights: prepared.insights,
    deepseekClient: options.deepseekClient || callDeepSeek,
  });
  return { ...prepared, ...answer };
}

export default analyzeData;
