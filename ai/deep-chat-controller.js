import { AI_MODES } from "../config/ai-config.js";
import { BUSINESS_CONTEXT } from "../config/business-context.js";
import { createSemanticLayer } from "../engine/semantic-layer.js";
import { createMultiQueryEngine } from "../engine/multi-query-engine.js";
import { buildEvidencePack } from "../engine/evidence-builder.js";
import { planDeepAnalysis } from "./deep-planner.js";
import { generateBusinessAnalysis } from "./business-analyst.js";
import { reviewBusinessAnalysis } from "./analysis-reviewer.js";
import { createConversationMemoryV2 } from "./conversation-memory-v2.js";
import { callDeepSeek } from "../llm/provider.js";

const STAGES = Object.freeze({
  idle: { id: "idle", label: "等待提问", progress: 0 },
  planning: { id: "planning", label: "拆解经营问题并制定分析任务", progress: 12 },
  querying: { id: "querying", label: "计算销售、出库和奥维证据", progress: 38 },
  evidence: { id: "evidence", label: "整理贡献、趋势与交叉证据", progress: 56 },
  analyzing: { id: "analyzing", label: "DeepSeek生成经营判断与行动方案", progress: 72 },
  reviewing: { id: "reviewing", label: "复核数字、逻辑与建议", progress: 90 },
  complete: { id: "complete", label: "分析完成", progress: 100 },
});

function toUiMessages(turns) {
  return turns.flatMap((turn) => [
    { role: "user", content: turn.question, createdAt: turn.createdAt },
    { role: "assistant", content: turn.answer, meta: turn.meta, analysis: turn.analysis, followUps: turn.analysis?.followUps || [], createdAt: turn.createdAt },
  ]);
}

export function createDeepChatController({ dataSources = {}, getDashboardFilters = () => ({}), getBusinessContext = () => ({}), deepseekClient = callDeepSeek } = {}) {
  const layer = createSemanticLayer(dataSources);
  const engine = createMultiQueryEngine(layer);
  const memoryStore = createConversationMemoryV2();
  let turns = memoryStore.load();
  let onChange = () => {};
  const state = {
    messages: toUiMessages(turns),
    running: false,
    error: "",
    mode: "deep",
    stage: STAGES.idle,
    lastPlan: null,
    lastEvidence: null,
    lastResults: null,
  };

  const notify = () => onChange({ ...state, messages: [...state.messages] });
  const setStage = (name, detail = "") => {
    state.stage = { ...(STAGES[name] || STAGES.idle), detail };
    notify();
  };

  async function ask(question, options = {}) {
    const value = String(question || "").trim().slice(0, 1000);
    if (!value || state.running) return null;
    const mode = AI_MODES[options.mode] ? options.mode : state.mode;
    state.mode = mode;
    state.running = true;
    state.error = "";
    state.messages.push({ role: "user", content: value, createdAt: new Date().toISOString() });
    setStage("planning");
    try {
      const dashboardFilters = getDashboardFilters() || {};
      const businessContext = { ...BUSINESS_CONTEXT, ...(getBusinessContext() || {}) };
      const planned = await planDeepAnalysis({
        question: value,
        mode,
        dashboardFilters,
        memory: memoryStore.summarize(turns),
        layer,
        businessContext,
        deepseekClient,
      });
      state.lastPlan = planned.plan;
      setStage("querying", `${planned.plan.queries.length}个分析任务`);
      const results = engine.execute(planned.plan, { mode, baseFilters: dashboardFilters });
      state.lastResults = results;
      setStage("evidence", `${results.length}组本地计算结果`);
      const evidence = buildEvidencePack({
        question: value,
        mode,
        filters: dashboardFilters,
        plan: planned.plan,
        results,
        businessContext,
        layerMeta: layer.meta,
      });
      state.lastEvidence = evidence;
      setStage("analyzing");
      const firstPass = await generateBusinessAnalysis({ question: value, mode, evidence, deepseekClient });
      let finalPass = { ...firstPass, reviewed: false, issues: [] };
      const modeConfig = AI_MODES[mode];
      if (modeConfig.review && firstPass.source === "deepseek") {
        setStage("reviewing");
        const reviewed = await reviewBusinessAnalysis({ question: value, evidence, draft: firstPass.analysis, deepseekClient });
        finalPass = {
          ...firstPass,
          analysis: reviewed.analysis,
          content: reviewed.content,
          reviewed: reviewed.reviewed,
          issues: reviewed.issues,
          warning: [firstPass.warning, reviewed.warning].filter(Boolean).join("；"),
        };
      }
      const createdAt = new Date().toISOString();
      const meta = {
        source: finalPass.source,
        model: finalPass.model,
        warning: [planned.warning, finalPass.warning].filter(Boolean).join("；"),
        mode,
        filters: dashboardFilters,
        queryCount: results.length,
        queryLabels: results.map((result) => result.label),
        reviewed: finalPass.reviewed,
        reviewIssues: finalPass.issues,
        sourceCoverage: layer.meta,
      };
      const turn = { question: value, answer: finalPass.content, analysis: finalPass.analysis, plan: planned.plan, meta, mode, createdAt };
      turns = [...turns, turn].slice(-12);
      memoryStore.replace(turns);
      state.messages.push({ role: "assistant", content: finalPass.content, meta, analysis: finalPass.analysis, followUps: finalPass.analysis.followUps, createdAt });
      setStage("complete");
      return turn;
    } catch (error) {
      state.error = error?.message || "分析未完成，请稍后重试。";
      state.messages.push({ role: "assistant", content: `分析未完成：${state.error}`, error: true, createdAt: new Date().toISOString() });
      setStage("idle");
      return null;
    } finally {
      state.running = false;
      notify();
    }
  }

  return {
    ask,
    clear() {
      turns = [];
      memoryStore.clear();
      state.messages = [];
      state.error = "";
      state.lastPlan = null;
      state.lastEvidence = null;
      state.lastResults = null;
      state.stage = STAGES.idle;
      notify();
    },
    setMode(mode) { if (AI_MODES[mode]) { state.mode = mode; notify(); } },
    getState() { return { ...state, messages: [...state.messages] }; },
    setOnChange(callback) { onChange = typeof callback === "function" ? callback : () => {}; notify(); },
    layer,
    engine,
  };
}

export default createDeepChatController;
