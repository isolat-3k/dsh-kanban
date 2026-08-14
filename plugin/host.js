// DSH Kanban 看板插件 — Host 半（DSH Kanban board plugin, Host half）
// 运行环境：动态 Cordis Plugin 的 code.host（纯 JavaScript 函数体，无 import/TS）
// 持久化：<workspaceRoot>/DSH-kanban/kanban-store.json
// 来源：由会话内动态插件 kanban-1/pkg-1 沉淀（2026-08-14）
return {
  inject: ['fs', 'timer'],
  apply(ctx) {
    const sandboxPolicy = ctx.get('sandboxPolicy')
    const subagents = ctx.get('subagents')
    const agents = ctx.get('agents')

    const STATUSES = ['triage', 'todo', 'scheduled', 'ready', 'running', 'blocked', 'review', 'done', 'archived']

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

    // The dynamic-plugin vm sandbox does not expose AbortController, but every
    // consumer of SubagentStartRequest.signal only uses `aborted`, `reason`,
    // `addEventListener` and `removeEventListener`, so a duck-typed signal
    // satisfies the contract. `run.dispose()` remains the primary cancel path.
    function makeSignal() {
      const listeners = new Set()
      const signal = {
        aborted: false,
        reason: undefined,
        addEventListener(type, callback, opts) {
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
        return out
      })
      mutationChain = op.catch(() => {})
      return op
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
              if (task.status === 'running') {
                task.status = 'blocked'
                pushEvent(task, 'blocked', { reason: 'worker lost：插件重启后运行状态丢失' })
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

    function buildPrompt(task) {
      const lines = []
      lines.push('你被派发执行一个看板任务（DeepSeek Harness kanban dispatch）。')
      lines.push('')
      lines.push('【任务标题】' + task.title)
      if (task.body) {
        lines.push('')
        lines.push('【任务描述】')
        lines.push(task.body)
      }
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
      lines.push('请在当前工作区中完成该任务。完成后，用一段简短的总结说明你做了什么、结果如何、以及遗留事项（如有）。这段总结将作为任务的完成摘要写回看板。')
      return lines.join('\n')
    }

    async function settleRun(slug, id, seq, result) {
      try {
        await mutate(() => {
          const board = findBoard(slug)
          const task = board && findTask(board, id)
          if (!task || !task.run || task.run.seq !== seq) return
          runs.delete(KEY(slug, id))
          task.run.ended_at = now()
          const text = extractText(result && result.output)
          if (result && result.stopReason === 'completed') {
            task.status = 'done'
            task.run.outcome = 'done'
            task.run.summary = text
            pushEvent(task, 'completed', { summary: text || null })
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
          if (!task || !task.run || task.run.seq !== seq) return
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
    function route(method, fn) {
      disposers.push(harness.handle(method, async (args) => {
        try {
          return { ok: true, data: await fn(args || {}) }
        } catch (err) {
          return { ok: false, error: String((err && err.message) || err) }
        }
      }))
    }

    route('getStore', async () => {
      await load()
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
        const name = typeof p === 'string' ? p : (p.name || p.id || p.provider)
        if (!name) continue
        try {
          const list = await llm.listModels(name)
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

    route('createBoard', async (a) => {
      const slug = normSlug(a.slug) || slugify(a.name)
      if (!slug) throw new Error('看板 slug 无效')
      const name = cap(String(a.name || slug), 80)
      return mutate(() => {
        if (findBoard(slug)) throw new Error('同名看板已存在')
        const board = { slug, name, created_at: now(), tasks: [] }
        store.boards.push(board)
        return board
      })
    })

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

    route('createTask', async (a) => {
      const title = cap(String(a.title || '').trim(), 500)
      if (!title) throw new Error('标题不能为空')
      const body = cap(String(a.body || ''), 20000)
      let status = STATUSES.indexOf(a.status) >= 0 ? a.status : 'todo'
      if (status === 'running') throw new Error('running 列只能通过派发进入')
      if (Boolean(a.triage)) status = 'triage'
      const assignee = cap(String(a.assignee || ''), 200) || null
      const priority = clampInt(a.priority, 0, 9)
      return mutate(() => {
        const board = findBoard(String(a.slug || ''))
        if (!board) throw new Error('看板不存在')
        const task = {
          id: makeId('t'), title, body, status, assignee, priority,
          created_at: now(), updated_at: now(), comments: [], events: [], run: null,
        }
        pushEvent(task, 'created', { status })
        board.tasks.push(task)
        return task
      })
    })

    route('patchTask', async (a) => {
      return mutate(() => {
        const board = findBoard(String(a.slug || ''))
        const task = board && findTask(board, String(a.id || ''))
        if (!task) throw new Error('任务不存在')
        const patch = (a.patch && typeof a.patch === 'object') ? a.patch : {}
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
        if (changes.length === 0) return task
        task.updated_at = now()
        pushEvent(task, 'edited', { fields: changes })
        return task
      })
    })

    route('moveTask', async (a) => {
      const status = String(a.status || '')
      if (STATUSES.indexOf(status) < 0) throw new Error('未知状态: ' + status)
      if (status === 'running') throw new Error('running 列只能通过派发进入')
      const slug = String(a.slug || '')
      const id = String(a.id || '')
      return mutate(() => {
        const board = findBoard(slug)
        const task = board && findTask(board, id)
        if (!task) throw new Error('任务不存在')
        if (task.status === status) return task
        if (task.status === 'running') {
          abortRun(slug, id)
          if (task.run) { task.run.ended_at = now(); task.run.outcome = 'terminated' }
          pushEvent(task, 'terminated', {})
        }
        const from = task.status
        task.status = status
        task.updated_at = now()
        pushEvent(task, 'moved', { from, to: status, by: 'manual' })
        return task
      })
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
            if (task.status === status) { results.push({ id, ok: true }); continue }
            if (task.status === 'running') {
              abortRun(slug, id)
              if (task.run) { task.run.ended_at = now(); task.run.outcome = 'terminated' }
              pushEvent(task, 'terminated', {})
            }
            const from = task.status
            task.status = status
            task.updated_at = now()
            pushEvent(task, 'moved', { from, to: status, by: 'bulk' })
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
          board.tasks.splice(idx, 1)
          results.push({ id, ok: true })
        }
        return { results }
      })
    })

    route('deleteTask', async (a) => {
      const slug = String(a.slug || '')
      const id = String(a.id || '')
      return mutate(() => {
        const board = findBoard(slug)
        if (!board) throw new Error('看板不存在')
        const idx = board.tasks.findIndex(t => t.id === id)
        if (idx < 0) throw new Error('任务不存在')
        abortRun(slug, id)
        board.tasks.splice(idx, 1)
        return { ok: true }
      })
    })

    route('addComment', async (a) => {
      const body = cap(String(a.body || '').trim(), 4000)
      if (!body) throw new Error('评论不能为空')
      const slug = String(a.slug || '')
      const id = String(a.id || '')
      return mutate(() => {
        const board = findBoard(slug)
        const task = board && findTask(board, id)
        if (!task) throw new Error('任务不存在')
        if (!Array.isArray(task.comments)) task.comments = []
        const comment = { id: makeId('c'), author: 'user', body, created_at: now() }
        task.comments.push(comment)
        task.updated_at = now()
        pushEvent(task, 'commented', { commentId: comment.id })
        return { comment, task }
      })
    })

    route('dispatch', async (a) => {
      const slug = String(a.slug || '')
      const id = String(a.id || '')
      return mutate(async () => {
        const board = findBoard(slug)
        const task = board && findTask(board, id)
        if (!task) throw new Error('任务不存在')
        if (task.status !== 'ready') throw new Error('只有 ready 状态的任务可以派发')
        if (runs.has(KEY(slug, id))) throw new Error('任务已在运行中')
        if (!subagents) throw new Error('当前 DSH 没有挂载 subagents 服务')
        const parent = (agents && typeof agents.currentInitiator === 'function' ? agents.currentInitiator() : undefined)
          || (agents && typeof agents.roots === 'function' ? agents.roots()[0] : undefined)
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
        const signal = makeSignal()
        const startRequest = {
          label: 'kanban: ' + cap(task.title, 60),
          prompt: [{ type: 'text', text: buildPrompt(task) }],
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
        runs.set(KEY(slug, id), { signal, run, seq })
        task.status = 'running'
        task.run = {
          provider: providerName, runId: String(run.id), seq,
          started_at: now(), ended_at: null, outcome: null, summary: null, error: null,
        }
        task.updated_at = now()
        pushEvent(task, 'dispatched', { provider: providerName, runId: task.run.runId, model: task.assignee || null })
        run.result.then(result => settleRun(slug, id, seq, result)).catch(err => settleError(slug, id, seq, err))
        return { ok: true, task }
      })
    })

    route('terminate', async (a) => {
      const slug = String(a.slug || '')
      const id = String(a.id || '')
      return mutate(() => {
        const board = findBoard(slug)
        const task = board && findTask(board, id)
        if (!task) throw new Error('任务不存在')
        if (task.status !== 'running') throw new Error('任务未在运行')
        abortRun(slug, id)
        if (task.run) { task.run.ended_at = now(); task.run.outcome = 'terminated' }
        task.status = 'ready'
        task.updated_at = now()
        pushEvent(task, 'terminated', {})
        return { ok: true, task }
      })
    })

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
          storeTarget().then(target => ctx.fs.writeText(target, JSON.stringify(store), undefined, undefined, resolvePolicy())).catch(() => {})
        }
      }
    })
  },
}
