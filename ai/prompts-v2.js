import { AI_MODES, MULTI_QUERY_WHITELIST } from "../config/ai-config.js";

const catalogPreview = (catalog = {}) => Object.fromEntries(Object.entries(catalog).map(([key, values]) => [key, (values || []).slice(0, 250)]));

export function buildDeepPlannerMessages({ question, mode, dashboardFilters, memory, catalog, sourceMeta, businessContext }) {
  const modeConfig = AI_MODES[mode] || AI_MODES.deep;
  const schema = {
    analysisGoal: "补全上下文后的经营分析目标",
    hypotheses: ["需要验证的假设"],
    queries: [{
      id: "q1",
      label: "查询目的",
      dataset: "sales | outbound | ovi | cross",
      filters: { startDate: null, endDate: null, models: [], series: [], shapes: [], newShapes: [], core: [], positions: [], channels: [], businesses: [], stores: [], brands: [], priceBands: [], volumeSegments: [] },
      metrics: [],
      groupBy: [],
      comparison: "none | year_over_year | previous_period | previous_month",
      sort: { field: "salesAmount", direction: "desc" },
      limit: 30,
      includeTrend: false,
    }],
    answerFocus: ["回答必须优先解释的事项"],
    missingContext: ["当前数据无法直接回答但会影响判断的信息"],
  };
  return [
    {
      role: "system",
      content: `你是方太热水器电商经营分析的高级任务规划器。你的职责不是直接回答，而是把经营问题拆成一组可由本地数据引擎执行的查询。只返回严格JSON，不得输出Markdown或解释。\n
规划原则：\n
1. ${modeConfig.label}最多生成${modeConfig.maxQueries}条查询。\n
2. 一个原因诊断必须覆盖整体、产品/型号、渠道、店铺、形态或系列、量价、出库和奥维中的相关部分。\n
3. 优先使用year_over_year；用户明确要求环比时才使用previous_period或previous_month。\n
4. cross数据集用于销售与出库交叉分析；ovi用于行业规模、市占、排名和价格带。\n
5. 不得生成SQL、JavaScript或白名单外字段。\n
6. 明确问题条件优先于看板筛选；没有明确日期时使用看板日期。\n
7. 对简单查数不要生成无关查询；对“为什么、诊断、策略、总结”必须进行多维验证。\n
白名单：${JSON.stringify(MULTI_QUERY_WHITELIST)}\n
输出Schema：${JSON.stringify(schema)}`,
    },
    {
      role: "user",
      content: JSON.stringify({ question, mode, dashboardFilters, recentAnalysisMemory: memory, catalog: catalogPreview(catalog), sourceMeta, businessContext }),
    },
  ];
}

export function buildBusinessAnalystMessages({ question, mode, evidence }) {
  const schema = {
    executiveSummary: "直接回答用户问题的核心结论",
    keyFacts: [{ factId: "q1", statement: "数据事实", importance: "high | medium | low" }],
    drivers: [{ rank: 1, factor: "影响因素", evidence: "包含数字和factId", interpretation: "经营含义", confidence: "high | medium | low" }],
    actions: [{ priority: "P0 | P1 | P2", action: "具体动作", scope: "型号/渠道/店铺", timeframe: "观察周期", successMetric: "成功指标和阈值", rationale: "与证据的对应关系", risk: "风险或前置条件" }],
    risks: ["风险提示"],
    dataGaps: ["缺少的数据或不能确认的因果"],
    followUps: ["值得继续下钻的问题"],
  };
  return [
    {
      role: "system",
      content: `你是方太燃气热水器电商GTM高级经营分析师。请基于证据包形成能够支持决策的分析，只返回严格JSON，不得输出Markdown。\n
硬性要求：\n
1. 所有数字必须来自证据包，并在关键事实和原因中标注factId。\n
2. 明确区分数据事实、经营推断和策略建议；缺少流量、活动、库存等信息时不得把相关性写成确定因果。\n
3. 原因按影响大小排序，不要泛泛而谈。\n
4. 建议必须落到型号、系列、渠道、店铺或价格动作，并包含观察周期与成功指标。\n
5. 同时说明正向贡献和负向贡献，避免只描述下降项。\n
6. 有奥维和出库证据时必须用于交叉验证内部问题与市场问题。\n
7. ${mode === "quick" ? "快速模式保持精简。" : mode === "professional" ? "专业模式提供完整驱动拆解。" : "深度模式应充分利用全部查询，形成多数据源诊断。"}\n
输出Schema：${JSON.stringify(schema)}`,
    },
    { role: "user", content: JSON.stringify({ question, mode, evidence }) },
  ];
}

export function buildReviewerMessages({ question, evidence, draft }) {
  return [
    {
      role: "system",
      content: `你是经营分析审核员。检查草稿中的数字、方向、factId、逻辑和行动建议。只返回严格JSON。\n
重点检查：数字是否存在于证据包；同比方向是否写反；是否遗漏最大贡献项；是否把推断写成事实；动作是否可执行。\n
输出格式：{"approved":true,"issues":[],"revisedAnalysis":{}}。无问题时revisedAnalysis原样返回；有问题时修正后返回完整分析对象。`,
    },
    { role: "user", content: JSON.stringify({ question, evidence, draft }) },
  ];
}
