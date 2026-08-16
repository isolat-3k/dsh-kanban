// DSH Kanban 看板插件 — Host 半（静态包 dsh-kanban，ES 模块）
// 运行环境：DSH 静态插件（真实 Node ESM），由 web profile 补丁层 cordis.patch.yml 以 insert 行 `name: dsh-kanban` 挂载到宿主平面
// 持久化：<workspaceRoot>/DSH-kanban/kanban-store.json（经 sandboxPolicy.workspaceRoot 解析）
// Client RPC：webServer 路由 POST /kanban/rpc（替代动态插件的 harness.handle/host.call）
// 硬依赖：声明后本插件会等到这些服务全部就绪才 apply（并在服务后到齐时自动重载）。
// 若只靠 apply 内 ctx.get()，启动早期服务提供方 fiber 尚未激活时 ctx.get 会返回
// undefined（strict 检查 fiber.state===2），导致 webServer 路由被静默跳过、页面永远「加载中」。
import { KANBAN_SKILLS } from './skill.js'

export const inject = ['fs', 'timer', 'llm', 'webServer', 'tools', 'subagents', 'agents', 'sandboxPolicy', 'skills']

export function apply(ctx) {
  const sandboxPolicy = ctx.get('sandboxPolicy')
  const subagents = ctx.get('subagents')
  const agents = ctx.get('agents')

  const STATUSES = ['triage', 'todo', 'scheduled', 'ready', 'running', 'blocked', 'review', 'done', 'archived']

  // —— i18n：界面与模型文案双语（zh/en）——
  // 语言解析优先级：平台设置 locale.preference（设置页 Language 行，prefLang）→ 浏览器语言（客户端 RPC 上报，clientLang）→ zh。
  // 文案模板用 {a}/{b} 占位，经 fmt() 插值；工具描述/skill 内容在语言切换时热重注册。
  const MSG = {
    zh: {
      'status.triage': '待细化', 'status.todo': '待办', 'status.scheduled': '定时', 'status.ready': '就绪',
      'status.running': '运行中', 'status.blocked': '阻塞', 'status.review': '审核', 'status.done': '完成', 'status.archived': '归档',
      'err.scheduleInvalid': '定时设置无效',
      'err.scheduleKind': '定时方式只支持 interval（间隔重复）或 daily（每天固定时刻）',
      'err.intervalRange': '间隔需为 1-{a} 分钟（最长 7 天）',
      'err.dailyFormat': '每天时刻需为 HH:MM 格式',
      'err.dailyRange': '每天时刻无效（00:00-23:59）',
      'err.parentSelf': '父卡片不能是自己',
      'err.parentMissing': '父卡片不存在（需在同一看板内）',
      'err.parentCycle': '父卡片链存在循环依赖：不能把祖先任务设为自己的父卡片',
      'err.boardSlugInvalid': '看板 slug 无效',
      'err.boardExists': '同名看板已存在',
      'err.boardNotFound': '看板不存在',
      'err.boardNotFoundSlug': '看板不存在: {a}',
      'err.taskNotFound': '任务不存在',
      'err.taskNotFoundInBoard': '任务不存在: {a}（看板 {b}）',
      'err.taskNotFoundAny': '任务不存在: {a}（已搜索全部看板；可用 board 指定看板）',
      'err.taskIdRequired': '任务 id 不能为空',
      'err.titleEmpty': '标题不能为空',
      'err.runningOnlyByDispatch': 'running 列只能通过派发进入',
      'err.unknownStatus': '未知状态: {a}',
      'err.commentEmpty': '评论不能为空',
      'err.dispatchNotReady': '只有 ready 状态的任务可以派发',
      'err.alreadyRunning': '任务已在运行中',
      'err.noSubagents': '当前 DSH 没有挂载 subagents 服务',
      'err.noLiveAgent': '没有存活的代理会话可用于派发（请先在对话中开启一个会话）',
      'err.noProvider': '没有可用的 subagent provider',
      'err.modelUnknown': '模型「{a}」在 provider「{b}」中不存在：请填写有效的模型名，或留空使用默认模型',
      'err.taskNotRunning': '任务未在运行',
      'err.taskNotRunningStatus': '任务未在运行（当前状态：{a}）',
      'err.boardNameEmpty': '看板名称不能为空',
      'err.patchEmpty': 'patch 至少需要 title/body/status/priority/assignee/schedule 中的一项',
      'err.taskRunningStopFirst': '任务正在运行：请先用 kanban_stop_task 停止，再改状态',
      'err.unknownMethod': '未知方法: {a}',
      'err.noBoards': '还没有任何看板：可用 kanban_create_board 创建，或在页面创建看板',
      'err.workerLost': 'worker lost：插件重启后运行状态丢失',
      'err.heartbeatLost': '心跳丢失：子代理超过 {a} 分钟无活动',
      'err.pluginStopped': '看板插件已停止',
      'sched.interval': '每{a} 分钟重复',
      'sched.daily': '每天 {a}',
      'sched.parent': '等待父卡片 {a} 完成后激活',
      'sched.join': '，',
      'sched.parked': '仅停放',
      'prompt.head': '你被派发执行一个看板任务（DeepSeek Harness kanban dispatch）。',
      'prompt.title': '【任务标题】',
      'prompt.body': '【任务描述】',
      'prompt.extra': '【补充要求】',
      'prompt.progress': '【进度汇报】',
      'prompt.progressBody': '看板会通过工作区文件 DSH-kanban/runs/{a}.progress 实时展示你的执行进度。每完成一个重要步骤（例如完成一次检查、写完一个文件、完成一次验证），请向该文件追加一行简短的中文进度说明。只追加、不覆盖、不删除该文件，也不要写入时间戳（看板会自动记录时间）。若某个步骤需要长时间执行，请在该步骤开始与结束时各追加一行。',
      'prompt.comments': '【追加评论】',
      'prompt.lastRun': '【上次运行】',
      'prompt.resultDone': '结果：完成',
      'prompt.resultError': '结果：失败',
      'prompt.resultTerminated': '结果：已终止',
      'prompt.result': '结果：',
      'prompt.summary': '摘要：',
      'prompt.error': '错误：',
      'prompt.collab': '【看板协作】',
      'prompt.collabBody': '若你的会话中提供看板工具（kanban_add_comment 等），可以用它们向本任务追加评论（供看板界面的人阅读），但不要用任何工具修改本任务的状态或字段：任务状态由看板的结算逻辑自动管理。',
      'prompt.done': '【完成要求】',
      'prompt.doneBody': '请在当前工作区中完成该任务。完成后，用一段简短的总结说明你做了什么、结果如何、以及遗留事项（如有）。这段总结将作为任务的完成摘要写回看板。',
      'out.boardsHead': '看板列表（{a} 个）：',
      'out.boardsRow': '- {a}（slug={b}）：待办 {c} / 定时 {d} / 就绪 {e} / 运行中 {f} / 阻塞 {g} / 完成 {h}，共 {i} 张卡',
      'out.boardEmpty': '看板 {a}（{b}）：当前无符合条件的任务。',
      'out.tasksHead': '看板 {a}（{b}）任务：共 {c} 张，仅列前 {d} 张（可用 query/limit 调整）：',
      'out.tasksHeadAll': '看板 {a}（{b}）任务：共 {c} 张：',
      'out.taskId': 'id={a}', 'out.taskStatus': '状态={a}', 'out.taskPriority': '优先级={a}',
      'out.taskAssignee': '负责人={a}', 'out.taskSchedule': '定时={a}', 'out.taskRunning': '运行中',
      'out.join': '，',
      'out.taskHead': '看板任务 {a}（看板：{b}）',
      'out.taskTitle': '标题：', 'out.taskStatusLabel': '状态：', 'out.taskPriorityLabel': '优先级：',
      'out.taskAssigneeLabel': '负责人：', 'out.taskScheduleLabel': '定时：', 'out.taskBody': '正文：',
      'out.commentsHead': '最近评论（{a} 条）：', 'out.none': '（无）', 'out.mainAgent': '主Agent',
      'out.eventsHead': '最近事件（{a} 条）：', 'out.lastRun': '最近运行：',
      'out.runOutcomeRunning': '运行中', 'out.runOutcomePending': '（未结算）',
      'out.runStarted': '开始：{a}；结束：{b}', 'out.runNotEnded': '（未结束）',
      'out.runProgress': '进度（最后 {a} 行）：', 'out.noRun': '最近运行：无（尚未派发过）',
      'out.defaultModel': '默认模型（跟随会话）', 'out.noSchedule': '无',
      'out.createdTask': '已创建看板任务：{a}（id={b}，看板={c}，初始列={d}{e}）',
      'out.createdTaskSched': '，定时={a}',
      'out.updatedTask': '已更新任务：{a}（id={b}，状态={c}）',
      'out.commented': '已评论任务：{a}（id={b}）',
      'out.dispatched': '已派发看板任务：{a}（id={b}，状态=running{c}）。运行期间可用 kanban_get_task 查询进度与结果。',
      'out.dispatchedRunId': '，runId={a}',
      'out.stopped': '已停止任务：{a}（id={b}，已移回就绪）',
      'out.deleted': '已删除任务：{a}（id={b}）',
      'out.createdBoard': '已创建看板：{a}（slug={b}）',
      'out.untitled': '（无标题）', 'out.unnamed': '（无名称）',
      'pc.listBoards': '看板：列出所有看板', 'pc.listBoardsResult': '看板：看板列表',
      'pc.listTasks': '看板：列出任务', 'pc.listTasksResult': '看板：任务列表',
      'pc.getTask': '看板：查看任务详情', 'pc.getTaskResult': '看板：任务详情',
      'pc.createTask': '看板：创建任务「{a}」', 'pc.createTaskResult': '看板：已创建任务',
      'pc.updateTask': '看板：更新任务', 'pc.updateTaskResult': '看板：已更新任务',
      'pc.comment': '看板：评论任务', 'pc.commentResult': '看板：已追加评论',
      'pc.dispatch': '看板：派发任务（id={a}）', 'pc.dispatchResult': '看板：已派发任务',
      'pc.stop': '看板：停止任务（id={a}）', 'pc.stopResult': '看板：已停止任务',
      'pc.delete': '看板：删除任务（id={a}）', 'pc.deleteResult': '看板：已删除任务',
      'pc.createBoard': '看板：创建看板「{a}」', 'pc.createBoardResult': '看板：已创建看板',
      'tool.listBoards': '列出 DSH 看板中的全部看板及其负载：slug、名称、各列任务数与运行中任务数。用于选择看板或了解全局状态。',
      'tool.listTasks': '列出看板任务（紧凑视图，先看板再动手）。可选过滤：status（triage/todo/scheduled/ready/running/blocked/review/done/archived）、priority_min（仅返回优先级 >= 该值）、assignee（负责人/子Agent模型名）、query（标题/正文/ID 关键词）、limit（默认 50，上限 200）。按优先级降序、同优先级新卡在前。board 省略时使用第一个看板。',
      'tool.getTask': '查看单个看板任务的完整信息：标题/正文/状态/优先级/负责人/定时设置/最近评论(最多20条)/最近事件(最多20条)/最近一次运行（结果、摘要、错误、进度最后50行）。board 省略时在所有看板中查找任务 id。',
      'tool.createTask': '在 DSH 看板中创建一张任务卡片——把工作拆进看板的入口，人会在界面「看板」标签页看到。board 省略时使用第一个看板；status 可选 triage/todo/scheduled/ready/blocked/review/done/archived（默认 todo，委派前需为 ready）；priority 为 0-9 整数，越大越优先（默认 0）；assignee 为子Agent模型名，留空表示跟随会话默认模型；schedule 为定时设置（仅 status=scheduled 时生效）：kind=interval 每 N 分钟间隔重复（需 intervalMinutes）、kind=daily 每天固定时刻（需 dailyTime，HH:MM）、可选 parentId 等待同看板父卡片完成/归档后激活。',
      'tool.updateTask': '更新看板任务：改标题/正文/优先级/负责人(子Agent模型名)/定时设置(schedule)，或移动状态列(status)。status 移动遵循看板规则（拖离定时列会清除定时；移入 done/archived 会激活等待本卡完成的子任务）。running 任务不能直接改状态：先 kanban_stop_task 停回就绪再移动。board 省略时在所有看板中查找任务 id。patch 至少含一个字段。',
      'tool.comment': '给看板任务追加一条评论（面向人：写在卡片上的备注/进展/遗留事项）。评论显示在看板任务详情里，并随下次派发带入子代理上下文。board 省略时在所有看板中查找任务 id。',
      'tool.dispatch': '将 DSH 看板中「就绪」(ready) 列的任务派发给子代理执行。任务必须处于 ready 列；运行完成后自动转「完成」并回写摘要，失败或心跳超时转「阻塞」。运行期间可用 kanban_get_task 查询进度与结果；可用 kanban_stop_task 停止。可选 instructions 追加本轮补充要求（随任务正文发给子代理）。board 省略时使用第一个看板。',
      'tool.stop': '终止正在运行(running)的看板任务：停止其子代理并把任务移回「就绪」列，之后可修改或重新派发。board 省略时在所有看板中查找任务 id。',
      'tool.delete': '删除看板任务（不可恢复）。若任务正在运行会先终止其子代理；等待该任务的子卡片会被激活。board 省略时在所有看板中查找任务 id。',
      'tool.createBoard': '新建一个看板。name 为显示名；slug 可选（省略时由名称自动生成），供工具与 RPC 定位看板。',
      'param.board': '看板 slug（可选，省略时使用第一个看板）。',
      'param.boardSearch': '看板 slug（可选，省略时在所有看板中查找任务 id）。',
      'param.taskId': '任务 id（必填）。',
      'param.status': '仅列该状态的任务（可选）。',
      'param.priorityMin': '仅列优先级 >= 该值的任务（可选，0-9）。',
      'param.assignee': '仅列该负责人（子Agent模型名）的任务（可选）。',
      'param.query': '标题/正文/ID 关键词（可选，不区分大小写）。',
      'param.limit': '最多返回条数（默认 50，上限 200）。',
      'param.title': '任务标题（必填）。',
      'param.body': '任务描述/正文（可选）。',
      'param.statusInit': '初始列，默认 todo。',
      'param.priority': '优先级 0-9，越大越优先，默认 0。',
      'param.assigneeOptional': '子Agent模型名（可选，留空跟随会话默认模型）。',
      'param.schedule': '定时设置（可选，仅 status=scheduled 时生效）。kind 必填；parentId 可选。',
      'param.scheduleKind': '定时方式：interval=间隔重复 / daily=每天固定时刻。',
      'param.intervalMinutes': 'kind=interval 时：间隔分钟（1-10080，最长 7 天）。',
      'param.dailyTime': 'kind=daily 时：每天时刻 HH:MM（如 09:00）。',
      'param.parentId': '可选：同看板父卡片 id，父卡片完成/归档时激活。',
      'param.patch': '要修改的字段（至少一项）。',
      'param.patchTitle': '新标题（非空）。',
      'param.patchBody': '新正文（空字符串清空）。',
      'param.patchStatus': '目标列。',
      'param.patchPriority': '优先级 0-9。',
      'param.patchAssignee': '子Agent模型名；空字符串清除。',
      'param.patchSchedule': '定时设置（同 kanban_create_task 的 schedule；传 null 清除）。',
      'param.commentBody': '评论内容（必填）。',
      'param.instructions': '可选：追加给子代理的本轮补充要求（如验收重点、环境说明）。',
      'param.boardName': '看板名称（必填）。',
      'param.boardSlug': '看板 slug（可选，小写字母/数字/连字符）。',
    },
    en: {
      'status.triage': 'Triage', 'status.todo': 'Todo', 'status.scheduled': 'Scheduled', 'status.ready': 'Ready',
      'status.running': 'Running', 'status.blocked': 'Blocked', 'status.review': 'Review', 'status.done': 'Done', 'status.archived': 'Archived',
      'err.scheduleInvalid': 'Invalid schedule settings',
      'err.scheduleKind': 'Schedule kind must be interval (repeating) or daily (fixed time)',
      'err.intervalRange': 'Interval must be 1-{a} minutes (max 7 days)',
      'err.dailyFormat': 'Daily time must be HH:MM format',
      'err.dailyRange': 'Daily time out of range (00:00-23:59)',
      'err.parentSelf': 'A task cannot be its own parent',
      'err.parentMissing': 'Parent card does not exist (must be in the same board)',
      'err.parentCycle': 'Circular dependency in the parent chain: an ancestor cannot be this task\'s parent',
      'err.boardSlugInvalid': 'Invalid board slug',
      'err.boardExists': 'A board with this slug already exists',
      'err.boardNotFound': 'Board not found',
      'err.boardNotFoundSlug': 'Board not found: {a}',
      'err.taskNotFound': 'Task not found',
      'err.taskNotFoundInBoard': 'Task not found: {a} (board {b})',
      'err.taskNotFoundAny': 'Task not found: {a} (searched every board; pass board to target one)',
      'err.taskIdRequired': 'Task id is required',
      'err.titleEmpty': 'Title cannot be empty',
      'err.runningOnlyByDispatch': 'Tasks enter the running column only via dispatch',
      'err.unknownStatus': 'Unknown status: {a}',
      'err.commentEmpty': 'Comment cannot be empty',
      'err.dispatchNotReady': 'Only tasks in the ready column can be dispatched',
      'err.alreadyRunning': 'Task is already running',
      'err.noSubagents': 'No subagents service mounted in this DSH',
      'err.noLiveAgent': 'No live agent session available for dispatch (open a conversation first)',
      'err.noProvider': 'No subagent provider available',
      'err.modelUnknown': 'Model "{a}" does not exist in provider "{b}": enter a valid model name, or leave it empty to use the default model',
      'err.taskNotRunning': 'Task is not running',
      'err.taskNotRunningStatus': 'Task is not running (current status: {a})',
      'err.boardNameEmpty': 'Board name cannot be empty',
      'err.patchEmpty': 'patch needs at least one of title/body/status/priority/assignee/schedule',
      'err.taskRunningStopFirst': 'Task is running: stop it with kanban_stop_task before changing its status',
      'err.unknownMethod': 'Unknown method: {a}',
      'err.noBoards': 'No boards yet: create one with kanban_create_board or from the page',
      'err.workerLost': 'worker lost: run state was lost after plugin restart',
      'err.heartbeatLost': 'Heartbeat lost: subagent idle for over {a} minutes',
      'err.pluginStopped': 'kanban plugin stopped',
      'sched.interval': 'every {a} min',
      'sched.daily': 'daily at {a}',
      'sched.parent': 'activates after parent {a} completes',
      'sched.join': ', ',
      'sched.parked': 'parked only',
      'prompt.head': 'You have been dispatched to execute a kanban task (DeepSeek Harness kanban dispatch).',
      'prompt.title': '[Task title]',
      'prompt.body': '[Task description]',
      'prompt.extra': '[Additional instructions]',
      'prompt.progress': '[Progress reporting]',
      'prompt.progressBody': 'The board shows your live progress through the workspace file DSH-kanban/runs/{a}.progress. After each important step (e.g. finishing a check, writing a file, completing a verification), append one short line describing that step to the file. Append only — never overwrite or delete the file, and do not write timestamps (the board records time automatically). If a step takes a long time, append one line when it starts and one when it ends.',
      'prompt.comments': '[Existing comments]',
      'prompt.lastRun': '[Previous run]',
      'prompt.resultDone': 'Result: completed',
      'prompt.resultError': 'Result: failed',
      'prompt.resultTerminated': 'Result: terminated',
      'prompt.result': 'Result: ',
      'prompt.summary': 'Summary: ',
      'prompt.error': 'Error: ',
      'prompt.collab': '[Board collaboration]',
      'prompt.collabBody': 'If kanban tools (kanban_add_comment etc.) are available in your session, you may use them to append comments to this task (for people reading the board UI), but do not use any tool to modify this task\'s status or fields: task status is managed automatically by the board\'s settlement logic.',
      'prompt.done': '[Completion requirements]',
      'prompt.doneBody': 'Complete the task in the current workspace. When done, write a short summary of what you did, the outcome, and any follow-ups. This summary will be recorded as the task\'s completion summary on the board.',
      'out.boardsHead': 'Boards ({a}):',
      'out.boardsRow': '- {a} (slug={b}): todo {c} / scheduled {d} / ready {e} / running {f} / blocked {g} / done {h}, {i} cards total',
      'out.boardEmpty': 'Board {a} ({b}): no matching tasks.',
      'out.tasksHead': 'Board {a} ({b}) tasks: {c} total, showing first {d} (adjust with query/limit):',
      'out.tasksHeadAll': 'Board {a} ({b}) tasks: {c} total:',
      'out.taskId': 'id={a}', 'out.taskStatus': 'status={a}', 'out.taskPriority': 'priority={a}',
      'out.taskAssignee': 'assignee={a}', 'out.taskSchedule': 'schedule={a}', 'out.taskRunning': 'running',
      'out.join': ', ',
      'out.taskHead': 'Kanban task {a} (board: {b})',
      'out.taskTitle': 'Title: ', 'out.taskStatusLabel': 'Status: ', 'out.taskPriorityLabel': 'Priority: ',
      'out.taskAssigneeLabel': 'Assignee: ', 'out.taskScheduleLabel': 'Schedule: ', 'out.taskBody': 'Body: ',
      'out.commentsHead': 'Recent comments ({a}):', 'out.none': '(none)', 'out.mainAgent': 'Main Agent',
      'out.eventsHead': 'Recent events ({a}):', 'out.lastRun': 'Last run:',
      'out.runOutcomeRunning': 'running', 'out.runOutcomePending': '(not settled)',
      'out.runStarted': 'Started: {a}; ended: {b}', 'out.runNotEnded': '(not ended)',
      'out.runProgress': 'Progress (last {a} lines):', 'out.noRun': 'Last run: none (never dispatched)',
      'out.defaultModel': 'default model (follows session)', 'out.noSchedule': 'none',
      'out.createdTask': 'Created kanban task: {a} (id={b}, board={c}, initial column={d}{e})',
      'out.createdTaskSched': ', schedule={a}',
      'out.updatedTask': 'Updated task: {a} (id={b}, status={c})',
      'out.commented': 'Commented on task: {a} (id={b})',
      'out.dispatched': 'Dispatched kanban task: {a} (id={b}, status=running{c}). Use kanban_get_task to check progress and results while it runs.',
      'out.dispatchedRunId': ', runId={a}',
      'out.stopped': 'Stopped task: {a} (id={b}, moved back to ready)',
      'out.deleted': 'Deleted task: {a} (id={b})',
      'out.createdBoard': 'Created board: {a} (slug={b})',
      'out.untitled': '(untitled)', 'out.unnamed': '(unnamed)',
      'pc.listBoards': 'Kanban: list all boards', 'pc.listBoardsResult': 'Kanban: board list',
      'pc.listTasks': 'Kanban: list tasks', 'pc.listTasksResult': 'Kanban: task list',
      'pc.getTask': 'Kanban: task details', 'pc.getTaskResult': 'Kanban: task details',
      'pc.createTask': 'Kanban: create task "{a}"', 'pc.createTaskResult': 'Kanban: task created',
      'pc.updateTask': 'Kanban: update task', 'pc.updateTaskResult': 'Kanban: task updated',
      'pc.comment': 'Kanban: comment on task', 'pc.commentResult': 'Kanban: comment added',
      'pc.dispatch': 'Kanban: dispatch task (id={a})', 'pc.dispatchResult': 'Kanban: task dispatched',
      'pc.stop': 'Kanban: stop task (id={a})', 'pc.stopResult': 'Kanban: task stopped',
      'pc.delete': 'Kanban: delete task (id={a})', 'pc.deleteResult': 'Kanban: task deleted',
      'pc.createBoard': 'Kanban: create board "{a}"', 'pc.createBoardResult': 'Kanban: board created',
      'tool.listBoards': 'List every board in the DSH kanban and its load: slug, name, per-column task counts, and running-task count. Use it to pick a board or survey the overall state.',
      'tool.listTasks': 'List board tasks (compact view; look at boards first, then act). Optional filters: status (triage/todo/scheduled/ready/running/blocked/review/done/archived), priority_min (only tasks with priority >= the value), assignee (subagent model name), query (title/body/ID keyword), limit (default 50, max 200). Sorted by priority descending, then newest first within a priority. Uses the first board when board is omitted.',
      'tool.getTask': 'Read one kanban task\'s full details: title/body/status/priority/assignee/schedule settings/recent comments (max 20)/recent events (max 20)/the latest run (result, summary, error, last 50 progress lines). Searches every board for the task id when board is omitted.',
      'tool.createTask': 'Create a task card in the DSH kanban — the entry point for splitting work onto the board; people see it in the UI\'s Kanban tab. Uses the first board when board is omitted; status may be triage/todo/scheduled/ready/blocked/review/done/archived (default todo; must be ready before dispatch); priority is a 0-9 integer, higher first (default 0); assignee is the subagent model name, leave empty to follow the session default model; schedule takes effect only when status=scheduled: kind=interval repeats every N minutes (needs intervalMinutes), kind=daily fires at a fixed time each day (needs dailyTime, HH:MM), optional parentId activates after the parent card in the same board completes or is archived.',
      'tool.updateTask': 'Update a kanban task: change title/body/priority/assignee (subagent model name)/schedule settings, or move the status column. Status moves follow board rules (leaving the scheduled column clears the schedule; moving into done/archived activates children waiting for this card). A running task cannot change status directly: first kanban_stop_task back to ready, then move it. Searches every board for the task id when board is omitted. patch needs at least one field.',
      'tool.comment': 'Append a comment to a kanban task (meant for humans: notes/progress/follow-ups written on the card). Comments show in the kanban task details and are carried into the subagent context on the next dispatch. Searches every board for the task id when board is omitted.',
      'tool.dispatch': 'Dispatch a task from the ready column of the DSH kanban to a subagent for execution. The task must be in the ready column; when the run finishes it turns done automatically and the summary is written back, while failure or heartbeat timeout turns it blocked. Use kanban_get_task to check progress and results while it runs; use kanban_stop_task to stop it. Optional instructions add requirements for this round (sent to the subagent with the task body). Uses the first board when board is omitted.',
      'tool.stop': 'Terminate a running kanban task: stops its subagent and moves the task back to the ready column, after which it can be edited or dispatched again. Searches every board for the task id when board is omitted.',
      'tool.delete': 'Delete a kanban task (irrecoverable). If the task is running, its subagent is terminated first; child cards waiting for this task are activated. Searches every board for the task id when board is omitted.',
      'tool.createBoard': 'Create a board. name is the display name; slug is optional (derived from the name when omitted) and is what tools and RPC use to locate the board.',
      'param.board': 'Board slug (optional; the first board is used when omitted).',
      'param.boardSearch': 'Board slug (optional; the task id is searched across all boards when omitted).',
      'param.taskId': 'Task id (required).',
      'param.status': 'Only list tasks in this status (optional).',
      'param.priorityMin': 'Only list tasks with priority >= this value (optional, 0-9).',
      'param.assignee': 'Only list tasks with this assignee (subagent model name, optional).',
      'param.query': 'Title/body/ID keyword (optional, case-insensitive).',
      'param.limit': 'Max entries to return (default 50, max 200).',
      'param.title': 'Task title (required).',
      'param.body': 'Task description/body (optional).',
      'param.statusInit': 'Initial column, default todo.',
      'param.priority': 'Priority 0-9, higher first, default 0.',
      'param.assigneeOptional': 'Subagent model name (optional; empty follows the session default model).',
      'param.schedule': 'Schedule settings (optional; takes effect only when status=scheduled). kind is required; parentId optional.',
      'param.scheduleKind': 'Schedule kind: interval=repeats every N minutes / daily=fixed time each day.',
      'param.intervalMinutes': 'For kind=interval: interval minutes (1-10080, max 7 days).',
      'param.dailyTime': 'For kind=daily: daily time HH:MM (e.g. 09:00).',
      'param.parentId': 'Optional: parent card id in the same board; activates when the parent completes or is archived.',
      'param.patch': 'Fields to modify (at least one).',
      'param.patchTitle': 'New title (non-empty).',
      'param.patchBody': 'New body (empty string clears it).',
      'param.patchStatus': 'Target column.',
      'param.patchPriority': 'Priority 0-9.',
      'param.patchAssignee': 'Subagent model name; empty string clears it.',
      'param.patchSchedule': 'Schedule settings (same as kanban_create_task schedule; pass null to clear).',
      'param.commentBody': 'Comment content (required).',
      'param.instructions': 'Optional: extra requirements for this round (e.g. acceptance focus, environment notes).',
      'param.boardName': 'Board name (required).',
      'param.boardSlug': 'Board slug (optional; lowercase letters/digits/hyphens).',
    },
  }
  const isLang = (l) => l === 'zh' || l === 'en'
  let prefLang = null    // 平台设置 locale.preference（用户在设置页切换）
  let clientLang = null  // 客户端最近一次 RPC 上报的界面语言
  let currentLang = 'zh'
  const fmt = (s, params) => {
    if (!params) return s
    return String(s).replace(/\{([a-z])\}/g, (m, k) => (params[k] === undefined ? m : String(params[k])))
  }
  function t(key, params) {
    const dict = MSG[currentLang] || MSG.zh
    const zh = MSG.zh
    const raw = (dict && dict[key] !== undefined) ? dict[key] : (zh[key] !== undefined ? zh[key] : key)
    return fmt(raw, params)
  }
  const statusLabel = (id) => t('status.' + id)
  function pickLang() {
    return isLang(prefLang) ? prefLang : (isLang(clientLang) ? clientLang : 'zh')
  }

  // 事件循环与心跳常量
  const LOOP_TICK_MS = 10000                       // 循环步长
  // 无任何活动信号超过该时长 → 判定心跳丢失；默认 30 分钟，可用环境变量 DSH_KANBAN_HEARTBEAT_MS 覆盖（毫秒）
  const HEARTBEAT_TIMEOUT_MS = (() => {
    const n = Number(process.env.DSH_KANBAN_HEARTBEAT_MS)
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 30 * 60 * 1000
  })()
  const PROGRESS_DIR = 'DSH-kanban/runs'           // 子代理进度文件目录（工作区相对路径）
  const PROGRESS_CAP = 50                          // 看板保留的最近进度行数

  const workspaceRoot = (sandboxPolicy && typeof sandboxPolicy.workspaceRoot === 'string')
    ? sandboxPolicy.workspaceRoot
    : 'D:/WorkSpace'
  const resolvePolicy = () => (sandboxPolicy && typeof sandboxPolicy.resolve === 'function' ? sandboxPolicy.resolve() : undefined)

  let store = null
  let loadPromise = null
  let mutationChain = Promise.resolve()
  let writePending = false
  let eventSeq = 0
  const runs = new Map()
  const timers = new Map() // 每任务一个 ctx.timeout：key = slug::id，只给「定时列 + 有 kind + nextAt」的任务武装
  let lastActiveRootId = null // 最近有会话活动的根代理 id（UI 派发无 initiator 时优先挂靠）

  const KEY = (slug, id) => slug + '::' + id
  const now = () => Date.now()
  const cap = (s, n) => (typeof s === 'string' && s.length > n ? s.slice(0, n) : s)
  const clampInt = (v, min, max) => {
    const n = Number(v)
    if (!Number.isFinite(n)) return 0
    return Math.min(max, Math.max(min, Math.round(n)))
  }
  const makeId = (prefix) => prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  const fmtTime = (ts) => {
    if (!ts) return ''
    const d = new Date(ts)
    const p = (n) => String(n).padStart(2, '0')
    return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
  }
  const normSlug = (s) => {
    const v = String(s || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)
    return /^[a-z0-9]/.test(v) ? v : ''
  }
  const slugify = (name) => normSlug(name) || ('board-' + Math.random().toString(36).slice(2, 8))

  // —— 定时模型（取代旧 scheduled_at）：interval 间隔重复 / daily 每天固定时刻 / 父卡片事件激活 ——
  // schedule: null | { kind: 'interval'|'daily'|null, intervalMinutes, dailyMinutes, parentId, nextAt }
  // 激活条件（全部满足才激活）：父卡片（若有）已 done/archived；kind（若有）的 nextAt 已到。
  // 无 kind 且无 parentId 视为纯停放（永不自动激活）。
  const MINUTE_MS = 60 * 1000
  const DAY_MS = 24 * 60 * MINUTE_MS
  const MAX_INTERVAL_MINUTES = 7 * 24 * 60 // 7 天（setTimeout 上限内）

  function nextAtFor(schedule, baseMs) {
    // 下一次激活时间：严格晚于 now；间隔重复按锚点整倍数（错过则快进到未来最近一格），每天按当天时刻
    if (schedule.kind === 'interval') {
      const intervalMs = schedule.intervalMinutes * MINUTE_MS
      const base = typeof baseMs === 'number' ? baseMs : now()
      const n = Math.max(1, Math.floor((now() - base) / intervalMs) + 1)
      return base + n * intervalMs
    }
    if (schedule.kind === 'daily') {
      const base = typeof baseMs === 'number' ? baseMs : now()
      const d = new Date(base)
      let target = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, schedule.dailyMinutes, 0, 0).getTime()
      if (target <= base) target += DAY_MS
      if (target <= now()) target += DAY_MS
      return target
    }
    return null
  }

  // 统一排期入口：interval 以锚点 base 起算（编辑/回排不漂移），daily 以当前时刻起算
  function scheduleNextAt(schedule) {
    if (schedule.kind === 'interval') return nextAtFor(schedule, typeof schedule.base === 'number' ? schedule.base : now())
    if (schedule.kind === 'daily') return nextAtFor(schedule, now())
    return null
  }

  function normalizeSchedule(input, board, selfId, prev) {
    // input: { kind, intervalMinutes, dailyTime, parentId } | null
    if (input === null || input === undefined) return null
    if (typeof input !== 'object') throw new Error(t('err.scheduleInvalid'))
    const kind = input.kind === 'interval' || input.kind === 'daily' ? input.kind : null
    if (input.kind && !kind) throw new Error(t('err.scheduleKind'))
    let intervalMinutes = null
    let dailyMinutes = null
    if (kind === 'interval') {
      const n = Math.round(Number(input.intervalMinutes))
      if (!Number.isFinite(n) || n < 1 || n > MAX_INTERVAL_MINUTES) throw new Error(t('err.intervalRange', { a: MAX_INTERVAL_MINUTES }))
      intervalMinutes = n
    }
    if (kind === 'daily') {
      const v = String(input.dailyTime || '').trim()
      const m = /^(\d{1,2}):(\d{2})$/.exec(v)
      if (!m) throw new Error(t('err.dailyFormat'))
      const hh = Number(m[1])
      const mm = Number(m[2])
      if (hh > 23 || mm > 59) throw new Error(t('err.dailyRange'))
      dailyMinutes = hh * 60 + mm
    }
    let parentId = null
    if (input.parentId !== null && input.parentId !== undefined && String(input.parentId).trim()) {
      parentId = String(input.parentId).trim().slice(0, 64)
      if (parentId === selfId) throw new Error(t('err.parentSelf'))
      if (board && !findTask(board, parentId)) throw new Error(t('err.parentMissing'))
      if (board && selfId) {
        // 环检测：沿现有父链向上查找，若包含 selfId 则构成循环依赖（A 等 B、B 等 A 死锁）
        const seen = new Set()
        let cur = parentId
        while (cur && !seen.has(cur)) {
          seen.add(cur)
          if (cur === selfId) throw new Error(t('err.parentCycle'))
          const p = findTask(board, cur)
          cur = (p && p.schedule && p.schedule.parentId) || null
        }
      }
    }
    if (!kind && !parentId) return null
    const schedule = { kind, intervalMinutes, dailyMinutes, parentId, nextAt: null }
    if (kind === 'interval') {
      // 间隔锚点：编辑时保留原锚点（维持整倍数网格），新建时以当前时刻为锚
      schedule.base = (prev && prev.kind === 'interval' && typeof prev.base === 'number') ? prev.base : now()
    }
    if (kind) schedule.nextAt = scheduleNextAt(schedule)
    return schedule
  }

  function canActivate(board, task) {
    const s = task.schedule
    if (!s) return false
    if (!s.kind && !s.parentId) return false
    if (s.parentId) {
      const p = findTask(board, s.parentId)
      if (p && p.status !== 'done' && p.status !== 'archived') return false
    }
    if (s.kind === 'interval' || s.kind === 'daily') {
      if (typeof s.nextAt !== 'number' || s.nextAt > now()) return false
    }
    return true
  }

  function tryActivate(slug, task, preferBy) {
    if (!task || task.status !== 'scheduled') return
    const board = findBoard(slug)
    if (!board || !canActivate(board, task)) return
    const s = task.schedule
    const by = preferBy || ((s.kind === 'interval' || s.kind === 'daily') ? s.kind : 'parent')
    task.status = 'ready'
    task.updated_at = now()
    s.nextAt = null // 本轮已触发；重复任务的下一轮在 settle 完成后回排
    pushEvent(task, 'moved', { from: 'scheduled', to: 'ready', by })
  }

  function activateChildren(slug, parentTask) {
    const board = findBoard(slug)
    if (!board || !parentTask) return
    for (const t of board.tasks) {
      if (t.status === 'scheduled' && t.schedule && t.schedule.parentId === parentTask.id) {
        tryActivate(slug, t, 'parent')
      }
    }
  }

  function makeSignal() {
    const listeners = new Set()
    const signal = {
      aborted: false,
      reason: undefined,
      addEventListener(type, callback) {
        if (type !== 'abort' || typeof callback !== 'function') return
        if (signal.aborted) {
          try { callback() } catch (err) {}
          return
        }
        listeners.add(callback)
      },
      removeEventListener(type, callback) {
        if (type !== 'abort') return
        listeners.delete(callback)
      },
      dispatchEvent() { return true },
    }
    signal._abort = (reason) => {
      if (signal.aborted) return
      signal.aborted = true
      signal.reason = reason
      for (const callback of Array.from(listeners)) {
        listeners.delete(callback)
        try { callback() } catch (err) {}
      }
    }
    return signal
  }

  async function storeTarget() {
    return ctx.fs.resolve('DSH-kanban/kanban-store.json', { cwd: workspaceRoot })
  }
  function blankStore() { return { schemaVersion: 1, boards: [] } }
  function isAbsent(err) {
    const msg = String((err && err.message) || err)
    return /not found|ENOENT|no such|absent|does not exist/i.test(msg)
  }
  function findBoard(slug) {
    for (const b of store.boards) if (b.slug === slug) return b
    return undefined
  }
  function findTask(board, id) {
    if (!board || !Array.isArray(board.tasks)) return undefined
    for (const t of board.tasks) if (t.id === id) return t
    return undefined
  }
  function pushEvent(task, kind, payload) {
    if (!Array.isArray(task.events)) task.events = []
    task.events.push({ id: ++eventSeq, kind, payload: payload || {}, created_at: now() })
    if (task.events.length > 300) task.events = task.events.slice(task.events.length - 300)
  }
  function scheduleWrite() {
    if (writePending) return
    writePending = true
    ctx.timeout(() => {
      writePending = false
      if (store === null) return
      const snapshot = JSON.stringify(store)
      mutationChain = mutationChain.then(async () => {
        try {
          const target = await storeTarget()
          await ctx.fs.writeText(target, snapshot, undefined, undefined, resolvePolicy())
        } catch (err) {
          console.error('[kanban] persist failed:', String((err && err.message) || err))
        }
      }).catch(() => {})
    }, 250)
  }
  function mutate(fn) {
    const op = mutationChain.then(async () => {
      await load()
      const out = await fn()
      scheduleWrite()
      syncTimers()
      return out
    })
    mutationChain = op.catch(() => {})
    return op
  }

  // 定时器对账：为「定时列 + interval/daily + nextAt」的任务各武装一个 ctx.timeout；
  // 已过期的 nextAt 以 30s 为最小复查间隔（等父卡片时避免 0ms 热循环），未来时间精确延时。
  function syncTimers() {
    if (store === null) return
    const wanted = new Set()
    for (const board of store.boards) {
      for (const task of board.tasks) {
        if (task.status !== 'scheduled' || !task.schedule) continue
        const kind = task.schedule.kind
        if (kind !== 'interval' && kind !== 'daily') continue
        if (typeof task.schedule.nextAt !== 'number') continue
        const key = KEY(board.slug, task.id)
        wanted.add(key)
        if (timers.has(key)) continue
        const overdue = task.schedule.nextAt - now() <= 0
        const delay = overdue ? 30000 : task.schedule.nextAt - now()
        const slug = board.slug
        const id = task.id
        timers.set(key, ctx.timeout(() => {
          timers.delete(key)
          mutate(() => {
            const b = findBoard(slug)
            const t = b && findTask(b, id)
            if (t && t.status === 'scheduled') tryActivate(slug, t)
          }).catch(() => {})
        }, delay))
      }
    }
    for (const key of Array.from(timers.keys())) {
      if (!wanted.has(key)) {
        const dispose = timers.get(key)
        try { dispose() } catch (err) {}
        timers.delete(key)
      }
    }
  }

  async function load() {
    if (store !== null) return store
    if (loadPromise === null) {
      loadPromise = (async () => {
        const target = await storeTarget()
        try {
          const text = await ctx.fs.readText(target)
          const parsed = JSON.parse(text)
          if (parsed && typeof parsed === 'object' && Array.isArray(parsed.boards)) store = parsed
          else store = blankStore()
        } catch (err) {
          store = blankStore()
          if (!isAbsent(err)) console.error('[kanban] store load failed:', String((err && err.message) || err))
        }
        // Seed the event-id counter from existing data and heal duplicate ids
        // within one task's event list (they break React list keys).
        let maxId = 0
        let healed = false
        for (const board of store.boards) {
          if (!Array.isArray(board.tasks)) board.tasks = []
          for (const task of board.tasks) {
            if (!Array.isArray(task.events)) task.events = []
            const seen = new Set()
            for (const ev of task.events) {
              if (typeof ev.id !== 'number' || seen.has(ev.id)) {
                ev.id = ++maxId
                healed = true
              } else {
                seen.add(ev.id)
                if (ev.id > maxId) maxId = ev.id
              }
            }
          }
        }
        eventSeq = maxId
        let touched = healed
        for (const board of store.boards) {
          for (const task of board.tasks) {
            // 仅当没有活跃运行记录时才做 worker-lost 修复（reload 重读磁盘时运行中的派发仍存活）
            if (task.status === 'running' && !runs.has(KEY(board.slug, task.id))) {
              task.status = 'blocked'
              pushEvent(task, 'blocked', { reason: t('err.workerLost') })
              touched = true
            }
          }
        }
        // 向后兼容：补齐心跳字段的默认值
        for (const board of store.boards) {
          for (const task of board.tasks) {
            if (task.run) {
              if (typeof task.run.heartbeat_at !== 'number') task.run.heartbeat_at = typeof task.run.started_at === 'number' ? task.run.started_at : null
              if (!Array.isArray(task.run.progress)) task.run.progress = []
              if (typeof task.run.progressLineCount !== 'number') task.run.progressLineCount = 0
            }
          }
        }
        // 迁移：移除旧定时系统（scheduled_at 字段）；新 schedule 缺 nextAt 的重复任务按当前时间补排
        for (const board of store.boards) {
          for (const task of board.tasks) {
            if ('scheduled_at' in task) {
              delete task.scheduled_at
              touched = true
            }
            const sc = task.schedule
            if (sc && typeof sc === 'object') {
              if (sc.kind !== 'interval' && sc.kind !== 'daily') sc.kind = null
              if (sc.kind === 'interval' && (typeof sc.intervalMinutes !== 'number' || sc.intervalMinutes < 1 || sc.intervalMinutes > MAX_INTERVAL_MINUTES)) sc.kind = null
              if (sc.kind === 'daily' && typeof sc.dailyMinutes !== 'number') sc.kind = null
              if (typeof sc.parentId !== 'string' || !sc.parentId) sc.parentId = null
              if (sc.kind === 'interval' && typeof sc.base !== 'number') { sc.base = now(); touched = true }
              if (!sc.kind && !sc.parentId) { task.schedule = null; touched = true }
              else if (sc.kind && typeof sc.nextAt !== 'number') { sc.nextAt = scheduleNextAt(sc); touched = true }
            } else if ('schedule' in task && task.schedule !== null) {
              task.schedule = null
              touched = true
            }
          }
        }
        if (touched) scheduleWrite()
        return store
      })()
    }
    return loadPromise
  }

  function abortRun(slug, id) {
    const entry = runs.get(KEY(slug, id))
    if (entry) {
      try { entry.signal._abort('kanban terminate') } catch (err) {}
      try { entry.run.dispose() } catch (err) {}
      runs.delete(KEY(slug, id))
    }
  }

  function extractText(blocks) {
    if (!Array.isArray(blocks)) return null
    let out = ''
    for (const b of blocks) {
      if (b && b.type === 'text' && typeof b.text === 'string') out += b.text + '\n'
    }
    const trimmed = out.trim()
    return trimmed ? cap(trimmed, 4000) : null
  }

  // 进度文件：子代理按派发提示词约定向 <PROGRESS_DIR>/<taskId>.progress 追加进度行，
  // 事件循环读取其尾部新行作为实时进度与（远程 provider 的）心跳兜底信号。
  async function progressTarget(taskId) {
    return ctx.fs.resolve(PROGRESS_DIR + '/' + taskId + '.progress', { cwd: workspaceRoot })
  }
  async function readProgressTail(taskId) {
    try {
      const text = await ctx.fs.readText(await progressTarget(taskId))
      return String(text).split(/\r?\n/).slice(-500)
    } catch (err) {
      return []
    }
  }
  async function resetProgressFile(taskId) {
    try {
      await ctx.fs.writeText(await progressTarget(taskId), '', undefined, undefined, resolvePolicy())
    } catch (err) {}
  }

  function buildPrompt(task, extra) {
    const lines = []
    lines.push(t('prompt.head'))
    lines.push('')
    lines.push(t('prompt.title') + task.title)
    if (task.body) {
      lines.push('')
      lines.push(t('prompt.body'))
      lines.push(task.body)
    }
    if (extra) {
      lines.push('')
      lines.push(t('prompt.extra'))
      lines.push(extra)
    }
    lines.push('')
    lines.push(t('prompt.progress'))
    lines.push(t('prompt.progressBody', { a: task.id }))
    if (Array.isArray(task.comments) && task.comments.length > 0) {
      lines.push('')
      lines.push(t('prompt.comments'))
      for (const c of task.comments) {
        lines.push('- ' + (c.author || 'user') + ' ' + fmtTime(c.created_at) + '：' + c.body)
      }
    }
    if (task.run && task.run.outcome) {
      lines.push('')
      lines.push(t('prompt.lastRun'))
      if (task.run.outcome === 'done') lines.push(t('prompt.resultDone'))
      else if (task.run.outcome === 'error') lines.push(t('prompt.resultError'))
      else if (task.run.outcome === 'terminated') lines.push(t('prompt.resultTerminated'))
      else lines.push(t('prompt.result') + task.run.outcome)
      if (task.run.summary) lines.push(t('prompt.summary') + task.run.summary)
      if (task.run.error) lines.push(t('prompt.error') + task.run.error)
    }
    lines.push('')
    lines.push(t('prompt.collab'))
    lines.push(t('prompt.collabBody'))
    lines.push('')
    lines.push(t('prompt.done'))
    lines.push(t('prompt.doneBody'))
    return lines.join('\n')
  }

  async function settleRun(slug, id, seq, result) {
    try {
      await mutate(() => {
        const board = findBoard(slug)
        const task = board && findTask(board, id)
        if (!task || !task.run || task.run.seq !== seq || task.run.outcome !== null) return
        runs.delete(KEY(slug, id))
        task.run.ended_at = now()
        const text = extractText(result && result.output)
        if (result && result.stopReason === 'completed') {
          task.run.outcome = 'done'
          task.run.summary = text
          pushEvent(task, 'completed', { summary: text || null })
          const repeat = task.schedule && (task.schedule.kind === 'interval' || task.schedule.kind === 'daily')
          if (repeat) {
            // 重复任务：本轮完成 → 回排「定时」列，等待下一轮（按锚点整倍数排期，不随运行时长漂移）
            task.status = 'scheduled'
            task.schedule.nextAt = scheduleNextAt(task.schedule)
            pushEvent(task, 'moved', { from: 'running', to: 'scheduled', by: 'schedule' })
          } else {
            task.status = 'done'
            activateChildren(slug, task)
          }
        } else {
          task.status = 'blocked'
          task.run.outcome = 'error'
          task.run.error = text || String((result && result.stopReason) || 'unknown')
          pushEvent(task, 'blocked', { reason: task.run.error })
        }
        task.updated_at = now()
      })
    } catch (err) {
      console.error('[kanban] settle failed:', String((err && err.message) || err))
    }
  }

  async function settleError(slug, id, seq, err) {
    try {
      await mutate(() => {
        const board = findBoard(slug)
        const task = board && findTask(board, id)
        if (!task || !task.run || task.run.seq !== seq || task.run.outcome !== null) return
        runs.delete(KEY(slug, id))
        task.run.ended_at = now()
        task.run.outcome = 'error'
        task.run.error = String((err && err.message) || err)
        task.status = 'blocked'
        pushEvent(task, 'blocked', { reason: task.run.error })
        task.updated_at = now()
      })
    } catch (e) {
      console.error('[kanban] settle-error failed:', String((e && e.message) || e))
    }
  }

  const disposers = []
  const routes = new Map()
  function route(method, fn) {
    routes.set(method, fn)
  }

  route('getStore', async () => {
    await load()
    return { boards: store.boards, now: now() }
  })

  route('reload', async () => {
    // 丢弃内存缓存并强制重读磁盘（「刷新」按钮使用，例如外部改动/删除了 kanban-store.json）
    await mutationChain
    store = null
    loadPromise = null
    await load()
    syncTimers()
    return { boards: store.boards, now: now() }
  })

  route('listModels', async () => {
    const llm = ctx.get('llm')
    if (!llm || typeof llm.listProviders !== 'function') return { models: [] }
    let providers = []
    try {
      providers = llm.listProviders()
    } catch (err) {
      return { models: [] }
    }
    const seen = new Set()
    const models = []
    for (const p of providers) {
      const providerKey = typeof p === 'string' ? p : (p.id || p.name || p.provider)
      if (!providerKey) continue
      try {
        const list = await llm.listModels(providerKey)
        for (const m of list) {
          const id = m && (m.id || m.name || m.model)
          if (id && !seen.has(id)) {
            seen.add(id)
            models.push(id)
          }
        }
      } catch (err) {
        // skip a provider that cannot list models
      }
    }
    return { models }
  })

  function createBoardInner(a) {
    const slug = normSlug(a.slug) || slugify(a.name)
    if (!slug) throw new Error(t('err.boardSlugInvalid'))
    const name = cap(String(a.name || slug), 80)
    if (findBoard(slug)) throw new Error(t('err.boardExists'))
    const board = { slug, name, created_at: now(), tasks: [] }
    store.boards.push(board)
    return board
  }

  route('createBoard', async (a) => mutate(() => createBoardInner(a)))

  route('deleteBoard', async (a) => {
    const slug = String(a.slug || '')
    return mutate(() => {
      const idx = store.boards.findIndex(b => b.slug === slug)
      if (idx < 0) throw new Error(t('err.boardNotFound'))
      for (const t of store.boards[idx].tasks) abortRun(slug, t.id)
      store.boards.splice(idx, 1)
      return { ok: true }
    })
  })

  async function createTaskOp(a) {
    const title = cap(String(a.title || '').trim(), 500)
    if (!title) throw new Error(t('err.titleEmpty'))
    const body = cap(String(a.body || ''), 20000)
    let status = STATUSES.indexOf(a.status) >= 0 ? a.status : 'todo'
    if (status === 'running') throw new Error(t('err.runningOnlyByDispatch'))
    const assignee = cap(String(a.assignee || ''), 200) || null
    const priority = clampInt(a.priority, 0, 9)
    return mutate(() => {
      const board = findBoard(String(a.slug || ''))
      if (!board) throw new Error(t('err.boardNotFound'))
      const schedule = normalizeSchedule(a.schedule, board, null)
      const task = {
        id: makeId('t'), title, body, status, assignee, priority, schedule,
        created_at: now(), updated_at: now(), comments: [], events: [], run: null,
      }
      pushEvent(task, 'created', { status })
      board.tasks.push(task)
      if (status === 'scheduled') tryActivate(String(a.slug || ''), task) // 父已完成等条件已满足时立即激活
      return task
    })
  }

  route('createTask', createTaskOp)

  function patchTaskInner(slug, id, patch) {
    const board = findBoard(slug)
    const task = board && findTask(board, id)
    if (!task) throw new Error(t('err.taskNotFound'))
    const changes = []
    if ('title' in patch) {
      const v = cap(String(patch.title || '').trim(), 500)
      if (!v) throw new Error(t('err.titleEmpty'))
      task.title = v
      changes.push('title')
    }
    if ('body' in patch) {
      task.body = cap(String(patch.body || ''), 20000)
      changes.push('body')
    }
    if ('assignee' in patch) {
      task.assignee = cap(String(patch.assignee || ''), 200) || null
      changes.push('assignee')
    }
    if ('priority' in patch) {
      task.priority = clampInt(patch.priority, 0, 9)
      changes.push('priority')
    }
    if ('schedule' in patch) {
      task.schedule = normalizeSchedule(patch.schedule, board, task.id, task.schedule)
      changes.push('schedule')
    }
    if (changes.length === 0) return task
    task.updated_at = now()
    pushEvent(task, 'edited', { fields: changes })
    if (task.status === 'scheduled' && changes.indexOf('schedule') >= 0) tryActivate(slug, task) // 新设的父已完成等条件已满足时立即激活
    return task
  }

  route('patchTask', async (a) => {
    const slug = String(a.slug || '')
    const id = String(a.id || '')
    const patch = (a.patch && typeof a.patch === 'object') ? a.patch : {}
    return mutate(() => patchTaskInner(slug, id, patch))
  })

  function moveTaskInner(slug, id, status, by) {
    const board = findBoard(slug)
    const task = board && findTask(board, id)
    if (!task) throw new Error(t('err.taskNotFound'))
    if (task.status === status) return task
    if (task.status === 'running') {
      abortRun(slug, id)
      if (task.run) { task.run.ended_at = now(); task.run.outcome = 'terminated' }
      pushEvent(task, 'terminated', { by })
    }
    const from = task.status
    task.status = status
    task.updated_at = now()
    pushEvent(task, 'moved', { from, to: status, by })
    if (status === 'scheduled' && task.schedule && task.schedule.kind && typeof task.schedule.nextAt !== 'number') {
      task.schedule.nextAt = scheduleNextAt(task.schedule)
    }
    if (from === 'scheduled' && status !== 'ready' && status !== 'scheduled' && task.schedule) {
      task.schedule = null
      pushEvent(task, 'edited', { fields: ['schedule'] })
    }
    if (status === 'done' || status === 'archived') activateChildren(slug, task)
    return task
  }

  route('moveTask', async (a) => {
    const status = String(a.status || '')
    if (STATUSES.indexOf(status) < 0) throw new Error(t('err.unknownStatus', { a: status }))
    if (status === 'running') throw new Error(t('err.runningOnlyByDispatch'))
    const slug = String(a.slug || '')
    const id = String(a.id || '')
    return mutate(() => moveTaskInner(slug, id, status, 'manual'))
  })

  route('bulkMove', async (a) => {
    const ids = Array.isArray(a.ids) ? a.ids.map(String) : []
    const status = String(a.status || '')
    if (STATUSES.indexOf(status) < 0) throw new Error(t('err.unknownStatus', { a: status }))
    if (status === 'running') throw new Error(t('err.runningOnlyByDispatch'))
    const slug = String(a.slug || '')
    return mutate(() => {
      const board = findBoard(slug)
      if (!board) throw new Error(t('err.boardNotFound'))
      const results = []
      for (const id of ids) {
        try {
          const task = findTask(board, id)
          if (!task) { results.push({ id, ok: false, error: t('err.taskNotFound') }); continue }
          moveTaskInner(slug, id, status, 'bulk')
          results.push({ id, ok: true })
        } catch (err) {
          results.push({ id, ok: false, error: String((err && err.message) || err) })
        }
      }
      return { results }
    })
  })

  route('bulkDelete', async (a) => {
    const ids = Array.isArray(a.ids) ? a.ids.map(String) : []
    const slug = String(a.slug || '')
    return mutate(() => {
      const board = findBoard(slug)
      if (!board) throw new Error(t('err.boardNotFound'))
      const results = []
      for (const id of ids) {
        const idx = board.tasks.findIndex(t => t.id === id)
        if (idx < 0) { results.push({ id, ok: false, error: t('err.taskNotFound') }); continue }
        abortRun(slug, id)
        const removed = board.tasks[idx]
        board.tasks.splice(idx, 1)
        activateChildren(slug, removed) // 父被删除视为已完成，释放等待它的子任务
        results.push({ id, ok: true })
      }
      return { results }
    })
  })

  function deleteTaskInner(slug, id) {
    const board = findBoard(slug)
    if (!board) throw new Error(t('err.boardNotFound'))
    const idx = board.tasks.findIndex(t => t.id === id)
    if (idx < 0) throw new Error(t('err.taskNotFound'))
    abortRun(slug, id)
    const removed = board.tasks[idx]
    board.tasks.splice(idx, 1)
    activateChildren(slug, removed) // 父被删除视为已完成，释放等待它的子任务
    return removed
  }

  route('deleteTask', async (a) => {
    const slug = String(a.slug || '')
    const id = String(a.id || '')
    return mutate(() => {
      deleteTaskInner(slug, id)
      return { ok: true }
    })
  })

  function addCommentInner(slug, id, body, author) {
    const board = findBoard(slug)
    const task = board && findTask(board, id)
    if (!task) throw new Error(t('err.taskNotFound'))
    if (!Array.isArray(task.comments)) task.comments = []
    const comment = { id: makeId('c'), author: author === 'agent' ? 'agent' : 'user', body, created_at: now() }
    task.comments.push(comment)
    task.updated_at = now()
    pushEvent(task, 'commented', { commentId: comment.id, author: comment.author })
    return { comment, task }
  }

  route('addComment', async (a) => {
    const body = cap(String(a.body || '').trim(), 4000)
    if (!body) throw new Error(t('err.commentEmpty'))
    const slug = String(a.slug || '')
    const id = String(a.id || '')
    return mutate(() => addCommentInner(slug, id, body, 'user'))
  })

  async function dispatchOp(a) {
    const slug = String(a.slug || '')
    const id = String(a.id || '')
    const extra = cap(String(a.instructions || '').trim(), 2000) || null
    return mutate(async () => {
      const board = findBoard(slug)
      const task = board && findTask(board, id)
      if (!task) throw new Error(t('err.taskNotFound'))
      if (task.status !== 'ready') throw new Error(t('err.dispatchNotReady'))
      if (runs.has(KEY(slug, id))) throw new Error(t('err.alreadyRunning'))
      if (!subagents) throw new Error(t('err.noSubagents'))
      const initiator = (agents && typeof agents.currentInitiator === 'function' ? agents.currentInitiator() : undefined)
      const roots = (agents && typeof agents.roots === 'function' ? agents.roots() : [])
      // UI 按钮派发时无 initiator：优先挂靠最近有会话活动的根，其次第一个根（多会话时尽量贴近用户当前上下文）
      const parent = initiator
        || (lastActiveRootId && roots.find(r => String(r.id) === lastActiveRootId))
        || roots[0]
      if (!parent) throw new Error(t('err.noLiveAgent'))
      let providerName = null
      try {
        const names = subagents.list ? subagents.list() : []
        const preferred = ['spawn', 'spawn-in-process', 'fork', 'fork-in-process']
        for (const p of preferred) {
          if (names.indexOf(p) >= 0) { providerName = p; break }
        }
        if (providerName === null && names.length > 0) providerName = names[0]
      } catch (err) {
        providerName = null
      }
      if (!providerName) throw new Error(t('err.noProvider'))
      await resetProgressFile(task.id)
      const signal = makeSignal()
      const startRequest = {
        label: 'kanban: ' + cap(task.title, 60),
        prompt: [{ type: 'text', text: buildPrompt(task, extra) }],
        parent,
        signal,
      }
      if (task.assignee) {
        const provider = parent.options && parent.options.provider
        if (provider) {
          const llm = ctx.get('llm')
          if (llm && typeof llm.listModels === 'function') {
            let known = false
            try {
              const models = await llm.listModels(provider)
              for (const m of models) {
                if (m && (m.id === task.assignee || m.name === task.assignee || m.model === task.assignee)) {
                  known = true
                  break
                }
              }
            } catch (err) {
              known = true
            }
            if (!known) throw new Error(t('err.modelUnknown', { a: task.assignee, b: provider }))
          }
        }
        startRequest.agentOptions = { model: task.assignee }
      }
      const run = await subagents.start(providerName, startRequest)
      const seq = (task.run && task.run.seq ? task.run.seq : 0) + 1
      runs.set(KEY(slug, id), { signal, run, seq, slug, id })
      task.status = 'running'
      task.run = {
        provider: providerName, runId: String(run.id), seq,
        started_at: now(), ended_at: null, outcome: null, summary: null, error: null,
        heartbeat_at: now(), progress: [], progressLineCount: 0,
      }
      task.updated_at = now()
      pushEvent(task, 'dispatched', { provider: providerName, runId: task.run.runId, model: task.assignee || null })
      run.result.then(result => settleRun(slug, id, seq, result)).catch(err => settleError(slug, id, seq, err))
      return { ok: true, task }
    })
  }

  route('dispatch', dispatchOp)

  function terminateInner(slug, id, by) {
    const board = findBoard(slug)
    const task = board && findTask(board, id)
    if (!task) throw new Error(t('err.taskNotFound'))
    if (task.status !== 'running') throw new Error(t('err.taskNotRunning'))
    abortRun(slug, id)
    if (task.run) { task.run.ended_at = now(); task.run.outcome = 'terminated' }
    task.status = 'ready'
    task.updated_at = now()
    pushEvent(task, 'terminated', { by })
    return task
  }

  route('terminate', async (a) => {
    const slug = String(a.slug || '')
    const id = String(a.id || '')
    return mutate(() => {
      const task = terminateInner(slug, id, 'manual')
      return { ok: true, task }
    })
  })

  // —— Client RPC：静态客户端经 fetch POST /kanban/rpc 调用（替代动态插件的 harness.handle/host.call）——
  const web = ctx.get('webServer')
  if (web && typeof web.register === 'function') {
    disposers.push(web.register({
      kind: 'exact',
      path: '/kanban/rpc',
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        // 同源校验：浏览器跨站请求会携带 Origin，其 host 必须与 Host 头一致，否则拒绝（防跨站触发本机 RPC）
        const origin = String((req.headers && req.headers.origin) || '')
        if (origin) {
          let same = false
          try { same = new URL(origin).host === String((req.headers && req.headers.host) || '') } catch (err) {}
          if (!same) {
            res.statusCode = 403
            res.end()
            return
          }
        }
        let payload = {}
        try {
          const chunks = []
          for await (const chunk of req) chunks.push(chunk)
          if (chunks.length > 0) payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) || {}
        } catch (err) {}
        const method = String((payload && payload.method) || '')
        // 客户端上报界面语言：未显式设置平台偏好时，宿主文案跟随浏览器语言（并热重注册工具/skill）
        adoptClientLang((payload && payload.lang) || null)
        const fn = routes.get(method)
        let out
        if (fn === undefined) {
          out = { ok: false, error: t('err.unknownMethod', { a: method }) }
        } else {
          try {
            out = { ok: true, data: await fn((payload && payload.args) || {}) }
          } catch (err) {
            out = { ok: false, error: String((err && err.message) || err) }
          }
        }
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.end(JSON.stringify(out))
      },
    }))
  }

  // —— Skill 引导：注册进宿主 skills 注册表（全局层，所有会话的 skill 目录可见）——
  // 内容随语言热重注册（语言切换时先销毁旧注册再注册新内容）。
  let skillDisposer = null
  function registerSkill() {
    if (skillDisposer) {
      try { skillDisposer() } catch (err) {}
      skillDisposer = null
    }
    const skills = ctx.get('skills')
    if (skills && typeof skills.register === 'function') {
      const sk = KANBAN_SKILLS[currentLang] || KANBAN_SKILLS.zh
      skillDisposer = skills.register({
        name: sk.name,
        description: sk.description,
        whenToUse: sk.whenToUse,
        source: 'custom',
        content: sk.content,
      })
    } else {
      console.warn('[kanban] skills 服务不可用：跳过 kanban skill 注册（工具面不受影响）')
    }
  }

  // —— Agent 工具：10 个看板工具（读得见、改得动、派得出去、收得回结果）——
  // 共享 helper：解析看板（省略时用第一个）、定位任务（省略 board 时全看板搜索）
  async function resolveBoardSlug(args) {
    await load()
    let slug = typeof args.board === 'string' ? args.board.trim() : ''
    if (!slug) {
      if (store.boards.length === 0) throw new Error(t('err.noBoards'))
      slug = store.boards[0].slug
    }
    return slug
  }
  function locateTask(args, id) {
    const slugArg = typeof args.board === 'string' ? args.board.trim() : ''
    if (slugArg) {
      const board = findBoard(slugArg)
      if (!board) throw new Error(t('err.boardNotFoundSlug', { a: slugArg }))
      const task = findTask(board, id)
      if (!task) throw new Error(t('err.taskNotFoundInBoard', { a: id, b: slugArg }))
      return { slug: slugArg, task }
    }
    for (const board of store.boards) {
      const task = findTask(board, id)
      if (task) return { slug: board.slug, task }
    }
    throw new Error(t('err.taskNotFoundAny', { a: id }))
  }
  const reqId = (args) => {
    const id = String(args && args.id ? args.id : '').trim()
    if (!id) throw new Error(t('err.taskIdRequired'))
    return id
  }
  const shortId = (id) => String(id || '').replace(/^t_/, '').slice(0, 8)
  const textResultView = (title, value) => ({ card: 'generic', title, content: [{ type: 'text', text: String(value) }] })
  const BOARD_PARAM = { type: 'string', description: t('param.board') }
  const NO_BOARD_BOARD_PARAM = { type: 'string', description: t('param.boardSearch') }
  const ID_PARAM = { type: 'string', description: t('param.taskId') }
  const scheduleText = (task) => {
    const s = task.schedule
    if (!s) return ''
    const parts = []
    if (s.kind === 'interval') parts.push(t('sched.interval', { a: s.intervalMinutes }))
    if (s.kind === 'daily') parts.push(t('sched.daily', { a: String(Math.floor(s.dailyMinutes / 60)).padStart(2, '0') + ':' + String(s.dailyMinutes % 60).padStart(2, '0') }))
    if (s.parentId) parts.push(t('sched.parent', { a: shortId(s.parentId) }))
    return parts.join(t('sched.join')) || t('sched.parked')
  }

  function buildTools() {
    return [
    {
      name: 'kanban_list_boards',
      description: t('tool.listBoards'),
      parameters: { type: 'object', properties: {}, required: [] },
      async execute() {
        await load()
        if (store.boards.length === 0) throw new Error(t('err.noBoards'))
        const lines = store.boards.map(b => {
          const c = {}
          for (const s of STATUSES) c[s] = 0
          for (const task of b.tasks) if (typeof c[task.status] === 'number') c[task.status]++
          return t('out.boardsRow', { a: b.name, b: b.slug, c: c.todo, d: c.scheduled, e: c.ready, f: c.running, g: c.blocked, h: c.done, i: b.tasks.length })
        })
        return t('out.boardsHead', { a: store.boards.length }) + '\n' + lines.join('\n')
      },
      presentCall: () => ({ card: 'generic', title: t('pc.listBoards') }),
      presentResult: (_a, value) => textResultView(t('pc.listBoardsResult'), value),
    },
    {
      name: 'kanban_list_tasks',
      description: t('tool.listTasks'),
      parameters: {
        type: 'object',
        properties: {
          board: BOARD_PARAM,
          status: { type: 'string', enum: STATUSES, description: t('param.status') },
          priority_min: { type: 'number', description: t('param.priorityMin') },
          assignee: { type: 'string', description: t('param.assignee') },
          query: { type: 'string', description: t('param.query') },
          limit: { type: 'number', description: t('param.limit') },
        },
        required: [],
      },
      async execute(args) {
        const slug = await resolveBoardSlug(args)
        const board = findBoard(slug)
        if (!board) throw new Error(t('err.boardNotFoundSlug', { a: slug }))
        const minP = args.priority_min === undefined || args.priority_min === null ? null : clampInt(args.priority_min, 0, 9)
        const q = String(args.query || '').trim().toLowerCase()
        const limit = args.limit === undefined || args.limit === null ? 50 : clampInt(args.limit, 1, 200)
        let list = board.tasks.slice()
        if (typeof args.status === 'string' && args.status) list = list.filter(task => task.status === args.status)
        if (minP !== null) list = list.filter(task => task.priority >= minP)
        if (typeof args.assignee === 'string' && args.assignee.trim()) {
          const want = args.assignee.trim()
          list = list.filter(task => (task.assignee || '') === want)
        }
        if (q) list = list.filter(task => ((task.title || '') + ' ' + (task.body || '') + ' ' + task.id).toLowerCase().indexOf(q) >= 0)
        list.sort((x, y) => (y.priority - x.priority) || (y.created_at - x.created_at))
        const total = list.length
        if (total === 0) return t('out.boardEmpty', { a: board.name, b: slug })
        const page = list.slice(0, limit)
        const lines = page.map(task => {
          const parts = [t('out.taskId', { a: task.id }), t('out.taskStatus', { a: statusLabel(task.status) }), t('out.taskPriority', { a: task.priority })]
          if (task.assignee) parts.push(t('out.taskAssignee', { a: task.assignee }))
          if (task.status === 'scheduled' && task.schedule) parts.push(t('out.taskSchedule', { a: scheduleText(task) }))
          if (task.status === 'running' && task.run) parts.push(t('out.taskRunning'))
          return '- ' + cap(task.title, 60) + '（' + parts.join(t('out.join')) + '）'
        })
        return (page.length < total ? t('out.tasksHead', { a: board.name, b: slug, c: total, d: page.length }) : t('out.tasksHeadAll', { a: board.name, b: slug, c: total })) + '\n' + lines.join('\n')
      },
      presentCall: () => ({ card: 'generic', title: t('pc.listTasks') }),
      presentResult: (_a, value) => textResultView(t('pc.listTasksResult'), value),
    },
    {
      name: 'kanban_get_task',
      description: t('tool.getTask'),
      parameters: { type: 'object', properties: { id: ID_PARAM, board: NO_BOARD_BOARD_PARAM }, required: ['id'] },
      async execute(args) {
        await load()
        const id = reqId(args)
        const located = locateTask(args, id)
        const slug = located.slug
        const task = located.task
        const lines = []
        lines.push(t('out.taskHead', { a: id, b: slug }))
        lines.push(t('out.taskTitle') + task.title)
        lines.push(t('out.taskStatusLabel') + statusLabel(task.status) + '（' + task.status + '）')
        lines.push(t('out.taskPriorityLabel') + task.priority)
        lines.push(t('out.taskAssigneeLabel') + (task.assignee || t('out.defaultModel')))
        lines.push(t('out.taskScheduleLabel') + (scheduleText(task) || t('out.noSchedule')))
        lines.push('')
        lines.push(t('out.taskBody') + (task.body || t('out.none')))
        const comments = (task.comments || []).slice(-20)
        lines.push('')
        lines.push(t('out.commentsHead', { a: comments.length }))
        if (comments.length === 0) lines.push('- ' + t('out.none'))
        for (const c of comments) lines.push('- ' + (c.author === 'agent' ? t('out.mainAgent') : 'user') + ' ' + fmtTime(c.created_at) + '：' + cap(c.body, 200))
        const events = (task.events || []).slice(-20)
        lines.push('')
        lines.push(t('out.eventsHead', { a: events.length }))
        if (events.length === 0) lines.push('- ' + t('out.none'))
        for (const ev of events) lines.push('- ' + fmtTime(ev.created_at) + ' ' + ev.kind + '：' + cap(JSON.stringify(ev.payload || {}), 120))
        const run = task.run
        lines.push('')
        if (run) {
          lines.push(t('out.lastRun'))
          lines.push('- ' + t('prompt.result') + (run.outcome || (task.status === 'running' ? t('out.runOutcomeRunning') : t('out.runOutcomePending'))))
          lines.push('- ' + t('out.runStarted', { a: fmtTime(run.started_at), b: (run.ended_at ? fmtTime(run.ended_at) : t('out.runNotEnded')) }))
          if (run.runId) lines.push('- runId: ' + run.runId)
          if (run.summary) lines.push('- ' + t('prompt.summary') + run.summary)
          if (run.error) lines.push('- ' + t('prompt.error') + run.error)
          const progress = (run.progress || []).filter(p => String(p).trim() !== '').slice(-50)
          if (progress.length > 0) {
            lines.push('- ' + t('out.runProgress', { a: progress.length }))
            for (const p of progress) lines.push('  ' + p)
          }
        } else {
          lines.push(t('out.noRun'))
        }
        return lines.join('\n')
      },
      presentCall: () => ({ card: 'generic', title: t('pc.getTask') }),
      presentResult: (_a, value) => textResultView(t('pc.getTaskResult'), value),
    },
    {
      name: 'kanban_create_task',
      description: t('tool.createTask'),
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: t('param.title') },
          body: { type: 'string', description: t('param.body') },
          board: { type: 'string', description: t('param.board') },
          status: { type: 'string', enum: ['triage', 'todo', 'scheduled', 'ready', 'blocked', 'review', 'done', 'archived'], description: t('param.statusInit') },
          priority: { type: 'number', description: t('param.priority') },
          assignee: { type: 'string', description: t('param.assigneeOptional') },
          schedule: {
            type: 'object',
            description: t('param.schedule'),
            properties: {
              kind: { type: 'string', enum: ['interval', 'daily'], description: t('param.scheduleKind') },
              intervalMinutes: { type: 'number', description: t('param.intervalMinutes') },
              dailyTime: { type: 'string', description: t('param.dailyTime') },
              parentId: { type: 'string', description: t('param.parentId') },
            },
            required: ['kind'],
          },
        },
        required: ['title'],
      },
      async execute(args) {
        const slug = await resolveBoardSlug(args)
        const task = await createTaskOp({
          slug,
          title: args.title,
          body: args.body,
          assignee: args.assignee,
          priority: args.priority,
          status: args.status,
          schedule: args.schedule,
        })
        const schedPart = scheduleText(task) ? t('out.createdTaskSched', { a: scheduleText(task) }) : ''
        return t('out.createdTask', { a: task.title, b: task.id, c: slug, d: statusLabel(task.status), e: schedPart })
      },
      presentCall(args) {
        const title = String((args && args.title) || '').trim()
        return { card: 'generic', title: t('pc.createTask', { a: cap(title || t('out.untitled'), 40) }) }
      },
      presentResult: (_a, value) => textResultView(t('pc.createTaskResult'), value),
    },
    {
      name: 'kanban_update_task',
      description: t('tool.updateTask'),
      parameters: {
        type: 'object',
        properties: {
          id: ID_PARAM,
          board: NO_BOARD_BOARD_PARAM,
          patch: {
            type: 'object',
            description: t('param.patch'),
            properties: {
              title: { type: 'string', description: t('param.patchTitle') },
              body: { type: 'string', description: t('param.patchBody') },
              status: { type: 'string', enum: ['triage', 'todo', 'scheduled', 'ready', 'blocked', 'review', 'done', 'archived'], description: t('param.patchStatus') },
              priority: { type: 'number', description: t('param.patchPriority') },
              assignee: { type: 'string', description: t('param.patchAssignee') },
              schedule: { type: 'object', description: t('param.patchSchedule') },
            },
          },
        },
        required: ['id', 'patch'],
      },
      async execute(args) {
        await load()
        const id = reqId(args)
        const patch = (args.patch && typeof args.patch === 'object') ? args.patch : {}
        const fields = ['title', 'body', 'status', 'priority', 'assignee', 'schedule'].filter(k => k in patch && patch[k] !== undefined)
        if (fields.length === 0) throw new Error(t('err.patchEmpty'))
        if ('status' in patch) {
          if (patch.status !== null && patch.status !== undefined && STATUSES.indexOf(patch.status) < 0) throw new Error(t('err.unknownStatus', { a: patch.status }))
          if (patch.status === 'running') throw new Error(t('err.runningOnlyByDispatch'))
        }
        locateTask(args, id) // 提前校验存在性，给出可读错误
        return mutate(() => {
          const { slug, task } = locateTask(args, id)
          if ('status' in patch && patch.status !== null && patch.status !== undefined && patch.status !== task.status) {
            if (task.status === 'running') throw new Error(t('err.taskRunningStopFirst'))
            moveTaskInner(slug, id, patch.status, 'agent')
          }
          const editPatch = {}
          for (const k of ['title', 'body', 'priority', 'assignee']) {
            if (k in patch && patch[k] !== undefined) editPatch[k] = patch[k]
          }
          if ('schedule' in patch && patch.schedule !== undefined) editPatch.schedule = patch.schedule
          if (Object.keys(editPatch).length > 0) patchTaskInner(slug, id, editPatch)
          const fresh = locateTask(args, id).task
          return t('out.updatedTask', { a: fresh.title, b: fresh.id, c: statusLabel(fresh.status) })
        })
      },
      presentCall: () => ({ card: 'generic', title: t('pc.updateTask') }),
      presentResult: (_a, value) => textResultView(t('pc.updateTaskResult'), value),
    },
    {
      name: 'kanban_add_comment',
      description: t('tool.comment'),
      parameters: {
        type: 'object',
        properties: {
          id: ID_PARAM,
          board: NO_BOARD_BOARD_PARAM,
          body: { type: 'string', description: t('param.commentBody') },
        },
        required: ['id', 'body'],
      },
      async execute(args) {
        await load()
        const id = reqId(args)
        const body = cap(String(args.body || '').trim(), 4000)
        if (!body) throw new Error(t('err.commentEmpty'))
        locateTask(args, id)
        return mutate(() => {
          const { slug } = locateTask(args, id)
          const out = addCommentInner(slug, id, body, 'agent')
          return t('out.commented', { a: out.task.title, b: out.task.id })
        })
      },
      presentCall: () => ({ card: 'generic', title: t('pc.comment') }),
      presentResult: (_a, value) => textResultView(t('pc.commentResult'), value),
    },
    {
      name: 'kanban_dispatch_task',
      description: t('tool.dispatch'),
      parameters: {
        type: 'object',
        properties: {
          id: ID_PARAM,
          board: BOARD_PARAM,
          instructions: { type: 'string', description: t('param.instructions') },
        },
        required: ['id'],
      },
      async execute(args) {
        const slug = await resolveBoardSlug(args)
        const out = await dispatchOp({ slug, id: reqId(args), instructions: args.instructions })
        const task = out && out.task
        const runTag = (task && task.run && task.run.runId) ? t('out.dispatchedRunId', { a: task.run.runId }) : ''
        return t('out.dispatched', { a: (task ? task.title : 'ok'), b: (task ? task.id : '?'), c: runTag })
      },
      presentCall(args) {
        const id = String((args && args.id) || '')
        return { card: 'generic', title: t('pc.dispatch', { a: shortId(id) }) }
      },
      presentResult: (_a, value) => textResultView(t('pc.dispatchResult'), value),
    },
    {
      name: 'kanban_stop_task',
      description: t('tool.stop'),
      parameters: { type: 'object', properties: { id: ID_PARAM, board: NO_BOARD_BOARD_PARAM }, required: ['id'] },
      async execute(args) {
        await load()
        const id = reqId(args)
        locateTask(args, id)
        return mutate(() => {
          const { slug, task } = locateTask(args, id)
          if (task.status !== 'running') throw new Error(t('err.taskNotRunningStatus', { a: statusLabel(task.status) }))
          terminateInner(slug, id, 'agent')
          return t('out.stopped', { a: task.title, b: task.id })
        })
      },
      presentCall(args) {
        const id = String((args && args.id) || '')
        return { card: 'generic', title: t('pc.stop', { a: shortId(id) }) }
      },
      presentResult: (_a, value) => textResultView(t('pc.stopResult'), value),
    },
    {
      name: 'kanban_delete_task',
      description: t('tool.delete'),
      parameters: { type: 'object', properties: { id: ID_PARAM, board: NO_BOARD_BOARD_PARAM }, required: ['id'] },
      async execute(args) {
        await load()
        const id = reqId(args)
        locateTask(args, id)
        return mutate(() => {
          const { slug } = locateTask(args, id)
          const removed = deleteTaskInner(slug, id)
          return t('out.deleted', { a: removed.title, b: removed.id })
        })
      },
      presentCall(args) {
        const id = String((args && args.id) || '')
        return { card: 'generic', title: t('pc.delete', { a: shortId(id) }) }
      },
      presentResult: (_a, value) => textResultView(t('pc.deleteResult'), value),
    },
    {
      name: 'kanban_create_board',
      description: t('tool.createBoard'),
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: t('param.boardName') },
          slug: { type: 'string', description: t('param.boardSlug') },
        },
        required: ['name'],
      },
      async execute(args) {
        const name = cap(String(args.name || '').trim(), 80)
        if (!name) throw new Error(t('err.boardNameEmpty'))
        const board = await mutate(() => createBoardInner({ name, slug: args.slug }))
        return t('out.createdBoard', { a: board.name, b: board.slug })
      },
      presentCall(args) {
        const n = String((args && args.name) || '').trim()
        return { card: 'generic', title: t('pc.createBoard', { a: cap(n || t('out.unnamed'), 40) }) }
      },
      presentResult: (_a, value) => textResultView(t('pc.createBoardResult'), value),
    },
  ]
  }

  // —— Agent 工具注册：10 个看板工具；语言切换时热重注册（先销毁旧注册，再按当前语言重建）——
  const toolDisposers = []
  function registerTools() {
    for (const d of toolDisposers) {
      try { d() } catch (err) {}
    }
    toolDisposers.length = 0
    const tools = ctx.get('tools')
    if (!tools || typeof tools.register !== 'function') return
    for (const def of buildTools()) {
      toolDisposers.push(tools.register({
        name: def.name,
        description: def.description,
        parameters: def.parameters,
        output: {
          schema: { type: 'string' },
          render(_args, value) { return [{ type: 'text', text: String(value) }] },
        },
        async execute(args) { return def.execute(args || {}) },
        presentCall: def.presentCall,
        presentResult: def.presentResult,
      }))
    }
  }

  // 语言切换入口：更新 currentLang 并重建注册（工具描述/skill 内容随语言变化）
  function applyLang(next) {
    if (!isLang(next) || next === currentLang) return
    currentLang = next
    registerTools()
    registerSkill()
  }
  // 客户端上报界面语言：仅在用户未显式设置平台偏好时跟随浏览器语言
  function adoptClientLang(l) {
    if (!isLang(l) || l === clientLang) return
    clientLang = l
    if (!isLang(prefLang)) applyLang(pickLang())
  }

  // 初始语言：读平台设置 locale.preference（设置页 Language 行）；随后监听设置变化
  const settings = ctx.get('settings')
  if (settings && typeof settings.get === 'function') {
    try {
      const loc = settings.get('locale')
      if (loc && isLang(loc.preference)) prefLang = loc.preference
    } catch (err) {}
    disposers.push(ctx.on('settings/updated', (ns, next) => {
      if (String(ns) !== 'locale') return
      const p = (next && isLang(next.preference)) ? next.preference : null
      if (p !== prefLang) {
        prefLang = p
        applyLang(pickLang())
      }
    }))
  }
  // 首次注册（applyLang 只在语言变化时才重建注册，这里保证启动时必有注册）
  currentLang = pickLang()
  registerTools()
  registerSkill()

  // —— 事件循环：运行心跳 + 实时进度（定时激活由每任务的 ctx.timeout + 父完成钩子驱动，不在此循环）——
  let ticking = false
  async function tick() {
    if (ticking) return
    ticking = true
    try {
      const s = await load()
      const deadline = now() - HEARTBEAT_TIMEOUT_MS
      const pending = []
      const runningSnapshots = []
      for (const board of s.boards) {
        for (const task of board.tasks) {
          if (task.status === 'running' && task.run && runs.has(KEY(board.slug, task.id))) {
            const base = typeof task.run.heartbeat_at === 'number' ? task.run.heartbeat_at : (typeof task.run.started_at === 'number' ? task.run.started_at : 0)
            if (base > 0 && base < deadline) {
              pending.push({ slug: board.slug, id: task.id, kind: 'heartbeat-dead' })
            } else {
              runningSnapshots.push({ slug: board.slug, id: task.id, seq: task.run.seq, run: task.run })
            }
          }
        }
      }
      const progressUpdates = []
      for (const item of runningSnapshots) {
        const lines = await readProgressTail(item.id)
        const prevCount = typeof item.run.progressLineCount === 'number' ? item.run.progressLineCount : 0
        if (lines.length > prevCount) {
          progressUpdates.push({
            slug: item.slug, id: item.id, seq: item.seq,
            progress: ((item.run.progress || []).concat(lines.slice(prevCount))).slice(-PROGRESS_CAP),
            progressLineCount: lines.length,
            heartbeatAt: now(),
          })
        }
      }
      if (pending.length === 0 && progressUpdates.length === 0) return
      await mutate(() => {
        for (const p of pending) {
          const board = findBoard(p.slug)
          const task = board && findTask(board, p.id)
          if (!task) continue
          if (p.kind === 'heartbeat-dead') {
            if (task.status !== 'running') continue
            abortRun(p.slug, p.id)
            const reason = t('err.heartbeatLost', { a: Math.round(HEARTBEAT_TIMEOUT_MS / 60000) })
            if (task.run) { task.run.ended_at = now(); task.run.outcome = 'error'; task.run.error = reason }
            task.status = 'blocked'
            task.updated_at = now()
            pushEvent(task, 'blocked', { reason })
          }
        }
        for (const u of progressUpdates) {
          const board = findBoard(u.slug)
          const task = board && findTask(board, u.id)
          if (!task || !task.run || task.run.seq !== u.seq) continue
          task.run.progress = u.progress
          task.run.progressLineCount = u.progressLineCount
          task.run.heartbeat_at = u.heartbeatAt
        }
      })
    } catch (err) {
      console.error('[kanban] tick failed:', String((err && err.message) || err))
    } finally {
      ticking = false
    }
  }
  disposers.push(ctx.interval(tick, LOOP_TICK_MS))
  load().then(() => syncTimers()).catch(() => {})

  // 会话日志活动 → 记录最近活跃根 + 子运行心跳（本地 provider 的 session/event 在本进程发射）
  disposers.push(ctx.on('session/event', (session) => {
    if (!session) return
    const sid = String(session.id)
    if (agents && typeof agents.roots === 'function') {
      for (const r of agents.roots()) {
        if (String(r.id) === sid || (r.session && String(r.session.id) === sid)) {
          lastActiveRootId = String(r.id)
          break
        }
      }
    }
    if (store === null) return
    for (const entry of runs.values()) {
      if (!entry.run || String(entry.run.id) !== sid) continue
      const board = findBoard(entry.slug)
      const task = board && findTask(board, entry.id)
      if (task && task.run && task.run.seq === entry.seq) {
        task.run.heartbeat_at = now()
      }
    }
  }))

  ctx.effect(() => () => {
    for (const key of Array.from(runs.keys())) {
      const entry = runs.get(key)
      if (entry) {
        try { entry.signal._abort('kanban stop') } catch (err) {}
        try { entry.run.dispose() } catch (err) {}
      }
    }
    runs.clear()
    for (const d of toolDisposers) {
      try { d() } catch (err) {}
    }
    toolDisposers.length = 0
    if (skillDisposer) {
      try { skillDisposer() } catch (err) {}
      skillDisposer = null
    }
    for (const d of disposers) {
      try { d() } catch (err) {}
    }
    if (store !== null) {
      let touched = false
      for (const board of store.boards) {
        for (const task of board.tasks) {
          if (task.status === 'running') {
            task.status = 'blocked'
            if (task.run) { task.run.ended_at = now(); task.run.outcome = 'terminated' }
            pushEvent(task, 'blocked', { reason: t('err.pluginStopped') })
            touched = true
          }
        }
      }
      if (touched) {
        // 返回落盘 Promise：宿主 dispose 若等待清理回调，可保证最终状态写入
        return storeTarget().then(target => ctx.fs.writeText(target, JSON.stringify(store), undefined, undefined, resolvePolicy())).catch(() => {})
      }
    }
  })
}
