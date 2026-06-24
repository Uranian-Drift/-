import { compressQueryResult } from "../ai/answer-generator.js";

export function buildLLMContext(queryResult = {}, insights = []) {
  return { ...compressQueryResult(queryResult), insights: insights.slice(0, 8) };
}

export default buildLLMContext;
