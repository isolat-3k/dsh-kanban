# DSH Kanban 看板插件

为 DeepSeek Harness（DSH）实现的 Hermes 风格看板插件：9 列任务流转 + 拖拽 + 评论 + 事件时间线 + 多看板 + **定时列自动流转**，并支持把「就绪」任务**派发给 DSH 子代理真实执行**（Ready → Running → Done 自动流转、**心跳监控**与**实时进度**回显、结果摘要回写）。

> 原型：Hermes 桌面端看板插件（`apps/desktop/src/plugins/kanban/`，功能分析见同目录《看板插件功能报告.md》）。
> 实现形式：**静态插件包 `dsh-kanban`，宿主平面挂载（不经任何 Agent 预设）**。插件以 ES 模块包（`plugin/`，Host 半 + dsh.client 客户端 bundle）落地，由 web profile 的补丁层 `~/.dsh/profiles/web/cordis.patch.yml`（`insert` 一行）挂载进宿主组合；进程启动即生效，任意预设的会话都自动获得看板工具与「看板」标签页。**看板数据永久落盘于 `kanban-store.json`。**

## 界面预览

![看板主界面](界面截图.png)

## 文件布局

```
DSH-kanban/
├── 看板插件功能报告.md      # Hermes 原版功能分析（只读参考）
├── 界面截图.png             # 看板主界面截图（README「界面预览」引用）
├── kanban-store.json        # 看板数据（任务/评论/事件/运行记录，自动生成与维护）
├── runs/                    # 派发任务的子代理进度文件（<任务ID>.progress，自动生成与维护，已 gitignore）
├── plugin/                  # 静态包 dsh-kanban（真实 ESM / 浏览器 bundle）
│   ├── package.json         # 包清单：exports ./client、dsh.client 声明（platform: web）
│   ├── index.js             # 包根再导出（兼容按目录候选 index.js 的解析路径）
│   ├── host.js              # Host 半：JSON 存储 + 14 个 RPC + 子代理派发/终止 + 事件循环（定时/心跳/进度）+ 10 个 Agent 工具 + 运行时 skill 注册 + webServer 路由 /kanban/rpc + WebSocket 下行通道 /kanban/events
│   ├── skill.js             # 运行时 skill「kanban」的内容（宿主启动时注册进 skills 注册表）
│   └── client.js            # Client bundle：window.__ModuleLoader__.load 注册，看板 UI（conversation.view「看板」标签页），fetch /kanban/rpc + WebSocket /kanban/events 订阅
└── README.md                # 本文档
```

## 安装（一次性）

1. 包解析 junction（把 `dsh-kanban` 暴露给 profile 引导的 node_modules 解析）：

   ```powershell
   New-Item -ItemType Junction `
     -Path  C:\Users\<用户>\.dsh\profiles\node_modules\dsh-kanban `
     -Target D:\WorkSpace\DSH-kanban\plugin
   ```

2. 补丁层（在 web profile 的宿主组合里插入挂载行），编辑 `C:\Users\<用户>\.dsh\profiles\web\cordis.patch.yml`：

   ```yaml
   - insert:
       - id: kanban
         name: dsh-kanban
   ```

3. 重启 `npx @deepseek-ai/dsh web` 并刷新页面。所有会话——无论选择哪个预设——都自动获得插件（看板标签页 + 10 个 `kanban_*` 工具 + skill 目录中的 `kanban`）。需要对所有 profile 生效时，把同一段补丁放进家级补丁层 `<DSH_HOME>\cordis.patch.yml`。

## 更新流程

- **改 Host（`plugin/host.js`）**：重启 `npx @deepseek-ai/dsh web` 后生效（补丁层随进程启动重新加载）。
- **改 Client（`plugin/client.js`）**：保存后刷新页面即可（bundle 由 `/plugins/dsh-kanban/client.js` 按请求从磁盘读取，no-cache）。
- 数据文件 `kanban-store.json` 与上述更新无关，始终保留。

## 停止 / 移除

- 停用：在补丁层给 kanban 行加 `disabled: true`（或删除 insert 行）后重启；数据文件保留。
- 移除：删除 junction `C:\Users\<用户>\.dsh\profiles\node_modules\dsh-kanban`，并删除 `DSH-kanban/` 目录（数据随 `kanban-store.json` 一起删除）。

## 功能清单

- **9 列泳道**：待细化 → 待办 → 定时 → 就绪 → 运行中 → 阻塞 → 审核 → 完成 → 归档（配色沿用 Hermes `COLUMN_META`）；空列自动收窄为竖条（含竖排列名），点列头可手动折叠/展开（手动收放过的列按选择记忆，localStorage 按看板分键）；归档列默认隐藏可切换显示
- **任务卡片**：标题（两行截断）、正文摘要、优先级徽章、负责人、定时徽章（「还剩xx · 绝对时间」）、评论数、运行中标记、卡片年龄、按列着色左边条
- **拖拽换列**：HTML5 原生拖放（与 Hermes board.tsx 同模式）
- **Ctrl/Cmd 多选 + 批量操作条**：批量移动状态 / 批量删除
- **按列筛选**：标题 / 正文 / ID 全文过滤
- **定时列自动化**（新定时模型）：任务带 `schedule` 放入「定时」列后按设定自动激活进「就绪」——**interval 间隔重复**（每 N 分钟，到点激活记录 `by: 'interval'`，本轮完成后自动回排定时列等下一轮）、**daily 每天固定时刻**（`by: 'daily'`）、**父卡片门禁**（设了父卡片的卡在父卡片完成/归档前不会被自动派发——任何列生效；父卡片被删除视为完成）。激活由每任务一个 `ctx.timeout` 驱动（不再全局扫描）；无 schedule 的定时任务保持纯停放
- **详情抽屉**：当前状态只读展示（彩色圆点 + 状态名）、标题/描述/负责人/优先级/定时方式（间隔/每天/父卡片）**实时保存**（字段变化 600ms 防抖自动保存，无「保存」按钮，关闭抽屉自动 flush）、评论线程、完整事件时间线、执行控制台（运行信息 + 最近活动 + 实时进度 + 结果摘要/错误）
- **多看板**：创建 / 切换 / 删除看板
- **DSH 代理自动派发**（核心）：**「待办/就绪」两列常驻自动派发**——建卡、拖入、定时激活、重启后的存量，凡在这两列、无活跃运行、且父卡片（若有）已完成/归档的卡，事件循环 10s 内自动启动 DSH 子代理执行（Agent 工具渠道挂靠当前发起代理；UI 渠道优先挂靠最近有会话活动的根代理，其次第一个根）→ 完成后自动转「完成」并回写结果摘要；失败转「阻塞」并记录错误（无存活会话等瞬态失败留在原列自动重试）；**派发按钮已移除**，「■ 停止运行」把任务移回**「待细化」**（避免被自动派发立即重跑）；只想记录不执行的卡放「待细化」
- **运行心跳**（事件循环）：子会话日志活动（`session/event`）与进度文件更新都会刷新 `heartbeat_at`；超过 30 分钟无任何信号 → 终止运行并转「阻塞」（原因：心跳丢失），杜绝"假运行"卡片；超时可用环境变量 `DSH_KANBAN_HEARTBEAT_MS`（毫秒）覆盖
- **实时进度**（事件循环）：派发提示词要求子代理向 `DSH-kanban/runs/<任务ID>.progress` 追加进度行，循环读取并在抽屉「执行」区显示最近 50 行
- **Agent 渠道（10 个工具 + skill 引导）**：Host 注册运行时 skill `kanban`（进入会话 skill 目录，模型可主动加载，用户可 `/kanban` 注入），并注册 10 个模型工具——读：`kanban_list_boards` / `kanban_list_tasks` / `kanban_get_task`；写：`kanban_create_task` / `kanban_update_task` / `kanban_add_comment` / `kanban_create_board`；执行：`kanban_dispatch_task` / `kanban_stop_task` / `kanban_delete_task`。全部与 UI 操作走同一套校验（含父卡片环检测）、事件与落盘逻辑；省略 `board` 的定位类工具会在所有看板中查找任务 id。工具调用在对话中以 `presentCall`/`presentResult` 渲染为文字提示卡片（不做自定义富卡片）
- **结算提醒（纯文字）**：客户端帧级浮层（`shell.overlay` 槽位）WebSocket 快照 diff——任务完成/失败弹 6s 文字 toast；页面刷新不回放历史结算（WS 断线时退回 5s 轮询兜底）
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
      "schedule": null | {
        "kind": "interval" | "daily" | null,   // interval=间隔重复，daily=每天固定时刻；null 且无 parentId 时纯停放
        "intervalMinutes": 30,                  // kind=interval 时：间隔分钟（1-10080，最长 7 天）
        "dailyMinutes": 540,                    // kind=daily 时：当天第几分钟（如 09:00 → 540）
        "parentId": null | "t_xxx",             // 可选父卡片（全局门禁）：父完成/归档/被删除前不自动派发；不设则不门禁
        "base": 1786642238696,                  // kind=interval 时：整倍数网格锚点（编辑保留，回排不随运行时长漂移）
        "nextAt": 1786642238696 | null          // 下一次激活时间（epoch 毫秒）；激活后置 null，重复任务在完成后回排
      },
      "created_at": …, "updated_at": …,
      "comments": [{ "id": "c_xxx", "author": "user" | "agent", "body": "…", "created_at": … }],
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

## 实时推送（WebSocket 下行通道 `GET /kanban/events`）

Host 经 `webServer.registerUpgrade` 注册 `/kanban/events` 升级路由，客户端以浏览器原生 WebSocket 连接。任何来源的 store 变更（UI 操作、Agent 工具、定时激活、运行进度/心跳、任务结算）都会在 Host 端防抖 100ms 合并后广播一帧**全量快照**给所有连接：

```json
{ "type": "snapshot", "boards": [ …与 getStore 相同… ], "now": 1786642238696 }
```

- **零依赖**：服务端握手用 `node:crypto` 自实现（RFC 6455，仅下行文本帧），不新增 npm 依赖；客户端无任何依赖。
- **下行专用**：客户端发文本/二进制帧按 1008（downlink only）关闭，仅接受 close/ping（pong 静默忽略）——与 harness 自带下行通道同语义。
- **安全**：握手前同源校验（Origin 与 Host 不一致 → 403），与 `/kanban/rpc` 一致。
- **保活**：服务端每 30s 发 ping；客户端据此察觉死连接并重连。
- **容错**：客户端断线按 1s 起指数退避重连（上限 15s）；断开期间界面退回 5s 轮询兜底，重连后自动恢复推送。旧版 Host（无此路由）时客户端同样始终轮询。
- **粒度**：任务卡片/状态/评论/结算类事件 <1s 送达；运行进度受 10s 事件循环读取进度文件的节奏约束（子代理按步骤写进度行，粒度匹配）。
- 快照推送为全量覆盖式（本地单机工具、数据量小），不做增量 diff；多标签页各持一条连接，全部实时同步。

## 与 Hermes 原版的差异（有意取舍）

| Hermes | 本插件 |
|---|---|
| 60s 调度器自动派发 Ready 任务 | **待办/就绪两列自动派发**（事件循环 10s 内；父卡片门禁等待；想记录不执行放待细化） |
| scheduled 列仅停放（时间归 cron，唤醒靠 agent 执行 `kanban unblock`） | **任务级 schedule**：interval / daily 每任务一个 `ctx.timeout` 到点激活；父卡片为全局门禁 |
| 运行中的代理可轮询新评论 | 评论仅记录；运行期间新评论不实时送达（重跑时经【追加评论】随任务正文带入） |
| 代理心跳 + 超时回收（`last_heartbeat_at`） | 子会话日志活动 + 进度文件双重信号刷新心跳；30 分钟无信号 → 终止并转「阻塞」 |
| WebSocket 事件流（每事件即推） | **WebSocket 全量快照推送**（`/kanban/events`，防抖合并；断线退回 5s 轮询兜底） |
| 父/子任务门禁、附件、工作量预估、编排设置、四语言 i18n | 未实现（列为后续可选扩展） |
| `~/.hermes/kanban.db` SQLite | 单文件 JSON（工作区内，跨重启持久） |

## 派发提示词结构（Host `buildPrompt`）

派发给 DSH 子代理的提示词按以下结构组装（无对应数据的区块自动省略）：

```
你被派发执行一个看板任务（DeepSeek Harness kanban dispatch）。

【任务标题】<title>
【任务描述】<body>（有则输出）
【补充要求】<instructions>（派发时给出则输出）

【进度汇报】
看板会通过工作区文件 DSH-kanban/runs/<任务ID>.progress 实时展示你的执行进度。
每完成一个重要步骤（例如完成一次检查、写完一个文件、完成一次验证），请向该文件
追加一行简短的中文进度说明。只追加、不覆盖、不删除该文件，也不要写入时间戳
（看板会自动记录时间）。若某个步骤需要长时间执行，请在该步骤开始与结束时各追加一行。

【追加评论】…（有评论时：`- <author> MM-DD HH:mm：内容` 逐行列出，author 为 user 或 agent）
【上次运行】…（有运行记录时：结果/摘要/错误）

【看板协作】
若你的会话中提供看板工具（kanban_add_comment 等），可以用它们向本任务追加评论（供看板
界面的人阅读），但不要用任何工具修改本任务的状态或字段：任务状态由看板的结算逻辑自动管理。

【完成要求】
请在当前工作区中完成该任务。完成后，用一段简短的总结说明你做了什么、结果如何、
以及遗留事项（如有）。这段总结将作为任务的完成摘要写回看板。
```

## Agent 工具清单（Host `KANBAN_TOOLS`）

| 工具 | 作用 | 定位方式（省略 board 时） |
|---|---|---|
| `kanban_list_boards` | 列出全部看板与各列负载 | — |
| `kanban_list_tasks` | 按 status/priority_min/assignee/query/limit 过滤列任务（按优先级降序） | 第一个看板 |
| `kanban_get_task` | 任务全量：字段/评论(近20)/事件(近20)/最近运行(结果、摘要、错误、进度尾 50 行) | 所有看板搜索 id |
| `kanban_create_task` | 建卡（title 必填；body/status/priority/assignee/schedule 可选） | 第一个看板 |
| `kanban_update_task` | patch 改字段（title/body/priority/assignee/schedule）或移动 status 列；拒绝改 running 任务（先用 stop） | 所有看板搜索 id |
| `kanban_add_comment` | 追加评论（author=agent，面向人） | 所有看板搜索 id |
| `kanban_dispatch_task` | 手动立即派发待办/就绪任务（默认已自动派发，一般无需手动）；可选 instructions 追加本轮【补充要求】 | 第一个看板 |
| `kanban_stop_task` | 终止 running 任务，移回待细化（避免自动重跑） | 所有看板搜索 id |
| `kanban_delete_task` | 删除任务（不可恢复） | 所有看板搜索 id |
| `kanban_create_board` | 新建看板（name 必填，slug 可选） | — |

所有工具返回值是面向人的一句话中文提示；对话中的调用卡片走 `presentCall`/`presentResult`（`card: 'generic'` 文字标题 + 结果文本），不注册自定义 toolview。

## Skill 引导（Host 运行时注册）

插件启动时通过 `ctx.skills.register` 注册运行时 skill `kanban`（来源 `custom`，全局层，所有预设/会话可见）：内容见 `plugin/skill.js`，说明何时用看板（多步骤/长期/定时/需委派的任务）、卡片生命周期、字段约定、标准工作流与面向人的书写礼仪。模型可经 `skill` 工具加载全文，用户可直接 `/kanban` 注入。若宿主不含 skills 服务则跳过注册（仅 console.warn），引导降级为工具描述内嵌约定。

## 限制与已知行为

- **刷新页面（F5）不会丢失看板入口**：客户端 bundle 属于 Web 引导图的一部分，每次刷新都重新加载；Host 端挂在宿主组合的常驻行上，与页面无关。页面数据由 WebSocket 实时推送自动更新，断开期间退回 5s 轮询兜底。
- 派发需要当前 DSH 进程中有**存活的代理会话**（当前对话开着即可）；没有时任务留在待办/就绪列，事件循环每 10s 自动重试（同一错误只告警一次）
- **自动派发会消耗 token**：任何进入「待办/就绪」列的卡都会启动子代理执行（含重启 DSH 后的存量）；只想记录不动手的卡放「待细化」
- 插件停止/更新/DSH 重启时，处于「运行中」的任务会被标记为「阻塞」（原因：worker lost / 插件已停止），需手动移回就绪重新派发——与 Hermes 的 stale 心跳处理同思路，不产生"假运行"卡片
- 「停止运行」把任务移回「待细化」而不是就绪（就绪会被自动派发立即重跑）；手动派发工具 `kanban_dispatch_task` 与 RPC `dispatch` 保留用于提前派发或重试
- `running` 列只能通过派发进入，不能手动拖入（防止伪造运行状态）
- 删除看板会终止其中所有运行中的派发
- 心跳超时默认 30 分钟（`HEARTBEAT_TIMEOUT_MS`，可用环境变量 `DSH_KANBAN_HEARTBEAT_MS` 覆盖）：单步长时间执行且既不写进度文件也不产生会话日志的任务，可能在无信号 30 分钟后被判定「心跳丢失」；此类任务请在任务描述中说明，或由代理按提示词在长步骤前后追加进度行
- RPC 路由 `/kanban/rpc` 校验浏览器 Origin 与 Host 一致（跨站请求返回 403）；命令行等无 Origin 头的客户端不受影响
- 手动/批量移入「定时」列的任务默认纯停放（不自动激活），需在抽屉设置定时方式（间隔/每天/父卡片）；带重复定时（interval/daily）的任务拖离「定时」列到除「就绪」以外的列会**清除其定时**（终止循环）；重复任务本轮执行失败转「阻塞」后需手动移回「定时」列才会重新排期
- 旧版数据的 `scheduled_at` 字段在加载时自动删除（旧定时系统已移除）
- Agent 派发是异步的：派发工具立即返回，主 Agent 需用 `kanban_get_task` 轮询运行结果与进度（工具说明与 skill 均已写明）；工具不提供阻塞式等待
- `kanban_update_task` 拒绝直接修改 running 任务的状态（需先 `kanban_stop_task` 停回待细化）；看板页拖拽仍按原行为「终止运行并移动」

## 变更记录

- 2026-08-16：**自动派发 + 实时保存 + 父卡片门禁**——① **自动派发**：「待办/就绪」两列常驻自动派发（列内无活跃运行且父卡片已完成的卡，事件循环 10s tick + 变更后 1s 补扫 + 启动加载后补扫都会触发；含重启后存量）；派发失败留在原列自动重试（同一错误只告警一次）；`dispatchOp` 门禁由 ready 放宽为 todo/ready；**派发按钮移除**（抽屉对 todo/ready 卡显示自动派发提示）；「停止运行」改为移回**待细化**（防止被自动派发立即重跑）。② **实时保存**：抽屉去掉「保存修改」按钮，标题/描述/负责人/优先级/定时字段 600ms 防抖自动 patchTask（显示「保存中…」；首轮基线不提交避免空 edited 事件；关闭抽屉自动 flush；自己的保存回显不回灌本地输入，外部修改照常同步）。③ **父卡片门禁修复 + 全局化**：修复客户端只设父卡片（无 interval/daily）时 payload 被丢弃的 bug；父卡片语义从「仅定时列激活」升级为**全局门禁**（任何列的卡在父卡片完成/归档前不被自动派发，父被删除视为完成）；新建对话框的父卡片选择对所有列可见。④ skill/工具文案同步新语义（中英）。生效方式：改 Host 需重启 DSH，改 Client 刷新页面。

- 2026-08-16：**WebSocket 实时推送**——① Host 新增 `/kanban/events` 下行通道（`webServer.registerUpgrade`）：零依赖自实现握手（node:crypto）与帧层（仅下行文本帧，客户端仅接受 close/ping，其余按 1008 关闭），同源校验与 `/kanban/rpc` 一致，30s 保活 ping，变更经 100ms 防抖合并后广播全量快照 `{type:'snapshot', boards, now}`；`mutate()` 完成钩子与 `session/event` 心跳路径接入广播，dispose 时关闭全部连接。② Client 在 apply 闭包内建单连接共享 channel：BoardContent 与结算 toast 浮层均改订阅推送，5s 轮询降级为「仅 WS 断开时」的兜底；断线 1s 起指数退避重连（上限 15s），订阅清空时关闭连接。③ 协议层已用 Node 原生 WebSocket 客户端冒烟验证（握手/短帧/16 位/64 位长度帧/ping-pong/1008 协议关闭/close 握手）。生效方式：改 Host 需重启 DSH，改 Client 刷新页面。

- 2026-08-15：**Agent 渠道补全 + 文字提示**——① **skill 引导**：新增 `plugin/skill.js`，宿主启动时经 `ctx.skills.register` 注册运行时 skill「kanban」（来源 custom、全局层，所有会话的 skill 目录可见；inject 增加 skills；服务缺失时仅 warn 降级）。② **工具面 2 → 10**：新增 `kanban_list_boards` / `kanban_list_tasks`（过滤+分页，按优先级降序）/ `kanban_get_task`（全量含评论、事件、运行进度）/ `kanban_update_task`（patch 编辑 + 状态移动；拒绝改 running）/ `kanban_add_comment`（author=agent）/ `kanban_stop_task` / `kanban_delete_task` / `kanban_create_board`；省略 board 时写/派发类工具用第一个看板、定位类工具全看板搜索 id；共享 `resolveBoardSlug`/`locateTask` helper 与注册工厂。③ **对话文字提示**：全部工具新增 `presentCall`/`presentResult`（`card:'generic'` 中文标题 + 结果摘要），不注册自定义 toolview、不引入 presentationMeta。④ **派发增强**：`kanban_dispatch_task` 新增可选 instructions（注入【补充要求】区块，cap 2000 字）；buildPrompt 新增【看板协作】区块（子代理可评论、不得改状态）。⑤ **结算提醒**：客户端注册 `shell.overlay` 槽位（id=kanban-status），5s 轮询快照 diff——完成/失败弹 6s 文字 toast、运行中显示「看板运行中 N」胶囊，首轮仅做基线不回放历史结算。⑥ **评论署名**：comment 增加 author（'user'/'agent'，存量补 'user'），事件 payload 与派发提示词携带；看板页 UI 不消费该字段。生效方式：改 Host 需重启 DSH，改 Client 刷新页面。

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
- 2026-08-14：**挂载方式迁移：告别预设**——看板不再经用户预设「看板」挂载（该预设目录 `~/.dsh/.agent-presets/kanban/` 已删除），改为 web profile 补丁层 `~/.dsh/profiles/web/cordis.patch.yml` 的 `insert` 行挂载到宿主平面：进程启动即生效，任意预设的会话都获得看板 RPC、两个 Agent 工具与「看板」标签页，与预设选择、会话创建顺序无关。插件代码零改动（其 Host 半本就通过 `ctx.get` 消费宿主平面服务，并把工具全局注册进宿主 tools 注册表）。删除前扫描了全部会话日志，无一会话记录 `kanban` 预设，删除不影响任何会话恢复。
- 2026-08-14：**静态化迁移（告别动态插件）**——插件改为静态包 `dsh-kanban`（`plugin/`：ES 模块 Host + `dsh.client` 浏览器 bundle + `package.json` + `index.js` 根再导出），由用户预设「看板」（`~/.dsh/.agent-presets/kanban/`，standard 组合 + `dsh-kanban` 行）挂载，经 `~/.dsh/profiles/node_modules/dsh-kanban` 目录联接解析；RPC 由动态插件的 `harness.handle/host.call` 改为 webServer 路由 `POST /kanban/rpc`（fetch），工具注册由 `harness.registerTool` 改为 `ctx.get('tools').register`，客户端样式注入改为自建 `<style data-plugin-css>`；新增 `kanban_dispatch_task` 工具（派发「就绪」任务）。已通过 `standingKeyFor` 挂载验证（validate=OK）与 Web 引导图确认（`/plugins/dsh-kanban/client.js`、`POST /kanban/rpc` 均 200）。更新流程：改 Host 重启 DSH，改 Client 刷新页面。
- 2026-08-14：**修复看板页永远「加载中」**——根因：插件 `inject` 只声明了 `fs/timer`，fiber 在启动早期即加载，此时 webServer 提供方 fiber 尚未激活，`ctx.get('webServer')`（strict 模式要求提供方 `fiber.state===2`）返回 `undefined`，路由注册被 `if (web && ...)` 静默跳过且不再重试；而 tools 服务加载早，工具分支正常注册（症状：Agent 工具可用、`POST /kanban/rpc` 405、页面无限加载）。修复：`inject` 补全 `webServer/tools/subagents/agents/sandboxPolicy`，Cordis 会等服务就绪再 apply（并在服务后到齐时自动重载）；同时客户端在初始加载失败时显示真实错误与「重试」按钮，不再永远显示「加载中…」。生效方式：改 Host 需重启 DSH（本次修复核心在 Host），改 Client 刷新页面即可。
- 2026-08-14：**定时系统重做**——移除旧 `scheduled_at` 单时间戳 + 10s 循环提权；任务新增 `schedule` 对象：`interval`（每 N 分钟间隔重复，激活 `by:'interval'`，本轮完成后自动回排定时列）、`daily`（每天固定时刻，`by:'daily'`）、`parentId`（父卡片完成/归档/被删除时事件激活，`by:'parent'`；不设父卡片则不激活；kind 与父卡片同时设置时需两者都满足）。激活由每任务一个 `ctx.timeout` 驱动（`syncTimers` 对账，错过快进到未来一次，过期时以 30s 复查防热循环），事件循环只保留心跳与进度读取。卡片徽章/抽屉同时显示「还剩xx」与「绝对时间」。拖离定时列到除就绪外的列会清除定时；重复任务失败转阻塞后需手动移回定时列重新排期。加载时自动删除旧 `scheduled_at` 字段（数据迁移）。`kanban_create_task` 工具的定时参数尚未同步（后续补齐）。生效方式：改 Host 需重启 DSH，改 Client 刷新页面。
- 2026-08-15：**修复批次（代码审查后）**——① **停止运行竞态**：`terminate` 置就绪后，迟到的 `run.result`（stopReason=aborted）会经 settle 把任务覆盖为「阻塞/失败」；`settleRun`/`settleError` 增加 `outcome !== null` 守卫（终止/拖离/心跳超时均已先落 outcome），「已终止」不再被迟到结果覆盖。② **Agent 工具对齐新定时模型**：`kanban_create_task` 删除已失效的 `scheduled_at` 死参数，新增 `schedule` 对象参数（kind/intervalMinutes/dailyTime/parentId），与 UI 同走 `normalizeSchedule` 校验。③ **父卡片链环检测**：设置 parentId 时沿现有父链向上查找，祖先成环直接报错，杜绝 A 等 B、B 等 A 死锁。④ **interval 锚点防漂移**：schedule 新增 `base` 锚点（编辑保留、加载时对存量数据补齐），回排按整倍数网格计算，每 N 分钟语义不再随运行时长漂移。⑤ **RPC 同源校验**：Origin 与 Host 不一致的浏览器请求返回 403。⑥ **UI 派发父会话选择**：优先最近有会话活动的根代理（`lastActiveRootId`，由 `session/event` 追踪），其次第一个根。⑦ 心跳超时支持环境变量 `DSH_KANBAN_HEARTBEAT_MS` 覆盖。⑧ dispose 落盘返回 Promise（宿主等待清理回调时可保证最终写入）。⑨ 清理 `createTaskOp` 死参数 triage。⑩ 客户端抽屉编辑态在服务端字段真正变化时自动同步（外部修改不丢、5s 轮询不打断输入）。生效方式：改 Host 需重启 DSH，改 Client 刷新页面。

- 2026-08-15：**UI 细节微调 + 子Agent模型选择修复**——① 工具栏文案：「＋ 看板」→「新建看板」、「显示归档」→「显示已归档列」、刷新按钮「↻」→「刷新」文字（空状态提示文案同步）；② 结算 toast 重做：深色半透明底 + 1px 浅绿细边框（失败款浅红边框），文字改浅色，去掉左侧 3px 色条；③ 修复「子Agent模型」下拉取不到模型：`inject` 补声明 `llm` 服务，`listModels` 按 provider 的 id（而非显示名）查询模型列表（llm 服务以 id 为路由键）。生效方式：改 Host 需重启 DSH，改 Client 刷新页面。

- 2026-08-15：**移除「看板运行中 N」常驻胶囊**——浮层只保留结算 toast（完成/阻塞 6s 自动消失），运行计数状态与 `.kbn-capsule` 样式一并删除。生效方式：改 Client，刷新页面。

- 2026-08-15：**列收放状态记忆**——用户手动收放过的列写入 localStorage（按看板 slug 分键），切页/刷新后保持用户选择；未点过的列维持默认行为（有卡自动展开、空列自动收缩）。生效方式：改 Client，刷新页面。

- 2026-08-15：**列内新建任务按钮卡片化**——列头「＋」按钮移到卡片区底部，改为虚线边框的卡片形按钮「＋ 新建任务」（悬停高亮），功能不变（以该列为初始列打开新建任务对话框）。生效方式：改 Client，刷新页面。

- 2026-08-15：**空列提示与虚线卡片微调**——移除空列的「拖入任务到这里」提示（空列只留虚线新建卡片；筛选词非空且无结果时显示「无匹配任务」，无论列本身是否有任务）；虚线卡片左边框由 3px 改回 1px 统一细虚线。生效方式：改 Client，刷新页面。

- 2026-08-15：**详情抽屉状态改为只读**——「状态」字段不再显示全部状态的可点击切换按钮组，改为只读展示当前状态（彩色圆点 + 状态名）；状态变更仍可经看板拖拽或 Agent 工具完成。生效方式：改 Client，刷新页面。
