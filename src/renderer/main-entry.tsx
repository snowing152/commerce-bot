import React, { useState, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import './styles.css'
import { DashboardPage, Task, LogEntry } from './pages'
import { ErrorBoundary } from './ErrorBoundary'
import { BotResult } from './types'

interface EngineTask {
  keyword: string
  target_name: string
  filters: string[]
  cost: number[]
}

function parseLogLine(msg: string): LogEntry {
  const time = new Date().toTimeString().slice(0, 8)
  const match = msg.match(/^\[(INFO|DEBUG|WARN|SKIP|ACTION|SUCCESS|ERROR)\]\s*(.*)/)
  if (match) {
    const rawLevel = match[1]
    const level = rawLevel === 'SKIP' || rawLevel === 'ACTION' ? 'INFO' : rawLevel
    return { id: `log-${Date.now()}-${Math.random()}`, time, level, source: 'engine', message: match[2] }
  }
  return { id: `log-${Date.now()}-${Math.random()}`, time, level: 'INFO', source: 'engine', message: msg }
}

function toEngineTasks(tasks: Task[]): EngineTask[] {
  return tasks.map(t => ({
    keyword: t.keyword,
    target_name: t.product,
    filters: [],
    cost: t.min > 0 && t.max > 0 ? [t.min, t.max] : [],
  }))
}

function fromSessionTasks(raw: EngineTask[]): Task[] {
  return raw.map((t, i) => ({
    id: `t${i + 1}`,
    keyword: t.keyword ?? '',
    product: t.target_name ?? '',
    min: t.cost?.[0] ?? 0,
    max: t.cost?.[1] ?? 0,
    status: 'idle' as const,
  }))
}

function DashboardApp() {
  const [botState, setBotState] = useState<'idle' | 'running' | 'paused'>('idle')
  const [version, setVersion] = useState('')
  const [initialTasks, setInitialTasks] = useState<Task[] | undefined>(undefined)
  const [ipcLogs, setIpcLogs] = useState<LogEntry[]>([])
  const [updateStatus, setUpdateStatus] = useState('')
  const [user, setUser] = useState<{ first_name: string; photo_url: string | null } | null>(null)
  const [results, setResults] = useState<BotResult[]>([])
  const [screenshotPath, setScreenshotPath] = useState<string | null>(null)
  const [updateProgress, setUpdateProgress] = useState<number | null>(null)

  // Load session + version + user on mount
  useEffect(() => {
    Promise.all([
      window.api.loadSession().catch(() => null),
      window.api.getVersion().catch(() => ''),
      window.api.getSubscriptionStatus().catch(() => null),
    ]).then(([session, ver, sub]) => {
      if (Array.isArray(session) && session.length > 0) {
        setInitialTasks(fromSessionTasks(session as EngineTask[]))
      } else {
        setInitialTasks([])
      }
      setVersion(ver)
      if (sub) setUser((sub as SubscriptionResult).user)
    })
  }, [])

  // Register all event listeners once; return all cleanups
  useEffect(() => {
    const unLog = window.api.onLog(msg => {
      try {
        const parsed = parseLogLine(msg)
        setIpcLogs(prev => prev.length >= 600 ? [...prev.slice(-599), parsed] : [...prev, parsed])
      } catch { /* discard malformed payload */ }
    })
    const unDone     = window.api.onDone(path => { setBotState('idle'); setScreenshotPath(path); setUpdateProgress(null) })
    const unStatus   = window.api.onUpdateStatus(text => setUpdateStatus(text))
    const unError    = window.api.onUpdateError(p => {
      if (p.message) setUpdateStatus(`Update error: ${p.message}`)
      setUpdateProgress(null)
    })
    const unResult   = window.api.onBotResult(d => setResults(prev => [...prev.slice(-499), d as BotResult]))
    const unProgress = window.api.onUpdateProgress(pct => setUpdateProgress(pct))
    return () => { unLog(); unDone(); unStatus(); unError(); unResult(); unProgress() }
  }, [])

  const handleStartBot = (tasks: Task[]) => {
    setResults([])
    setScreenshotPath(null)
    window.api.saveSession(toEngineTasks(tasks))
    window.api.startBot(toEngineTasks(tasks))
  }

  const handleLogout = async () => {
    await window.api.logout()
    window.api.navigateTo('auth')
  }

  // Don't mount the page until session is loaded (avoid flash of empty task list)
  if (initialTasks === undefined) {
    return (
      <div className="h-full w-full grid place-items-center bg-zinc-950">
        <div className="flex items-center gap-2 text-zinc-500 text-[13px]">
          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.18" strokeWidth="2.5" />
            <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
          Loading…
        </div>
      </div>
    )
  }

  return (
    <DashboardPage
      botState={botState}
      onBotStateChange={setBotState}
      onLogout={handleLogout}
      onOpenSubscription={() => window.api.navigateTo('subscription')}
      version={version}
      initialTasks={initialTasks}
      onStartBot={handleStartBot}
      extraLogs={ipcLogs}
      updateStatus={updateStatus}
      user={user}
      results={results}
      screenshotPath={screenshotPath}
      updateProgress={updateProgress}
      onSendLogs={() => window.api.sendLogToTelegram()}
      onViewScreenshot={p => window.api.openScreenshot(p)}
    />
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ErrorBoundary><DashboardApp /></ErrorBoundary>
)
