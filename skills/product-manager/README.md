# 产品经理 / Product Manager

## 一句话简介 / Summary

中文：面向产品经理的全生命周期技能，覆盖机会评估、PRD 撰写、路线图规划、GTM 上市方案与上线后度量，输出可直接粘贴进文档系统的成品。

EN: Full-lifecycle product management skill covering opportunity assessment, PRD writing, roadmap planning, GTM launch, and post-launch measurement, delivered as paste-ready documents.

## 能力清单 / Capabilities

中文：

- 机会评估：为什么现在做、用户证据、商业价值、RICE 打分、备选方案、做/不做建议
- PRD：问题陈述、目标与成功指标、非目标、用户故事与验收标准、技术考量、发布计划
- 路线图：Now / Next / Later 三层结构 + 北极星指标 + 明确不做清单
- GTM：目标受众、价值主张、分角色话术、发布检查清单、成功标准、回滚预案
- Sprint 健康快照：承诺 vs 交付、阻塞、范围变更、进入下迭代的风险

EN: Opportunity assessment, PRD, Now/Next/Later roadmap, GTM plan, and sprint health snapshot.

## 使用示例 / Example Prompts

中文：

- 帮我写一份「批量导出」功能的 PRD，用户是中小企业的运营人员
- 这个需求该不该做？帮我做个机会评估，附 RICE 打分
- 帮我排一下 Q4 的产品路线图，我们团队 4 个研发
- 写个 GTM 上市方案，下个月 15 号发布
- 从 0 到 1 规划一个共享电单车的运营后台，先给我产品规划

EN:

- Write a PRD for bulk export, target users are ops staff at SMBs
- Should we build this? Give me an opportunity assessment with a RICE score
- Draft our Q4 roadmap for a team of four engineers
- Create a go-to-market plan for a launch on the 15th

## 目录结构 / Structure

```text
product-manager/
├── SKILL.md                      # 技能定义（必须）
├── README.md                     # 本说明
└── references/
    ├── templates.zh.md           # 中文模板
    ├── templates.en.md           # English templates
    └── frameworks.md             # RICE、指标设计、PRFAQ（中英对照）
```

## 前置条件 / Prerequisites

中文：无。本技能为纯提示词型技能，不依赖任何 MCP 服务、API Key 或外部账号，安装即可使用。涉及联网调研的场景，建议在具备联网检索能力的环境中使用。

EN: None. This is a prompt-only skill with no MCP service, API key, or external account required.

## 安全说明 / Security Notes

中文：本技能仅生成 Markdown 文档内容，不执行脚本、不访问网络、不读写用户文件、不调用任何外部接口。所有需要确认的信息以 `[待确认：xxx]` 标注，不臆造数据。

EN: This skill generates Markdown only. It runs no scripts, makes no network calls, touches no user files, and calls no external APIs. Unknown inputs are marked `[TBD: xxx]` rather than invented.

## 版本 / Version

1.0.0 ｜ 作者 Author: zxh ｜ 许可 License: MIT
