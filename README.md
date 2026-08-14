# DSH Kanban 看板插件

为 DeepSeek Harness（DSH）实现的 Hermes 风格看板插件：9 列任务流转 + 拖拽 + 评论 + 事件时间线 + 多看板 + **定时列自动流转**，并支持把「就绪」任务**派发给 DSH 子代理真实执行**（Ready → Running → Done 自动流转、**心跳监控**与**实时进度**回显、结果摘要回写）。

> 原型：Hermes 桌面端看板插件（`apps/desktop/src/plugins/kanban/`，功能分析见同目录《看板插件功能报告.md》）。
> 实现形式：**静态插件包 `dsh-kanban` + 用户预设「看板」**。插件以 ES 模块包（`plugin/`，Host 半 + dsh.client 客户端 bundle）落地，由用户预设 `~/.dsh/.agent-presets/kanban/agent.cordis.yml`（standard 组合 + `dsh-kanban` 一行）挂载；选择该预设的会话自动获得看板工具与「看板」标签页。**看板数据永久落盘于 `kanban-store.json`。**

## 文件布局

```
DSH-kanban/
├── 看板插件功能报告.md      # Hermes 原版功能分析（只读参考）
├── kanban-store.json        # 看板数据（任务/评论/事件/运行记录，自动生成与维护）
├── runs/                    # 派发任务的子代理进度文件（<任务ID>.progress，自动生成与维护，已 gitignore）
├── plugin/                  # 静态包 dsh-kanban（真实 ESM / 浏览器 bundle）
│   ├── package.json         # 包清单：exports ./client、dsh.client 声明（platform: web）
│   ├── index.js             # 包根再导出（兼容按目录候选 index.js 的解析路径）
│   ├── host.js              # Host 半：JSON 存储 + 14 个 RPC + 子代理派发/终止 + 事件循环（定时/心跳/进度）+ 2 个 Agent 工具 + webServer 路由 /kanban/rpc
│   └── client.js            # Client bundle：window.__ModuleLoader__.load 注册，看板 UI（conversation.view「看板」标签页），fetch /kanban/rpc
└── README.md                # 本文档
```

## 安装（一次性）

1. 预设目录（`agent.cordis.yml` = standard 组合 + 看板行，`preset.yml` 为显示名）：

   ```
   C:\Users\<用户>\.dsh\.agent-presets\kanban\
   ```

2. 包解析 junction（把 `dsh-kanban` 暴露给 profile 引导的 node_modules 解析）：

   ```powershell
   New-Item -ItemType Junction `
     -Path  C:\Users\<用户>\.dsh\profiles\node_modules\dsh-kanban `
     -Target D:\WorkSpace\DSH-kanban\plugin
   ```

3. 在 GUI 的预设选择器里选「看板」，新建会话即自动获得插件（看板标签页 + `kanban_create_task` / `kanban_dispatch_task` 工具）。

## 更新流程

- **改 Host（`plugin/host.js`）**：重启 `npx @deepseek-ai/dsh web` 后生效（预设行随进程启动重新加载）。
- **改 Client（`plugin/client.js`）**：保存后刷新页面即可（bundle 由 `/plugins/dsh-kanban/client.js` 按请求从磁盘读取，no-cache）。
- 数据文件 `kanban-store.json` 与上述更新无关，始终保留。

## 停止 / 移除

- 停用：会话改用其他预设（看板行不再挂载；数据文件保留）。
- 移除：删除预设目录 `C:\Users\<用户>\.dsh\.agent-presets\kanban\` 与 junction `C:\Users\<用户>\.dsh\profiles\node_modules\dsh-kanban`，并删除 `DSH-kanban/` 目录（数据随 `kanban-store.json` 一起删除）。

## 功能清单

- **9 列泳道**：待细化 → 待办 → 定时 → 就绪 → 运行中 → 阻塞 → 审核 → 完成 → 归档（配色沿用 Hermes `COLUMN_META`）；空列自动收窄为竖条（含竖排列名），点列头可手动折叠/展开；归档列默认隐藏可切换显示
- **任务卡片**：标题（两行截断）、正文摘要、优先级徽章、负责人、定时时间、评论数、运行中标记、卡片年龄、按列着色左边条
- **拖拽换列**：HTML5 原生拖放（与 Hermes board.tsx 同模式）
- **Ctrl/Cmd 多选 + 批量操作条**：批量移动状态 / 批量删除
- **按列筛选**：标题 / 正文 / ID 全文过滤
- **定时列自动化**（事件循环）：任务带「定时执行时间」放入「定时」列，到点自动流转「就绪」并记录 `by: 'timer'` 事件；不带时间的定时任务保持停放（需在抽屉设置时间）。新建任务选定时列默认 +1 小时，可改
- **详情抽屉**：彩色状态迁移按钮、标题/描述/负责人/优先级/定时时间编辑、评论线程、完整事件时间线、执行控制台（运行信息 + 最近活动 + 实时进度 + 结果摘要/错误）
- **多看板**：创建 / 切换 / 删除看板
- **DSH 代理派发**（核心）：Ready 任务点「▶ 派发给 DSH 代理执行」→ 宿主在当前会话下启动 DSH 子代理执行任务 → 完成后自动转「完成」并回写结果摘要；失败转「阻塞」并记录错误；可「■ 停止运行」（任务回到就绪）
- **运行心跳**（事件循环）：子会话日志活动（`session/event`）与进度文件更新都会刷新 `heartbeat_at`；超过 30 分钟无任何信号 → 终止运行并转「阻塞」（原因：心跳丢失），杜绝"假运行"卡片
- **实时进度**（事件循环）：派发提示词要求子代理向 `DSH-kanban/runs/<任务ID>.progress` 追加进度行，循环读取并在抽屉「执行」区显示最近 50 行
- **Agent 渠道**：Host 注册模型工具 `kanban_create_task`，主 Agent 可在对话中直接创建看板任务（标题必填；看板/初始列/优先级/子Agent模型/定时时间可选），与 UI 创建走同一套校验、事件与落盘逻辑
- **持久化**：每次变更 250ms 防抖落盘；刷新页面、重跑插件、重启 DSH 数据都不丢

## 入口

- 会话视图中的「看板」标签页（`conversation.view` 插槽，id=kanban）；关闭 = 切回「聊天」标签。

## 数据格式（kanban-store.json）

```jsonc
{
  "schemaVersion": 1,
  "boards": [{
    "slug": "main", "name": "主看板", "created_at": 1786642238696,
    "tasks": [{
      "id": "t_xxx", "title": "…", "body": "…",
      "status": "triage|todo|scheduled|ready|running|blocked|review|done|archived",
      "assignee": null | "标签", "priority": 0|1|2,
      "scheduled_at": null | 1786642238696,  // 定时执行时间（epoch 毫秒），仅 scheduled 状态生效
      "created_at": …, "updated_at": …,
      "comments": [{ "id": "c_xxx", "author": "user", "body": "…", "created_at": … }],
      "events":  [{ "id": 1, "kind": "created|edited|moved|commented|dispatched|completed|terminated|blocked", "payload": {}, "created_at": … }],
      "run": null | { "provider": "…", "runId": "…", "seq": 1, "started_at": …, "ended_at": …,
        "outcome": "done|error|terminated", "summary": "…", "error": "…",
        "heartbeat_at": …, "progress": ["…"], "progressLineCount": 0 }
    }]
  }]
}
```

## RPC 面（Host webServer 路由 `POST /kanban/rpc`，Client 经 fetch 调用）

`getStore`（内存缓存）`reload`（丢弃缓存强制重读磁盘，刷新按钮用）`listModels` `createBoard` `deleteBoard` `createTask` `patchTask` `moveTask` `bulkMove` `bulkDelete` `deleteTask` `addComment` `dispatch` `terminate`

## 与 Hermes 原版的差异（有意取舍）

| Hermes | 本插件 |
|---|---|
| 60s 调度器自动派发 Ready 任务 | **手动点「运行」派发**（避免意外消耗 token） |
| scheduled 列有定时唤醒语义 | 事件循环每 10s 检查，到点自动流转「就绪」（`by: 'timer'`） |
| 运行中的代理可轮询新评论 | 评论仅记录；运行期间新评论不实时送达（重跑时经【追加评论】随任务正文带入） |
| 代理心跳 + 超时回收（`last_heartbeat_at`） | 子会话日志活动 + 进度文件双重信号刷新心跳；30 分钟无信号 → 终止并转「阻塞」 |
| WebSocket 实时推送 | 5s 轮询 + 每次操作后立即刷新 |
| 父/子任务门禁、附件、工作量预估、编排设置、四语言 i18n | 未实现（列为后续可选扩展） |
| `~/.hermes/kanban.db` SQLite | 单文件 JSON（工作区内，跨重启持久） |

## 派发提示词结构（Host `buildPrompt`）

派发给 DSH 子代理的提示词按以下结构组装（无对应数据的区块自动省略）：

```
你被派发执行一个看板任务（DeepSeek Harness kanban dispatch）。

【任务标题】<title>
【任务描述】<body>（有则输出）

【进度汇报】
看板会通过工作区文件 DSH-kanban/runs/<任务ID>.progress 实时展示你的执行进度。
每完成一个重要步骤（例如完成一次检查、写完一个文件、完成一次验证），请向该文件
追加一行简短的中文进度说明。只追加、不覆盖、不删除该文件，也不要写入时间戳
（看板会自动记录时间）。若某个步骤需要长时间执行，请在该步骤开始与结束时各追加一行。

【追加评论】…（有评论时：`- user MM-DD HH:mm：内容` 逐行列出）
【上次运行】…（有运行记录时：结果/摘要/错误）

【完成要求】
请在当前工作区中完成该任务。完成后，用一段简短的总结说明你做了什么、结果如何、
以及遗留事项（如有）。这段总结将作为任务的完成摘要写回看板。
```

## 限制与已知行为

- **刷新页面（F5）不会丢失看板入口**：客户端 bundle 属于 Web 引导图的一部分，每次刷新都重新加载；Host 端挂在预设的常驻挂载上，与页面无关。页面长时间不刷新时数据由 5s 轮询自动更新。
- 派发需要当前 DSH 进程中有**存活的代理会话**（当前对话开着即可）；否则任务留在就绪列并提示
- 插件停止/更新/DSH 重启时，处于「运行中」的任务会被标记为「阻塞」（原因：worker lost / 插件已停止），需手动移回就绪重新派发——与 Hermes 的 stale 心跳处理同思路，不产生"假运行"卡片
- `running` 列只能通过派发进入，不能手动拖入（防止伪造运行状态）
- 删除看板会终止其中所有运行中的派发
- 心跳超时 30 分钟为插件常量（`HEARTBEAT_TIMEOUT_MS`）：单步长时间执行且既不写进度文件也不产生会话日志的任务，可能在无信号 30 分钟后被判定「心跳丢失」；此类任务请在任务描述中说明，或由代理按提示词在长步骤前后追加进度行
- 手动/批量移入「定时」列的任务不会自动获得定时时间（保持停放），需在抽屉设置「定时执行时间」；到点提升后 `scheduled_at` 置空，避免重复触发

## 变更记录

- 2026-08-14：初版（动态插件 `kanban-1/pkg-1`），通过本会话验证；源码沉淀至 `plugin/`，数据文件 `kanban-store.json` 含示例看板「主看板」。
- 2026-08-14：pkg-2 修复事件 ID 在插件重启后归零导致的重复 ID（React key 冲突），加载时自动修复存量数据。
- 2026-08-14：pkg-3 修复派发——动态插件 VM 沙箱不提供 `AbortController`，改用鸭子类型的 AbortSignal（`subagents` 链路仅使用 `aborted`/`reason`/`addEventListener`/`removeEventListener`），终止仍以 `run.dispose()` 为主通道。
- 2026-08-14：pkg-4 修复窗口 ✕ 关闭按钮——标题栏拖拽的指针捕获吞掉按钮点击；拖拽现在只在非按钮区域启动。
- 2026-08-14：pkg-5（插件 `kanban-2`，因原 `kanban-1` 被移除后重新定义）——调大左下角侧边栏开关按钮：图标 14→18px、文字 13→15px 加粗、点击区域增大。
- 2026-08-14：pkg-8——左下角按钮改为「文字 + 品牌色圆点」方案（不依赖字体字形/图标），加浅色底与边框，窄/宽侧栏均清晰可见；途中迭代过 pkg-6（SVG 图标）与 pkg-7（加宽按钮），最终采用 pkg-8。
- 2026-08-14：pkg-10——入口改为**会话视图标签页**：在「聊天」标签旁新增「看板」标签，点击后整个会话区域显示看板（`conversation.view` 插槽，id=kanban）；移除左下角按钮与悬浮窗口。看板窗口不再可拖动，关闭 = 切回「聊天」标签。
- 2026-08-14：pkg-11——派发按钮改为在未运行、未归档的任务上始终显示；不在「就绪」列时点击自动先移至就绪再派发（记录移动事件）。
- 2026-08-14：pkg-12——细节微调：「归档」按钮改「显示归档」；列收缩态与展开态等高（窄条整列高度）；颜色标识由圆点改为列顶部小竖条。
- 2026-08-14：pkg-13——细节微调：展开列颜色标记改为向左圆角箭头（高度与竖条一致）；列名 14px、列头图标 16px；新建任务默认初始列=待细化、移除 triage 勾选框、字段标签加大并改主文字色；优先级改为整数 0-9（越大越优先，卡片显示数字徽章：7-9 红 / 4-6 黄 / 1-3 蓝）。
- 2026-08-14：pkg-14——**负责人升级为模型绑定**：派发时以负责人字段作为子代理模型（`agentOptions.model`，继承父代理 provider），派发前校验模型存在（无效模型名直接报错提示），派发事件记录所用模型；提示词不再携带负责人标签。
- 2026-08-14：pkg-15——「负责人（模型名）」改名为「子Agent模型」并改为**下拉选择框**：选项由 Host 新增 `listModels` RPC 动态获取（LLM 服务全部 provider 的模型去重列表），第一项「默认模型（跟随会话）」，抽屉与新建任务对话框均生效。
- 2026-08-14：pkg-16——移除「子Agent模型」下方的小字提示。
- 2026-08-14：pkg-17——卡片徽章微调：优先级徽章始终显示（0=绿色，分档 0 绿 / 1-3 蓝 / 4-6 黄 / 7-9 红）；评论徽章由 💬 emoji 改为「评论个数N」文字。
- 2026-08-14：pkg-18——收缩列（kbn-lane-rail）在色条与数量之间新增竖排列标题（writing-mode: vertical-rl），收缩时仍能看到列名。
- 2026-08-14：pkg-19——派发按钮文案统一为「▶ 派发给 DSH 代理执行」，去掉「（先移至就绪）」括号说明（自动移动行为不变）。
- 2026-08-14：pkg-21——派发提示词注入历史上下文：任务已有评论时追加【追加评论】区块（作者+时间+内容）；有运行记录时追加【上次运行】区块（结果/摘要/错误）。首次派发无评论、无运行记录，两段自动省略。（pkg-20 为该功能的中间版本，未运行。）
- 2026-08-14：pkg-22/pkg-23——**心跳 + 定时列事件循环**：Host 增加 10s 事件循环（定时列到点自动流转就绪 `by:'timer'`、运行心跳监控、进度文件读取）与 `session/event` 活性监听；任务新增 `scheduled_at` 字段（新建/抽屉可设「定时执行时间」，默认 +1 小时），运行记录新增 `heartbeat_at`/`progress`/`progressLineCount`；派发提示词重构为【任务标题】→【任务描述】→【进度汇报】（子代理向 `DSH-kanban/runs/<任务ID>.progress` 追加进度行）→【追加评论】→【上次运行】→【完成要求】；抽屉显示「最近活动」与「实时进度（最近 50 行）」，定时卡显示时间徽章；心跳超时 30 分钟无信号 → 终止并转「阻塞」。（pkg-22 为验证版，超时 5 秒；pkg-23 正式版，超时 30 分钟。）
- 2026-08-14：pkg-23——**刷新按钮改为强制重读磁盘**：新增 `reload` RPC（丢弃内存缓存重读 kanban-store.json），↻ 按钮走它（5s 轮询仍用缓存）；修复连带问题：重读磁盘时不再把有活跃运行的任务误判为 worker lost（仅无 `runs` 记录的 running 任务才修复）、事件循环改用加载快照扫描。
- 2026-08-14：pkg-24——**列「＋」按钮联动初始列**：从某列的 ＋ 打开新建任务对话框时，初始列默认即为该列（定时列入口同时预填 +1 小时定时时间）；工具栏「＋ 新任务」仍默认待细化。
- 2026-08-14：pkg-25——**Agent 创建任务渠道 + 正式心跳超时**：Host 注册模型工具 `kanban_create_task`（主 Agent 对话内直接建卡，参数：title 必填、body/board/status/priority/assignee/scheduled_at 可选；省略 board 用第一个看板，status 默认 todo，支持定时 ISO 时间）；`createTask` 逻辑抽取为 `createTaskOp` 供 RPC 与工具共用；心跳超时由验证值 5 秒改回正式值 30 分钟。
- 2026-08-14：**静态化迁移（告别动态插件）**——插件改为静态包 `dsh-kanban`（`plugin/`：ES 模块 Host + `dsh.client` 浏览器 bundle + `package.json` + `index.js` 根再导出），由用户预设「看板」（`~/.dsh/.agent-presets/kanban/`，standard 组合 + `dsh-kanban` 行）挂载，经 `~/.dsh/profiles/node_modules/dsh-kanban` 目录联接解析；RPC 由动态插件的 `harness.handle/host.call` 改为 webServer 路由 `POST /kanban/rpc`（fetch），工具注册由 `harness.registerTool` 改为 `ctx.get('tools').register`，客户端样式注入改为自建 `<style data-plugin-css>`；新增 `kanban_dispatch_task` 工具（派发「就绪」任务）。已通过 `standingKeyFor` 挂载验证（validate=OK）与 Web 引导图确认（`/plugins/dsh-kanban/client.js`、`POST /kanban/rpc` 均 200）。更新流程：改 Host 重启 DSH，改 Client 刷新页面。
