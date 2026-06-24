import { createConversationMemory } from "./conversation-memory.js";
import { planQuery } from "./query-planner.js";
import { generateAnswer } from "./answer-generator.js";
import { createDataQueryEngine } from "../engine/data-query-engine.js";
import { generateInsights } from "../engine/insight-engine.js";
import { getSupportedMetrics } from "../engine/metrics.js";
import { callDeepSeek } from "../llm/provider.js";

function toUiMessages(turns) {
  return turns.flatMap((turn) => [
    { role: "user", content: turn.question, createdAt: turn.createdAt },
    { role: "assistant", content: turn.answer, meta: turn.meta, createdAt: turn.createdAt },
  ]);
}

export function createChatController({ records = [], getDashboardFilters = () => ({}), deepseekClient = callDeepSeek } = {}) {
  const engine = createDataQueryEngine(records);
  const memoryStore = createConversationMemory();
  let turns = memoryStore.load();
  let onChange = () => {};
  const dates = records.map((row) => row?.date).filter(Boolean).sort();
  const supportedMetrics = getSupportedMetrics(records).map((metric) => metric.id);
  const catalog = {
    products: engine.catalog,
    channels: [...new Set(records.map((row) => row?.channel).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN")),
    series: [...new Set(records.map((row) => row?.product?.series).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN")),
  };
  const state = { messages: toUiMessages(turns), running: false, error: "", lastPlan: null, lastResult: null };
  const notify = () => onChange({ ...state, messages: [...state.messages] });

  async function ask(question) {
    const value = String(question || "").trim();
    if (!value || state.running) return null;
    state.running = true;
    state.error = "";
    state.messages.push({ role: "user", content: value, createdAt: new Date().toISOString() });
    notify();
    try {
      const dashboardFilters = getDashboardFilters() || {};
      const planned = await planQuery({
        question: value,
        dashboardFilters,
        memory: memoryStore.summarize(turns),
        catalog,
        supportedMetrics,
        dataRange: { startDate: dates[0] || null, endDate: dates[dates.length - 1] || null },
        deepseekClient,
      });
      const result = engine.execute(planned.plan);
      const insights = generateInsights(result);
      const answer = await generateAnswer({ question: value, plan: planned.plan, result, insights, deepseekClient, plannerWarning: planned.warning });
      const meta = {
        source: answer.source,
        model: answer.model,
        warning: answer.warning || planned.warning,
        filters: result.meta.actualFilters,
        comparison: result.meta.comparison,
        rowCount: result.meta.rowCount,
        matchedProducts: result.meta.matchedProducts,
        intent: planned.plan.intent,
      };
      const turn = { question: value, answer: answer.content, plan: planned.plan, meta, createdAt: new Date().toISOString() };
      turns = [...turns, turn].slice(-8);
      memoryStore.replace(turns);
      state.lastPlan = planned.plan;
      state.lastResult = result;
      state.messages.push({ role: "assistant", content: answer.content, meta, createdAt: turn.createdAt });
      return turn;
    } catch (error) {
      state.error = error?.message || "分析未完成，请稍后重试。";
      state.messages.push({ role: "assistant", content: `分析未完成：${state.error}`, error: true, createdAt: new Date().toISOString() });
      return null;
    } finally {
      state.running = false;
      notify();
    }
  }

  return {
    ask,
    clear() { turns = []; memoryStore.clear(); state.messages = []; state.error = ""; state.lastPlan = null; state.lastResult = null; notify(); },
    getState() { return { ...state, messages: [...state.messages] }; },
    setOnChange(callback) { onChange = typeof callback === "function" ? callback : () => {}; notify(); },
    engine,
  };
}

export default createChatController;
