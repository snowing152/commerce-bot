import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import { DashboardPage, Task, LogEntry } from './pages';
import { ErrorBoundary } from './ErrorBoundary';
import { BotResult } from './types';
import { LanguageProvider, useT } from './i18n';
import { mergeNextRunAt } from './schedule-utils';

interface EngineTask {
  keyword: string;
  target_name: string;
  filters: string[];
  cost?: [number, number];
}

function parseLogLine(msg: string): LogEntry {
  const time = new Date().toTimeString().slice(0, 8);
  const match = msg.match(/^\[(INFO|DEBUG|WARN|SKIP|ACTION|SUCCESS|ERROR)\]\s*(.*)/);
  if (match) {
    const rawLevel = match[1];
    const level = rawLevel === 'SKIP' || rawLevel === 'ACTION' ? 'INFO' : rawLevel;
    return {
      id: `log-${Date.now()}-${Math.random()}`,
      time,
      level,
      source: 'engine',
      message: match[2],
    };
  }
  return {
    id: `log-${Date.now()}-${Math.random()}`,
    time,
    level: 'INFO',
    source: 'engine',
    message: msg,
  };
}

function toEngineTasks(tasks: Task[]): EngineTask[] {
  return tasks.map((t) => ({
    keyword: t.keyword,
    target_name: t.product,
    filters: t.filters ?? [],
    cost:
      t.minCost || t.maxCost ? ([t.minCost ?? 0, t.maxCost ?? 0] as [number, number]) : undefined,
  }));
}

function fromSessionTasks(raw: EngineTask[]): Task[] {
  return raw.map((t, i) => ({
    id: `t${i + 1}`,
    keyword: t.keyword ?? '',
    product: t.target_name ?? '',
    filters: t.filters ?? [],
    minCost: t.cost?.[0] || undefined,
    maxCost: t.cost?.[1] || undefined,
    status: 'idle' as const,
  }));
}

function DashboardApp() {
  const { t } = useT();
  const [botState, setBotState] = useState<'idle' | 'running' | 'paused'>('idle');
  const [version, setVersion] = useState('');
  const [initialTasks, setInitialTasks] = useState<Task[] | undefined>(undefined);
  const [ipcLogs, setIpcLogs] = useState<LogEntry[]>([]);
  const [updateStatus, setUpdateStatus] = useState<{
    key: string;
    params?: Record<string, string | number>;
  } | null>(null);
  const [user, setUser] = useState<{ first_name: string; photo_url: string | null } | null>(null);
  const [subscriptionResult, setSubscriptionResult] = useState<SubscriptionResult | null>(null);
  const [results, setResults] = useState<BotResult[]>([]);
  const [liveResults, setLiveResults] = useState<BotResult[]>([]);
  const [screenshotPath, setScreenshotPath] = useState<string | null>(null);
  const [updateProgress, setUpdateProgress] = useState<number | null>(null);
  const [scheduleConfig, setScheduleConfig] = useState<ScheduleConfig | null>(null);

  // Load session + version + user on mount
  useEffect(() => {
    Promise.all([
      window.api.loadSession().catch(() => null),
      window.api.getVersion().catch(() => ''),
      window.api.getSubscriptionStatus().catch(() => null),
      window.api.loadResults().catch(() => []),
      window.api.getSchedule().catch(() => null),
    ]).then(([session, ver, sub, savedResults, schedule]) => {
      if (Array.isArray(session) && session.length > 0) {
        setInitialTasks(fromSessionTasks(session as EngineTask[]));
      } else {
        setInitialTasks([]);
      }
      setVersion(ver);
      if (sub) {
        const s = sub as SubscriptionResult;
        setUser(s.user);
        setSubscriptionResult(s);
      }
      if (Array.isArray(savedResults)) setResults(savedResults as BotResult[]);
      if (schedule) setScheduleConfig(schedule as ScheduleConfig);
    });
  }, []);

  const refreshSubscription = () => {
    window.api
      .getSubscriptionStatus()
      .then((s) => {
        setUser(s.user);
        setSubscriptionResult(s);
      })
      .catch(() => {});
  };

  // Re-check subscription every 30 minutes so expiry shows without a restart
  useEffect(() => {
    const id = setInterval(refreshSubscription, 30 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // Register all event listeners once; return all cleanups
  useEffect(() => {
    const unLog = window.api.onLog((msg) => {
      try {
        const parsed = parseLogLine(msg);
        setIpcLogs((prev) =>
          prev.length >= 600 ? [...prev.slice(-599), parsed] : [...prev, parsed],
        );
      } catch {
        /* discard malformed payload */
      }
    });
    const unRunning = window.api.onRunning(() => {
      setBotState('running');
      setLiveResults([]);
    });
    const unDone = window.api.onDone((path) => {
      setBotState('idle');
      setScreenshotPath(path);
      setUpdateProgress(null);
    });
    const unStatus = window.api.onUpdateStatus((payload) => setUpdateStatus(payload));
    const unError = window.api.onUpdateError((p) => {
      if (p.message) setUpdateStatus({ key: 'update.errorPrefix', params: { message: p.message } });
      setUpdateProgress(null);
    });
    const unResult = window.api.onBotResult((d) => {
      setResults((prev) => [...prev.slice(-499), d as BotResult]);
      setLiveResults((prev) => [...prev, d as BotResult]);
    });
    const unProgress = window.api.onUpdateProgress((pct) => setUpdateProgress(pct));
    const unSubUpdated = window.api.onSubscriptionUpdated(refreshSubscription);
    const unSchedule = window.api.onScheduleUpdated((s) =>
      setScheduleConfig((prev) => mergeNextRunAt(prev, s.nextRunAt)),
    );
    return () => {
      unRunning();
      unLog();
      unDone();
      unStatus();
      unError();
      unResult();
      unProgress();
      unSubUpdated();
      unSchedule();
    };
  }, []);

  const handleStartBot = (tasks: Task[]) => {
    setScreenshotPath(null);
    setLiveResults([]);
    window.api.saveSession(toEngineTasks(tasks));
    window.api.startBot(toEngineTasks(tasks));
  };

  const handleTasksChanged = (tasks: Task[]) => {
    window.api.saveSession(toEngineTasks(tasks));
  };

  const handleLogout = async () => {
    await window.api.logout();
    window.api.navigateTo('auth');
  };

  const handleClearResults = async () => {
    await window.api.clearResults();
    setResults([]);
  };

  const handleExportResults = () => {
    window.api.exportResultsCsv();
  };

  const handleSaveSchedule = async (cfg: Omit<ScheduleConfig, 'nextRunAt'>) => {
    await window.api.saveSchedule(cfg);
    const updated = await window.api.getSchedule().catch(() => null);
    if (updated) setScheduleConfig(updated);
  };

  // Don't mount the page until session is loaded (avoid flash of empty task list)
  if (initialTasks === undefined) {
    return (
      <div className="h-full w-full grid place-items-center bg-zinc-950">
        <div className="flex items-center gap-2 text-zinc-500 text-[13px]">
          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
            <circle
              cx="12"
              cy="12"
              r="9"
              stroke="currentColor"
              strokeOpacity="0.18"
              strokeWidth="2.5"
            />
            <path
              d="M12 3a9 9 0 0 1 9 9"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </svg>
          {t('common.loading')}
        </div>
      </div>
    );
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
      onTasksChanged={handleTasksChanged}
      extraLogs={ipcLogs}
      updateStatus={updateStatus ? t(updateStatus.key, updateStatus.params) : ''}
      user={user}
      results={results}
      liveResults={liveResults}
      screenshotPath={screenshotPath}
      updateProgress={updateProgress}
      onReportProblem={(payload) => window.api.sendProblemReport(payload)}
      onViewScreenshot={(p) => window.api.openScreenshot(p)}
      onStopBot={() => window.api.stopBot()}
      onClearResults={handleClearResults}
      onExportResults={handleExportResults}
      initialSchedule={scheduleConfig}
      onSaveSchedule={handleSaveSchedule}
      subscriptionResult={subscriptionResult}
    />
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <LanguageProvider>
      <DashboardApp />
    </LanguageProvider>
  </ErrorBoundary>,
);
