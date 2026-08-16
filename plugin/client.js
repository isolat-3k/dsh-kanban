// DSH Kanban 看板插件 — Client 静态 bundle（dsh.client 包 dsh-kanban）
// 运行环境：浏览器模块表（window.__ModuleLoader__）；require('react') 来自平台种子表
// RPC：fetch POST /kanban/rpc（Host 的 webServer 路由，替代动态插件的 host.call）
window.__ModuleLoader__.load({
  id: 'dsh-kanban',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')

    function insertCss(css) {
      const el = document.createElement('style')
      el.setAttribute('data-plugin-css', 'dsh-kanban')
      el.textContent = css
      document.head.appendChild(el)
      return () => { el.remove() }
    }

    function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return
      const h = React.createElement

      // —— i18n：跟随 DSH 平台 locale 服务（设置页 Language 行切换，默认跟随 DSH core/browser 语言）——
      // 词典注册进平台 registry；t(key, params) 读取当前语言文案；槽位声明 locale 后切语言自动重渲染。
      const LOCALE_DICT = {
        zh: {
          'tab': '看板',
          'status.triage': '待细化', 'status.todo': '待办', 'status.scheduled': '定时', 'status.ready': '就绪',
          'status.running': '运行中', 'status.blocked': '阻塞', 'status.review': '审核', 'status.done': '完成', 'status.archived': '归档',
          'time.justNow': '刚刚', 'time.minutes': '{a} 分钟', 'time.hours': '{a} 小时', 'time.days': '{a} 天',
          'time.daysHours': '{a} 天 {b} 小时', 'time.hoursMinutes': '{a} 小时 {b} 分',
          'time.expired': '已到期', 'time.remain': '还剩 {a}',
          'sched.interval': '间隔重复 · 每{a}', 'sched.daily': '每天 {a}',
          'sched.parent': '父 {a}', 'sched.waitParent': '等待父卡片完成',
          'ui.filter': '筛选', 'ui.search': '搜索标题/正文/ID…', 'ui.noMatch': '无匹配任务',
          'ui.newTaskHere': '在此列新建任务', 'ui.newTask': '＋ 新建任务',
          'ui.model': '模型：{a}', 'ui.repeat': '重复任务：本轮完成后自动回排定时列',
          'ui.priority': '优先级 {a}', 'ui.commentCount': '评论个数{a}', 'ui.running': '运行中',
          'ui.selected': '已选 {a} 项', 'ui.move': '移动', 'ui.delete': '删除', 'ui.clearSel': '取消选择',
          'ev.created': '创建任务（{a}）', 'ev.edited': '编辑字段：{a}',
          'ev.movedParent': '父卡片完成 → 自动激活：{a} → {b}',
          'ev.movedInterval': '间隔定时到点 → 自动激活：{a} → {b}',
          'ev.movedDaily': '每日定时到点 → 自动激活：{a} → {b}',
          'ev.movedSchedule': '本轮完成 → 回排定时列：{a} → {b}',
          'ev.movedTimer': '旧定时到点提权：{a} → {b}',
          'ev.moved': '移动：{a} → {b}', 'ev.commented': '添加评论',
          'ev.dispatched': '派发执行（provider: {a}）', 'ev.completed': '执行完成',
          'ev.terminated': '手动终止运行', 'ev.blocked': '阻塞：{a}',
          'd.close': '关闭', 'd.title': '标题', 'd.status': '状态', 'd.model': '子Agent模型',
          'd.defaultModel': '默认模型（跟随会话）', 'd.priority': '优先级（0-9，越大越优先）', 'd.desc': '描述',
          'd.schedule': '定时（停放后自动激活方式）', 'd.scheduleNone': '无（仅停放，不自动激活）',
          'd.scheduleInterval': '间隔重复（每 N 分钟）', 'd.scheduleDaily': '每天固定时刻',
          'd.interval': '间隔（分钟，1-10080，最长 7 天）', 'd.dailyTime': '每天时刻',
          'd.parent': '父卡片（可选：父卡片完成时激活；不设则不激活）', 'd.parentNone': '无（不设置父卡片）',
          'd.currentSchedule': '当前定时', 'd.parentCard': '父卡片：{a}（{b}）', 'd.parentDeleted': '已删除（视为已完成）',
          'd.nextActivation': '下次激活：{a}　{b}', 'd.saving': '保存中…', 'd.run': '执行',
          'd.providerRun': 'Provider：{a}　Run：{b}', 'd.started': '开始：{a}', 'd.ended': '　结束：{a}',
          'd.lastActive': '最近活动：{a}', 'd.resultDone': '结果：完成', 'd.resultError': '结果：失败',
          'd.resultTerminated': '结果：已终止', 'd.error': '错误：{a}', 'd.neverRun': '尚未执行过',
          'd.progress': '实时进度（最近 {a} 行）', 'd.stopBtn': '■ 停止运行',
          'd.autoHint': '本卡在「待办/就绪」列：看板会自动派发给 DSH 代理执行（事件循环最多等 10s）',
          'd.autoHintParent': '已设父卡片：等父卡片完成/归档后才会自动派发',
          'd.stopNote': '停止运行会把任务移回「待细化」，避免被自动派发立即重跑',
          'd.runningRepeat': '重复任务：本轮完成后自动回到「定时」列等待下一轮；失败则转「阻塞」。',
          'd.runningOnce': '已派发给 DSH 子代理执行，完成后自动流转为「完成」；失败则转「阻塞」。',
          'd.comments': '评论（{a}）', 'd.commentPh': '写评论…（运行期间新评论不会实时送达代理）', 'd.commentBtn': '发表评论',
          'd.events': '事件时间线（{a}）', 'd.confirmDel': '确认删除该任务？', 'd.confirmDelBtn': '确认删除',
          'd.deleteBtn': '删除任务', 'ui.cancel': '取消',
          'dlg.newTask': '新建任务', 'dlg.titleRequired': '请填写标题', 'dlg.initialColumn': '初始列',
          'dlg.create': '创建', 'dlg.newBoard': '新建看板', 'dlg.boardNameRequired': '请填写看板名称',
          'dlg.boardNamePh': '看板名称',
          'err.unknown': '未知错误', 'err.http': 'HTTP {a}',
          'board.partialMoveFail': '部分任务移动失败：{a}',
          'board.loadFail': '看板数据加载失败：{a}（若持续出现，请重启 DSH 服务后刷新页面）',
          'board.retry': '重试', 'board.loading': '加载中…', 'board.errorSuffix': '{a}（请检查插件与存储）',
          'board.newBoardBtn': '新建看板', 'board.confirmDelBoard': '确认删除当前看板', 'board.delBoard': '删板',
          'board.showArchived': '显示已归档列', 'board.newTaskBtn': '＋ 新任务',
          'board.refreshTitle': '强制重读磁盘数据', 'board.refreshBtn': '刷新',
          'board.empty': '还没有看板。点击「新建看板」创建第一个看板。',
          'toast.done': '看板任务「{a}」已完成', 'toast.blocked': '看板任务「{a}」已阻塞',
        },
        en: {
          'tab': 'Kanban',
          'status.triage': 'Triage', 'status.todo': 'Todo', 'status.scheduled': 'Scheduled', 'status.ready': 'Ready',
          'status.running': 'Running', 'status.blocked': 'Blocked', 'status.review': 'Review', 'status.done': 'Done', 'status.archived': 'Archived',
          'time.justNow': 'just now', 'time.minutes': '{a} min', 'time.hours': '{a} hr', 'time.days': '{a} d',
          'time.daysHours': '{a} d {b} hr', 'time.hoursMinutes': '{a} hr {b} min',
          'time.expired': 'due', 'time.remain': '{a} left',
          'sched.interval': 'repeats every {a}', 'sched.daily': 'daily at {a}',
          'sched.parent': 'parent {a}', 'sched.waitParent': 'waiting for parent',
          'ui.filter': 'Filter', 'ui.search': 'Search title/body/ID…', 'ui.noMatch': 'No matching tasks',
          'ui.newTaskHere': 'New task in this column', 'ui.newTask': '＋ New task',
          'ui.model': 'Model: {a}', 'ui.repeat': 'Repeating task: returns to the scheduled column after this round',
          'ui.priority': 'Priority {a}', 'ui.commentCount': 'Comments {a}', 'ui.running': 'Running',
          'ui.selected': '{a} selected', 'ui.move': 'Move', 'ui.delete': 'Delete', 'ui.clearSel': 'Clear selection',
          'ev.created': 'Task created ({a})', 'ev.edited': 'Edited fields: {a}',
          'ev.movedParent': 'Parent completed → auto-activated: {a} → {b}',
          'ev.movedInterval': 'Interval due → auto-activated: {a} → {b}',
          'ev.movedDaily': 'Daily due → auto-activated: {a} → {b}',
          'ev.movedSchedule': 'Round done → back to scheduled: {a} → {b}',
          'ev.movedTimer': 'Legacy timer fired: {a} → {b}',
          'ev.moved': 'Moved: {a} → {b}', 'ev.commented': 'Comment added',
          'ev.dispatched': 'Dispatched (provider: {a})', 'ev.completed': 'Run completed',
          'ev.terminated': 'Run terminated manually', 'ev.blocked': 'Blocked: {a}',
          'd.close': 'Close', 'd.title': 'Title', 'd.status': 'Status', 'd.model': 'Subagent model',
          'd.defaultModel': 'Default model (follows session)', 'd.priority': 'Priority (0-9, higher first)', 'd.desc': 'Description',
          'd.schedule': 'Schedule (auto-activation while parked)', 'd.scheduleNone': 'None (parked only, no auto-activation)',
          'd.scheduleInterval': 'Repeating interval (every N min)', 'd.scheduleDaily': 'Daily at a fixed time',
          'd.interval': 'Interval (minutes, 1-10080, max 7 days)', 'd.dailyTime': 'Daily time',
          'd.parent': 'Parent card (optional: activates when the parent completes; none = never)', 'd.parentNone': 'None (no parent card)',
          'd.currentSchedule': 'Current schedule', 'd.parentCard': 'Parent card: {a} ({b})', 'd.parentDeleted': 'Deleted (treated as completed)',
          'd.nextActivation': 'Next activation: {a} {b}', 'd.saving': 'Saving…', 'd.run': 'Run',
          'd.providerRun': 'Provider: {a} Run: {b}', 'd.started': 'Started: {a}', 'd.ended': ' Ended: {a}',
          'd.lastActive': 'Last activity: {a}', 'd.resultDone': 'Result: completed', 'd.resultError': 'Result: failed',
          'd.resultTerminated': 'Result: terminated', 'd.error': 'Error: {a}', 'd.neverRun': 'Never run',
          'd.progress': 'Live progress (last {a} lines)', 'd.stopBtn': '■ Stop run',
          'd.autoHint': 'This card is in a todo/ready column: the board auto-dispatches it to a DSH agent (within ~10s).',
          'd.autoHintParent': 'Parent card set: it auto-dispatches after the parent completes or is archived.',
          'd.stopNote': 'Stopping the run moves the task back to triage so auto-dispatch does not rerun it immediately.',
          'd.runningRepeat': 'Repeating task: returns to the scheduled column after this round; failures turn blocked.',
          'd.runningOnce': 'Dispatched to a DSH subagent; it turns done when finished, blocked on failure.',
          'd.comments': 'Comments ({a})', 'd.commentPh': 'Write a comment… (new comments are not delivered live while running)', 'd.commentBtn': 'Post comment',
          'd.events': 'Event timeline ({a})', 'd.confirmDel': 'Delete this task?', 'd.confirmDelBtn': 'Confirm delete',
          'd.deleteBtn': 'Delete task', 'ui.cancel': 'Cancel',
          'dlg.newTask': 'New task', 'dlg.titleRequired': 'Please enter a title', 'dlg.initialColumn': 'Initial column',
          'dlg.create': 'Create', 'dlg.newBoard': 'New board', 'dlg.boardNameRequired': 'Please enter a board name',
          'dlg.boardNamePh': 'Board name',
          'err.unknown': 'Unknown error', 'err.http': 'HTTP {a}',
          'board.partialMoveFail': 'Some tasks failed to move: {a}',
          'board.loadFail': 'Failed to load kanban data: {a} (if this persists, restart DSH and refresh the page)',
          'board.retry': 'Retry', 'board.loading': 'Loading…', 'board.errorSuffix': '{a} (check the plugin and storage)',
          'board.newBoardBtn': 'New board', 'board.confirmDelBoard': 'Confirm delete current board', 'board.delBoard': 'Delete board',
          'board.showArchived': 'Show archived column', 'board.newTaskBtn': '＋ New task',
          'board.refreshTitle': 'Force reload from disk', 'board.refreshBtn': 'Refresh',
          'board.empty': 'No boards yet. Click "New board" to create the first one.',
          'toast.done': 'Kanban task "{a}" completed', 'toast.blocked': 'Kanban task "{a}" blocked',
        },
      }
      const locale = ctx.get('locale')
      const navLang = (typeof navigator !== 'undefined' && navigator.language && String(navigator.language).slice(0, 2).toLowerCase() === 'en') ? 'en' : 'zh'
      const t = (locale && typeof locale.bind === 'function')
        ? locale.bind('kanban')
        : (key, params) => {
            const dict = LOCALE_DICT[navLang] || LOCALE_DICT.zh
            const raw = (dict && dict[key] !== undefined) ? dict[key] : key
            if (!params) return raw
            return String(raw).replace(/\{([a-z])\}/g, (m, k) => (params[k] === undefined ? m : String(params[k])))
          }
      const uiLang = () => (locale && typeof locale.getLocale === 'function' && locale.getLocale().active === 'en' ? 'en' : 'zh')

      const CSS = [
        '.kbn-view { flex:1; display:flex; flex-direction:column; min-height:0; height:100%; background:var(--dsw-alias-bg-base); }',
        '.kbn-body { flex:1; display:flex; flex-direction:column; min-height:0; position:relative; }',
        '.kbn-toolbar { display:flex; align-items:center; gap:8px; padding:8px 12px; border-bottom:1px solid var(--dsw-alias-border-l1); flex:0 0 auto; flex-wrap:wrap; }',
        '.kbn-error { background:rgba(248,113,113,.12); color:var(--dsw-alias-state-error-primary); padding:6px 12px; font-size:12px; }',
        '.kbn-cols { flex:1; display:flex; gap:8px; padding:12px; overflow-x:auto; overflow-y:hidden; align-items:stretch; }',
        '.kbn-lane { flex:0 0 250px; display:flex; flex-direction:column; background:var(--dsw-alias-bg-layer-1); border:1px solid var(--dsw-alias-border-l1); border-radius:8px; min-height:0; }',
        '.kbn-lane-over { border-color:var(--dsw-alias-brand-primary); background:var(--dsw-alias-bg-layer-2); }',
        '.kbn-lane-head { display:flex; align-items:center; gap:6px; padding:8px 10px; cursor:pointer; flex:0 0 auto; }',
        '.kbn-lane-dot { width:8.5px; height:8.5px; border-left:2px solid currentColor; border-bottom:2px solid currentColor; border-radius:2px; transform:rotate(45deg); flex:0 0 auto; margin:1.5px 2px; box-sizing:border-box; }',
        '.kbn-lane-label { font-weight:600; font-size:14px; }',
        '.kbn-lane-count { background:var(--dsw-alias-bg-layer-2); border-radius:8px; padding:0 6px; font-size:11px; color:var(--dsw-alias-label-secondary); }',
        '.kbn-lane-head-spacer { flex:1; }',
        '.kbn-lane-head .kbn-icon-btn { font-size:16px; padding:2px 8px; }',
        '.kbn-lane-body { flex:1; overflow-y:auto; padding:0 8px 8px; display:flex; flex-direction:column; gap:6px; min-height:30px; }',
        '.kbn-lane-empty { color:var(--dsw-alias-label-secondary); font-size:11px; text-align:center; padding:14px 0; }',
        '.kbn-lane-rail { flex:0 0 40px; align-self:stretch; display:flex; flex-direction:column; align-items:center; background:var(--dsw-alias-bg-layer-1); border:1px solid var(--dsw-alias-border-l1); border-radius:8px; cursor:pointer; }',
        '.kbn-lane-rail-bar { width:4px; height:12px; border-radius:2px; margin-top:8px; flex:0 0 auto; }',
        '.kbn-lane-rail-label { writing-mode:vertical-rl; font-weight:600; font-size:12.5px; color:var(--dsw-alias-label-primary); margin-top:10px; flex:0 0 auto; }',
        '.kbn-lane-rail-count { margin-top:6px; font-size:11px; color:var(--dsw-alias-label-secondary); font-weight:600; }',
        '.kbn-filter { margin:0 8px 8px; }',
        '.kbn-card { background:var(--dsw-alias-bg-base); border:1px solid var(--dsw-alias-border-l1); border-left:3px solid var(--dsw-alias-border-l2); border-radius:6px; padding:8px 9px; cursor:pointer; display:flex; flex-direction:column; gap:5px; }',
        '.kbn-card:hover { border-color:var(--dsw-alias-border-l2); }',
        '.kbn-card-sel { outline:2px solid var(--dsw-alias-brand-primary); }',
        '.kbn-card-drag { opacity:.45; }',
        '.kbn-card-running { box-shadow:0 0 0 1px #34d399 inset; }',
        '.kbn-card-new { background:transparent; border:1px dashed var(--dsw-alias-border-l2); border-radius:6px; padding:8px 9px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; color:var(--dsw-alias-label-secondary); font-size:12.5px; font-family:inherit; flex:0 0 auto; }',
        '.kbn-card-new:hover { border-color:var(--dsw-alias-brand-primary); color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-layer-2); }',
        '.kbn-card-title { font-weight:600; font-size:12.5px; line-height:1.35; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }',
        '.kbn-card-body { color:var(--dsw-alias-label-secondary); font-size:11.5px; line-height:1.4; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; white-space:pre-wrap; }',
        '.kbn-card-foot { display:flex; align-items:center; gap:5px; flex-wrap:wrap; }',
        '.kbn-chip { background:var(--dsw-alias-bg-layer-2); border-radius:8px; padding:1px 6px; font-size:10.5px; color:var(--dsw-alias-label-secondary); max-width:110px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }',
        '.kbn-run-chip { background:rgba(52,211,153,.15); color:#34d399; border-radius:8px; padding:1px 6px; font-size:10.5px; }',
        '.kbn-prio { border-radius:8px; padding:1px 6px; font-size:10.5px; font-weight:600; }',
        '.kbn-prio.p3 { background:rgba(248,113,113,.15); color:#f87171; }',
        '.kbn-prio.p2 { background:rgba(251,191,36,.15); color:#fbbf24; }',
        '.kbn-prio.p1 { background:rgba(96,165,250,.15); color:#60a5fa; }',
        '.kbn-prio.p0 { background:rgba(52,211,153,.15); color:#34d399; }',
        '.kbn-age { margin-left:auto; color:var(--dsw-alias-label-secondary); font-size:10.5px; }',
        '.kbn-bulkbar { display:flex; align-items:center; gap:8px; padding:8px 12px; background:var(--dsw-alias-bg-layer-1); border-bottom:1px solid var(--dsw-alias-border-l1); flex:0 0 auto; }',
        '.kbn-bulkbar-count { font-weight:600; font-size:12px; margin-right:4px; }',
        '.kbn-btn { border:1px solid var(--dsw-alias-border-l2); background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); border-radius:6px; padding:4px 10px; font-size:12px; cursor:pointer; }',
        '.kbn-btn:hover:not(:disabled) { background:var(--dsw-alias-bg-base); }',
        '.kbn-btn:disabled { opacity:.5; cursor:default; }',
        '.kbn-btn-run { background:rgba(96,165,250,.15); border-color:#60a5fa; color:#60a5fa; }',
        '.kbn-btn-stop { background:rgba(248,113,113,.15); border-color:#f87171; color:#f87171; }',
        '.kbn-btn-danger { background:rgba(248,113,113,.15); border-color:#f87171; color:#f87171; }',
        '.kbn-btn.on { border-color:var(--dsw-alias-brand-primary); color:var(--dsw-alias-brand-primary); }',
        '.kbn-icon-btn { border:none; background:transparent; color:var(--dsw-alias-label-secondary); cursor:pointer; border-radius:6px; padding:2px 7px; font-size:13px; line-height:1.4; }',
        '.kbn-icon-btn:hover { background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); }',
        '.kbn-input { background:var(--dsw-alias-bg-base); border:1px solid var(--dsw-alias-border-l1); color:var(--dsw-alias-label-primary); border-radius:6px; padding:5px 8px; font-size:12.5px; }',
        '.kbn-input:focus { outline:none; border-color:var(--dsw-alias-brand-primary); }',
        '.kbn-select { padding:5px 6px; }',
        '.kbn-textarea { width:100%; resize:vertical; box-sizing:border-box; font-family:inherit; }',
        '.kbn-drawer { position:absolute; top:0; right:0; bottom:0; width:400px; max-width:92%; background:var(--dsw-alias-bg-overlay); border-left:1px solid var(--dsw-alias-border-l2); display:flex; flex-direction:column; z-index:5; box-shadow:-12px 0 30px rgba(0,0,0,.25); }',
        '.kbn-drawer-scroll { flex:1; overflow-y:auto; padding:14px; display:flex; flex-direction:column; gap:12px; }',
        '.kbn-drawer-head { display:flex; align-items:center; gap:8px; padding:10px 14px; border-bottom:1px solid var(--dsw-alias-border-l1); }',
        '.kbn-drawer-title { font-weight:600; font-size:14px; flex:1; }',
        '.kbn-section-title { font-weight:600; font-size:12px; margin-bottom:8px; color:var(--dsw-alias-label-secondary); }',
        '.kbn-status-view { display:inline-flex; align-items:center; gap:6px; border:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); border-radius:12px; padding:3px 10px; font-size:12px; }',
        '.kbn-status-dot { width:8px; height:8px; border-radius:50%; background:var(--tone, var(--dsw-alias-border-l2)); }',
        '.kbn-field { display:flex; flex-direction:column; gap:5px; }',
        '.kbn-field-row { display:flex; gap:8px; align-items:center; }',
        '.kbn-field-label { font-size:13px; font-weight:600; color:var(--dsw-alias-label-primary); }',
        '.kbn-runbox { border:1px solid var(--dsw-alias-border-l1); border-radius:8px; padding:10px; display:flex; flex-direction:column; gap:8px; background:var(--dsw-alias-bg-layer-1); }',
        '.kbn-run-info { font-size:12px; color:var(--dsw-alias-label-secondary); display:flex; flex-direction:column; gap:4px; }',
        '.kbn-run-summary { color:var(--dsw-alias-label-primary); white-space:pre-wrap; font-size:12px; border-top:1px dashed var(--dsw-alias-border-l1); padding-top:6px; }',
        '.kbn-run-ok { color:var(--dsw-alias-state-success-primary); }',
        '.kbn-run-bad { color:var(--dsw-alias-state-error-primary); }',
        '.kbn-run-hint { font-size:11px; color:var(--dsw-alias-label-secondary); }',
        '.kbn-comments { display:flex; flex-direction:column; gap:8px; }',
        '.kbn-comment { border:1px solid var(--dsw-alias-border-l1); border-radius:6px; padding:7px 9px; background:var(--dsw-alias-bg-layer-1); }',
        '.kbn-comment-meta { font-size:10.5px; color:var(--dsw-alias-label-secondary); margin-bottom:3px; }',
        '.kbn-comment-body { font-size:12.5px; white-space:pre-wrap; }',
        '.kbn-comment-compose { display:flex; flex-direction:column; gap:6px; }',
        '.kbn-events { display:flex; flex-direction:column; gap:4px; }',
        '.kbn-event { display:flex; gap:8px; font-size:12px; }',
        '.kbn-event-meta { color:var(--dsw-alias-label-secondary); font-size:11px; flex:0 0 92px; }',
        '.kbn-event-body { flex:1; }',
        '.kbn-drawer-foot { padding:10px 14px; border-top:1px solid var(--dsw-alias-border-l1); display:flex; gap:8px; align-items:center; }',
        '.kbn-modal-mask { position:absolute; inset:0; background:rgba(0,0,0,.45); display:flex; align-items:center; justify-content:center; z-index:6; }',
        '.kbn-modal { background:var(--dsw-alias-bg-overlay); border:1px solid var(--dsw-alias-border-l2); border-radius:10px; padding:16px; width:440px; max-width:90%; display:flex; flex-direction:column; gap:10px; }',
        '.kbn-modal-title { font-weight:600; font-size:16px; }',
        '.kbn-modal-actions { display:flex; justify-content:flex-end; gap:8px; }',
        '.kbn-empty { padding:40px; text-align:center; color:var(--dsw-alias-label-secondary); }',
        '.kbn-overlay { position:fixed; top:12px; right:12px; display:flex; flex-direction:column; align-items:flex-end; gap:8px; pointer-events:none; z-index:1000; }',
        '.kbn-toast { pointer-events:auto; background:rgba(31,41,55,.96); border:1px solid #6ee7b7; border-radius:8px; padding:7px 12px; min-width:200px; max-width:340px; box-shadow:0 4px 16px rgba(0,0,0,.25); }',
        '.kbn-toast-bad { border-color:#fca5a5; }',
        '.kbn-toast-title { font-size:12.5px; font-weight:600; color:#f9fafb; }',
        '.kbn-toast-detail { font-size:11.5px; color:#d1d5db; margin-top:3px; }',
      ].join('\n')

      const STATUSES = [
        { id: 'triage', tone: 'var(--dsw-alias-label-secondary)' },
        { id: 'todo', tone: 'var(--dsw-alias-label-secondary)' },
        { id: 'scheduled', tone: '#a78bfa' },
        { id: 'ready', tone: '#60a5fa' },
        { id: 'running', tone: '#34d399' },
        { id: 'blocked', tone: '#f87171' },
        { id: 'review', tone: '#fbbf24' },
        { id: 'done', tone: 'var(--dsw-alias-state-success-primary)' },
        { id: 'archived', tone: 'var(--dsw-alias-label-secondary)' },
      ]
      const statusOf = (id) => {
        for (const s of STATUSES) if (s.id === id) return { id: s.id, label: t('status.' + s.id), tone: s.tone }
        return { id, label: id, tone: 'var(--dsw-alias-label-secondary)' }
      }
      const prioTier = (p) => (p >= 7 ? 'p3' : p >= 4 ? 'p2' : p >= 1 ? 'p1' : 'p0')
      const clampNum = (v, min, max) => {
        const n = Math.floor(Number(v))
        if (!Number.isFinite(n)) return min
        return Math.min(max, Math.max(min, n))
      }
      const cap = (s, n) => (typeof s === 'string' && s.length > n ? s.slice(0, n) : s)
      const fmtAge = (ts) => {
        if (!ts) return ''
        const d = Date.now() - ts
        const m = Math.floor(d / 60000)
        if (m < 1) return t('time.justNow')
        if (m < 60) return t('time.minutes', { a: m })
        const hr = Math.floor(m / 60)
        if (hr < 24) return t('time.hours', { a: hr })
        return t('time.days', { a: Math.floor(hr / 24) })
      }
      const fmtTime = (ts) => {
        if (!ts) return ''
        const d = new Date(ts)
        const p = (n) => String(n).padStart(2, '0')
        return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
      }
      const shortId = (id) => String(id || '').replace(/^t_/, '').slice(0, 6)
      const toHM = (dm) => {
        const hh = Math.floor(dm / 60)
        const mm = dm % 60
        return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0')
      }
      const fmtMinutes = (m) => {
        if (!m) return ''
        if (m >= 1440) {
          const d = Math.floor(m / 1440)
          const h = Math.round((m % 1440) / 60)
          return h > 0 ? t('time.daysHours', { a: d, b: h }) : t('time.days', { a: d })
        }
        if (m >= 60) {
          const h = Math.floor(m / 60)
          const mm = m % 60
          return mm > 0 ? t('time.hoursMinutes', { a: h, b: mm }) : t('time.hours', { a: h })
        }
        return t('time.minutes', { a: m })
      }
      const fmtRemain = (ts) => {
        if (!ts) return ''
        const ms = ts - Date.now()
        if (ms <= 0) return t('time.expired')
        return t('time.remain', { a: fmtMinutes(Math.floor(ms / 60000)) })
      }
      const fmtAbs = (ts) => {
        if (!ts) return ''
        const d = new Date(ts)
        const p = (n) => String(n).padStart(2, '0')
        return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
      }
      const scheduleKindLabel = (s) => {
        if (!s) return ''
        if (s.kind === 'interval') return t('sched.interval', { a: fmtMinutes(s.intervalMinutes) })
        if (s.kind === 'daily') return t('sched.daily', { a: toHM(s.dailyMinutes) })
        return ''
      }
      const scheduleChip = (s) => {
        // 定时列卡片：方式 + 父卡片 + 「还剩xx · 绝对时间」
        if (!s) return ''
        const parts = []
        const kl = scheduleKindLabel(s)
        if (kl) parts.push(kl)
        if (s.parentId) parts.push(t('sched.parent', { a: shortId(s.parentId) }))
        if (typeof s.nextAt === 'number') parts.push(fmtRemain(s.nextAt) + ' · ' + fmtAbs(s.nextAt))
        if (parts.length === 0 && !s.kind && s.parentId) parts.push(t('sched.waitParent'))
        return parts.join('　')
      }
      const defaultSchedule = (lane) => (lane === 'scheduled'
        ? { kind: 'interval', intervalMinutes: 60, dailyTime: '09:00', parentId: '' }
        : { kind: 'none', intervalMinutes: 60, dailyTime: '09:00', parentId: '' })
      const schedFromTask = (task) => {
        const s = task.schedule
        if (!s) return { kind: 'none', intervalMinutes: 60, dailyTime: '09:00', parentId: '' }
        return {
          kind: s.kind || 'none',
          intervalMinutes: typeof s.intervalMinutes === 'number' ? s.intervalMinutes : 60,
          dailyTime: typeof s.dailyMinutes === 'number' ? toHM(s.dailyMinutes) : '09:00',
          parentId: s.parentId || '',
        }
      }
      const schedulePayload = (sched) => {
        // 修复：只设父卡片（无 interval/daily）也必须保存——父卡片是全局门禁，任何列生效
        const kind = sched.kind === 'interval' || sched.kind === 'daily' ? sched.kind : null
        const parentId = sched.parentId ? sched.parentId : null
        if (!kind && !parentId) return null
        return {
          kind,
          intervalMinutes: kind === 'interval' ? Math.max(1, Math.min(10080, Math.round(Number(sched.intervalMinutes) || 60))) : undefined,
          dailyTime: kind === 'daily' ? sched.dailyTime : undefined,
          parentId,
        }
      }

      function call(method, args) {
        return fetch('/kanban/rpc', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ method, args: args || {}, lang: uiLang() }),
        }).then(res => {
          if (!res.ok) throw new Error(t('err.http', { a: res.status }))
          return res.json()
        }).then(res => {
          if (res && res.ok === true) return res.data
          throw new Error((res && res.error) || t('err.unknown'))
        })
      }

      // —— WebSocket 实时推送 channel：apply 闭包内单连接共享 ——
      // BoardContent 与 KanbanOverlay 订阅同一连接；断线指数退避重连（1s 起，15s 上限），
      // 断开期间调用方用 wsIsOpen() 判断并退回 5s 轮询。Host 无 /kanban/events 时同样回落。
      const wsSubs = new Set()
      let wsSocket = null
      let wsRetry = 0
      let wsTimer = null

      function wsUrl() {
        const proto = (typeof location !== 'undefined' && location.protocol === 'https:') ? 'wss://' : 'ws://'
        return proto + location.host + '/kanban/events'
      }
      function wsEmit(data) {
        for (const fn of Array.from(wsSubs)) {
          try { fn(data) } catch (err) {}
        }
      }
      function wsScheduleRetry() {
        if (wsTimer) return
        const delay = Math.min(15000, 1000 * Math.pow(2, wsRetry))
        wsRetry++
        wsTimer = setTimeout(() => {
          wsTimer = null
          wsConnect()
        }, delay)
      }
      function wsConnect() {
        if (wsSocket || typeof WebSocket === 'undefined') return
        let socket
        try { socket = new WebSocket(wsUrl()) } catch (err) {
          wsScheduleRetry()
          return
        }
        wsSocket = socket
        socket.onopen = () => {
          wsRetry = 0
          call('getStore').then(wsEmit).catch(() => {})
        }
        socket.onmessage = (ev) => {
          if (typeof ev.data !== 'string') return
          try {
            const msg = JSON.parse(ev.data)
            if (msg && msg.type === 'snapshot' && Array.isArray(msg.boards)) wsEmit({ boards: msg.boards, now: msg.now })
          } catch (err) {}
        }
        socket.onclose = () => {
          if (wsSocket === socket) wsSocket = null
          wsScheduleRetry()
        }
        socket.onerror = () => {}
      }
      function wsSubscribe(fn) {
        wsSubs.add(fn)
        wsConnect()
        return () => {
          wsSubs.delete(fn)
          if (wsSubs.size === 0) {
            if (wsTimer) { clearTimeout(wsTimer); wsTimer = null }
            const s = wsSocket
            wsSocket = null
            if (s) {
              s.onopen = null
              s.onmessage = null
              s.onclose = null
              s.onerror = null
              try { s.close() } catch (err) {}
            }
          }
        }
      }
      const wsIsOpen = () => Boolean(wsSocket && wsSocket.readyState === 1)

      function Lane(props) {
        const [over, setOver] = React.useState(false)
        const meta = statusOf(props.lane.id)
        const head = h('div', { className: 'kbn-lane-head', onClick: () => props.onToggleCollapse(props.lane.id) },
          h('span', { className: 'kbn-lane-dot', style: { borderColor: meta.tone } }),
          h('span', { className: 'kbn-lane-label' }, meta.label),
          h('span', { className: 'kbn-lane-count' }, props.laneTasks.length),
          h('span', { className: 'kbn-lane-head-spacer' }),
          h('button', { className: 'kbn-icon-btn', title: t('ui.filter'), onClick: e => { e.stopPropagation(); props.onToggleFilter(props.lane.id) } }, '⌕'),
        )
        if (props.isCollapsed) {
          return h('div', { className: 'kbn-lane-rail', onClick: () => props.onToggleCollapse(props.lane.id) },
            h('div', { className: 'kbn-lane-rail-bar', style: { background: meta.tone } }),
            h('span', { className: 'kbn-lane-rail-label' }, meta.label),
            h('span', { className: 'kbn-lane-rail-count' }, props.laneTasks.length),
          )
        }
        return h('div', {
          className: 'kbn-lane' + (over ? ' kbn-lane-over' : ''),
          onDragOver: e => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            if (!over) setOver(true)
          },
          onDragLeave: () => setOver(false),
          onDrop: e => {
            e.preventDefault()
            setOver(false)
            const id = e.dataTransfer.getData('text/plain')
            if (id) props.onDropTask(id, props.lane.id)
          },
        },
          head,
          props.filterOpen ? h('input', {
            className: 'kbn-input kbn-filter',
            placeholder: t('ui.search'),
            value: props.filterText,
            onChange: e => props.onFilterChange(props.lane.id, e.target.value),
          }) : null,
          h('div', { className: 'kbn-lane-body' },
            props.shown.length === 0 && props.filterText.trim().length > 0 ? h('div', { className: 'kbn-lane-empty' }, t('ui.noMatch')) : null,
            props.shown.map(t => h(Card, {
              key: t.id,
              task: t,
              selected: Boolean(props.selectedIds[t.id]),
              onOpen: props.onOpenTask,
              onToggleSelect: props.onToggleSelect,
            })),
            h('button', { className: 'kbn-card-new', title: t('ui.newTaskHere'), onClick: () => props.onNewTask(props.lane.id) }, t('ui.newTask')),
          ),
        )
      }

      function Card(props) {
        const [dragging, setDragging] = React.useState(false)
        const task = props.task
        const meta = statusOf(task.status)
        return h('div', {
          className: 'kbn-card'
            + (props.selected ? ' kbn-card-sel' : '')
            + (dragging ? ' kbn-card-drag' : '')
            + (task.status === 'running' ? ' kbn-card-running' : ''),
          style: { borderLeftColor: meta.tone },
          draggable: true,
          onClick: e => {
            if (e.ctrlKey || e.metaKey) {
              e.stopPropagation()
              props.onToggleSelect(task.id)
            } else {
              props.onOpen(task.id)
            }
          },
          onDragStart: e => {
            e.dataTransfer.setData('text/plain', task.id)
            e.dataTransfer.effectAllowed = 'move'
            setDragging(true)
          },
          onDragEnd: () => setDragging(false),
        },
          h('div', { className: 'kbn-card-title' }, task.title),
          task.body ? h('div', { className: 'kbn-card-body' }, cap(task.body, 160)) : null,
          h('div', { className: 'kbn-card-foot' },
            task.assignee ? h('span', { className: 'kbn-chip', title: t('ui.model', { a: task.assignee }) }, task.assignee) : null,
            task.status === 'scheduled' && task.schedule ? h('span', { className: 'kbn-chip', title: scheduleChip(task.schedule) }, scheduleChip(task.schedule)) : null,
            task.status !== 'scheduled' && task.schedule && task.schedule.kind ? h('span', { className: 'kbn-chip', title: t('ui.repeat') }, scheduleKindLabel(task.schedule)) : null,
            h('span', { className: 'kbn-prio ' + prioTier(task.priority), title: t('ui.priority', { a: task.priority }) }, String(task.priority)),
            task.comments && task.comments.length > 0 ? h('span', { className: 'kbn-chip' }, t('ui.commentCount', { a: task.comments.length })) : null,
            task.status === 'running' ? h('span', { className: 'kbn-run-chip' }, t('ui.running')) : null,
            h('span', { className: 'kbn-age' }, fmtAge(task.created_at)),
          ),
        )
      }

      function BulkBar(props) {
        const [status, setStatus] = React.useState('ready')
        const count = Object.keys(props.selected).length
        return h('div', { className: 'kbn-bulkbar' },
          h('span', { className: 'kbn-bulkbar-count' }, t('ui.selected', { a: count })),
          h('button', { className: 'kbn-btn', onClick: () => props.onMove('ready') }, statusOf('ready').label),
          h('button', { className: 'kbn-btn', onClick: () => props.onMove('done') }, statusOf('done').label),
          h('select', { className: 'kbn-input kbn-select', value: status, onChange: e => setStatus(e.target.value) },
            STATUSES.filter(s => s.id !== 'running').map(s => h('option', { key: s.id, value: s.id }, statusOf(s.id).label)),
          ),
          h('button', { className: 'kbn-btn', onClick: () => props.onMove(status) }, t('ui.move')),
          h('button', { className: 'kbn-btn kbn-btn-danger', onClick: () => props.onDelete() }, t('ui.delete')),
          h('button', { className: 'kbn-btn', onClick: () => props.onClear() }, t('ui.clearSel')),
        )
      }

      function eventText(ev) {
        const p = ev.payload || {}
        if (ev.kind === 'created') return t('ev.created', { a: (p.status || '') })
        if (ev.kind === 'edited') return t('ev.edited', { a: (p.fields ? p.fields.join('、') : '') })
        if (ev.kind === 'moved') {
          const by = p.by
          const from = p.from || '?'
          const to = p.to || '?'
          if (by === 'parent') return t('ev.movedParent', { a: from, b: to })
          if (by === 'interval') return t('ev.movedInterval', { a: from, b: to })
          if (by === 'daily') return t('ev.movedDaily', { a: from, b: to })
          if (by === 'schedule') return t('ev.movedSchedule', { a: from, b: to })
          if (by === 'timer') return t('ev.movedTimer', { a: from, b: to })
          return t('ev.moved', { a: from, b: to })
        }
        if (ev.kind === 'commented') return t('ev.commented')
        if (ev.kind === 'dispatched') return t('ev.dispatched', { a: (p.provider || '?') })
        if (ev.kind === 'completed') return t('ev.completed')
        if (ev.kind === 'terminated') return t('ev.terminated')
        if (ev.kind === 'blocked') return t('ev.blocked', { a: (p.reason || '') })
        return ev.kind
      }

      function Drawer(props) {
        const task = props.task
        const [title, setTitle] = React.useState(task.title || '')
        const [body, setBody] = React.useState(task.body || '')
        const [assignee, setAssignee] = React.useState(task.assignee || '')
        const [modelOptions, setModelOptions] = React.useState([])
        const [priority, setPriority] = React.useState(task.priority || 0)
        const [sched, setSched] = React.useState(schedFromTask(task))
        const [comment, setComment] = React.useState('')
        const [err, setErr] = React.useState(null)
        const [busy, setBusy] = React.useState(false)
        const [saving, setSaving] = React.useState(false)
        const [confirmDel, setConfirmDel] = React.useState(false)
        const meta = statusOf(task.status)

        React.useEffect(() => {
          call('listModels').then(data => {
            const list = (data && data.models) || []
            setModelOptions(list.map(String))
          }).catch(() => {})
        }, [])

        // 实时保存：字段变化 600ms 防抖后自动 patchTask，不再有「保存」按钮。
        // 服务端字段变化时同步本地编辑态（外部修改/其他标签页/Agent 工具）；自动保存自己的
        // 成功回显（与 lastSent 字段一致）不回灌，避免覆盖正在进行的输入。
        const serverSigRef = React.useRef(JSON.stringify({
          title: task.title, body: task.body, assignee: task.assignee,
          priority: task.priority, schedule: task.schedule,
        }))
        const lastSentRef = React.useRef(null)      // 最近一次成功提交的 patch；无变化时不提交
        const baselineRef = React.useRef(false)     // 首轮只做基线不提交（避免打开抽屉就写 edited 事件）
        const saveTimerRef = React.useRef(null)     // 防抖定时器；关闭抽屉时 flush
        const skipNextSaveRef = React.useRef(false) // 服务端回灌引发的状态变化不再保存
        const editRef = React.useRef({ title, body, assignee, priority, sched })
        editRef.current = { title, body, assignee, priority, sched }

        function buildPatch(cur) {
          return {
            title: String(cur.title || '').trim(),
            body: cur.body || '',
            assignee: cur.assignee || '',
            priority: cur.priority,
            schedule: schedulePayload(cur.sched),
          }
        }
        function doSave() {
          const patch = buildPatch(editRef.current)
          if (JSON.stringify(patch) === JSON.stringify(lastSentRef.current)) { setSaving(false); return }
          lastSentRef.current = patch
          call('patchTask', { slug: props.slug, id: task.id, patch })
            .then(() => { setErr(null); setSaving(false) })
            .catch(e => {
              lastSentRef.current = null // 提交失败：下次编辑重试
              setErr(String((e && e.message) || e))
              setSaving(false)
            })
        }
        function flushSave() {
          if (saveTimerRef.current) {
            clearTimeout(saveTimerRef.current)
            saveTimerRef.current = null
            doSave()
          }
        }
        React.useEffect(() => {
          if (!baselineRef.current) {
            // 挂载即建立基线（初始字段不提交）；之后的任何变化正常防抖保存
            baselineRef.current = true
            lastSentRef.current = buildPatch(editRef.current)
            return
          }
          if (skipNextSaveRef.current) { skipNextSaveRef.current = false; return }
          setSaving(true)
          saveTimerRef.current = setTimeout(() => {
            saveTimerRef.current = null
            doSave()
          }, 600)
          return () => {
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
            saveTimerRef.current = null
          }
        }, [title, body, assignee, priority, sched])
        React.useEffect(() => {
          const sig = JSON.stringify({
            title: task.title, body: task.body, assignee: task.assignee,
            priority: task.priority, schedule: task.schedule,
          })
          if (sig === serverSigRef.current) return
          serverSigRef.current = sig
          const sent = lastSentRef.current
          if (sent && sent.title === task.title && sent.body === (task.body || '') && (sent.assignee || null) === (task.assignee || null) && sent.priority === task.priority) {
            return // 自己保存的成功回显：不回灌（schedule 回灌由保存自身收敛）
          }
          skipNextSaveRef.current = true
          setTitle(task.title || '')
          setBody(task.body || '')
          setAssignee(task.assignee || '')
          setPriority(task.priority || 0)
          setSched(schedFromTask(task))
        }, [task])

        function act(fn) {
          setBusy(true)
          setErr(null)
          fn().then(() => { setBusy(false); props.onChanged() })
            .catch(e => { setBusy(false); setErr(String((e && e.message) || e)) })
        }

        return h('div', { className: 'kbn-drawer' },
          h('div', { className: 'kbn-drawer-head' },
            h('span', { className: 'kbn-lane-rail-bar', style: { background: meta.tone, marginTop: 0 } }),
            h('span', { className: 'kbn-drawer-title' }, meta.label + ' · ' + task.id),
            task.status === 'running' ? h('button', {
              className: 'kbn-btn kbn-btn-stop',
              disabled: busy,
              onClick: () => act(() => call('terminate', { slug: props.slug, id: task.id })),
            }, t('d.stopBtn')) : null,
            h('button', { className: 'kbn-icon-btn', title: t('d.close'), onClick: () => { flushSave(); props.onClose() } }, '✕'),
          ),
          h('div', { className: 'kbn-drawer-scroll' },
            err ? h('div', { className: 'kbn-error' }, err) : null,
            h('div', { className: 'kbn-field' },
              h('span', { className: 'kbn-field-label' }, t('d.title')),
              h('input', { className: 'kbn-input', value: title, onChange: e => setTitle(e.target.value) }),
            ),
            h('div', { className: 'kbn-field' },
              h('span', { className: 'kbn-field-label' }, t('d.status')),
              h('div', { className: 'kbn-status-view', style: { '--tone': meta.tone } },
                h('span', { className: 'kbn-status-dot' }),
                meta.label,
              ),
            ),
            h('div', { className: 'kbn-field-row' },
              h('div', { className: 'kbn-field', style: { flex: 1 } },
                h('span', { className: 'kbn-field-label' }, t('d.model')),
                h('select', { className: 'kbn-input kbn-select', value: assignee, onChange: e => setAssignee(e.target.value) },
                  h('option', { value: '' }, t('d.defaultModel')),
                  assignee && modelOptions.indexOf(assignee) < 0 ? h('option', { value: assignee }, assignee) : null,
                  modelOptions.map(m => h('option', { key: m, value: m }, m)),
                ),
              ),
              h('div', { className: 'kbn-field' },
                h('span', { className: 'kbn-field-label' }, t('d.priority')),
                h('input', { className: 'kbn-input', type: 'number', min: 0, max: 9, value: String(priority), onChange: e => setPriority(clampNum(e.target.value, 0, 9)) }),
              ),
            ),
            h('div', { className: 'kbn-field' },
              h('span', { className: 'kbn-field-label' }, t('d.desc')),
              h('textarea', { className: 'kbn-input kbn-textarea', rows: 6, value: body, onChange: e => setBody(e.target.value) }),
            ),
            h('div', { className: 'kbn-field' },
              h('span', { className: 'kbn-field-label' }, t('d.schedule')),
              h('select', { className: 'kbn-input kbn-select', value: sched.kind, onChange: e => setSched({ ...sched, kind: e.target.value }) },
                h('option', { value: 'none' }, t('d.scheduleNone')),
                h('option', { value: 'interval' }, t('d.scheduleInterval')),
                h('option', { value: 'daily' }, t('d.scheduleDaily')),
              ),
            ),
            sched.kind === 'interval' ? h('div', { className: 'kbn-field' },
              h('span', { className: 'kbn-field-label' }, t('d.interval')),
              h('input', { className: 'kbn-input', type: 'number', min: 1, max: 10080, value: String(sched.intervalMinutes), onChange: e => setSched({ ...sched, intervalMinutes: e.target.value }) }),
            ) : null,
            sched.kind === 'daily' ? h('div', { className: 'kbn-field' },
              h('span', { className: 'kbn-field-label' }, t('d.dailyTime')),
              h('input', { className: 'kbn-input', type: 'time', value: sched.dailyTime, onChange: e => setSched({ ...sched, dailyTime: e.target.value }) }),
            ) : null,
            h('div', { className: 'kbn-field' },
              h('span', { className: 'kbn-field-label' }, t('d.parent')),
              h('select', { className: 'kbn-input kbn-select', value: sched.parentId, onChange: e => setSched({ ...sched, parentId: e.target.value }) },
                h('option', { value: '' }, t('d.parentNone')),
                (props.tasks || []).filter(x => x.id !== task.id).map(x => h('option', { key: x.id, value: x.id }, x.title + '（' + statusOf(x.status).label + '）')),
              ),
            ),
            task.schedule && (task.schedule.kind || task.schedule.parentId) ? h('div', { className: 'kbn-field' },
              h('span', { className: 'kbn-field-label' }, t('d.currentSchedule')),
              h('div', { className: 'kbn-run-info' },
                scheduleKindLabel(task.schedule) || t('sched.waitParent'),
                task.schedule.parentId ? h('div', null, t('d.parentCard', { a: shortId(task.schedule.parentId), b: (() => {
                  const p = (props.tasks || []).find(x => x.id === task.schedule.parentId)
                  return p ? statusOf(p.status).label : t('d.parentDeleted')
                })() })) : null,
                typeof task.schedule.nextAt === 'number' ? h('div', null, t('d.nextActivation', { a: fmtRemain(task.schedule.nextAt), b: fmtAbs(task.schedule.nextAt) })) : null,
              ),
            ) : null,
            saving ? h('div', { className: 'kbn-run-hint' }, t('d.saving')) : null,
            h('div', { className: 'kbn-runbox' },
              h('div', { className: 'kbn-section-title', style: { marginBottom: 0 } }, t('d.run')),
              task.run ? h('div', { className: 'kbn-run-info' },
                h('div', null, t('d.providerRun', { a: (task.run.provider || '?'), b: (task.run.runId || '?') })),
                h('div', null, t('d.started', { a: fmtTime(task.run.started_at) }) + (task.run.ended_at ? t('d.ended', { a: fmtTime(task.run.ended_at) }) : '')),
                task.run.heartbeat_at ? h('div', null, t('d.lastActive', { a: fmtTime(task.run.heartbeat_at) })) : null,
                task.run.outcome === 'done' ? h('div', { className: 'kbn-run-ok' }, t('d.resultDone')) : null,
                task.run.outcome === 'error' ? h('div', { className: 'kbn-run-bad' }, t('d.resultError')) : null,
                task.run.outcome === 'terminated' ? h('div', null, t('d.resultTerminated')) : null,
                task.run.summary ? h('div', { className: 'kbn-run-summary' }, task.run.summary) : null,
                task.run.error ? h('div', { className: 'kbn-run-bad' }, t('d.error', { a: task.run.error })) : null,
              ) : h('div', { className: 'kbn-run-info' }, t('d.neverRun')),
              task.run && Array.isArray(task.run.progress) && task.run.progress.length > 0 ? h('div', null,
                h('div', { className: 'kbn-section-title', style: { marginBottom: 4 } }, t('d.progress', { a: task.run.progress.length })),
                h('div', { className: 'kbn-run-summary' }, task.run.progress.join('\n')),
              ) : null,
              (task.status === 'todo' || task.status === 'ready') ? h('div', { className: 'kbn-run-hint' },
                task.schedule && task.schedule.parentId ? t('d.autoHintParent') : t('d.autoHint')) : null,
              task.status === 'running' ? h('div', { className: 'kbn-run-hint' },
                task.schedule && task.schedule.kind
                  ? t('d.runningRepeat')
                  : t('d.runningOnce')) : null,
              task.status === 'running' ? h('div', { className: 'kbn-run-hint' }, t('d.stopNote')) : null,
            ),
            h('div', { className: 'kbn-comments' },
              h('div', { className: 'kbn-section-title' }, t('d.comments', { a: (task.comments || []).length })),
              (task.comments || []).map(c => h('div', { key: c.id, className: 'kbn-comment' },
                h('div', { className: 'kbn-comment-meta' }, (c.author || 'user') + ' · ' + fmtTime(c.created_at)),
                h('div', { className: 'kbn-comment-body' }, c.body),
              )),
              h('div', { className: 'kbn-comment-compose' },
                h('textarea', {
                  className: 'kbn-input kbn-textarea',
                  rows: 3,
                  placeholder: t('d.commentPh'),
                  value: comment,
                  onChange: e => setComment(e.target.value),
                }),
                h('button', {
                  className: 'kbn-btn',
                  disabled: busy || !comment.trim(),
                  onClick: () => {
                    const text = comment.trim()
                    if (!text) return
                    act(() => call('addComment', { slug: props.slug, id: task.id, body: text }).then(() => setComment('')))
                  },
                }, t('d.commentBtn')),
              ),
            ),
            h('div', { className: 'kbn-events' },
              h('div', { className: 'kbn-section-title' }, t('d.events', { a: (task.events || []).length })),
              (task.events || []).slice().reverse().map(ev => h('div', { key: ev.id, className: 'kbn-event' },
                h('span', { className: 'kbn-event-meta' }, fmtTime(ev.created_at)),
                h('span', { className: 'kbn-event-body' }, eventText(ev)),
              )),
            ),
          ),
          h('div', { className: 'kbn-drawer-foot' },
            confirmDel ? h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-state-error-primary)' } }, t('d.confirmDel')) : null,
            confirmDel
              ? h('button', { className: 'kbn-btn kbn-btn-danger', disabled: busy, onClick: () => { act(() => call('deleteTask', { slug: props.slug, id: task.id }).then(() => props.onClose())); } }, t('d.confirmDelBtn'))
              : h('button', { className: 'kbn-btn kbn-btn-danger', onClick: () => setConfirmDel(true) }, t('d.deleteBtn')),
            confirmDel ? h('button', { className: 'kbn-btn', onClick: () => setConfirmDel(false) }, t('ui.cancel')) : null,
          ),
        )
      }

      function NewTaskDialog(props) {
        const [title, setTitle] = React.useState('')
        const [body, setBody] = React.useState('')
        const [assignee, setAssignee] = React.useState('')
        const [modelOptions, setModelOptions] = React.useState([])
        const [priority, setPriority] = React.useState(0)
        const [status, setStatus] = React.useState(
          props.lane && STATUSES.some(s => s.id === props.lane && s.id !== 'running') ? props.lane : 'triage',
        )
        const [sched, setSched] = React.useState(defaultSchedule(props.lane))
        const [busy, setBusy] = React.useState(false)
        const [err, setErr] = React.useState(null)

        React.useEffect(() => {
          call('listModels').then(data => {
            const list = (data && data.models) || []
            setModelOptions(list.map(String))
          }).catch(() => {})
        }, [])

        function submit() {
          if (!title.trim()) { setErr(t('dlg.titleRequired')); return }
          setBusy(true)
          setErr(null)
          call('createTask', {
            slug: props.slug, title: title.trim(), body, assignee, priority, status,
            schedule: schedulePayload(sched),
          })
            .then(() => { props.onCreated(); props.onClose() })
            .catch(e => { setBusy(false); setErr(String((e && e.message) || e)) })
        }

        return h('div', { className: 'kbn-modal-mask', onClick: e => { if (e.target === e.currentTarget) props.onClose() } },
          h('div', { className: 'kbn-modal' },
            h('div', { className: 'kbn-modal-title' }, t('dlg.newTask')),
            err ? h('div', { className: 'kbn-error' }, err) : null,
            h('div', { className: 'kbn-field' },
              h('span', { className: 'kbn-field-label' }, t('d.title')),
              h('input', { className: 'kbn-input', autoFocus: true, value: title, onChange: e => setTitle(e.target.value), onKeyDown: e => { if (e.key === 'Enter') submit() } }),
            ),
            h('div', { className: 'kbn-field' },
              h('span', { className: 'kbn-field-label' }, t('d.desc')),
              h('textarea', { className: 'kbn-input kbn-textarea', rows: 5, value: body, onChange: e => setBody(e.target.value) }),
            ),
            h('div', { className: 'kbn-field-row' },
              h('div', { className: 'kbn-field', style: { flex: 1 } },
                h('span', { className: 'kbn-field-label' }, t('d.model')),
                h('select', { className: 'kbn-input kbn-select', value: assignee, onChange: e => setAssignee(e.target.value) },
                  h('option', { value: '' }, t('d.defaultModel')),
                  modelOptions.map(m => h('option', { key: m, value: m }, m)),
                ),
              ),
              h('div', { className: 'kbn-field' },
                h('span', { className: 'kbn-field-label' }, t('d.priority')),
                h('input', { className: 'kbn-input', type: 'number', min: 0, max: 9, value: String(priority), onChange: e => setPriority(clampNum(e.target.value, 0, 9)) }),
              ),
            ),
            h('div', { className: 'kbn-field' },
              h('span', { className: 'kbn-field-label' }, t('dlg.initialColumn')),
              h('select', {
                className: 'kbn-input kbn-select',
                value: status,
                onChange: e => setStatus(e.target.value),
              },
                STATUSES.filter(s => s.id !== 'running').map(s => h('option', { key: s.id, value: s.id }, statusOf(s.id).label)),
              ),
            ),
            status === 'scheduled' ? h('div', { className: 'kbn-field' },
              h('span', { className: 'kbn-field-label' }, t('d.schedule')),
              h('select', { className: 'kbn-input kbn-select', value: sched.kind, onChange: e => setSched({ ...sched, kind: e.target.value }) },
                h('option', { value: 'none' }, t('d.scheduleNone')),
                h('option', { value: 'interval' }, t('d.scheduleInterval')),
                h('option', { value: 'daily' }, t('d.scheduleDaily')),
              ),
            ) : null,
            status === 'scheduled' && sched.kind === 'interval' ? h('div', { className: 'kbn-field' },
              h('span', { className: 'kbn-field-label' }, t('d.interval')),
              h('input', { className: 'kbn-input', type: 'number', min: 1, max: 10080, value: String(sched.intervalMinutes), onChange: e => setSched({ ...sched, intervalMinutes: e.target.value }) }),
            ) : null,
            status === 'scheduled' && sched.kind === 'daily' ? h('div', { className: 'kbn-field' },
              h('span', { className: 'kbn-field-label' }, t('d.dailyTime')),
              h('input', { className: 'kbn-input', type: 'time', value: sched.dailyTime, onChange: e => setSched({ ...sched, dailyTime: e.target.value }) }),
            ) : null,
            h('div', { className: 'kbn-field' },
              h('span', { className: 'kbn-field-label' }, t('d.parent')),
              h('select', { className: 'kbn-input kbn-select', value: sched.parentId, onChange: e => setSched({ ...sched, parentId: e.target.value }) },
                h('option', { value: '' }, t('d.parentNone')),
                (props.tasks || []).map(x => h('option', { key: x.id, value: x.id }, x.title + '（' + statusOf(x.status).label + '）')),
              ),
            ),
            h('div', { className: 'kbn-modal-actions' },
              h('button', { className: 'kbn-btn', onClick: () => props.onClose() }, t('ui.cancel')),
              h('button', { className: 'kbn-btn kbn-btn-run', disabled: busy, onClick: submit }, t('dlg.create')),
            ),
          ),
        )
      }

      function CreateBoardForm(props) {
        const [name, setName] = React.useState('')
        const [busy, setBusy] = React.useState(false)
        const [err, setErr] = React.useState(null)
        function submit() {
          if (!name.trim()) { setErr(t('dlg.boardNameRequired')); return }
          setBusy(true)
          setErr(null)
          call('createBoard', { name: name.trim() })
            .then(board => { props.onCreated(board.slug); props.onClose() })
            .catch(e => { setBusy(false); setErr(String((e && e.message) || e)) })
        }
        return h('div', { className: 'kbn-modal-mask', onClick: e => { if (e.target === e.currentTarget) props.onClose() } },
          h('div', { className: 'kbn-modal' },
            h('div', { className: 'kbn-modal-title' }, t('dlg.newBoard')),
            err ? h('div', { className: 'kbn-error' }, err) : null,
            h('input', { className: 'kbn-input', autoFocus: true, placeholder: t('dlg.boardNamePh'), value: name, onChange: e => setName(e.target.value), onKeyDown: e => { if (e.key === 'Enter') submit() } }),
            h('div', { className: 'kbn-modal-actions' },
              h('button', { className: 'kbn-btn', onClick: () => props.onClose() }, t('ui.cancel')),
              h('button', { className: 'kbn-btn kbn-btn-run', disabled: busy, onClick: submit }, t('dlg.create')),
            ),
          ),
        )
      }

      // 列收放偏好：只持久化「用户点过的列」（localStorage，按看板 slug 分键）。
      // 未点过的列维持默认行为：有卡自动展开、空列自动收缩。
      const COLLAPSED_KEY = 'dsh-kanban:collapsed:'
      function readCollapsed(slug) {
        if (!slug) return {}
        try {
          const raw = window.localStorage.getItem(COLLAPSED_KEY + slug)
          if (!raw) return {}
          const parsed = JSON.parse(raw)
          const out = {}
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            for (const k of Object.keys(parsed)) {
              if (typeof parsed[k] === 'boolean') out[k] = parsed[k]
            }
          }
          return out
        } catch (err) {
          return {}
        }
      }
      function writeCollapsed(slug, map) {
        if (!slug) return
        try { window.localStorage.setItem(COLLAPSED_KEY + slug, JSON.stringify(map)) } catch (err) {}
      }

      function BoardContent() {
        const [store, setStore] = React.useState(null)
        const [slug, setSlug] = React.useState(null)
        const [error, setError] = React.useState(null)
        const [showArchived, setShowArchived] = React.useState(false)
        const [drawerId, setDrawerId] = React.useState(null)
        const [dialog, setDialog] = React.useState(null)
        const [sel, setSel] = React.useState({})
        const [filters, setFilters] = React.useState({})
        const [filterOpen, setFilterOpen] = React.useState({})
        const [collapsed, setCollapsed] = React.useState({})
        const [creating, setCreating] = React.useState(false)
        const [confirmBoardDel, setConfirmBoardDel] = React.useState(false)

        function refresh(force) {
          call(force ? 'reload' : 'getStore').then(data => {
            setStore(data)
            setError(null)
            setSlug(prev => {
              if (prev && data.boards.some(b => b.slug === prev)) return prev
              return data.boards.length > 0 ? data.boards[0].slug : null
            })
          }).catch(e => setError(String((e && e.message) || e)))
        }

        React.useEffect(() => {
          refresh(false)
          const unsub = wsSubscribe(data => { setStore(data) })
          // 兜底：WS 断开时才 5s 轮询；连接正常时由推送驱动
          const poll = ctx.interval(() => { if (!wsIsOpen()) refresh(false) }, 5000)
          return () => { unsub(); poll() }
        }, [])

        // 进入/切换看板时恢复该看板用户点过的收放状态（没点过的列交给默认行为）
        React.useEffect(() => {
          setCollapsed(readCollapsed(slug))
        }, [slug])

        const board = (store && slug) ? store.boards.find(b => b.slug === slug) : null
        const tasks = board ? board.tasks : []
        const drawerTask = board && drawerId ? board.tasks.find(t => t.id === drawerId) : null
        const lanes = STATUSES.filter(s => s.id !== 'archived' || showArchived)
        const selIds = Object.keys(sel)

        function doMove(id, status) {
          call('moveTask', { slug, id, status }).then(() => refresh(false)).catch(e => setError(String((e && e.message) || e)))
        }
        function toggleCollapse(laneId, laneTasks) {
          const cur = collapsed[laneId] !== undefined ? collapsed[laneId] : laneTasks.length === 0
          const next = { ...collapsed, [laneId]: !cur }
          setCollapsed(next)
          writeCollapsed(slug, next)
        }
        function toggleSelect(id) {
          setSel(prev => {
            const next = { ...prev }
            if (next[id]) delete next[id]
            else next[id] = true
            return next
          })
        }
        function doBulkMove(status) {
          if (selIds.length === 0) return
          call('bulkMove', { slug, ids: selIds, status }).then(data => {
            const results = (data && data.results) || []
            const failed = results.filter(r => !r.ok)
            if (failed.length > 0) setError(t('board.partialMoveFail', { a: failed.map(r => r.error).join('；') }))
            else setSel({})
            refresh(false)
          }).catch(e => setError(String((e && e.message) || e)))
        }
        function doBulkDelete() {
          if (selIds.length === 0) return
          call('bulkDelete', { slug, ids: selIds }).then(() => { setSel({}); refresh(false) }).catch(e => setError(String((e && e.message) || e)))
        }
        function doDeleteBoard() {
          call('deleteBoard', { slug }).then(() => { setConfirmBoardDel(false); setDrawerId(null); setSel({}); refresh(false) }).catch(e => setError(String((e && e.message) || e)))
        }

        if (!store) {
          if (error) {
            return h('div', { className: 'kbn-empty' },
              h('div', { className: 'kbn-error' }, t('board.loadFail', { a: error })),
              h('button', { className: 'kbn-btn', style: { marginTop: 10 }, onClick: () => { setError(null); refresh(false) } }, t('board.retry')),
            )
          }
          return h('div', { className: 'kbn-empty' }, t('board.loading'))
        }

        return h('div', { className: 'kbn-body' },
          error ? h('div', { className: 'kbn-error' }, t('board.errorSuffix', { a: error })) : null,
          h('div', { className: 'kbn-toolbar' },
            store.boards.length > 0 ? h('select', {
              className: 'kbn-input kbn-select',
              value: slug || '',
              onChange: e => { setSlug(e.target.value); setSel({}); setDrawerId(null) },
            },
              store.boards.map(b => h('option', { key: b.slug, value: b.slug }, b.name + '（' + b.tasks.length + '）')),
            ) : null,
            h('button', { className: 'kbn-btn', onClick: () => setCreating(!creating) }, t('board.newBoardBtn')),
            confirmBoardDel ? h('button', { className: 'kbn-btn kbn-btn-danger', disabled: !board, onClick: doDeleteBoard }, t('board.confirmDelBoard')) : null,
            board && !confirmBoardDel ? h('button', { className: 'kbn-btn kbn-btn-danger', onClick: () => setConfirmBoardDel(true) }, t('board.delBoard')) : null,
            confirmBoardDel ? h('button', { className: 'kbn-btn', onClick: () => setConfirmBoardDel(false) }, t('ui.cancel')) : null,
            h('button', { className: 'kbn-btn' + (showArchived ? ' on' : ''), onClick: () => setShowArchived(!showArchived) }, t('board.showArchived')),
            h('button', { className: 'kbn-btn kbn-btn-run', disabled: !board, onClick: () => setDialog({ lane: 'triage' }) }, t('board.newTaskBtn')),
            h('button', { className: 'kbn-btn', title: t('board.refreshTitle'), onClick: () => refresh(true) }, t('board.refreshBtn')),
          ),
          creating ? h(CreateBoardForm, { onCreated: newSlug => { setSlug(newSlug); refresh(false) }, onClose: () => setCreating(false) }) : null,
          selIds.length > 1 ? h(BulkBar, {
            selected: sel,
            onMove: doBulkMove,
            onDelete: doBulkDelete,
            onClear: () => setSel({}),
          }) : null,
          store.boards.length === 0 ? h('div', { className: 'kbn-empty' }, t('board.empty')) : null,
          h('div', { className: 'kbn-cols', onClick: () => { if (selIds.length > 0) setSel({}) } },
            lanes.map(lane => {
              const laneTasks = tasks.filter(t => t.status === lane.id)
              const f = (filters[lane.id] || '').trim().toLowerCase()
              const shown = f
                ? laneTasks.filter(t => ((t.title || '') + ' ' + (t.body || '') + ' ' + t.id).toLowerCase().indexOf(f) >= 0)
                : laneTasks
              const isCollapsed = collapsed[lane.id] !== undefined ? collapsed[lane.id] : laneTasks.length === 0
              return h(Lane, {
                key: lane.id,
                lane,
                laneTasks,
                shown,
                isCollapsed,
                filterOpen: Boolean(filterOpen[lane.id]),
                filterText: filters[lane.id] || '',
                selectedIds: sel,
                onDropTask: doMove,
                onOpenTask: id => setDrawerId(id),
                onToggleSelect: toggleSelect,
                onNewTask: laneId => setDialog({ lane: laneId }),
                onToggleCollapse: () => toggleCollapse(lane.id, laneTasks),
                onToggleFilter: laneId => setFilterOpen(prev => ({ ...prev, [laneId]: !prev[laneId] })),
                onFilterChange: (laneId, text) => setFilters(prev => ({ ...prev, [laneId]: text })),
              })
            }),
          ),
          drawerTask ? h(Drawer, {
            key: drawerTask.id,
            task: drawerTask,
            tasks,
            slug,
            onClose: () => setDrawerId(null),
            onChanged: () => refresh(false),
          }) : null,
          dialog ? h(NewTaskDialog, {
            lane: dialog.lane,
            slug,
            tasks,
            onClose: () => setDialog(null),
            onCreated: () => refresh(false),
          }) : null,
        )
      }

      function KanbanView() {
        return h('div', { className: 'kbn-view' }, h(BoardContent))
      }

      // —— 帧级浮层：任务结算文字 toast（纯文字提示，5s 轮询 getStore 快照 diff）——
      function KanbanOverlay() {
        const [toasts, setToasts] = React.useState([])
        const seenRef = React.useRef(null)

        React.useEffect(() => {
          let alive = true
          let seq = 0
          function scan(data) {
            if (!alive) return
            const boards = (data && data.boards) || []
            const nextSeen = seenRef.current || {}
            const newToasts = []
            for (const b of boards) {
              for (const task of b.tasks || []) {
                const run = task.run
                const prev = nextSeen[task.id]
                if (run && run.outcome && (!prev || prev.outcome !== run.outcome)) {
                  if (run.outcome === 'done') {
                    newToasts.push({ key: 't' + (++seq), tone: 'ok', title: t('toast.done', { a: cap(task.title, 30) }), detail: '' })
                  } else if (run.outcome === 'error') {
                    newToasts.push({ key: 't' + (++seq), tone: 'bad', title: t('toast.blocked', { a: cap(task.title, 30) }), detail: run.error ? String(run.error) : '' })
                  }
                }
                nextSeen[task.id] = { outcome: run && run.outcome ? run.outcome : null }
              }
            }
            if (seenRef.current === null) {
              // 首轮只做基线，不回放历史结算（刷新页面不刷旧 toast）
              seenRef.current = nextSeen
            } else {
              seenRef.current = nextSeen
              if (newToasts.length > 0) {
                setToasts(prev => [...prev, ...newToasts])
                for (const toast of newToasts) {
                  setTimeout(() => {
                    if (!alive) return
                    setToasts(prev => prev.filter(x => x.key !== toast.key))
                  }, 6000)
                }
              }
            }
          }
          // WS 快照驱动 diff；断线时退回 5s 轮询兜底
          const unsub = wsSubscribe(scan)
          const poll = ctx.interval(() => {
            if (!wsIsOpen()) call('getStore').then(scan).catch(() => {})
          }, 5000)
          return () => { alive = false; unsub(); poll() }
        }, [])

        if (toasts.length === 0) return null
        return h('div', { className: 'kbn-overlay' },
          toasts.map(t => h('div', { key: t.key, className: 'kbn-toast' + (t.tone === 'bad' ? ' kbn-toast-bad' : '') },
            h('div', { className: 'kbn-toast-title' }, t.title),
            t.detail ? h('div', { className: 'kbn-toast-detail' }, cap(t.detail, 120)) : null,
          )),
        )
      }

      const disposers = []
      if (locale && typeof locale.register === 'function') {
        disposers.push(locale.register('kanban', LOCALE_DICT))
      }
      disposers.push(insertCss(CSS))
      slots.inject('conversation.view', () => slots.register(
        { name: 'conversation.view', id: 'kanban', order: 20, locale: locale ? 'kanban' : undefined, label: () => t('tab') },
        () => h(KanbanView),
      ))
      slots.inject('shell.overlay', () => slots.register(
        { name: 'shell.overlay', id: 'kanban-status', order: 0, locale: locale ? 'kanban' : undefined },
        () => h(KanbanOverlay),
      ))
      ctx.effect(() => () => {
        disposers.forEach(d => { try { d() } catch (err) {} })
      })
    }

    exports.inject = ['timer']
    exports.apply = apply
    return module.exports
  },
})
