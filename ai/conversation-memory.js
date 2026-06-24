import { AI_CONFIG } from "../config/ai-config.js";

const STORAGE_KEY = "WATER_HEATER_AI_CONVERSATION_V3";

function storage() {
  try { return window.sessionStorage; } catch { return null; }
}

function cleanTurn(turn) {
  return {
    question: String(turn?.question || "").slice(0, AI_CONFIG.maxQuestionLength),
    answer: String(turn?.answer || "").slice(0, 1800),
    plan: turn?.plan && typeof turn.plan === "object" ? turn.plan : null,
    meta: turn?.meta && typeof turn.meta === "object" ? turn.meta : null,
    createdAt: turn?.createdAt || new Date().toISOString(),
  };
}

export function createConversationMemory() {
  function load() {
    try {
      const parsed = JSON.parse(storage()?.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed.slice(-AI_CONFIG.memoryTurns).map(cleanTurn) : [];
    } catch { return []; }
  }

  function save(turns) {
    const next = turns.slice(-AI_CONFIG.memoryTurns).map(cleanTurn);
    try { storage()?.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* memory remains in controller */ }
    return next;
  }

  return {
    load,
    add(turn) { return save([...load(), turn]); },
    replace(turns) { return save(turns); },
    clear() { try { storage()?.removeItem(STORAGE_KEY); } catch { /* no-op */ } },
    summarize(turns = load()) {
      return turns.slice(-AI_CONFIG.memoryTurns).map((turn) => ({
        question: turn.question,
        filters: turn.plan?.filters || {},
        comparison: turn.plan?.comparison || { type: "none" },
        intent: turn.plan?.intent || "summary",
      }));
    },
  };
}

export default createConversationMemory;
