# Suo · 梭

面向 AI 产品经理的桌面工作台。资料、想法和对话放在同一张画布上，和 AI 一起把一个想法推进成立项报告、需求文档和调研结论。名字取自织布的梭子：在资料、工具和文档之间来回穿梭，把零散的线织成成品。

Suo 是一个 macOS 桌面 App（Apple 芯片），没有命令行入口。

## 下载

在 [Releases](../../releases) 下载 `Suo_<版本>_aarch64.dmg`，打开后把 Suo 拖进「应用程序」。App 没有 Apple 开发者签名，第一次打开时请在「应用程序」里右键 Suo，选择「打开」。

打开后在「设置 → 模型」里添加自己的模型连接（OpenAI 兼容、OpenAI Responses 或 Anthropic 接口），可以用「测试连接」确认模型能用、是否支持工具调用。

## 能做什么

- **画布**：便签、文档、草图和文件卡片自由摆放、连线、分组（⌘G）、上色、加标签和置顶；便签和文档支持 Markdown，文档可以导出为 Markdown 文件。
- **读资料**：PDF 连续阅读，Word 正文、CSV、HTML、图片和音视频都能在卡片里直接打开。
- **Agent 对话**：Suo 能读取画布和资料，把结果整理到画布上、撰写和修改文档、整理画布（分组、排列、上色）、联网搜索和读取网页、使用下面的技能；需求不清时会给出选项让你选。回复可以随时停止，所有画布改动都能用 ⌘Z 撤销。
- **会话**：自动保存，可以重命名、置顶、删除到回收站再恢复。

## 自带技能

| 技能 | 用途 |
|---|---|
| `ai-product-initiation` | 产品立项教练：逐步提问，用证据推导问题、目标体验、取舍和版本安排，形成八章立项报告和工作底稿 |
| `pm-opportunity-assessment` | 产品机会与需求判断 |
| `pm-material-synthesis` | 资料整理与知识归纳 |
| `pm-user-research` | 用户研究与访谈分析 |
| `pm-competitive-research` | 竞品与替代方案研究 |
| `pm-requirements-prd` | 需求拆解与 PRD |
| `pm-prioritization-roadmap` | 优先级与版本路线图 |
| `pm-metrics-experiments` | 指标设计与实验复盘 |
| `pm-ai-product-design` | AI 产品设计与评估 |
| `product-manager` | 产品经理全生命周期：机会评估、PRD、路线图、GTM 上市方案、上线后度量（作者 zxh，MIT） |

技能是 Agent Skills 格式：每个技能一个目录，里面放 `SKILL.md`，模板和参考资料放在同目录的 `references/`、`assets/` 下。也可以在 App 的「技能」里导入自己的技能。

## 目录

```text
desktop/           桌面 App（Tauri + React），开发、打包与数据说明见 desktop/项目说明.md
agent.md           Suo 的角色与工作方式（系统提示词）
skills/            产品经理技能，打包进 App
extensions/        网页读取（web-fetch.js），打包进 App
config/            模型配置示例
test/              网页读取与品牌检查测试
state/             本机私有数据，如模型密钥（不进仓库）
```

## 开发

需要 macOS、Node.js 22.19 以上和 Rust 工具链。

```bash
npm install --ignore-scripts          # 根目录：Agent 引擎依赖
npm test                              # 根目录测试，不调用付费模型
cd desktop && npm install
npm test                              # 桌面端测试，不调用付费模型
npm run dev                           # 浏览器开发版，打开 http://127.0.0.1:1420
npm run bundle                        # 生成 src-tauri/target/release/bundle/macos/Suo.app
npm run dmg                           # 把上面的 App 做成 DMG 安装包
```

开发版没有添加模型连接时，会读取 `state/agent/models.json`，格式参考 `config/models.example.json`。

## 致谢

Suo 以 [Pi coding agent](https://github.com/earendil-works/pi) 为运行引擎。第三方项目与许可见 [NOTICE](NOTICE)。

## 许可

[MIT](LICENSE)
