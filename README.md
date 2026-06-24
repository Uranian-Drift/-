# 电商GTM AI经营分析系统 3.0

这是在 2.0 看板基础上独立升级的 3.0 目录，2.0 文件不会被覆盖。页面仍使用 `data/water-heater-data.js`，AI部分增加了自然语言查询规划、本地白名单查询、对比诊断、会话记忆和 DeepSeek 经营解读。

## AI工作方式

1. 用户提问后，DeepSeek先返回结构化查询计划。
2. 浏览器中的查询引擎在真实数据上执行筛选、聚合、排序、趋势和对比。
3. 只把压缩后的汇总、Top结果、趋势和诊断发送给DeepSeek生成答案。
4. 条件优先级为：本轮明确条件 > 当前看板筛选 > 上一轮对话 > 数据默认范围。

当前数据没有成本字段，因此系统不会推算毛利或毛利率。

## Netlify部署

1. 将整个“电商热水器经营看板3.0”作为站点目录部署；不要只上传 `index.html`。
2. 在 Netlify 站点设置的 Environment variables 中新增：
   - Key：`DEEPSEEK_API_KEY`
   - Value：你的 DeepSeek API Key
3. 重新部署后，`netlify/functions/deepseek.js` 会作为服务端代理读取该变量，网页端不会看到或保存密钥。

仅使用 Netlify Drop 拖拽静态文件时，看板和本地计算可以运行，但 Functions 通常需要通过 Git 仓库连接、Netlify CLI 或支持 Functions 的完整站点部署流程发布。若页面提示“站点尚未配置DeepSeek服务”，检查环境变量和 Functions 是否已部署。

## 本地预览

直接以静态服务器打开本目录即可查看看板。由于本地静态服务器没有 Netlify Functions，AI会显示本地安全摘要；部署并配置环境变量后才会调用 DeepSeek。

## 修改业务背景

在 `config/business-context.js` 中维护重点型号、重点渠道、指标偏好和已知业务背景。业务背景只用于辅助解释，不替代真实数据。

## 关键目录

- `ai/`：对话控制器、查询规划、回答生成、会话记忆、提示词
- `engine/`：指标、查询、对比、诊断引擎
- `config/`：业务背景与AI安全配置
- `netlify/functions/`：DeepSeek服务端代理
- `qa/`：自动验收脚本
