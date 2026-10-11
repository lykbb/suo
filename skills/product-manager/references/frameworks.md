# 常用框架 / Shared Frameworks（中英对照 / Bilingual）

## 1. RICE 打分 / RICE Scoring

中文：RICE = (触达 × 影响 × 信心) ÷ 投入。用于给同一批候选项排序，不做跨季度绝对值比较。

EN: RICE = (Reach x Impact x Confidence) / Effort. Use it to rank candidates within one batch, not to compare across quarters.

| 因子 / Factor | 中文口径 | English scale |
|---|---|---|
| 触达 Reach | 一个季度内触达的用户数或事件数，取埋点值，无埋点则标注估算 | Users or events reached per quarter, from analytics; label estimates as estimates |
| 影响 Impact | 3 巨大 / 2 高 / 1 中 / 0.5 低 / 0.25 极小 | 3 massive / 2 high / 1 medium / 0.5 low / 0.25 minimal |
| 信心 Confidence | 100% 有强数据 / 80% 有访谈 / 50% 有类比 / <50% 纯直觉 | 100% hard data / 80% interviews / 50% analogy / <50% gut |
| 投入 Effort | 人月，含研发、设计、测试，不含上线后运维 | Person-months including eng, design, QA; excludes post-launch ops |

中文使用要点：

- 打分前先统一口径，同一批候选项必须由同一批人打分
- 得分接近（差距 <15%）时，按战略契合度与依赖风险定先后，不要迷信小数点
- 结果必须附敏感性分析：把 Effort 翻倍后排名是否变化

EN usage notes:

- Calibrate the scale before scoring; one batch, one group of scorers
- When scores are within 15%, decide on strategic fit and dependency risk, not decimals
- Always include a sensitivity check: does the ranking hold if Effort doubles?

## 2. 成功指标设计清单 / Success Metric Checklist

中文：每个指标必须四要素齐全，缺一项就不是指标。

1. 指标名与口径（怎么算，分母是谁）
2. 当前基线（数值 + 数据来源 + 取数日期）
3. 目标值与时间窗口（上线后 30 / 60 / 90 天）
4. 反向护栏指标（这个功能会不会伤害别的指标）

反例 / Bad：「提升用户满意度」（无法测量）
正例 / Good：「该主题每周工单量从 120 降到 40 以下，统计口径为标签包含 billing 的工单，测量窗口为上线后 90 天」

EN: Every metric needs four elements: definition with denominator, baseline with source and date, target with window, and a counter-metric that watches for collateral damage.

Bad: "Improve user satisfaction"
Good: "Weekly tickets tagged billing drop from 120 to under 40, measured 90 days post-launch"

常用护栏指标 / Common counter-metrics：崩溃率、页面加载时长、核心流程转化率、工单总量、退订率。

## 3. PRFAQ 写法 / Writing a PRFAQ

中文：在写 PRD 之前，先用两页纸做 PRFAQ，用来验证需求是否值得做。

**第一部分 新闻稿（假设发布日期在 6 个月后）**
- 标题：产品名 + 给用户的核心价值
- 第一段：为谁解决了什么问题
- 第二段：为什么现在才做成（过去为什么不行）
- 第三段：用户原话引述
- 第四段：怎么开始用（价格 / 入口）

**第二部分 常见问题（站在挑剔用户角度问 8-12 个）**
- 必问一：这跟我现在的做法有什么不同
- 必问二：我要迁移数据吗，多麻烦
- 必问三：和 【竞品 / 现有功能】 是什么关系
- 必问四：价格怎么算
- 必问五：不支持什么场景

如果新闻稿写不出让用户想转发的点，说明需求没找对，回到问题陈述。

EN: Write a two-page PRFAQ before the PRD to validate whether the idea deserves scope.

**Part 1 - Press release** (dated 6 months out): headline with user value, opening paragraph on who and what problem, why now, a customer quote, and how to get started.

**Part 2 - FAQ** (8-12 questions from a skeptical user): how this differs from current workflow, migration cost, relationship to existing features or competitors, pricing, and unsupported scenarios.

If the press release has nothing shareable, the problem is not framed correctly. Go back to the problem statement.

## 4. 三问法 / Three Whys

中文：收到需求时连续追问，直到挖到底层目标。

- 问一：为什么要做这个？（得到第一个答案：业务诉求）
- 问二：为什么这个业务诉求重要？（得到用户或商业结果）
- 问三：为什么这个结果现在重要？（得到时机与代价）

挖不出来就说明需求方自己也没想清楚，此时应输出澄清问题清单，而不是 PRD。

EN: Drill from a feature request to the underlying objective with three successive whys: why build it (business ask), why that matters (user or business outcome), why now (timing and cost of delay). If the chain collapses, return a clarification checklist instead of a PRD.

## 5. 优先级主张句式 / Recommendation Sentence Patterns

中文：

- 建议做：【结论】。依据是【证据】。若不做的代价是【代价】。置信度【X%】，改变结论的条件是【条件】。
- 建议不做：【结论】。因为【证据不足 / 与战略不符 / 投入产出比低】。重启条件是【条件】。
- 建议延后：【结论】。当前阻塞是【依赖 / 资源 / 时机】。建议在【时间】重新评估。

EN:

- Build: [conclusion] because [evidence]. Cost of not doing it: [cost]. Confidence [X]%; what would change my mind: [condition].
- Do not build: [conclusion] because [weak evidence / poor strategic fit / weak ROI]. Revisit condition: [condition].
- Defer: [conclusion] because of [dependency / resource / timing]. Re-evaluate at [date].
