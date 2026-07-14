import { AI_CONFIG } from "../config/ai-config.js";

const STORAGE_KEY = "WATER_HEATER_AI_CONVERSATION_V45";

function storage() {
  try { return window.localStorage; } catch { return null; }
}

function cleanTurn(turn = {}) {
  return {
    question: String(turn.question || "").slice(0, AI_CONFIG.maxQuestionLength),
    answer: String(turn.answer || "").slice(0, 6000),
    mode: ["quick", "professional", "deep"].includes(turn.mode) ? turn.mode : "deep",
    plan: turn.plan && typeof turn.plan === "object" ? {
      analysisGoal: turn.plan.analysisGoal,
      hypotheses: turn.plan.hypotheses,
      queries: (turn.plan.queries || []).map((query) => ({ id: query.id, label: query.label, dataset: query.dataset, groupBy: query.groupBy, filters: query.filters, comparison: query.comparison })).slice(0, 15),
    } : null,
    analysis: turn.analysis && typeof turn.analysis === "object" ? {
      executiveSummary: turn.analysis.executiveSummary,
      drivers: (turn.analysis.drivers || []).slice(0, 5).map((item) => ({ factor: item.factor, interpretation: item.interpretation, confidence: item.confidence })),
      actions: (turn.analysis.actions || []).slice(0, 5).map((item) => ({ action: item.action, scope: item.scope, successMetric: item.successMetric })),
      followUps: (turn.analysis.followUps || []).slice(0, 5),
    } : null,
    meta: turn.meta && typeof turn.meta === "object" ? turn.meta : null,
    createdAt: turn.createdAt || new Date().toISOString(),
  };
}

export function createConversationMemoryV2() {
  function load() {
    try {
      const value = JSON.parse(storage()?.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(value) ? value.slice(-AI_CONFIG.memoryTurns).map(cleanTurn) : [];
    } catch { return []; }
  }

  function save(turns) {
    const next = turns.slice(-AI_CONFIG.memoryTurns).map(cleanTurn);
    try { storage()?.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* controller still keeps in-memory state */ }
    return next;
  }

  return {
    load,
    replace: save,
    add(turn) { return save([...load(), turn]); },
    clear() { try { storage()?.removeItem(STORAGE_KEY); } catch { /* no-op */ } },
    summarize(turns = load()) {
      return turns.slice(-6).map((turn) => ({
        question: turn.question,
        mode: turn.mode,
        analysisGoal: turn.plan?.analysisGoal,
        filters: turn.meta?.filters || {},
        conclusion: turn.analysis?.executiveSummary,
        verifiedDrivers: turn.analysis?.drivers || [],
        actions: turn.analysis?.actions || [],
        followUps: turn.analysis?.followUps || [],
      }));
    },
  };
}

export default createConversationMemoryV2;
