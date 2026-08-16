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
        { id: 'triage', label: '待细化', tone: 'var(--dsw-alias-label-secondary)' },
        { id: 'todo', label: '待办', tone: 'var(--dsw-alias-label-secondary)' },
        { id: 'scheduled', label: '定时', tone: '#a78bfa' },
        { id: 'ready', label: '就绪', tone: '#60a5fa' },
        { id: 'running', label: '运行中', tone: '#34d399' },
        { id: 'blocked', label: '阻塞', tone: '#f87171' },
        { id: 'review', label: '审核', tone: '#fbbf24' },
        { id: 'done', label: '完成', tone: 'var(--dsw-alias-state-success-primary)' },
        { id: 'archived', label: '归档', tone: 'var(--dsw-alias-label-secondary)' },
      ]
      const statusOf = (id) => {
        for (const s of STATUSES) if (s.id === id) return s
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
        if (m < 1) return '刚刚'
        if (m < 60) return m + ' 分钟'
        const hr = Math.floor(m / 60)
        if (hr < 24) return hr + ' 小时'
        return Math.floor(hr / 24) + ' 天'
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
          return h > 0 ? d + ' 天 ' + h + ' 小时' : d + ' 天'
        }
        if (m >= 60) {
          const h = Math.floor(m / 60)
          const mm = m % 60
          return mm > 0 ? h + ' 小时 ' + mm + ' 分' : h + ' 小时'
        }
        return m + ' 分钟'
      }
      const fmtRemain = (ts) => {
        if (!ts) return ''
        const ms = ts - Date.now()
        if (ms <= 0) return '已到期'
        return '还剩 ' + fmtMinutes(Math.floor(ms / 60000))
      }
      const fmtAbs = (ts) => {
        if (!ts) return ''
        const d = new Date(ts)
        const p = (n) => String(n).padStart(2, '0')
        return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
      }
      const scheduleKindLabel = (s) => {
        if (!s) return ''
        if (s.kind === 'interval') return '间隔重复 · 每' + fmtMinutes(s.intervalMinutes)
        if (s.kind === 'daily') return '每天 ' + toHM(s.dailyMinutes)
        return ''
      }
      const scheduleChip = (s) => {
        // 定时列卡片：方式 + 父卡片 + 「还剩xx · 绝对时间」
        if (!s) return ''
        const parts = []
        const kl = scheduleKindLabel(s)
        if (kl) parts.push(kl)
        if (s.parentId) parts.push('父 ' + shortId(s.parentId))
        if (typeof s.nextAt === 'number') parts.push(fmtRemain(s.nextAt) + ' · ' + fmtAbs(s.nextAt))
        if (parts.length === 0 && !s.kind && s.parentId) parts.push('等待父卡片完成')
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
      const schedulePayload = (sched) => (sched.kind === 'none'
        ? null
        : {
            kind: sched.kind,
            intervalMinutes: sched.kind === 'interval' ? Math.max(1, Math.min(10080, Math.round(Number(sched.intervalMinutes) || 60))) : undefined,
            dailyTime: sched.kind === 'daily' ? sched.dailyTime : undefined,
            parentId: sched.parentId ? sched.parentId : null,
          })

      function call(method, args) {
        return fetch('/kanban/rpc', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ method, args: args || {} }),
        }).then(res => {
          if (!res.ok) throw new Error('HTTP ' + res.status)
          return res.json()
        }).then(res => {
          if (res && res.ok === true) return res.data
          throw new Error((res && res.error) || '未知错误')
        })
      }

      function Lane(props) {
        const [over, setOver] = React.useState(false)
        const meta = statusOf(props.lane.id)
        const head = h('div', { className: 'kbn-lane-head', onClick: () => props.onToggleCollapse(props.lane.id) },
          h('span', { className: 'kbn-lane-dot', style: { borderColor: meta.tone } }),
          h('span', { className: 'kbn-lane-label' }, meta.label),
          h('span', { className: 'kbn-lane-count' }, props.laneTasks.length),
          h('span', { className: 'kbn-lane-head-spacer' }),
          h('button', { className: 'kbn-icon-btn', title: '筛选', onClick: e => { e.stopPropagation(); props.onToggleFilter(props.lane.id) } }, '⌕'),
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
            placeholder: '搜索标题/正文/ID…',
            value: props.filterText,
            onChange: e => props.onFilterChange(props.lane.id, e.target.value),
          }) : null,
          h('div', { className: 'kbn-lane-body' },
            props.shown.length === 0 && props.filterText.trim().length > 0 ? h('div', { className: 'kbn-lane-empty' }, '无匹配任务') : null,
            props.shown.map(t => h(Card, {
              key: t.id,
              task: t,
              selected: Boolean(props.selectedIds[t.id]),
              onOpen: props.onOpenTask,
              onToggleSelect: props.onToggleSelect,
            })),
            h('button', { className: 'kbn-card-new', title: '在此列新建任务', onClick: () => props.onNewTask(props.lane.id) }, '＋ 新建任务'),
          ),
        )
      }

      function Card(props) {
        const [dragging, setDragging] = React.useState(false)
        const t = props.task
        const meta = statusOf(t.status)
        return h('div', {
          className: 'kbn-card'
            + (props.selected ? ' kbn-card-sel' : '')
            + (dragging ? ' kbn-card-drag' : '')
            + (t.status === 'running' ? ' kbn-card-running' : ''),
          style: { borderLeftColor: meta.tone },
          draggable: true,
          onClick: e => {
            if (e.ctrlKey || e.metaKey) {
              e.stopPropagation()
              props.onToggleSelect(t.id)
            } else {
              props.onOpen(t.id)
            }
          },
          onDragStart: e => {
            e.dataTransfer.setData('text/plain', t.id)
            e.dataTransfer.effectAllowed = 'move'
            setDragging(true)
          },
          onDragEnd: () => setDragging(false),
        },
          h('div', { className: 'kbn-card-title' }, t.title),
          t.body ? h('div', { className: 'kbn-card-body' }, cap(t.body, 160)) : null,
          h('div', { className: 'kbn-card-foot' },
            t.assignee ? h('span', { className: 'kbn-chip', title: '模型：' + t.assignee }, t.assignee) : null,
            t.status === 'scheduled' && t.schedule ? h('span', { className: 'kbn-chip', title: scheduleChip(t.schedule) }, scheduleChip(t.schedule)) : null,
            t.status !== 'scheduled' && t.schedule && t.schedule.kind ? h('span', { className: 'kbn-chip', title: '重复任务：本轮完成后自动回排定时列' }, scheduleKindLabel(t.schedule)) : null,
            h('span', { className: 'kbn-prio ' + prioTier(t.priority), title: '优先级 ' + t.priority }, String(t.priority)),
            t.comments && t.comments.length > 0 ? h('span', { className: 'kbn-chip' }, '评论个数' + t.comments.length) : null,
            t.status === 'running' ? h('span', { className: 'kbn-run-chip' }, '运行中') : null,
            h('span', { className: 'kbn-age' }, fmtAge(t.created_at)),
          ),
        )
      }

      function BulkBar(props) {
        const [status, setStatus] = React.useState('ready')
        const count = Object.keys(props.selected).length
        return h('div', { className: 'kbn-bulkbar' },
          h('span', { className: 'kbn-bulkbar-count' }, '已选 ' + count + ' 项'),
          h('button', { className: 'kbn-btn', onClick: () => props.onMove('ready') }, '就绪'),
          h('button', { className: 'kbn-btn', onClick: () => props.onMove('done') }, '完成'),
          h('select', { className: 'kbn-input kbn-select', value: status, onChange: e => setStatus(e.target.value) },
            STATUSES.filter(s => s.id !== 'running').map(s => h('option', { key: s.id, value: s.id }, s.label)),
          ),
          h('button', { className: 'kbn-btn', onClick: () => props.onMove(status) }, '移动'),
          h('button', { className: 'kbn-btn kbn-btn-danger', onClick: () => props.onDelete() }, '删除'),
          h('button', { className: 'kbn-btn', onClick: () => props.onClear() }, '取消选择'),
        )
      }

      function eventText(ev) {
        const p = ev.payload || {}
        if (ev.kind === 'created') return '创建任务（' + (p.status || '') + '）'
        if (ev.kind === 'edited') return '编辑字段：' + (p.fields ? p.fields.join('、') : '')
        if (ev.kind === 'moved') {
          const by = p.by
          if (by === 'parent') return '父卡片完成 → 自动激活：' + (p.from || '?') + ' → ' + (p.to || '?')
          if (by === 'interval') return '间隔定时到点 → 自动激活：' + (p.from || '?') + ' → ' + (p.to || '?')
          if (by === 'daily') return '每日定时到点 → 自动激活：' + (p.from || '?') + ' → ' + (p.to || '?')
          if (by === 'schedule') return '本轮完成 → 回排定时列：' + (p.from || '?') + ' → ' + (p.to || '?')
          if (by === 'timer') return '旧定时到点提权：' + (p.from || '?') + ' → ' + (p.to || '?')
          return '移动：' + (p.from || '?') + ' → ' + (p.to || '?')
        }
        if (ev.kind === 'commented') return '添加评论'
        if (ev.kind === 'dispatched') return '派发执行（provider: ' + (p.provider || '?') + '）'
        if (ev.kind === 'completed') return '执行完成'
        if (ev.kind === 'terminated') return '手动终止运行'
        if (ev.kind === 'blocked') return '阻塞：' + (p.reason || '')
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
        const [confirmDel, setConfirmDel] = React.useState(false)
        const meta = statusOf(task.status)

        React.useEffect(() => {
          call('listModels').then(data => {
            const list = (data && data.models) || []
            setModelOptions(list.map(String))
          }).catch(() => {})
        }, [])

        // 服务端字段变化时同步本地编辑态：仅在任务真正被编辑（外部修改/其他标签页/Agent 工具）
        // 时同步，运行进度与心跳等 5s 轮询刷新不会打断正在进行的输入。
        const serverSigRef = React.useRef(JSON.stringify({
          title: task.title, body: task.body, assignee: task.assignee,
          priority: task.priority, schedule: task.schedule,
        }))
        React.useEffect(() => {
          const sig = JSON.stringify({
            title: task.title, body: task.body, assignee: task.assignee,
            priority: task.priority, schedule: task.schedule,
          })
          if (sig !== serverSigRef.current) {
            serverSigRef.current = sig
            setTitle(task.title || '')
            setBody(task.body || '')
            setAssignee(task.assignee || '')
            setPriority(task.priority || 0)
            setSched(schedFromTask(task))
          }
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
            h('button', { className: 'kbn-icon-btn', title: '关闭', onClick: () => props.onClose() }, '✕'),
          ),
          h('div', { className: 'kbn-drawer-scroll' },
            err ? h('div', { className: 'kbn-error' }, err) : null,
            h('div', { className: 'kbn-field' },
              h('span', { className: 'kbn-field-label' }, '标题'),
              h('input', { className: 'kbn-input', value: title, onChange: e => setTitle(e.target.value) }),
            ),
            h('div', { className: 'kbn-field' },
              h('span', { className: 'kbn-field-label' }, '状态'),
              h('div', { className: 'kbn-status-view', style: { '--tone': meta.tone } },
                h('span', { className: 'kbn-status-dot' }),
                meta.label,
              ),
            ),
            h('div', { className: 'kbn-field-row' },
              h('div', { className: 'kbn-field', style: { flex: 1 } },
                h('span', { className: 'kbn-field-label' }, '子Agent模型'),
                h('select', { className: 'kbn-input kbn-select', value: assignee, onChange: e => setAssignee(e.target.value) },
                  h('option', { value: '' }, '默认模型（跟随会话）'),
                  assignee && modelOptions.indexOf(assignee) < 0 ? h('option', { value: assignee }, assignee) : null,
                  modelOptions.map(m => h('option', { key: m, value: m }, m)),
                ),
              ),
              h('div', { className: 'kbn-field' },
                h('span', { className: 'kbn-field-label' }, '优先级（0-9，越大越优先）'),
                h('input', { className: 'kbn-input', type: 'number', min: 0, max: 9, value: String(priority), onChange: e => setPriority(clampNum(e.target.value, 0, 9)) }),
              ),
            ),
            h('div', { className: 'kbn-field' },
              h('span', { className: 'kbn-field-label' }, '描述'),
              h('textarea', { className: 'kbn-input kbn-textarea', rows: 6, value: body, onChange: e => setBody(e.target.value) }),
            ),
            h('div', { className: 'kbn-field' },
              h('span', { className: 'kbn-field-label' }, '定时（停放后自动激活方式）'),
              h('select', { className: 'kbn-input kbn-select', value: sched.kind, onChange: e => setSched({ ...sched, kind: e.target.value }) },
                h('option', { value: 'none' }, '无（仅停放，不自动激活）'),
                h('option', { value: 'interval' }, '间隔重复（每 N 分钟）'),
                h('option', { value: 'daily' }, '每天固定时刻'),
              ),
            ),
            sched.kind === 'interval' ? h('div', { className: 'kbn-field' },
              h('span', { className: 'kbn-field-label' }, '间隔（分钟，1-10080，最长 7 天）'),
              h('input', { className: 'kbn-input', type: 'number', min: 1, max: 10080, value: String(sched.intervalMinutes), onChange: e => setSched({ ...sched, intervalMinutes: e.target.value }) }),
            ) : null,
            sched.kind === 'daily' ? h('div', { className: 'kbn-field' },
              h('span', { className: 'kbn-field-label' }, '每天时刻'),
              h('input', { className: 'kbn-input', type: 'time', value: sched.dailyTime, onChange: e => setSched({ ...sched, dailyTime: e.target.value }) }),
            ) : null,
            h('div', { className: 'kbn-field' },
              h('span', { className: 'kbn-field-label' }, '父卡片（可选：父卡片完成时激活；不设则不激活）'),
              h('select', { className: 'kbn-input kbn-select', value: sched.parentId, onChange: e => setSched({ ...sched, parentId: e.target.value }) },
                h('option', { value: '' }, '无（不设置父卡片）'),
                (props.tasks || []).filter(t => t.id !== task.id).map(t => h('option', { key: t.id, value: t.id }, t.title + '（' + statusOf(t.status).label + '）')),
              ),
            ),
            task.schedule && (task.schedule.kind || task.schedule.parentId) ? h('div', { className: 'kbn-field' },
              h('span', { className: 'kbn-field-label' }, '当前定时'),
              h('div', { className: 'kbn-run-info' },
                scheduleKindLabel(task.schedule) || '等待父卡片完成',
                task.schedule.parentId ? h('div', null, '父卡片：' + shortId(task.schedule.parentId) + '（' + (() => {
                  const p = (props.tasks || []).find(x => x.id === task.schedule.parentId)
                  return p ? statusOf(p.status).label : '已删除（视为已完成）'
                })() + '）') : null,
                typeof task.schedule.nextAt === 'number' ? h('div', null, '下次激活：' + fmtRemain(task.schedule.nextAt) + '　' + fmtAbs(task.schedule.nextAt)) : null,
              ),
            ) : null,
            h('button', {
              className: 'kbn-btn',
              disabled: busy || !title.trim(),
              onClick: () => act(() => call('patchTask', {
                slug: props.slug, id: task.id,
                patch: { title: title.trim(), body, assignee, priority, schedule: schedulePayload(sched) },
              })),
            }, '保存修改'),
            h('div', { className: 'kbn-runbox' },
              h('div', { className: 'kbn-section-title', style: { marginBottom: 0 } }, '执行'),
              task.run ? h('div', { className: 'kbn-run-info' },
                h('div', null, 'Provider：' + (task.run.provider || '?') + '　Run：' + (task.run.runId || '?')),
                h('div', null, '开始：' + fmtTime(task.run.started_at) + (task.run.ended_at ? '　结束：' + fmtTime(task.run.ended_at) : '')),
                task.run.heartbeat_at ? h('div', null, '最近活动：' + fmtTime(task.run.heartbeat_at)) : null,
                task.run.outcome === 'done' ? h('div', { className: 'kbn-run-ok' }, '结果：完成') : null,
                task.run.outcome === 'error' ? h('div', { className: 'kbn-run-bad' }, '结果：失败') : null,
                task.run.outcome === 'terminated' ? h('div', null, '结果：已终止') : null,
                task.run.summary ? h('div', { className: 'kbn-run-summary' }, task.run.summary) : null,
                task.run.error ? h('div', { className: 'kbn-run-bad' }, '错误：' + task.run.error) : null,
              ) : h('div', { className: 'kbn-run-info' }, '尚未执行过'),
              task.run && Array.isArray(task.run.progress) && task.run.progress.length > 0 ? h('div', null,
                h('div', { className: 'kbn-section-title', style: { marginBottom: 4 } }, '实时进度（最近 ' + task.run.progress.length + ' 行）'),
                h('div', { className: 'kbn-run-summary' }, task.run.progress.join('\n')),
              ) : null,
              (task.status !== 'running' && task.status !== 'archived') ? h('button', {
                className: 'kbn-btn kbn-btn-run',
                disabled: busy,
                onClick: () => act(() => {
                  const prepare = task.status === 'ready'
                    ? Promise.resolve()
                    : call('moveTask', { slug: props.slug, id: task.id, status: 'ready' })
                  return prepare.then(() => call('dispatch', { slug: props.slug, id: task.id }))
                }),
              }, '▶ 派发给 DSH 代理执行') : null,
              task.status === 'running' ? h('button', {
                className: 'kbn-btn kbn-btn-stop',
                disabled: busy,
                onClick: () => act(() => call('terminate', { slug: props.slug, id: task.id })),
              }, '■ 停止运行') : null,
              task.status === 'running' ? h('div', { className: 'kbn-run-hint' },
                task.schedule && task.schedule.kind
                  ? '重复任务：本轮完成后自动回到「定时」列等待下一轮；失败则转「阻塞」。'
                  : '已派发给 DSH 子代理执行，完成后自动流转为「完成」；失败则转「阻塞」。') : null,
            ),
            h('div', { className: 'kbn-comments' },
              h('div', { className: 'kbn-section-title' }, '评论（' + ((task.comments || []).length) + '）'),
              (task.comments || []).map(c => h('div', { key: c.id, className: 'kbn-comment' },
                h('div', { className: 'kbn-comment-meta' }, (c.author || 'user') + ' · ' + fmtTime(c.created_at)),
                h('div', { className: 'kbn-comment-body' }, c.body),
              )),
              h('div', { className: 'kbn-comment-compose' },
                h('textarea', {
                  className: 'kbn-input kbn-textarea',
                  rows: 3,
                  placeholder: '写评论…（运行期间新评论不会实时送达代理）',
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
                }, '发表评论'),
              ),
            ),
            h('div', { className: 'kbn-events' },
              h('div', { className: 'kbn-section-title' }, '事件时间线（' + ((task.events || []).length) + '）'),
              (task.events || []).slice().reverse().map(ev => h('div', { key: ev.id, className: 'kbn-event' },
                h('span', { className: 'kbn-event-meta' }, fmtTime(ev.created_at)),
                h('span', { className: 'kbn-event-body' }, eventText(ev)),
              )),
            ),
          ),
          h('div', { className: 'kbn-drawer-foot' },
            confirmDel ? h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-state-error-primary)' } }, '确认删除该任务？') : null,
            confirmDel
              ? h('button', { className: 'kbn-btn kbn-btn-danger', disabled: busy, onClick: () => { act(() => call('deleteTask', { slug: props.slug, id: task.id }).then(() => props.onClose())); } }, '确认删除')
              : h('button', { className: 'kbn-btn kbn-btn-danger', onClick: () => setConfirmDel(true) }, '删除任务'),
            confirmDel ? h('button', { className: 'kbn-btn', onClick: () => setConfirmDel(false) }, '取消') : null,
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
          if (!title.trim()) { setErr('请填写标题'); return }
          setBusy(true)
          setErr(null)
          call('createTask', {
            slug: props.slug, title: title.trim(), body, assignee, priority, status,
            schedule: status === 'scheduled' ? schedulePayload(sched) : null,
          })
            .then(() => { props.onCreated(); props.onClose() })
            .catch(e => { setBusy(false); setErr(String((e && e.message) || e)) })
        }

        return h('div', { className: 'kbn-modal-mask', onClick: e => { if (e.target === e.currentTarget) props.onClose() } },
          h('div', { className: 'kbn-modal' },
            h('div', { className: 'kbn-modal-title' }, '新建任务'),
            err ? h('div', { className: 'kbn-error' }, err) : null,
            h('div', { className: 'kbn-field' },
              h('span', { className: 'kbn-field-label' }, '标题'),
              h('input', { className: 'kbn-input', autoFocus: true, value: title, onChange: e => setTitle(e.target.value), onKeyDown: e => { if (e.key === 'Enter') submit() } }),
            ),
            h('div', { className: 'kbn-field' },
              h('span', { className: 'kbn-field-label' }, '描述'),
              h('textarea', { className: 'kbn-input kbn-textarea', rows: 5, value: body, onChange: e => setBody(e.target.value) }),
            ),
            h('div', { className: 'kbn-field-row' },
              h('div', { className: 'kbn-field', style: { flex: 1 } },
                h('span', { className: 'kbn-field-label' }, '子Agent模型'),
                h('select', { className: 'kbn-input kbn-select', value: assignee, onChange: e => setAssignee(e.target.value) },
                  h('option', { value: '' }, '默认模型（跟随会话）'),
                  modelOptions.map(m => h('option', { key: m, value: m }, m)),
                ),
              ),
              h('div', { className: 'kbn-field' },
                h('span', { className: 'kbn-field-label' }, '优先级（0-9，越大越优先）'),
                h('input', { className: 'kbn-input', type: 'number', min: 0, max: 9, value: String(priority), onChange: e => setPriority(clampNum(e.target.value, 0, 9)) }),
              ),
            ),
            h('div', { className: 'kbn-field' },
              h('span', { className: 'kbn-field-label' }, '初始列'),
              h('select', {
                className: 'kbn-input kbn-select',
                value: status,
                onChange: e => setStatus(e.target.value),
              },
                STATUSES.filter(s => s.id !== 'running').map(s => h('option', { key: s.id, value: s.id }, s.label)),
              ),
            ),
            status === 'scheduled' ? h('div', { className: 'kbn-field' },
              h('span', { className: 'kbn-field-label' }, '定时（停放后自动激活方式）'),
              h('select', { className: 'kbn-input kbn-select', value: sched.kind, onChange: e => setSched({ ...sched, kind: e.target.value }) },
                h('option', { value: 'none' }, '无（仅停放，不自动激活）'),
                h('option', { value: 'interval' }, '间隔重复（每 N 分钟）'),
                h('option', { value: 'daily' }, '每天固定时刻'),
              ),
            ) : null,
            status === 'scheduled' && sched.kind === 'interval' ? h('div', { className: 'kbn-field' },
              h('span', { className: 'kbn-field-label' }, '间隔（分钟，1-10080，最长 7 天）'),
              h('input', { className: 'kbn-input', type: 'number', min: 1, max: 10080, value: String(sched.intervalMinutes), onChange: e => setSched({ ...sched, intervalMinutes: e.target.value }) }),
            ) : null,
            status === 'scheduled' && sched.kind === 'daily' ? h('div', { className: 'kbn-field' },
              h('span', { className: 'kbn-field-label' }, '每天时刻'),
              h('input', { className: 'kbn-input', type: 'time', value: sched.dailyTime, onChange: e => setSched({ ...sched, dailyTime: e.target.value }) }),
            ) : null,
            status === 'scheduled' ? h('div', { className: 'kbn-field' },
              h('span', { className: 'kbn-field-label' }, '父卡片（可选：父卡片完成时激活；不设则不激活）'),
              h('select', { className: 'kbn-input kbn-select', value: sched.parentId, onChange: e => setSched({ ...sched, parentId: e.target.value }) },
                h('option', { value: '' }, '无（不设置父卡片）'),
                (props.tasks || []).map(t => h('option', { key: t.id, value: t.id }, t.title + '（' + statusOf(t.status).label + '）')),
              ),
            ) : null,
            h('div', { className: 'kbn-modal-actions' },
              h('button', { className: 'kbn-btn', onClick: () => props.onClose() }, '取消'),
              h('button', { className: 'kbn-btn kbn-btn-run', disabled: busy, onClick: submit }, '创建'),
            ),
          ),
        )
      }

      function CreateBoardForm(props) {
        const [name, setName] = React.useState('')
        const [busy, setBusy] = React.useState(false)
        const [err, setErr] = React.useState(null)
        function submit() {
          if (!name.trim()) { setErr('请填写看板名称'); return }
          setBusy(true)
          setErr(null)
          call('createBoard', { name: name.trim() })
            .then(board => { props.onCreated(board.slug); props.onClose() })
            .catch(e => { setBusy(false); setErr(String((e && e.message) || e)) })
        }
        return h('div', { className: 'kbn-modal-mask', onClick: e => { if (e.target === e.currentTarget) props.onClose() } },
          h('div', { className: 'kbn-modal' },
            h('div', { className: 'kbn-modal-title' }, '新建看板'),
            err ? h('div', { className: 'kbn-error' }, err) : null,
            h('input', { className: 'kbn-input', autoFocus: true, placeholder: '看板名称', value: name, onChange: e => setName(e.target.value), onKeyDown: e => { if (e.key === 'Enter') submit() } }),
            h('div', { className: 'kbn-modal-actions' },
              h('button', { className: 'kbn-btn', onClick: () => props.onClose() }, '取消'),
              h('button', { className: 'kbn-btn kbn-btn-run', disabled: busy, onClick: submit }, '创建'),
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
          return ctx.interval(() => refresh(false), 5000)
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
            if (failed.length > 0) setError('部分任务移动失败：' + failed.map(r => r.error).join('；'))
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
              h('div', { className: 'kbn-error' }, '看板数据加载失败：' + error + '（若持续出现，请重启 DSH 服务后刷新页面）'),
              h('button', { className: 'kbn-btn', style: { marginTop: 10 }, onClick: () => { setError(null); refresh(false) } }, '重试'),
            )
          }
          return h('div', { className: 'kbn-empty' }, '加载中…')
        }

        return h('div', { className: 'kbn-body' },
          error ? h('div', { className: 'kbn-error' }, error + '（请检查插件与存储）') : null,
          h('div', { className: 'kbn-toolbar' },
            store.boards.length > 0 ? h('select', {
              className: 'kbn-input kbn-select',
              value: slug || '',
              onChange: e => { setSlug(e.target.value); setSel({}); setDrawerId(null) },
            },
              store.boards.map(b => h('option', { key: b.slug, value: b.slug }, b.name + '（' + b.tasks.length + '）')),
            ) : null,
            h('button', { className: 'kbn-btn', onClick: () => setCreating(!creating) }, '新建看板'),
            confirmBoardDel ? h('button', { className: 'kbn-btn kbn-btn-danger', disabled: !board, onClick: doDeleteBoard }, '确认删除当前看板') : null,
            board && !confirmBoardDel ? h('button', { className: 'kbn-btn kbn-btn-danger', onClick: () => setConfirmBoardDel(true) }, '删板') : null,
            confirmBoardDel ? h('button', { className: 'kbn-btn', onClick: () => setConfirmBoardDel(false) }, '取消') : null,
            h('button', { className: 'kbn-btn' + (showArchived ? ' on' : ''), onClick: () => setShowArchived(!showArchived) }, '显示已归档列'),
            h('button', { className: 'kbn-btn kbn-btn-run', disabled: !board, onClick: () => setDialog({ lane: 'triage' }) }, '＋ 新任务'),
            h('button', { className: 'kbn-btn', title: '强制重读磁盘数据', onClick: () => refresh(true) }, '刷新'),
          ),
          creating ? h(CreateBoardForm, { onCreated: newSlug => { setSlug(newSlug); refresh(false) }, onClose: () => setCreating(false) }) : null,
          selIds.length > 1 ? h(BulkBar, {
            selected: sel,
            onMove: doBulkMove,
            onDelete: doBulkDelete,
            onClear: () => setSel({}),
          }) : null,
          store.boards.length === 0 ? h('div', { className: 'kbn-empty' }, '还没有看板。点击「新建看板」创建第一个看板。') : null,
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
          function scan() {
            call('getStore').then(data => {
              if (!alive) return
              const boards = (data && data.boards) || []
              const nextSeen = seenRef.current || {}
              const newToasts = []
              for (const b of boards) {
                for (const t of b.tasks || []) {
                  const run = t.run
                  const prev = nextSeen[t.id]
                  if (run && run.outcome && (!prev || prev.outcome !== run.outcome)) {
                    if (run.outcome === 'done') {
                      newToasts.push({ key: 't' + (++seq), tone: 'ok', title: '看板任务「' + cap(t.title, 30) + '」已完成', detail: '' })
                    } else if (run.outcome === 'error') {
                      newToasts.push({ key: 't' + (++seq), tone: 'bad', title: '看板任务「' + cap(t.title, 30) + '」已阻塞', detail: run.error ? String(run.error) : '' })
                    }
                  }
                  nextSeen[t.id] = { outcome: run && run.outcome ? run.outcome : null }
                }
              }
              if (seenRef.current === null) {
                // 首轮只做基线，不回放历史结算（刷新页面不刷旧 toast）
                seenRef.current = nextSeen
              } else {
                seenRef.current = nextSeen
                if (newToasts.length > 0) {
                  setToasts(prev => [...prev, ...newToasts])
                  for (const t of newToasts) {
                    setTimeout(() => {
                      if (!alive) return
                      setToasts(prev => prev.filter(x => x.key !== t.key))
                    }, 6000)
                  }
                }
              }
            }).catch(() => {
              // 轮询失败静默：下个周期重试
            })
          }
          scan()
          return ctx.interval(scan, 5000)
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
      disposers.push(insertCss(CSS))
      slots.inject('conversation.view', () => slots.register(
        { name: 'conversation.view', id: 'kanban', order: 20, label: () => '看板' },
        () => h(KanbanView),
      ))
      slots.inject('shell.overlay', () => slots.register(
        { name: 'shell.overlay', id: 'kanban-status', order: 0 },
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
