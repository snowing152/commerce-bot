import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import {
  Icon, Button, Input, Card, StatusBadge, LogLine, ProgressBar, Spinner, Kbd, SectionHeader, Wordmark,
} from './components'
import { BotResult } from './types'

/* ============================================================ */
/*  TYPES                                                        */
/* ============================================================ */

export interface Task {
  id: string
  keyword: string
  product: string
  min: number
  max: number
  status: 'idle' | 'running' | 'warn' | 'error'
}

export interface LogEntry {
  id: string
  time: string
  level: string
  source: string
  message: string
}

/* ============================================================ */
/*  AUTH PAGE                                                    */
/* ============================================================ */

export interface AuthPageProps {
  status: 'idle' | 'waiting' | 'confirmed' | 'error'
  onStatusChange: (s: 'idle' | 'waiting' | 'confirmed' | 'error') => void
  onAuthenticated: () => void
  onLoginClick?: () => void
}

export function AuthPage({ status, onStatusChange, onAuthenticated, onLoginClick }: AuthPageProps) {
  const [pollSeconds, setPollSeconds] = useState(0)

  useEffect(() => {
    if (status !== 'waiting') { setPollSeconds(0); return }
    const id = setInterval(() => setPollSeconds(s => s + 1), 1000)
    return () => clearInterval(id)
  }, [status])

  const handleLogin = () => {
    if (onLoginClick) {
      onLoginClick()
    } else {
      onStatusChange('waiting')
    }
  }

  const statusCopy: Record<string, { label: string; hint: string }> = {
    idle:      { label: 'Ready',                     hint: 'Tap below to open Telegram and authorize this device.' },
    waiting:   { label: 'Waiting for confirmation',  hint: 'Open Telegram and tap “Confirm login” in the chat.' },
    confirmed: { label: 'Confirmed',                 hint: 'Redirecting to your dashboard…' },
    error:     { label: 'Authorization failed',      hint: "We didn't hear back. Check Telegram and try again." },
  }

  return (
    <div className="h-full w-full grid place-items-center p-8 bg-[radial-gradient(circle_at_50%_-10%,rgba(255,255,255,0.03),transparent_60%)]">
      <div className="w-full max-w-[380px] flex flex-col items-center">
        <div className="mb-10 flex flex-col items-center">
          <Wordmark size="lg" />
        </div>

        <Card className="w-full p-7">
          <div className="flex flex-col items-center text-center">
            <h1 className="text-[18px] font-semibold tracking-tight text-zinc-100 mb-1.5">
              Sign in to continue
            </h1>
            <p className="text-[12.5px] text-zinc-500 leading-relaxed max-w-[280px]">
              Coupang Bot uses Telegram for secure, password-free login.
            </p>

            <button
              onClick={handleLogin}
              disabled={status === 'waiting' || status === 'confirmed'}
              className="mt-7 w-full h-10 inline-flex items-center justify-center gap-2 rounded-md
                         bg-[#229ED9] hover:bg-[#1f93cb] text-white font-medium text-[13.5px]
                         transition-colors disabled:opacity-50 disabled:cursor-not-allowed
                         shadow-[0_1px_0_rgba(255,255,255,0.15)_inset]"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.24 3.64 11.95c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z"/>
              </svg>
              {status === 'waiting' ? 'Waiting…' : 'Continue with Telegram'}
            </button>

            <div className="mt-6 w-full">
              <div className={`rounded-md border px-3 py-2.5 transition-colors ${
                status === 'error'     ? 'border-red-500/15 bg-red-500/[0.04]'      :
                status === 'confirmed' ? 'border-emerald-500/15 bg-emerald-500/[0.04]' :
                status === 'waiting'   ? 'border-amber-500/15 bg-amber-500/[0.04]'  :
                                         'border-zinc-800 bg-zinc-900/40'
              }`}>
                <div className="flex items-center gap-2.5">
                  {status === 'waiting'   && <Spinner size={13} className="text-amber-300" />}
                  {status === 'confirmed' && <Icon name="check" className="w-3.5 h-3.5 text-emerald-300" />}
                  {status === 'error'     && <Icon name="alert" className="w-3.5 h-3.5 text-red-300" />}
                  {status === 'idle'      && <span className="w-2 h-2 rounded-full bg-zinc-600" />}
                  <span className="text-[12px] font-medium text-zinc-200 flex-1 text-left">
                    {statusCopy[status]?.label}
                  </span>
                  {status === 'waiting' && (
                    <span className="text-[10.5px] text-zinc-500 tabular-nums font-mono">{pollSeconds}s</span>
                  )}
                </div>
                <p className="text-[11.5px] text-zinc-500 mt-1.5 text-left leading-relaxed">
                  {statusCopy[status]?.hint}
                </p>
              </div>

              {status === 'error' && (
                <button onClick={handleLogin}
                  className="mt-3 w-full text-[12px] text-zinc-400 hover:text-zinc-200 inline-flex items-center justify-center gap-1.5">
                  <Icon name="refresh" className="w-3 h-3" /> Try again
                </button>
              )}
              {status === 'confirmed' && (
                <button onClick={onAuthenticated}
                  className="mt-3 w-full text-[12px] text-emerald-300 hover:text-emerald-200 inline-flex items-center justify-center gap-1">
                  Continue <Icon name="chevronRight" className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </Card>

        <p className="mt-6 text-[11px] text-zinc-600">
          By signing in you agree to the Terms of Use.
        </p>
      </div>
    </div>
  )
}

/* ============================================================ */
/*  SUBSCRIPTION PAGE                                           */
/* ============================================================ */

export interface SubscriptionInfo {
  plan: string
  price: string
  expires: string
  daysLeft: number
}

export interface SubscriptionPageProps {
  planStatus: 'active' | 'expired' | string
  onBack: () => void
  onRenew?: () => void
  subscriptionInfo?: SubscriptionInfo
}

export function SubscriptionPage({ planStatus, onBack, onRenew, subscriptionInfo }: SubscriptionPageProps) {
  const defaults = planStatus === 'active'
    ? { plan: 'Pro', price: '₩29,000 / mo', expires: 'Jun 14, 2026', daysLeft: 37 }
    : { plan: 'Pro', price: '₩29,000 / mo', expires: 'Apr 02, 2026', daysLeft: -36 }
  const data = subscriptionInfo ?? defaults

  return (
    <div className="h-full w-full overflow-y-auto bg-[radial-gradient(circle_at_50%_-10%,rgba(255,255,255,0.03),transparent_60%)]">
      <div className="max-w-[560px] mx-auto px-8 py-12">
        <div className="mb-8">
          <p className="text-[11px] font-medium tracking-[0.08em] text-zinc-500 uppercase mb-2">Account</p>
          <h1 className="text-[22px] font-semibold tracking-tight text-zinc-50">Subscription</h1>
          <p className="text-[13px] text-zinc-500 mt-1">Manage your plan and renewals via Telegram.</p>
        </div>

        <Card className="overflow-hidden">
          <div className="px-5 py-5 flex items-start justify-between gap-4 border-b border-zinc-800/70">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-md bg-zinc-800/80 border border-zinc-700/50 grid place-items-center text-zinc-300">
                <Icon name="crown" className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-[15px] font-semibold text-zinc-100 tracking-tight">{data.plan} Plan</h2>
                  <StatusBadge status={planStatus} label={planStatus} size="sm" />
                </div>
                <p className="text-[12px] text-zinc-500 mt-0.5">{data.price} · billed monthly</p>
              </div>
            </div>
          </div>

          <dl className="divide-y divide-zinc-800/70">
            <SubRow label="Status">
              <span className={`text-[13px] font-medium ${planStatus === 'active' ? 'text-emerald-300' : 'text-zinc-400'}`}>
                {planStatus === 'active' ? 'Active' : 'Expired'}
              </span>
            </SubRow>
            <SubRow label={planStatus === 'active' ? 'Renews on' : 'Expired on'}>
              <span className="text-[13px] text-zinc-200 tabular-nums">{data.expires}</span>
            </SubRow>
            <SubRow label={planStatus === 'active' ? 'Days remaining' : 'Days since expiry'}>
              <span className="text-[13px] text-zinc-200 tabular-nums">{Math.abs(data.daysLeft)} days</span>
            </SubRow>
            <SubRow label="Concurrent tasks">
              <span className="text-[13px] text-zinc-200 tabular-nums">10</span>
            </SubRow>
          </dl>

          <div className="px-5 py-4 border-t border-zinc-800/70 flex items-center justify-between gap-3 bg-zinc-900/30">
            <p className="text-[11.5px] text-zinc-500 leading-relaxed">
              Renewal is handled in our Telegram billing bot. <br />You'll get a confirmation here when it completes.
            </p>
            <button
              onClick={onRenew}
              className="shrink-0 h-9 px-3.5 inline-flex items-center gap-2 rounded-md
                         bg-[#229ED9] hover:bg-[#1f93cb] text-white font-medium text-[12.5px]
                         transition-colors shadow-[0_1px_0_rgba(255,255,255,0.15)_inset]"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.24 3.64 11.95c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z"/>
              </svg>
              Extend via Telegram
            </button>
          </div>
        </Card>

        <div className="mt-5 flex items-center justify-between">
          <button onClick={onBack} className="text-[12px] text-zinc-500 hover:text-zinc-200 inline-flex items-center gap-1">
            <Icon name="chevronRight" className="w-3.5 h-3.5 rotate-180" /> Back to dashboard
          </button>
          <p className="text-[11px] text-zinc-600">Need help? Contact @coupangbot_support</p>
        </div>
      </div>
    </div>
  )
}

const SubRow = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="px-5 py-3 flex items-center justify-between">
    <dt className="text-[12px] text-zinc-500">{label}</dt>
    <dd>{children}</dd>
  </div>
)

/* ============================================================ */
/*  DASHBOARD PAGE                                              */
/* ============================================================ */

export interface DashboardPageProps {
  botState: 'idle' | 'running' | 'paused'
  onBotStateChange: (s: 'idle' | 'running' | 'paused') => void
  onLogout: () => void
  onOpenSubscription: () => void
  version?: string
  initialTasks?: Task[]
  onStartBot?: (tasks: Task[]) => void
  extraLogs?: LogEntry[]
  updateStatus?: string
  user?: { first_name: string; photo_url: string | null } | null
  results?: BotResult[]
  screenshotPath?: string | null
  updateProgress?: number | null
  onSendLogs?: () => void
  onViewScreenshot?: (path: string) => void
}

const seedLogs = (count = 40): LogEntry[] => {
  const messages = [
    { l: 'INFO',    m: 'Bot ready. Add tasks and press Start.' },
    { l: 'INFO',    m: 'Session loaded from userData.' },
  ]
  const now = Date.now()
  return Array.from({ length: Math.min(count, messages.length) }, (_, i) => {
    const t = new Date(now - (count - i) * 1100)
    return {
      id: `seed-${i}`,
      time: t.toTimeString().slice(0, 8),
      level: messages[i % messages.length].l,
      source: 'system',
      message: messages[i % messages.length].m,
    }
  })
}

export function DashboardPage({
  botState,
  onBotStateChange,
  onLogout,
  onOpenSubscription,
  version = '',
  initialTasks,
  onStartBot,
  extraLogs,
  updateStatus,
  user,
  results = [],
  screenshotPath,
  updateProgress,
  onSendLogs,
  onViewScreenshot,
}: DashboardPageProps) {
  const [tasks, setTasks] = useState<Task[]>(() => initialTasks ?? [])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [localLogs, setLocalLogs] = useState<LogEntry[]>(() => seedLogs(2))
  const [autoscroll, setAutoscroll] = useState(true)
  const [filter, setFilter] = useState('ALL')
  const [showNewTask, setShowNewTask] = useState(false)
  const [stopNotice, setStopNotice] = useState(false)
  const [imgError, setImgError] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; taskId: string } | null>(null)
  const [rightTab, setRightTab] = useState<'log' | 'results'>('log')
  const logScrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (initialTasks && initialTasks.length > 0) {
      setTasks(initialTasks)
      setSelectedId(initialTasks[0]?.id ?? null)
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') { e.preventDefault(); setShowNewTask(true) }
      if (e.key === 'Escape') setShowNewTask(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const addTask = useCallback((task: Omit<Task, 'id' | 'status'>) => {
    setTasks(prev => {
      const next: Task = { ...task, id: `t${prev.length + 1}`, status: 'idle' }
      return [...prev, next]
    })
    setShowNewTask(false)
  }, [])

  useEffect(() => {
    if (!autoscroll) return
    const el = logScrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [localLogs, extraLogs, autoscroll])

  const onLogScroll = () => {
    const el = logScrollRef.current
    if (!el) return
    setAutoscroll(el.scrollHeight - el.scrollTop - el.clientHeight < 24)
  }

  const allLogs = useMemo(() => [...localLogs, ...(extraLogs ?? [])], [localLogs, extraLogs])
  const filteredLogs = useMemo(
    () => filter === 'ALL' ? allLogs : allLogs.filter(l => l.level === filter),
    [allLogs, filter]
  )
  const counts = useMemo(() => {
    const c: Record<string, number> = { INFO: 0, WARN: 0, ERROR: 0, SUCCESS: 0, DEBUG: 0 }
    for (const l of allLogs) c[l.level] = (c[l.level] ?? 0) + 1
    return c
  }, [allLogs])

  const runningCount = tasks.filter(t => t.status === 'running').length
  const progressValue = botState === 'running' ? 64 : 0

  const handleStart = () => {
    onBotStateChange('running')
    setTasks(prev => prev.map(t => ({ ...t, status: 'running' as const })))
    onStartBot?.(tasks)
  }

  const handleStop = () => {
    setStopNotice(true)
    setTimeout(() => setStopNotice(false), 4000)
  }

  const deleteTask = (id: string) => setTasks(prev => prev.filter(t => t.id !== id))

  return (
    <div className="relative h-full w-full flex flex-col bg-zinc-950 text-zinc-200">
      {/* TOP BAR */}
      <header className="h-11 shrink-0 flex items-center justify-between px-4 border-b border-zinc-800/70 bg-zinc-950/90 backdrop-blur">
        <div className="flex items-center gap-3">
          <Wordmark size="sm" />
          {version && <span className="text-[10.5px] text-zinc-600 font-mono tabular-nums">v{version}</span>}
          {updateStatus && (
            <span className="text-[10.5px] text-zinc-500 max-w-[200px] truncate">{updateStatus}</span>
          )}
          {updateProgress !== null && updateProgress > 0 && (
            <div className="flex items-center gap-1.5">
              <div className="w-[80px] h-1 bg-zinc-800 rounded-full overflow-hidden">
                <div className="h-full bg-zinc-400 rounded-full transition-all" style={{ width: `${updateProgress}%` }} />
              </div>
              <span className="text-[10.5px] text-zinc-500 tabular-nums">{updateProgress}%</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {user && (
            <div className="flex items-center gap-2 mr-1">
              {user.photo_url && !imgError ? (
                <img
                  src={user.photo_url}
                  alt={user.first_name}
                  onError={() => setImgError(true)}
                  className="w-6 h-6 rounded-full object-cover ring-1 ring-zinc-700"
                />
              ) : (
                <div className="w-6 h-6 rounded-full bg-zinc-700 flex items-center justify-center text-[10px] font-semibold text-zinc-300 ring-1 ring-zinc-600">
                  {user.first_name.charAt(0).toUpperCase()}
                </div>
              )}
              <span className="text-[12px] text-zinc-400 max-w-[96px] truncate">{user.first_name}</span>
            </div>
          )}
          <div className="w-px h-4 bg-zinc-800 mx-0.5" />
          <Button variant="ghost" size="sm" onClick={onOpenSubscription} leadingIcon={<Icon name="crown" className="w-3.5 h-3.5" />}>
            Subscription
          </Button>
          <div className="w-px h-4 bg-zinc-800 mx-1" />
          <Button variant="ghost" size="sm" onClick={onLogout} leadingIcon={<Icon name="logout" className="w-3.5 h-3.5" />}>
            Logout
          </Button>
        </div>
      </header>

      {/* MAIN GRID */}
      <div className="flex-1 min-h-0 grid grid-cols-[minmax(320px,36%)_1fr]">
        {/* LEFT: TASK LIST */}
        <aside className="border-r border-zinc-800/70 flex flex-col min-h-0">
          <SectionHeader
            title="Tasks"
            subtitle={`${runningCount > 0 ? `${runningCount} running · ` : ''}${tasks.length} total`}
            right={
              <Button variant="ghost" size="sm" onClick={() => setShowNewTask(true)}
                leadingIcon={<Icon name="plus" className="w-3.5 h-3.5" />}
                trailingIcon={<Kbd>⌘N</Kbd>}>
                New task
              </Button>
            }
          />
          <ul className="flex-1 overflow-y-auto">
            {tasks.map(t => (
              <li key={t.id} onContextMenu={e => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, taskId: t.id }) }}>
                <TaskRow task={t} selected={selectedId === t.id} onClick={() => setSelectedId(t.id)} />
              </li>
            ))}
            <li className="px-4 py-6 text-center">
              <button onClick={() => setShowNewTask(true)} className="text-[12px] text-zinc-500 hover:text-zinc-300 inline-flex items-center gap-1.5">
                <Icon name="plus" className="w-3 h-3" /> Add task
              </button>
            </li>
          </ul>
        </aside>

        {/* RIGHT: TABBED PANEL (Log / Results) */}
        <section className="flex flex-col min-h-0 bg-zinc-950">
          {/* Tab bar */}
          <div className="h-10 shrink-0 flex items-center justify-between px-4 border-b border-zinc-800/70">
            <div className="flex items-center gap-0.5">
              {(['log', 'results'] as const).map(tab => (
                <button key={tab} onClick={() => setRightTab(tab)}
                  className={`h-7 px-3 text-[12px] font-medium rounded-md transition-colors flex items-center gap-1.5 ${
                    rightTab === tab ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
                  }`}>
                  {tab === 'log' ? 'Live Log' : 'Results'}
                  {tab === 'log' && <span className="text-[10.5px] text-zinc-600 tabular-nums">{allLogs.length}</span>}
                  {tab === 'results' && results.length > 0 && (
                    <span className="text-[10.5px] bg-zinc-700 text-zinc-300 rounded px-1 tabular-nums">{results.length}</span>
                  )}
                </button>
              ))}
            </div>
            {rightTab === 'log' && (
              <div className="flex items-center gap-1">
                {['ALL', 'INFO', 'WARN', 'ERROR', 'SUCCESS'].map(lvl => (
                  <button key={lvl} onClick={() => setFilter(lvl)}
                    className={`h-6 px-2 text-[10.5px] font-semibold tracking-[0.04em] rounded-md transition-colors ${
                      filter === lvl ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
                    }`}>
                    {lvl}
                    {lvl !== 'ALL' && <span className="ml-1 text-zinc-600 tabular-nums">{counts[lvl] ?? 0}</span>}
                  </button>
                ))}
                <div className="w-px h-4 bg-zinc-800 mx-1" />
                <Button variant="ghost" size="sm" onClick={onSendLogs} leadingIcon={<Icon name="send" className="w-3 h-3" />}>TG</Button>
                <Button variant="ghost" size="sm" onClick={() => setLocalLogs([])}>Clear</Button>
              </div>
            )}
          </div>

          {/* Log view */}
          {rightTab === 'log' && (
            <div ref={logScrollRef} onScroll={onLogScroll} className="flex-1 overflow-y-auto py-2">
              {filteredLogs.map(line => (
                <LogLine key={line.id} time={line.time} level={line.level} source={line.source} message={line.message} />
              ))}
              {filteredLogs.length === 0 && (
                <div className="px-4 py-10 text-center">
                  <Icon name="terminal" className="w-5 h-5 text-zinc-700 mx-auto mb-2" />
                  <p className="text-[12px] text-zinc-500">No log lines{filter !== 'ALL' && ` at ${filter}`}.</p>
                </div>
              )}
            </div>
          )}

          {/* Results view */}
          {rightTab === 'results' && (
            <div className="flex-1 overflow-y-auto">
              {results.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  <Icon name="target" className="w-5 h-5 text-zinc-700 mx-auto mb-2" />
                  <p className="text-[12px] text-zinc-500">No results yet. Start the bot to see matches here.</p>
                </div>
              ) : (
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-zinc-800/70 text-zinc-500 text-[10.5px] uppercase tracking-wider">
                      <th className="px-4 py-2 text-left font-semibold w-10">#</th>
                      <th className="px-4 py-2 text-left font-semibold w-24">Date</th>
                      <th className="px-4 py-2 text-left font-semibold">Keyword</th>
                      <th className="px-4 py-2 text-left font-semibold">Product</th>
                      <th className="px-4 py-2 text-left font-semibold w-36">Location</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map(r => (
                      <tr key={r.id} className="border-b border-zinc-800/40 hover:bg-zinc-900/40">
                        <td className="px-4 py-2 text-zinc-600 tabular-nums">{r.id}</td>
                        <td className="px-4 py-2 text-zinc-500 tabular-nums whitespace-nowrap">{r.date}</td>
                        <td className="px-4 py-2 text-zinc-300 max-w-[140px]"><span className="block truncate">{r.keyword}</span></td>
                        <td className="px-4 py-2 text-zinc-100 max-w-[200px]"><span className="block truncate">{r.targetName}</span></td>
                        <td className="px-4 py-2 text-zinc-400 max-w-[140px]"><span className="block truncate">{r.location}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </section>
      </div>

      {/* BOTTOM BAR */}
      <footer className="h-12 shrink-0 flex items-center gap-4 px-4 border-t border-zinc-800/70 bg-zinc-950/90">
        <div className="flex items-center gap-1.5">
          {botState !== 'running' ? (
            <Button variant="primary" size="md"
              leadingIcon={<Icon name="play" className="w-3.5 h-3.5" strokeWidth={2} />}
              onClick={handleStart}
              disabled={tasks.length === 0}>
              Start bot
            </Button>
          ) : (
            <Button variant="secondary" size="md"
              leadingIcon={<Icon name="pause" className="w-3.5 h-3.5" />}
              onClick={() => onBotStateChange('paused')}>
              Pause
            </Button>
          )}
          <Button variant={botState === 'idle' ? 'secondary' : 'danger'} size="md"
            leadingIcon={<Icon name="stop" className="w-3.5 h-3.5" />}
            onClick={handleStop}
            disabled={botState === 'idle'}>
            Stop
          </Button>
        </div>

        <div className="w-px h-5 bg-zinc-800" />

        {screenshotPath && (
          <Button variant="ghost" size="md" onClick={() => onViewScreenshot?.(screenshotPath)}
            leadingIcon={<Icon name="image" className="w-3.5 h-3.5" />}>
            View screenshot
          </Button>
        )}

        <div className="flex-1 flex items-center gap-3 min-w-0">
          {stopNotice ? (
            <span className="text-[11.5px] text-amber-300">Stop is not available — close the window to abort.</span>
          ) : (
            <>
              <StatusBadge
                status={botState === 'running' ? 'running' : botState === 'paused' ? 'warn' : 'idle'}
                label={botState}
                pulse={botState === 'running'}
              />
              <ProgressBar
                value={progressValue}
                indeterminate={botState === 'running'}
                label={botState === 'running' ? `${tasks.length} tasks` : undefined}
                className="flex-1 max-w-[420px]"
              />
            </>
          )}
        </div>
      </footer>

      {showNewTask && <NewTaskDialog onClose={() => setShowNewTask(false)} onSubmit={addTask} />}

      {ctxMenu && (
        <div className="fixed inset-0 z-40" onClick={() => setCtxMenu(null)}>
          <div
            style={{ top: ctxMenu.y, left: ctxMenu.x }}
            className="absolute z-50 min-w-[140px] rounded-md border border-zinc-700 bg-zinc-900 shadow-xl py-1"
            onClick={e => e.stopPropagation()}
          >
            <button
              className="w-full text-left px-3 py-1.5 text-[12.5px] text-red-400 hover:bg-zinc-800 flex items-center gap-2"
              onClick={() => { deleteTask(ctxMenu.taskId); setCtxMenu(null) }}
            >
              <Icon name="x" className="w-3.5 h-3.5" /> Delete task
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ---- New Task modal ---- */
function NewTaskDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void
  onSubmit: (t: Omit<Task, 'id' | 'status'>) => void
}) {
  const [keyword, setKeyword] = useState('')
  const [product, setProduct] = useState('')
  const [min, setMin] = useState('')
  const [max, setMax] = useState('')
  const valid = keyword.trim() && product.trim() && Number(min) > 0 && Number(max) >= Number(min)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!valid) return
    onSubmit({ keyword: keyword.trim(), product: product.trim(), min: Number(min), max: Number(max) })
  }

  return (
    <div className="absolute inset-0 z-50 grid place-items-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()}
        className="w-[460px] rounded-lg border border-zinc-800 bg-zinc-950 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]">
        <div className="px-5 pt-5 pb-4 border-b border-zinc-800/70">
          <h2 className="text-[14px] font-semibold text-zinc-100 tracking-tight">New task</h2>
          <p className="text-[11.5px] text-zinc-500 mt-0.5">The bot will poll Coupang for this product and order when it falls in band.</p>
        </div>
        <div className="px-5 py-4 space-y-3.5">
          <Field label="Search keyword" hint="Korean text supported">
            <Input value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="e.g. 무선 이어폰" autoFocus />
          </Field>
          <Field label="Target product name" hint="Substring match against listing titles">
            <Input value={product} onChange={e => setProduct(e.target.value)} placeholder="e.g. Galaxy Buds3 Pro 화이트" />
          </Field>
          <Field label="Price range (KRW)">
            <div className="grid grid-cols-2 gap-2">
              <Input type="number" value={min} onChange={e => setMin(e.target.value)} placeholder="min  120000" />
              <Input type="number" value={max} onChange={e => setMax(e.target.value)} placeholder="max  160000" />
            </div>
          </Field>
        </div>
        <div className="px-5 py-3.5 border-t border-zinc-800/70 flex items-center justify-between bg-zinc-900/30">
          <p className="text-[11px] text-zinc-500 inline-flex items-center gap-1.5"><Kbd>Esc</Kbd> to cancel</p>
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="md" type="button" onClick={onClose}>Cancel</Button>
            <Button variant="primary" size="md" type="submit" disabled={!valid}>Create task</Button>
          </div>
        </div>
      </form>
    </div>
  )
}

const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <label className="block">
    <div className="flex items-baseline justify-between mb-1.5">
      <span className="text-[11.5px] font-medium text-zinc-300">{label}</span>
      {hint && <span className="text-[10.5px] text-zinc-600">{hint}</span>}
    </div>
    {children}
  </label>
)

const TaskRow = ({ task, selected, onClick }: { task: Task; selected: boolean; onClick: () => void }) => {
  const fmt = (n: number) => '₩' + n.toLocaleString('ko-KR')
  return (
    <button onClick={onClick}
      className={`group w-full text-left px-4 py-3 border-b border-zinc-800/50 transition-colors ${
        selected ? 'bg-zinc-900/60' : 'hover:bg-zinc-900/30'
      }`}>
      <div className="flex items-start justify-between gap-3 mb-1.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Icon name="target" className="w-3 h-3 text-zinc-600 shrink-0" />
            <span className="text-[12px] font-medium text-zinc-300 truncate">{task.keyword}</span>
          </div>
          <p className="text-[13px] font-medium text-zinc-100 tracking-tight truncate">{task.product}</p>
        </div>
        <StatusBadge status={task.status} label={task.status} size="sm" pulse={task.status === 'running'} />
      </div>
      <div className="flex items-center gap-3 pl-[18px] text-[11px] text-zinc-500 font-mono tabular-nums">
        {task.min > 0 && <span>{fmt(task.min)}</span>}
        {task.min > 0 && task.max > 0 && <span className="text-zinc-700">→</span>}
        {task.max > 0 && <span>{fmt(task.max)}</span>}
        <span className={`ml-auto px-1.5 py-px text-[10px] rounded font-sans ${
          selected ? 'text-zinc-400' : 'text-zinc-600 group-hover:text-zinc-400'
        }`}>#{task.id}</span>
      </div>
    </button>
  )
}
