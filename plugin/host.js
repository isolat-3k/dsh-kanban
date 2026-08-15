// DSH Kanban 看板插件 — Host 半（静态包 dsh-kanban，ES 模块）
// 运行环境：DSH 静态插件（真实 Node ESM），由 web profile 补丁层 cordis.patch.yml 以 insert 行 `name: dsh-kanban` 挂载到宿主平面
// 持久化：<workspaceRoot>/DSH-kanban/kanban-store.json（经 sandboxPolicy.workspaceRoot 解析）
// Client RPC：webServer 路由 POST /kanban/rpc（替代动态插件的 harness.handle/host.call）
// 硬依赖：声明后本插件会等到这些服务全部就绪才 apply（并在服务后到齐时自动重载）。
// 若只靠 apply 内 ctx.get()，启动早期服务提供方 fiber 尚未激活时 ctx.get 会返回
// undefined（strict 检查 fiber.state===2），导致 webServer 路由被静默跳过、页面永远「加载中」。
import { KANBAN_SKILL } from './skill.js'

export const inject = ['fs', 'timer', 'llm', 'webServer', 'tools', 'subagents', 'agents', 'sandboxPolicy', 'skills']

export function apply(ctx) {
  const sandboxPolicy = ctx.get('sandboxPolicy')
  const subagents = ctx.get('subagents')
  const agents = ctx.get('agents')

  const STATUSES = ['triage', 'todo', 'scheduled', 'ready', 'running', 'blocked', 'review', 'done', 'archived']
  const STATUS_LABEL = { triage: '待细化', todo: '待办', scheduled: '定时', ready: '就绪', running: '运行中', blocked: '阻塞', review: '审核', done: '完成', archived: '归档' }

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
    if (typeof input !== 'object') throw new Error('定时设置无效')
    const kind = input.kind === 'interval' || input.kind === 'daily' ? input.kind : null
    if (input.kind && !kind) throw new Error('定时方式只支持 interval（间隔重复）或 daily（每天固定时刻）')
    let intervalMinutes = null
    let dailyMinutes = null
    if (kind === 'interval') {
      const n = Math.round(Number(input.intervalMinutes))
      if (!Number.isFinite(n) || n < 1 || n > MAX_INTERVAL_MINUTES) throw new Error('间隔需为 1-' + MAX_INTERVAL_MINUTES + ' 分钟（最长 7 天）')
      intervalMinutes = n
    }
    if (kind === 'daily') {
      const v = String(input.dailyTime || '').trim()
      const m = /^(\d{1,2}):(\d{2})$/.exec(v)
      if (!m) throw new Error('每天时刻需为 HH:MM 格式')
      const hh = Number(m[1])
      const mm = Number(m[2])
      if (hh > 23 || mm > 59) throw new Error('每天时刻无效（00:00-23:59）')
      dailyMinutes = hh * 60 + mm
    }
    let parentId = null
    if (input.parentId !== null && input.parentId !== undefined && String(input.parentId).trim()) {
      parentId = String(input.parentId).trim().slice(0, 64)
      if (parentId === selfId) throw new Error('父卡片不能是自己')
      if (board && !findTask(board, parentId)) throw new Error('父卡片不存在（需在同一看板内）')
      if (board && selfId) {
        // 环检测：沿现有父链向上查找，若包含 selfId 则构成循环依赖（A 等 B、B 等 A 死锁）
        const seen = new Set()
        let cur = parentId
        while (cur && !seen.has(cur)) {
          seen.add(cur)
          if (cur === selfId) throw new Error('父卡片链存在循环依赖：不能把祖先任务设为自己的父卡片')
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
              pushEvent(task, 'blocked', { reason: 'worker lost：插件重启后运行状态丢失' })
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
    lines.push('你被派发执行一个看板任务（DeepSeek Harness kanban dispatch）。')
    lines.push('')
    lines.push('【任务标题】' + task.title)
    if (task.body) {
      lines.push('')
      lines.push('【任务描述】')
      lines.push(task.body)
    }
    if (extra) {
      lines.push('')
      lines.push('【补充要求】')
      lines.push(extra)
    }
    lines.push('')
    lines.push('【进度汇报】')
    lines.push('看板会通过工作区文件 DSH-kanban/runs/' + task.id + '.progress 实时展示你的执行进度。每完成一个重要步骤（例如完成一次检查、写完一个文件、完成一次验证），请向该文件追加一行简短的中文进度说明。只追加、不覆盖、不删除该文件，也不要写入时间戳（看板会自动记录时间）。若某个步骤需要长时间执行，请在该步骤开始与结束时各追加一行。')
    if (Array.isArray(task.comments) && task.comments.length > 0) {
      lines.push('')
      lines.push('【追加评论】')
      for (const c of task.comments) {
        lines.push('- ' + (c.author || 'user') + ' ' + fmtTime(c.created_at) + '：' + c.body)
      }
    }
    if (task.run && task.run.outcome) {
      lines.push('')
      lines.push('【上次运行】')
      if (task.run.outcome === 'done') lines.push('结果：完成')
      else if (task.run.outcome === 'error') lines.push('结果：失败')
      else if (task.run.outcome === 'terminated') lines.push('结果：已终止')
      else lines.push('结果：' + task.run.outcome)
      if (task.run.summary) lines.push('摘要：' + task.run.summary)
      if (task.run.error) lines.push('错误：' + task.run.error)
    }
    lines.push('')
    lines.push('【看板协作】')
    lines.push('若你的会话中提供看板工具（kanban_add_comment 等），可以用它们向本任务追加评论（供看板界面的人阅读），但不要用任何工具修改本任务的状态或字段：任务状态由看板的结算逻辑自动管理。')
    lines.push('')
    lines.push('【完成要求】')
    lines.push('请在当前工作区中完成该任务。完成后，用一段简短的总结说明你做了什么、结果如何、以及遗留事项（如有）。这段总结将作为任务的完成摘要写回看板。')
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
    if (!slug) throw new Error('看板 slug 无效')
    const name = cap(String(a.name || slug), 80)
    if (findBoard(slug)) throw new Error('同名看板已存在')
    const board = { slug, name, created_at: now(), tasks: [] }
    store.boards.push(board)
    return board
  }

  route('createBoard', async (a) => mutate(() => createBoardInner(a)))

  route('deleteBoard', async (a) => {
    const slug = String(a.slug || '')
    return mutate(() => {
      const idx = store.boards.findIndex(b => b.slug === slug)
      if (idx < 0) throw new Error('看板不存在')
      for (const t of store.boards[idx].tasks) abortRun(slug, t.id)
      store.boards.splice(idx, 1)
      return { ok: true }
    })
  })

  async function createTaskOp(a) {
    const title = cap(String(a.title || '').trim(), 500)
    if (!title) throw new Error('标题不能为空')
    const body = cap(String(a.body || ''), 20000)
    let status = STATUSES.indexOf(a.status) >= 0 ? a.status : 'todo'
    if (status === 'running') throw new Error('running 列只能通过派发进入')
    const assignee = cap(String(a.assignee || ''), 200) || null
    const priority = clampInt(a.priority, 0, 9)
    return mutate(() => {
      const board = findBoard(String(a.slug || ''))
      if (!board) throw new Error('看板不存在')
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
    if (!task) throw new Error('任务不存在')
    const changes = []
    if ('title' in patch) {
      const v = cap(String(patch.title || '').trim(), 500)
      if (!v) throw new Error('标题不能为空')
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
    if (!task) throw new Error('任务不存在')
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
    if (STATUSES.indexOf(status) < 0) throw new Error('未知状态: ' + status)
    if (status === 'running') throw new Error('running 列只能通过派发进入')
    const slug = String(a.slug || '')
    const id = String(a.id || '')
    return mutate(() => moveTaskInner(slug, id, status, 'manual'))
  })

  route('bulkMove', async (a) => {
    const ids = Array.isArray(a.ids) ? a.ids.map(String) : []
    const status = String(a.status || '')
    if (STATUSES.indexOf(status) < 0) throw new Error('未知状态')
    if (status === 'running') throw new Error('running 列只能通过派发进入')
    const slug = String(a.slug || '')
    return mutate(() => {
      const board = findBoard(slug)
      if (!board) throw new Error('看板不存在')
      const results = []
      for (const id of ids) {
        try {
          const task = findTask(board, id)
          if (!task) { results.push({ id, ok: false, error: '任务不存在' }); continue }
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
      if (!board) throw new Error('看板不存在')
      const results = []
      for (const id of ids) {
        const idx = board.tasks.findIndex(t => t.id === id)
        if (idx < 0) { results.push({ id, ok: false, error: '任务不存在' }); continue }
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
    if (!board) throw new Error('看板不存在')
    const idx = board.tasks.findIndex(t => t.id === id)
    if (idx < 0) throw new Error('任务不存在')
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
    if (!task) throw new Error('任务不存在')
    if (!Array.isArray(task.comments)) task.comments = []
    const comment = { id: makeId('c'), author: author === 'agent' ? 'agent' : 'user', body, created_at: now() }
    task.comments.push(comment)
    task.updated_at = now()
    pushEvent(task, 'commented', { commentId: comment.id, author: comment.author })
    return { comment, task }
  }

  route('addComment', async (a) => {
    const body = cap(String(a.body || '').trim(), 4000)
    if (!body) throw new Error('评论不能为空')
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
      if (!task) throw new Error('任务不存在')
      if (task.status !== 'ready') throw new Error('只有 ready 状态的任务可以派发')
      if (runs.has(KEY(slug, id))) throw new Error('任务已在运行中')
      if (!subagents) throw new Error('当前 DSH 没有挂载 subagents 服务')
      const initiator = (agents && typeof agents.currentInitiator === 'function' ? agents.currentInitiator() : undefined)
      const roots = (agents && typeof agents.roots === 'function' ? agents.roots() : [])
      // UI 按钮派发时无 initiator：优先挂靠最近有会话活动的根，其次第一个根（多会话时尽量贴近用户当前上下文）
      const parent = initiator
        || (lastActiveRootId && roots.find(r => String(r.id) === lastActiveRootId))
        || roots[0]
      if (!parent) throw new Error('没有存活的代理会话可用于派发（请先在对话中开启一个会话）')
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
      if (!providerName) throw new Error('没有可用的 subagent provider')
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
            if (!known) throw new Error('模型「' + task.assignee + '」在 provider「' + provider + '」中不存在：请填写有效的模型名，或留空使用默认模型')
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
    if (!task) throw new Error('任务不存在')
    if (task.status !== 'running') throw new Error('任务未在运行')
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
        const fn = routes.get(method)
        let out
        if (fn === undefined) {
          out = { ok: false, error: '未知方法: ' + method }
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
  const skills = ctx.get('skills')
  if (skills && typeof skills.register === 'function') {
    disposers.push(skills.register({
      name: KANBAN_SKILL.name,
      description: KANBAN_SKILL.description,
      whenToUse: KANBAN_SKILL.whenToUse,
      source: 'custom',
      content: KANBAN_SKILL.content,
    }))
  } else {
    console.warn('[kanban] skills 服务不可用：跳过 kanban skill 注册（工具面不受影响）')
  }

  // —— Agent 工具：10 个看板工具（读得见、改得动、派得出去、收得回结果）——
  // 共享 helper：解析看板（省略时用第一个）、定位任务（省略 board 时全看板搜索）
  async function resolveBoardSlug(args) {
    await load()
    let slug = typeof args.board === 'string' ? args.board.trim() : ''
    if (!slug) {
      if (store.boards.length === 0) throw new Error('还没有任何看板：可用 kanban_create_board 创建，或在页面创建看板')
      slug = store.boards[0].slug
    }
    return slug
  }
  function locateTask(args, id) {
    const slugArg = typeof args.board === 'string' ? args.board.trim() : ''
    if (slugArg) {
      const board = findBoard(slugArg)
      if (!board) throw new Error('看板不存在: ' + slugArg)
      const task = findTask(board, id)
      if (!task) throw new Error('任务不存在: ' + id + '（看板 ' + slugArg + '）')
      return { slug: slugArg, task }
    }
    for (const board of store.boards) {
      const task = findTask(board, id)
      if (task) return { slug: board.slug, task }
    }
    throw new Error('任务不存在: ' + id + '（已搜索全部看板；可用 board 指定看板）')
  }
  const reqId = (args) => {
    const id = String(args && args.id ? args.id : '').trim()
    if (!id) throw new Error('任务 id 不能为空')
    return id
  }
  const shortId = (id) => String(id || '').replace(/^t_/, '').slice(0, 8)
  const textResultView = (title, value) => ({ card: 'generic', title, content: [{ type: 'text', text: String(value) }] })
  const BOARD_PARAM = { type: 'string', description: '看板 slug（可选，省略时使用第一个看板）。' }
  const NO_BOARD_BOARD_PARAM = { type: 'string', description: '看板 slug（可选，省略时在所有看板中查找任务 id）。' }
  const ID_PARAM = { type: 'string', description: '任务 id（必填）。' }
  const scheduleText = (t) => {
    const s = t.schedule
    if (!s) return ''
    const parts = []
    if (s.kind === 'interval') parts.push('每' + s.intervalMinutes + ' 分钟重复')
    if (s.kind === 'daily') parts.push('每天 ' + String(Math.floor(s.dailyMinutes / 60)).padStart(2, '0') + ':' + String(s.dailyMinutes % 60).padStart(2, '0'))
    if (s.parentId) parts.push('等待父卡片 ' + shortId(s.parentId) + ' 完成后激活')
    return parts.join('，') || '仅停放'
  }

  const KANBAN_TOOLS = [
    {
      name: 'kanban_list_boards',
      description: '列出 DSH 看板中的全部看板及其负载：slug、名称、各列任务数与运行中任务数。用于选择看板或了解全局状态。',
      parameters: { type: 'object', properties: {}, required: [] },
      async execute() {
        await load()
        if (store.boards.length === 0) throw new Error('还没有任何看板：可用 kanban_create_board 创建，或在页面创建看板')
        const lines = store.boards.map(b => {
          const c = {}
          for (const s of STATUSES) c[s] = 0
          for (const t of b.tasks) if (typeof c[t.status] === 'number') c[t.status]++
          return '- ' + b.name + '（slug=' + b.slug + '）：待办 ' + c.todo + ' / 定时 ' + c.scheduled + ' / 就绪 ' + c.ready + ' / 运行中 ' + c.running + ' / 阻塞 ' + c.blocked + ' / 完成 ' + c.done + '，共 ' + b.tasks.length + ' 张卡'
        })
        return '看板列表（' + store.boards.length + ' 个）：\n' + lines.join('\n')
      },
      presentCall: () => ({ card: 'generic', title: '看板：列出所有看板' }),
      presentResult: (_a, value) => textResultView('看板：看板列表', value),
    },
    {
      name: 'kanban_list_tasks',
      description: '列出看板任务（紧凑视图，先看板再动手）。可选过滤：status（triage/todo/scheduled/ready/running/blocked/review/done/archived）、priority_min（仅返回优先级 >= 该值）、assignee（负责人/子Agent模型名）、query（标题/正文/ID 关键词）、limit（默认 50，上限 200）。按优先级降序、同优先级新卡在前。board 省略时使用第一个看板。',
      parameters: {
        type: 'object',
        properties: {
          board: BOARD_PARAM,
          status: { type: 'string', enum: STATUSES, description: '仅列该状态的任务（可选）。' },
          priority_min: { type: 'number', description: '仅列优先级 >= 该值的任务（可选，0-9）。' },
          assignee: { type: 'string', description: '仅列该负责人（子Agent模型名）的任务（可选）。' },
          query: { type: 'string', description: '标题/正文/ID 关键词（可选，不区分大小写）。' },
          limit: { type: 'number', description: '最多返回条数（默认 50，上限 200）。' },
        },
        required: [],
      },
      async execute(args) {
        const slug = await resolveBoardSlug(args)
        const board = findBoard(slug)
        if (!board) throw new Error('看板不存在: ' + slug)
        const minP = args.priority_min === undefined || args.priority_min === null ? null : clampInt(args.priority_min, 0, 9)
        const q = String(args.query || '').trim().toLowerCase()
        const limit = args.limit === undefined || args.limit === null ? 50 : clampInt(args.limit, 1, 200)
        let list = board.tasks.slice()
        if (typeof args.status === 'string' && args.status) list = list.filter(t => t.status === args.status)
        if (minP !== null) list = list.filter(t => t.priority >= minP)
        if (typeof args.assignee === 'string' && args.assignee.trim()) {
          const want = args.assignee.trim()
          list = list.filter(t => (t.assignee || '') === want)
        }
        if (q) list = list.filter(t => ((t.title || '') + ' ' + (t.body || '') + ' ' + t.id).toLowerCase().indexOf(q) >= 0)
        list.sort((x, y) => (y.priority - x.priority) || (y.created_at - x.created_at))
        const total = list.length
        if (total === 0) return '看板 ' + board.name + '（' + slug + '）：当前无符合条件的任务。'
        const page = list.slice(0, limit)
        const lines = page.map(t => {
          const parts = ['id=' + t.id, '状态=' + STATUS_LABEL[t.status], '优先级=' + t.priority]
          if (t.assignee) parts.push('负责人=' + t.assignee)
          if (t.status === 'scheduled' && t.schedule) parts.push('定时=' + scheduleText(t))
          if (t.status === 'running' && t.run) parts.push('运行中')
          return '- ' + cap(t.title, 60) + '（' + parts.join('，') + '）'
        })
        return '看板 ' + board.name + '（' + slug + '）任务：共 ' + total + ' 张' + (page.length < total ? '，仅列前 ' + page.length + ' 张（可用 query/limit 调整）' : '') + '：\n' + lines.join('\n')
      },
      presentCall: () => ({ card: 'generic', title: '看板：列出任务' }),
      presentResult: (_a, value) => textResultView('看板：任务列表', value),
    },
    {
      name: 'kanban_get_task',
      description: '查看单个看板任务的完整信息：标题/正文/状态/优先级/负责人/定时设置/最近评论(最多20条)/最近事件(最多20条)/最近一次运行（结果、摘要、错误、进度最后50行）。board 省略时在所有看板中查找任务 id。',
      parameters: { type: 'object', properties: { id: ID_PARAM, board: NO_BOARD_BOARD_PARAM }, required: ['id'] },
      async execute(args) {
        await load()
        const id = reqId(args)
        const located = locateTask(args, id)
        const slug = located.slug
        const task = located.task
        const lines = []
        lines.push('看板任务 ' + id + '（看板：' + slug + '）')
        lines.push('标题：' + task.title)
        lines.push('状态：' + STATUS_LABEL[task.status] + '（' + task.status + '）')
        lines.push('优先级：' + task.priority)
        lines.push('负责人：' + (task.assignee || '默认模型（跟随会话）'))
        lines.push('定时：' + (scheduleText(task) || '无'))
        lines.push('')
        lines.push('正文：' + (task.body || '（无）'))
        const comments = (task.comments || []).slice(-20)
        lines.push('')
        lines.push('最近评论（' + comments.length + ' 条）：')
        if (comments.length === 0) lines.push('- （无）')
        for (const c of comments) lines.push('- ' + (c.author === 'agent' ? '主Agent' : 'user') + ' ' + fmtTime(c.created_at) + '：' + cap(c.body, 200))
        const events = (task.events || []).slice(-20)
        lines.push('')
        lines.push('最近事件（' + events.length + ' 条）：')
        if (events.length === 0) lines.push('- （无）')
        for (const ev of events) lines.push('- ' + fmtTime(ev.created_at) + ' ' + ev.kind + '：' + cap(JSON.stringify(ev.payload || {}), 120))
        const run = task.run
        lines.push('')
        if (run) {
          lines.push('最近运行：')
          lines.push('- 结果：' + (run.outcome || (task.status === 'running' ? '运行中' : '（未结算）')))
          lines.push('- 开始：' + fmtTime(run.started_at) + '；结束：' + (run.ended_at ? fmtTime(run.ended_at) : '（未结束）'))
          if (run.runId) lines.push('- runId：' + run.runId)
          if (run.summary) lines.push('- 摘要：' + run.summary)
          if (run.error) lines.push('- 错误：' + run.error)
          const progress = (run.progress || []).filter(p => String(p).trim() !== '').slice(-50)
          if (progress.length > 0) {
            lines.push('- 进度（最后 ' + progress.length + ' 行）：')
            for (const p of progress) lines.push('  ' + p)
          }
        } else {
          lines.push('最近运行：无（尚未派发过）')
        }
        return lines.join('\n')
      },
      presentCall: () => ({ card: 'generic', title: '看板：查看任务详情' }),
      presentResult: (_a, value) => textResultView('看板：任务详情', value),
    },
    {
      name: 'kanban_create_task',
      description: '在 DSH 看板中创建一张任务卡片——把工作拆进看板的入口，人会在界面「看板」标签页看到。board 省略时使用第一个看板；status 可选 triage/todo/scheduled/ready/blocked/review/done/archived（默认 todo，委派前需为 ready）；priority 为 0-9 整数，越大越优先（默认 0）；assignee 为子Agent模型名，留空表示跟随会话默认模型；schedule 为定时设置（仅 status=scheduled 时生效）：kind=interval 每 N 分钟间隔重复（需 intervalMinutes）、kind=daily 每天固定时刻（需 dailyTime，HH:MM）、可选 parentId 等待同看板父卡片完成/归档后激活。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '任务标题（必填）。' },
          body: { type: 'string', description: '任务描述/正文（可选）。' },
          board: { type: 'string', description: '看板 slug（可选，省略时使用第一个看板）。' },
          status: { type: 'string', enum: ['triage', 'todo', 'scheduled', 'ready', 'blocked', 'review', 'done', 'archived'], description: '初始列，默认 todo。' },
          priority: { type: 'number', description: '优先级 0-9，越大越优先，默认 0。' },
          assignee: { type: 'string', description: '子Agent模型名（可选，留空跟随会话默认模型）。' },
          schedule: {
            type: 'object',
            description: '定时设置（可选，仅 status=scheduled 时生效）。kind 必填；parentId 可选。',
            properties: {
              kind: { type: 'string', enum: ['interval', 'daily'], description: '定时方式：interval=间隔重复 / daily=每天固定时刻。' },
              intervalMinutes: { type: 'number', description: 'kind=interval 时：间隔分钟（1-10080，最长 7 天）。' },
              dailyTime: { type: 'string', description: 'kind=daily 时：每天时刻 HH:MM（如 09:00）。' },
              parentId: { type: 'string', description: '可选：同看板父卡片 id，父卡片完成/归档时激活。' },
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
        return '已创建看板任务：' + task.title + '（id=' + task.id + '，看板=' + slug + '，初始列=' + STATUS_LABEL[task.status] + (scheduleText(task) ? '，定时=' + scheduleText(task) : '') + '）'
      },
      presentCall(args) {
        const t = String((args && args.title) || '').trim()
        return { card: 'generic', title: '看板：创建任务「' + cap(t || '（无标题）', 40) + '」' }
      },
      presentResult: (_a, value) => textResultView('看板：已创建任务', value),
    },
    {
      name: 'kanban_update_task',
      description: '更新看板任务：改标题/正文/优先级/负责人(子Agent模型名)/定时设置(schedule)，或移动状态列(status)。status 移动遵循看板规则（拖离定时列会清除定时；移入 done/archived 会激活等待本卡完成的子任务）。running 任务不能直接改状态：先 kanban_stop_task 停回就绪再移动。board 省略时在所有看板中查找任务 id。patch 至少含一个字段。',
      parameters: {
        type: 'object',
        properties: {
          id: ID_PARAM,
          board: NO_BOARD_BOARD_PARAM,
          patch: {
            type: 'object',
            description: '要修改的字段（至少一项）。',
            properties: {
              title: { type: 'string', description: '新标题（非空）。' },
              body: { type: 'string', description: '新正文（空字符串清空）。' },
              status: { type: 'string', enum: ['triage', 'todo', 'scheduled', 'ready', 'blocked', 'review', 'done', 'archived'], description: '目标列。' },
              priority: { type: 'number', description: '优先级 0-9。' },
              assignee: { type: 'string', description: '子Agent模型名；空字符串清除。' },
              schedule: { type: 'object', description: '定时设置（同 kanban_create_task 的 schedule；传 null 清除）。' },
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
        if (fields.length === 0) throw new Error('patch 至少需要 title/body/status/priority/assignee/schedule 中的一项')
        if ('status' in patch) {
          if (patch.status !== null && patch.status !== undefined && STATUSES.indexOf(patch.status) < 0) throw new Error('未知状态: ' + patch.status)
          if (patch.status === 'running') throw new Error('running 列只能通过派发进入')
        }
        locateTask(args, id) // 提前校验存在性，给出可读错误
        return mutate(() => {
          const { slug, task } = locateTask(args, id)
          if ('status' in patch && patch.status !== null && patch.status !== undefined && patch.status !== task.status) {
            if (task.status === 'running') throw new Error('任务正在运行：请先用 kanban_stop_task 停止，再改状态')
            moveTaskInner(slug, id, patch.status, 'agent')
          }
          const editPatch = {}
          for (const k of ['title', 'body', 'priority', 'assignee']) {
            if (k in patch && patch[k] !== undefined) editPatch[k] = patch[k]
          }
          if ('schedule' in patch && patch.schedule !== undefined) editPatch.schedule = patch.schedule
          if (Object.keys(editPatch).length > 0) patchTaskInner(slug, id, editPatch)
          const fresh = locateTask(args, id).task
          return '已更新任务：' + fresh.title + '（id=' + fresh.id + '，状态=' + STATUS_LABEL[fresh.status] + '）'
        })
      },
      presentCall: () => ({ card: 'generic', title: '看板：更新任务' }),
      presentResult: (_a, value) => textResultView('看板：已更新任务', value),
    },
    {
      name: 'kanban_add_comment',
      description: '给看板任务追加一条评论（面向人：写在卡片上的备注/进展/遗留事项）。评论显示在看板任务详情里，并随下次派发带入子代理上下文。board 省略时在所有看板中查找任务 id。',
      parameters: {
        type: 'object',
        properties: {
          id: ID_PARAM,
          board: NO_BOARD_BOARD_PARAM,
          body: { type: 'string', description: '评论内容（必填）。' },
        },
        required: ['id', 'body'],
      },
      async execute(args) {
        await load()
        const id = reqId(args)
        const body = cap(String(args.body || '').trim(), 4000)
        if (!body) throw new Error('评论不能为空')
        locateTask(args, id)
        return mutate(() => {
          const { slug } = locateTask(args, id)
          const out = addCommentInner(slug, id, body, 'agent')
          return '已评论任务：' + out.task.title + '（id=' + out.task.id + '）'
        })
      },
      presentCall: () => ({ card: 'generic', title: '看板：评论任务' }),
      presentResult: (_a, value) => textResultView('看板：已追加评论', value),
    },
    {
      name: 'kanban_dispatch_task',
      description: '将 DSH 看板中「就绪」(ready) 列的任务派发给子代理执行。任务必须处于 ready 列；运行完成后自动转「完成」并回写摘要，失败或心跳超时转「阻塞」。运行期间可用 kanban_get_task 查询进度与结果；可用 kanban_stop_task 停止。可选 instructions 追加本轮补充要求（随任务正文发给子代理）。board 省略时使用第一个看板。',
      parameters: {
        type: 'object',
        properties: {
          id: ID_PARAM,
          board: BOARD_PARAM,
          instructions: { type: 'string', description: '可选：追加给子代理的本轮补充要求（如验收重点、环境说明）。' },
        },
        required: ['id'],
      },
      async execute(args) {
        const slug = await resolveBoardSlug(args)
        const out = await dispatchOp({ slug, id: reqId(args), instructions: args.instructions })
        const task = out && out.task
        return '已派发看板任务：' + (task ? task.title + '（id=' + task.id + '，状态=running' + (task.run && task.run.runId ? '，runId=' + task.run.runId : '') + '）。运行期间可用 kanban_get_task 查询进度与结果。' : 'ok')
      },
      presentCall(args) {
        const id = String((args && args.id) || '')
        return { card: 'generic', title: '看板：派发任务（id=' + shortId(id) + '）' }
      },
      presentResult: (_a, value) => textResultView('看板：已派发任务', value),
    },
    {
      name: 'kanban_stop_task',
      description: '终止正在运行(running)的看板任务：停止其子代理并把任务移回「就绪」列，之后可修改或重新派发。board 省略时在所有看板中查找任务 id。',
      parameters: { type: 'object', properties: { id: ID_PARAM, board: NO_BOARD_BOARD_PARAM }, required: ['id'] },
      async execute(args) {
        await load()
        const id = reqId(args)
        locateTask(args, id)
        return mutate(() => {
          const { slug, task } = locateTask(args, id)
          if (task.status !== 'running') throw new Error('任务未在运行（当前状态：' + STATUS_LABEL[task.status] + '）')
          terminateInner(slug, id, 'agent')
          return '已停止任务：' + task.title + '（id=' + task.id + '，已移回就绪）'
        })
      },
      presentCall(args) {
        const id = String((args && args.id) || '')
        return { card: 'generic', title: '看板：停止任务（id=' + shortId(id) + '）' }
      },
      presentResult: (_a, value) => textResultView('看板：已停止任务', value),
    },
    {
      name: 'kanban_delete_task',
      description: '删除看板任务（不可恢复）。若任务正在运行会先终止其子代理；等待该任务的子卡片会被激活。board 省略时在所有看板中查找任务 id。',
      parameters: { type: 'object', properties: { id: ID_PARAM, board: NO_BOARD_BOARD_PARAM }, required: ['id'] },
      async execute(args) {
        await load()
        const id = reqId(args)
        locateTask(args, id)
        return mutate(() => {
          const { slug } = locateTask(args, id)
          const removed = deleteTaskInner(slug, id)
          return '已删除任务：' + removed.title + '（id=' + removed.id + '）'
        })
      },
      presentCall(args) {
        const id = String((args && args.id) || '')
        return { card: 'generic', title: '看板：删除任务（id=' + shortId(id) + '）' }
      },
      presentResult: (_a, value) => textResultView('看板：已删除任务', value),
    },
    {
      name: 'kanban_create_board',
      description: '新建一个看板。name 为显示名；slug 可选（省略时由名称自动生成），供工具与 RPC 定位看板。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '看板名称（必填）。' },
          slug: { type: 'string', description: '看板 slug（可选，小写字母/数字/连字符）。' },
        },
        required: ['name'],
      },
      async execute(args) {
        const name = cap(String(args.name || '').trim(), 80)
        if (!name) throw new Error('看板名称不能为空')
        const board = await mutate(() => createBoardInner({ name, slug: args.slug }))
        return '已创建看板：' + board.name + '（slug=' + board.slug + '）'
      },
      presentCall(args) {
        const n = String((args && args.name) || '').trim()
        return { card: 'generic', title: '看板：创建看板「' + cap(n || '（无名称）', 40) + '」' }
      },
      presentResult: (_a, value) => textResultView('看板：已创建看板', value),
    },
  ]

  const tools = ctx.get('tools')
  if (tools && typeof tools.register === 'function') {
    for (const def of KANBAN_TOOLS) {
      disposers.push(tools.register({
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
            const reason = '心跳丢失：子代理超过 ' + Math.round(HEARTBEAT_TIMEOUT_MS / 60000) + ' 分钟无活动'
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
            pushEvent(task, 'blocked', { reason: '看板插件已停止' })
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
