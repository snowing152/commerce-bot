import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import {
  Icon,
  Button,
  Input,
  Card,
  StatusBadge,
  LogLine,
  ProgressBar,
  Spinner,
  Kbd,
  SectionHeader,
  Wordmark,
} from './components';
import { BotResult } from './types';
import { LanguageSwitcher, useT } from './i18n';

/* ============================================================ */
/*  TYPES                                                        */
/* ============================================================ */

export interface Task {
  id: string;
  keyword: string;
  product: string;
  filters?: string[];
  minCost?: number;
  maxCost?: number;
  status: 'idle' | 'running' | 'warn' | 'error';
}

export interface LogEntry {
  id: string;
  time: string;
  level: string;
  source: string;
  message: string;
}

/* ---- Promotion Progress ---- */
interface RankPoint {
  page: number;
  pos: number;
}
interface RankingStat {
  keyword: string;
  targetName: string;
  first: RankPoint;
  latest: RankPoint;
  pageImprovement: number;
  posImprovement: number;
  history: RankPoint[];
  runCount: number;
}

function parseLocation(location: string): RankPoint | null {
  const m = location.match(/page\s+(\d+)\s+position\s+(\d+)/i);
  if (!m) return null;
  const page = parseInt(m[1], 10),
    pos = parseInt(m[2], 10);
  if (isNaN(page) || isNaN(pos) || page < 1 || pos < 1) return null;
  return { page, pos };
}

/* ============================================================ */
/*  AUTH PAGE                                                    */
/* ============================================================ */

export interface AuthPageProps {
  status: 'idle' | 'waiting' | 'confirmed' | 'error';
  onStatusChange: (s: 'idle' | 'waiting' | 'confirmed' | 'error') => void;
  onAuthenticated: () => void;
  onLoginClick?: () => void;
}

export function AuthPage({ status, onStatusChange, onAuthenticated, onLoginClick }: AuthPageProps) {
  const { t } = useT();
  const [pollSeconds, setPollSeconds] = useState(0);

  useEffect(() => {
    if (status !== 'waiting') {
      setPollSeconds(0);
      return;
    }
    const id = setInterval(() => setPollSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [status]);

  const handleLogin = () => {
    if (onLoginClick) {
      onLoginClick();
    } else {
      onStatusChange('waiting');
    }
  };

  return (
    <div className="h-full w-full grid place-items-center p-8 bg-[radial-gradient(circle_at_50%_-10%,rgba(255,255,255,0.03),transparent_60%)]">
      <div className="absolute top-4 right-4">
        <LanguageSwitcher />
      </div>
      <div className="w-full max-w-[380px] flex flex-col items-center">
        <div className="mb-10 flex flex-col items-center">
          <Wordmark size="lg" />
        </div>

        <Card className="w-full p-7">
          <div className="flex flex-col items-center text-center">
            <h1 className="text-[18px] font-semibold tracking-tight text-zinc-100 mb-1.5">
              {t('auth.signInTitle')}
            </h1>
            <p className="text-[12.5px] text-zinc-500 leading-relaxed max-w-[280px]">
              {t('auth.signInSubtitle')}
            </p>

            <button
              onClick={handleLogin}
              disabled={status === 'waiting' || status === 'confirmed'}
              className="mt-7 w-full h-10 inline-flex items-center justify-center gap-2 rounded-md
                         bg-[#229ED9] hover:bg-[#1f93cb] text-white font-medium text-[13.5px]
                         transition-colors disabled:opacity-50 disabled:cursor-not-allowed
                         shadow-[0_1px_0_rgba(255,255,255,0.15)_inset]"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.24 3.64 11.95c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z" />
              </svg>
              {status === 'waiting' ? t('auth.waiting') : t('auth.continueWithTelegram')}
            </button>

            <div className="mt-6 w-full">
              <div
                className={`rounded-md border px-3 py-2.5 transition-colors ${
                  status === 'error'
                    ? 'border-red-500/15 bg-red-500/[0.04]'
                    : status === 'confirmed'
                      ? 'border-emerald-500/15 bg-emerald-500/[0.04]'
                      : status === 'waiting'
                        ? 'border-amber-500/15 bg-amber-500/[0.04]'
                        : 'border-zinc-800 bg-zinc-900/40'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  {status === 'waiting' && <Spinner size={13} className="text-amber-300" />}
                  {status === 'confirmed' && (
                    <Icon name="check" className="w-3.5 h-3.5 text-emerald-300" />
                  )}
                  {status === 'error' && <Icon name="alert" className="w-3.5 h-3.5 text-red-300" />}
                  {status === 'idle' && <span className="w-2 h-2 rounded-full bg-zinc-600" />}
                  <span className="text-[12px] font-medium text-zinc-200 flex-1 text-left">
                    {t(`auth.status.${status}.label`)}
                  </span>
                  {status === 'waiting' && (
                    <span className="text-[10.5px] text-zinc-500 tabular-nums font-mono">
                      {pollSeconds}s
                    </span>
                  )}
                </div>
                <p className="text-[11.5px] text-zinc-500 mt-1.5 text-left leading-relaxed">
                  {t(`auth.status.${status}.hint`)}
                </p>
              </div>

              {status === 'error' && (
                <button
                  onClick={handleLogin}
                  className="mt-3 w-full text-[12px] text-zinc-400 hover:text-zinc-200 inline-flex items-center justify-center gap-1.5"
                >
                  <Icon name="refresh" className="w-3 h-3" /> {t('common.tryAgain')}
                </button>
              )}
              {status === 'confirmed' && (
                <button
                  onClick={onAuthenticated}
                  className="mt-3 w-full text-[12px] text-emerald-300 hover:text-emerald-200 inline-flex items-center justify-center gap-1"
                >
                  {t('common.continue')} <Icon name="chevronRight" className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </Card>

        <p className="mt-6 text-[11px] text-zinc-600">{t('auth.terms')}</p>
      </div>
    </div>
  );
}

/* ============================================================ */
/*  SUBSCRIPTION PAGE                                           */
/* ============================================================ */

export interface SubscriptionInfo {
  plan: string;
  price: string;
  expires: string;
  daysLeft: number;
}

export interface SubscriptionPageProps {
  planStatus: 'active' | 'expired' | string;
  onBack: () => void;
  onRenew?: () => void;
  subscriptionInfo?: SubscriptionInfo;
}

export function SubscriptionPage({
  planStatus,
  onBack,
  onRenew,
  subscriptionInfo,
}: SubscriptionPageProps) {
  const { t } = useT();
  const data = subscriptionInfo ?? { plan: 'Pro', price: '—', expires: '—', daysLeft: 0 };

  return (
    <div className="h-full w-full overflow-y-auto bg-[radial-gradient(circle_at_50%_-10%,rgba(255,255,255,0.03),transparent_60%)]">
      <div className="absolute top-4 right-4 z-10">
        <LanguageSwitcher />
      </div>
      <div className="max-w-[560px] mx-auto px-8 py-12">
        <div className="mb-8">
          <p className="text-[11px] font-medium tracking-[0.08em] text-zinc-500 uppercase mb-2">
            {t('sub.section')}
          </p>
          <h1 className="text-[22px] font-semibold tracking-tight text-zinc-50">
            {t('sub.title')}
          </h1>
          <p className="text-[13px] text-zinc-500 mt-1">{t('sub.subtitle')}</p>
        </div>

        <Card className="overflow-hidden">
          <div className="px-5 py-5 flex items-start justify-between gap-4 border-b border-zinc-800/70">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-md bg-zinc-800/80 border border-zinc-700/50 grid place-items-center text-zinc-300">
                <Icon name="crown" className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-[15px] font-semibold text-zinc-100 tracking-tight">
                    {t('sub.plan', { plan: data.plan })}
                  </h2>
                  <StatusBadge
                    status={planStatus}
                    label={planStatus === 'active' ? t('sub.active') : t('sub.expired')}
                    size="sm"
                  />
                </div>
                <p className="text-[12px] text-zinc-500 mt-0.5">
                  {t('sub.billed', { price: data.price })}
                </p>
              </div>
            </div>
          </div>

          <dl className="divide-y divide-zinc-800/70">
            <SubRow label={t('sub.status')}>
              <span
                className={`text-[13px] font-medium ${planStatus === 'active' ? 'text-emerald-300' : 'text-zinc-400'}`}
              >
                {planStatus === 'active' ? t('sub.active') : t('sub.expired')}
              </span>
            </SubRow>
            <SubRow label={planStatus === 'active' ? t('sub.renewsOn') : t('sub.expiredOn')}>
              <span className="text-[13px] text-zinc-200 tabular-nums">{data.expires}</span>
            </SubRow>
            <SubRow
              label={planStatus === 'active' ? t('sub.daysRemaining') : t('sub.daysSinceExpiry')}
            >
              <span className="text-[13px] text-zinc-200 tabular-nums">
                {t('sub.days', { n: Math.abs(data.daysLeft) })}
              </span>
            </SubRow>
            <SubRow label={t('sub.concurrent')}>
              <span className="text-[13px] text-zinc-200 tabular-nums">10</span>
            </SubRow>
          </dl>

          <div className="px-5 py-4 border-t border-zinc-800/70 flex items-center justify-between gap-3 bg-zinc-900/30">
            <p className="text-[11.5px] text-zinc-500 leading-relaxed">{t('sub.renewalCopy')}</p>
            <button
              onClick={onRenew}
              className="shrink-0 h-9 px-3.5 inline-flex items-center gap-2 rounded-md
                         bg-[#229ED9] hover:bg-[#1f93cb] text-white font-medium text-[12.5px]
                         transition-colors shadow-[0_1px_0_rgba(255,255,255,0.15)_inset]"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.24 3.64 11.95c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z" />
              </svg>
              {t('sub.extend')}
            </button>
          </div>
        </Card>

        <div className="mt-5 flex items-center justify-between">
          <button
            onClick={onBack}
            className="text-[12px] text-zinc-500 hover:text-zinc-200 inline-flex items-center gap-1"
          >
            <Icon name="chevronRight" className="w-3.5 h-3.5 rotate-180" /> {t('common.back')}
          </button>
          <p className="text-[11px] text-zinc-600">{t('sub.help')}</p>
        </div>
      </div>
    </div>
  );
}

const SubRow = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="px-5 py-3 flex items-center justify-between">
    <dt className="text-[12px] text-zinc-500">{label}</dt>
    <dd>{children}</dd>
  </div>
);

/* ============================================================ */
/*  DASHBOARD PAGE                                              */
/* ============================================================ */

export interface DashboardPageProps {
  botState: 'idle' | 'running' | 'paused';
  onBotStateChange: (s: 'idle' | 'running' | 'paused') => void;
  onLogout: () => void;
  onOpenSubscription: () => void;
  version?: string;
  initialTasks?: Task[];
  onStartBot?: (tasks: Task[]) => void;
  onTasksChanged?: (tasks: Task[]) => void;
  extraLogs?: LogEntry[];
  updateStatus?: string;
  user?: { first_name: string; photo_url: string | null } | null;
  results?: BotResult[];
  liveResults?: BotResult[];
  screenshotPath?: string | null;
  updateProgress?: number | null;
  onReportProblem?: (payload: {
    type: string;
    description: string;
  }) => Promise<{ success: boolean; error?: string }>;
  onViewScreenshot?: (path: string) => void;
  onStopBot?: () => void;
  onClearResults?: () => void;
  onExportResults?: () => void;
  initialSchedule?: ScheduleConfig | null;
  onSaveSchedule?: (cfg: Omit<ScheduleConfig, 'nextRunAt'>) => Promise<void>;
}

const seedLogs = (count = 40): LogEntry[] => {
  const messages = [
    { l: 'INFO', m: 'Bot ready. Add tasks and press Start.' },
    { l: 'INFO', m: 'Session loaded from userData.' },
  ];
  const now = Date.now();
  return Array.from({ length: Math.min(count, messages.length) }, (_, i) => {
    const t = new Date(now - (count - i) * 1100);
    return {
      id: `seed-${i}`,
      time: t.toTimeString().slice(0, 8),
      level: messages[i % messages.length].l,
      source: 'system',
      message: messages[i % messages.length].m,
    };
  });
};

export function DashboardPage({
  botState,
  onBotStateChange,
  onLogout,
  onOpenSubscription,
  version = '',
  initialTasks,
  onStartBot,
  onTasksChanged,
  extraLogs,
  updateStatus,
  user,
  results = [],
  liveResults = [],
  screenshotPath,
  updateProgress,
  onReportProblem,
  onViewScreenshot,
  onStopBot,
  onClearResults,
  onExportResults,
  initialSchedule,
  onSaveSchedule,
}: DashboardPageProps) {
  const { t } = useT();
  const [tasks, setTasks] = useState<Task[]>(() => initialTasks ?? []);
  const [selectedId, setSelectedId] = useState<string | null>(() => initialTasks?.[0]?.id ?? null);
  const [localLogs, setLocalLogs] = useState<LogEntry[]>(() => seedLogs(2));
  const [autoscroll, setAutoscroll] = useState(true);
  const [filter, setFilter] = useState('ALL');
  const [showNewTask, setShowNewTask] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [imgError, setImgError] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    taskId: string;
    confirming: boolean;
  } | null>(null);
  const [rightTab, setRightTab] = useState<'log' | 'results'>('log');
  const [unreadResults, setUnreadResults] = useState(0);
  const foundTaskIds = useMemo<Set<string>>(() => {
    const ids = new Set<string>();
    for (const r of liveResults) {
      const kw = r.keyword.toLowerCase();
      const tn = r.targetName?.toLowerCase() ?? '';
      const match =
        tasks.find((t) => t.keyword.toLowerCase() === kw && t.product.toLowerCase() === tn) ??
        tasks.find((t) => t.keyword.toLowerCase() === kw);
      if (match) ids.add(match.id);
    }
    return ids;
  }, [liveResults, tasks]);
  const [confirmClear, setConfirmClear] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const logScrollRef = useRef<HTMLDivElement>(null);
  const [scheduleConfig, setScheduleConfig] = useState<ScheduleConfig | null>(
    () => initialSchedule ?? null,
  );
  // Keep local config in sync when the parent re-fetches after save (so nextRunAt updates).
  useEffect(() => {
    if (initialSchedule) setScheduleConfig(initialSchedule);
  }, [initialSchedule]);
  const [showSchedule, setShowSchedule] = useState(false);
  const [showReport, setShowReport] = useState(false);

  const groupedResults = useMemo(() => {
    const groups: Array<{ runId: number | null; items: BotResult[] }> = [];
    for (const r of results) {
      const rid = r.run_id ?? null;
      const last = groups[groups.length - 1];
      if (last && last.runId === rid) {
        last.items.push(r);
      } else {
        groups.push({ runId: rid, items: [r] });
      }
    }
    return groups;
  }, [results]);

  const rankingStats = useMemo((): RankingStat[] => {
    const map = new Map<string, BotResult[]>();
    for (const r of results) {
      const key = `${r.keyword}|||${r.targetName}`;
      const b = map.get(key);
      b ? b.push(r) : map.set(key, [r]);
    }
    const stats: RankingStat[] = [];
    for (const [, bucket] of map) {
      const parsed = bucket
        .map((r) => ({ pt: parseLocation(r.location), id: r.id }))
        .filter((x): x is { pt: RankPoint; id: number } => x.pt !== null)
        .sort((a, b) => a.id - b.id);
      if (parsed.length < 2) continue;
      const history = parsed.map((x) => x.pt);
      const first = history[0],
        latest = history[history.length - 1];
      stats.push({
        keyword: bucket[0].keyword,
        targetName: bucket[0].targetName,
        first,
        latest,
        pageImprovement: first.page - latest.page,
        posImprovement: first.pos - latest.pos,
        history,
        runCount: parsed.length,
      });
    }
    return stats.sort((a, b) =>
      b.pageImprovement !== a.pageImprovement
        ? b.pageImprovement - a.pageImprovement
        : b.posImprovement - a.posImprovement,
    );
  }, [results]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        setShowNewTask(true);
      }
      if (e.key === 'Escape') {
        setShowNewTask(false);
        setEditingTask(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const addTask = useCallback((task: Omit<Task, 'id' | 'status'>) => {
    setTasks((prev) => {
      const next: Task = { ...task, id: `t${prev.length + 1}`, status: 'idle' };
      return [...prev, next];
    });
    setShowNewTask(false);
  }, []);

  useEffect(() => {
    if (!autoscroll) return;
    const el = logScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [localLogs, extraLogs, autoscroll]);

  const onLogScroll = () => {
    const el = logScrollRef.current;
    if (!el) return;
    setAutoscroll(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
  };

  const allLogs = useMemo(() => [...localLogs, ...(extraLogs ?? [])], [localLogs, extraLogs]);
  const filteredLogs = useMemo(
    () => (filter === 'ALL' ? allLogs : allLogs.filter((l) => l.level === filter)),
    [allLogs, filter],
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = { INFO: 0, WARN: 0, ERROR: 0, SUCCESS: 0, DEBUG: 0 };
    for (const l of allLogs) c[l.level] = (c[l.level] ?? 0) + 1;
    return c;
  }, [allLogs]);

  const runningCount = tasks.filter((t) => t.status === 'running').length;
  const progressValue = botState === 'running' ? 64 : 0;

  const handleStart = () => {
    onBotStateChange('running');
    setTasks((prev) => prev.map((t) => ({ ...t, status: 'running' as const })));
    onStartBot?.(tasks);
  };

  const handleStop = () => {
    onStopBot?.();
    onBotStateChange('idle');
    setTasks((prev) =>
      prev.map((t) => (t.status === 'running' ? { ...t, status: 'idle' as const } : t)),
    );
  };

  const deleteTask = (id: string) => {
    setTasks((prev) => {
      const next = prev.filter((t) => t.id !== id);
      onTasksChanged?.(next);
      return next;
    });
  };

  const applyTaskEdit = useCallback(
    (id: string, changes: Omit<Task, 'id' | 'status'>) => {
      setTasks((prev) => {
        const next = prev.map((t) => (t.id === id ? { ...t, ...changes } : t));
        onTasksChanged?.(next);
        return next;
      });
      setEditingTask(null);
    },
    [onTasksChanged],
  );

  useEffect(() => {
    if (results.length === 0) return;
    if (rightTab !== 'results') setUnreadResults((prev) => prev + 1);
  }, [results.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative h-full w-full flex flex-col bg-zinc-950 text-zinc-200">
      {/* TOP BAR */}
      <header className="h-11 shrink-0 flex items-center justify-between px-4 border-b border-zinc-800/70 bg-zinc-950/90 backdrop-blur">
        <div className="flex items-center gap-3">
          <Wordmark size="sm" />
          {version && (
            <span className="text-[10.5px] text-zinc-600 font-mono tabular-nums">v{version}</span>
          )}
          {updateStatus && (
            <span className="text-[10.5px] text-zinc-500 max-w-[200px] truncate">
              {updateStatus}
            </span>
          )}
          {updateProgress != null && updateProgress > 0 && (
            <div className="flex items-center gap-1.5">
              <div className="w-[80px] h-1 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-zinc-400 rounded-full transition-all"
                  style={{ width: `${updateProgress}%` }}
                />
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
              <span className="text-[12px] text-zinc-400 max-w-[96px] truncate">
                {user.first_name}
              </span>
            </div>
          )}
          <div className="w-px h-4 bg-zinc-800 mx-0.5" />
          <LanguageSwitcher />
          <div className="w-px h-4 bg-zinc-800 mx-1" />
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenSubscription}
            leadingIcon={<Icon name="crown" className="w-3.5 h-3.5" />}
          >
            {t('top.subscription')}
          </Button>
          <div className="w-px h-4 bg-zinc-800 mx-1" />
          <Button
            variant="ghost"
            size="sm"
            onClick={onLogout}
            leadingIcon={<Icon name="logout" className="w-3.5 h-3.5" />}
          >
            {t('top.logout')}
          </Button>
        </div>
      </header>

      {/* MAIN GRID */}
      <div className="flex-1 min-h-0 grid grid-cols-[minmax(320px,36%)_1fr]">
        {/* LEFT: TASK LIST */}
        <aside className="border-r border-zinc-800/70 flex flex-col min-h-0">
          <SectionHeader
            title={t('tasks.title')}
            subtitle={`${runningCount > 0 ? t('tasks.counts.running', { n: runningCount }) : ''}${t('tasks.counts.total', { n: tasks.length })}`}
            right={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowNewTask(true)}
                leadingIcon={<Icon name="plus" className="w-3.5 h-3.5" />}
                trailingIcon={<Kbd>⌘N</Kbd>}
              >
                {t('tasks.new')}
              </Button>
            }
          />
          {tasks.length === 0 ? (
            <div className="flex-1 grid place-items-center px-6 py-10 text-center">
              <div>
                <Icon name="target" className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
                <p className="text-[13px] font-semibold text-zinc-300 mb-1">
                  {t('tasks.empty.title')}
                </p>
                <p className="text-[12px] text-zinc-500 mb-4">{t('tasks.empty.subtitle')}</p>
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => setShowNewTask(true)}
                  leadingIcon={<Icon name="plus" className="w-3.5 h-3.5" />}
                >
                  {t('tasks.empty.cta')}
                </Button>
              </div>
            </div>
          ) : (
            <ul className="flex-1 overflow-y-auto">
              {tasks.map((task) => (
                <li
                  key={task.id}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setCtxMenu({ x: e.clientX, y: e.clientY, taskId: task.id, confirming: false });
                  }}
                >
                  <TaskRow
                    task={task}
                    selected={selectedId === task.id}
                    onClick={() => setSelectedId(task.id)}
                    found={foundTaskIds.has(task.id)}
                    foundLabel={t('tasks.found')}
                  />
                </li>
              ))}
              <li className="px-4 py-6 text-center">
                <button
                  onClick={() => setShowNewTask(true)}
                  className="text-[12px] text-zinc-500 hover:text-zinc-300 inline-flex items-center gap-1.5"
                >
                  <Icon name="plus" className="w-3 h-3" /> {t('tasks.addMore')}
                </button>
              </li>
            </ul>
          )}
        </aside>

        {/* RIGHT: TABBED PANEL (Log / Results) */}
        <section className="flex flex-col min-h-0 bg-zinc-950">
          {/* Tab bar */}
          <div className="h-10 shrink-0 flex items-center justify-between px-4 border-b border-zinc-800/70">
            <div className="flex items-center gap-0.5">
              {(['log', 'results'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => {
                    setRightTab(tab);
                    if (tab === 'results') setUnreadResults(0);
                  }}
                  className={`h-7 px-3 text-[12px] font-medium rounded-md transition-colors flex items-center gap-1.5 ${
                    rightTab === tab
                      ? 'bg-zinc-800 text-zinc-100'
                      : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
                  }`}
                >
                  {tab === 'log' ? t('panel.log') : t('panel.results')}
                  {tab === 'log' && (
                    <span className="text-[10.5px] text-zinc-600 tabular-nums">
                      {allLogs.length}
                    </span>
                  )}
                  {tab === 'results' && unreadResults > 0 && rightTab !== 'results' && (
                    <span className="text-[10.5px] bg-zinc-100 text-zinc-900 rounded px-1 tabular-nums font-semibold">
                      {unreadResults}
                    </span>
                  )}
                  {tab === 'results' &&
                    (rightTab === 'results' || unreadResults === 0) &&
                    results.length > 0 && (
                      <span className="text-[10.5px] bg-zinc-700 text-zinc-300 rounded px-1 tabular-nums">
                        {results.length}
                      </span>
                    )}
                </button>
              ))}
            </div>
            {rightTab === 'log' && (
              <div className="flex items-center gap-1">
                {['ALL', 'INFO', 'WARN', 'ERROR', 'SUCCESS'].map((lvl) => (
                  <button
                    key={lvl}
                    onClick={() => setFilter(lvl)}
                    className={`h-6 px-2 text-[10.5px] font-semibold tracking-[0.04em] rounded-md transition-colors ${
                      filter === lvl
                        ? 'bg-zinc-800 text-zinc-100'
                        : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
                    }`}
                  >
                    {lvl}
                    {lvl !== 'ALL' && (
                      <span className="ml-1 text-zinc-600 tabular-nums">{counts[lvl] ?? 0}</span>
                    )}
                  </button>
                ))}
                <div className="w-px h-4 bg-zinc-800 mx-1" />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowReport(true)}
                  title={t('report.button')}
                  leadingIcon={<Icon name="alert" className="w-3.5 h-3.5" />}
                />
                <Button variant="ghost" size="sm" onClick={() => setLocalLogs([])}>
                  {t('panel.clear')}
                </Button>
              </div>
            )}
            {rightTab === 'results' && results.length > 0 && (
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onExportResults}
                  leadingIcon={<Icon name="send" className="w-3 h-3" />}
                >
                  {t('panel.exportCsv')}
                </Button>
                {!confirmClear ? (
                  <Button variant="ghost" size="sm" onClick={() => setConfirmClear(true)}>
                    {t('panel.clear')}
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        onClearResults?.();
                        setConfirmClear(false);
                      }}
                    >
                      {t('common.confirm')}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmClear(false)}>
                      {t('common.cancel')}
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Log view */}
          {rightTab === 'log' && (
            <div ref={logScrollRef} onScroll={onLogScroll} className="flex-1 overflow-y-auto py-2">
              {filteredLogs.map((line) => (
                <LogLine
                  key={line.id}
                  time={line.time}
                  level={line.level}
                  source={line.source}
                  message={line.message}
                />
              ))}
              {filteredLogs.length === 0 && (
                <div className="px-4 py-10 text-center">
                  <Icon name="terminal" className="w-5 h-5 text-zinc-700 mx-auto mb-2" />
                  <p className="text-[12px] text-zinc-500">
                    {filter === 'ALL' ? t('panel.noLogs') : t('panel.noLogsAt', { filter })}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Results view */}
          {rightTab === 'results' && (
            <div className="flex-1 overflow-y-auto">
              {rankingStats.length > 0 && (
                <div className="border-b border-zinc-800/70">
                  <button
                    onClick={() => setStatsOpen((v) => !v)}
                    className="w-full flex items-center justify-between px-4 h-9 hover:bg-zinc-900/40 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <Icon name="activity" className="w-3.5 h-3.5 text-zinc-400" />
                      <span className="text-[11px] font-semibold tracking-[0.06em] text-zinc-300 uppercase">
                        Promotion Progress
                      </span>
                      <span className="inline-flex items-center justify-center h-4 min-w-[16px] px-1 rounded-sm bg-zinc-700 text-zinc-300 text-[10px] font-semibold tabular-nums">
                        {rankingStats.length}
                      </span>
                    </div>
                    <Icon
                      name="chevronRight"
                      className={`w-3.5 h-3.5 text-zinc-500 transition-transform ${statsOpen ? 'rotate-90' : ''}`}
                    />
                  </button>
                  {statsOpen && (
                    <div className="px-3 pb-3 pt-1 flex flex-wrap gap-2">
                      {rankingStats.map((s) => {
                        const improved =
                          s.pageImprovement > 0 ||
                          (s.pageImprovement === 0 && s.posImprovement > 0);
                        const worsened =
                          s.pageImprovement < 0 ||
                          (s.pageImprovement === 0 && s.posImprovement < 0);
                        const arrow = improved ? '↑' : worsened ? '↓' : '→';
                        const arrowColor = improved
                          ? 'text-emerald-400'
                          : worsened
                            ? 'text-red-400'
                            : 'text-zinc-500';
                        const chips = s.history.slice(-8);
                        const ref = chips[0];
                        return (
                          <div
                            key={`${s.keyword}|||${s.targetName}`}
                            className="flex-shrink-0 w-[220px] rounded-md border border-zinc-800/80 bg-zinc-900/50 px-3 py-2.5 space-y-1.5"
                          >
                            <div>
                              <p className="text-[12px] font-medium text-zinc-100 truncate leading-tight">
                                {s.targetName}
                              </p>
                              <p className="text-[10.5px] text-zinc-500 truncate mt-px">
                                {s.keyword}
                              </p>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[11px] font-mono text-zinc-400 tabular-nums">
                                P{s.first.page}·{s.first.pos}
                              </span>
                              <span className="text-[11px] text-zinc-600">→</span>
                              <span className="text-[11px] font-mono font-semibold text-zinc-100 tabular-nums">
                                P{s.latest.page}·{s.latest.pos}
                              </span>
                              <span
                                className={`text-[13px] font-bold leading-none ml-auto ${arrowColor}`}
                              >
                                {arrow}
                              </span>
                            </div>
                            <div className="flex items-center gap-0.5 flex-wrap">
                              {chips.map((pt, i) => {
                                const isFirst = i === 0;
                                const chipImproved =
                                  !isFirst &&
                                  (pt.page < ref.page ||
                                    (pt.page === ref.page && pt.pos < ref.pos));
                                const chipWorsened =
                                  !isFirst &&
                                  (pt.page > ref.page ||
                                    (pt.page === ref.page && pt.pos > ref.pos));
                                const chipCls = isFirst
                                  ? 'bg-zinc-700 text-zinc-300'
                                  : chipImproved
                                    ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/20'
                                    : chipWorsened
                                      ? 'bg-red-500/10 text-red-300 border border-red-500/15'
                                      : 'bg-zinc-800 text-zinc-400';
                                return (
                                  <span
                                    key={i}
                                    className={`inline-flex items-center justify-center h-4 px-1 rounded text-[9px] font-mono tabular-nums font-medium ${chipCls}`}
                                    title={`Page ${pt.page} Position ${pt.pos}`}
                                  >
                                    {pt.page}·{pt.pos}
                                  </span>
                                );
                              })}
                            </div>
                            <p className="text-[10px] text-zinc-600 tabular-nums">
                              {s.runCount} runs
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
              {results.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  <Icon name="target" className="w-5 h-5 text-zinc-700 mx-auto mb-2" />
                  <p className="text-[12px] text-zinc-500">{t('panel.noResults')}</p>
                </div>
              ) : (
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-zinc-800/70 text-zinc-500 text-[10.5px] uppercase tracking-wider sticky top-0 bg-zinc-950">
                      <th className="px-4 py-2 text-left font-semibold w-10">
                        {t('panel.col.num')}
                      </th>
                      <th className="px-4 py-2 text-left font-semibold w-24">
                        {t('panel.col.date')}
                      </th>
                      <th className="px-4 py-2 text-left font-semibold">
                        {t('panel.col.keyword')}
                      </th>
                      <th className="px-4 py-2 text-left font-semibold">
                        {t('panel.col.product')}
                      </th>
                      <th className="px-4 py-2 text-left font-semibold w-36">
                        {t('panel.col.location')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupedResults.map((group) => (
                      <React.Fragment key={group.runId ?? 'legacy'}>
                        <tr>
                          <td
                            colSpan={5}
                            className="px-4 py-1.5 bg-zinc-900/60 border-y border-zinc-800/60"
                          >
                            <span className="text-[10.5px] font-semibold text-zinc-500 uppercase tracking-[0.06em]">
                              {group.runId
                                ? t('panel.runId', { id: group.runId })
                                : t('panel.previousRuns')}
                            </span>
                            <span className="ml-2 text-[10.5px] text-zinc-600 tabular-nums">
                              {group.items.length === 1
                                ? t('panel.resultsCount.one')
                                : t('panel.resultsCount', { n: group.items.length })}
                            </span>
                          </td>
                        </tr>
                        {group.items.map((r) => (
                          <tr
                            key={r.id}
                            className="border-b border-zinc-800/40 hover:bg-zinc-900/40"
                          >
                            <td className="px-4 py-2 text-zinc-600 tabular-nums">{r.id}</td>
                            <td className="px-4 py-2 text-zinc-500 tabular-nums whitespace-nowrap">
                              <div>{r.date}</div>
                              {r.time && <div className="text-[10px] text-zinc-600">{r.time}</div>}
                            </td>
                            <td className="px-4 py-2 text-zinc-300 max-w-[140px]">
                              <span className="block truncate">{r.keyword}</span>
                            </td>
                            <td className="px-4 py-2 text-zinc-100 max-w-[200px]">
                              <span className="block truncate">{r.targetName}</span>
                            </td>
                            <td className="px-4 py-2 text-zinc-400 max-w-[140px]">
                              <span className="block truncate">{r.location}</span>
                            </td>
                          </tr>
                        ))}
                      </React.Fragment>
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
            <Button
              variant="primary"
              size="md"
              leadingIcon={<Icon name="play" className="w-3.5 h-3.5" strokeWidth={2} />}
              onClick={handleStart}
              disabled={tasks.length === 0}
            >
              {t('footer.start')}
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="md"
              leadingIcon={<Icon name="pause" className="w-3.5 h-3.5" />}
              onClick={() => onBotStateChange('paused')}
            >
              {t('footer.pause')}
            </Button>
          )}
          <Button
            variant={botState === 'idle' ? 'secondary' : 'danger'}
            size="md"
            leadingIcon={<Icon name="stop" className="w-3.5 h-3.5" />}
            onClick={handleStop}
            disabled={botState === 'idle'}
          >
            {t('footer.stop')}
          </Button>
        </div>

        <div className="w-px h-5 bg-zinc-800" />

        <div className="relative">
          <Button
            variant="ghost"
            size="md"
            onClick={() => setShowSchedule(true)}
            title="Scheduled search"
            leadingIcon={<Icon name="clock" className="w-3.5 h-3.5" />}
          />
          {scheduleConfig?.enabled && (
            <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-emerald-500 pointer-events-none" />
          )}
        </div>

        {screenshotPath && (
          <Button
            variant="ghost"
            size="md"
            onClick={() => onViewScreenshot?.(screenshotPath)}
            leadingIcon={<Icon name="image" className="w-3.5 h-3.5" />}
          >
            {t('footer.viewScreenshot')}
          </Button>
        )}

        <div className="flex-1 flex items-center gap-3 min-w-0">
          <StatusBadge
            status={botState === 'running' ? 'running' : botState === 'paused' ? 'warn' : 'idle'}
            label={t(`footer.state.${botState}`)}
            pulse={botState === 'running'}
          />
          <ProgressBar
            value={progressValue}
            indeterminate={botState === 'running'}
            label={botState === 'running' ? t('footer.tasksLabel', { n: tasks.length }) : undefined}
            className="flex-1 max-w-[420px]"
          />
        </div>
      </footer>

      {showReport && (
        <ReportModal
          onClose={() => setShowReport(false)}
          onSubmit={async (payload) => {
            const result = await onReportProblem?.(payload);
            return result ?? { success: false, error: 'Not configured' };
          }}
        />
      )}

      {showSchedule && (
        <ScheduleModal
          config={scheduleConfig ?? { enabled: false, intervalHours: 6, nextRunAt: null }}
          onClose={() => setShowSchedule(false)}
          onSave={async (cfg) => {
            await onSaveSchedule?.(cfg);
            // Parent re-fetches and updates initialSchedule, which syncs via useEffect above.
            setShowSchedule(false);
          }}
        />
      )}

      {showNewTask && <NewTaskDialog onClose={() => setShowNewTask(false)} onSubmit={addTask} />}
      {editingTask && (
        <NewTaskDialog
          onClose={() => setEditingTask(null)}
          onSubmit={addTask}
          editTask={editingTask}
          onEdit={applyTaskEdit}
        />
      )}

      {ctxMenu && (
        <div className="fixed inset-0 z-40" onClick={() => setCtxMenu(null)}>
          <div
            style={{ top: ctxMenu.y, left: ctxMenu.x }}
            className="absolute z-50 min-w-[160px] rounded-md border border-zinc-700 bg-zinc-900 shadow-xl py-1"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="w-full text-left px-3 py-1.5 text-[12.5px] text-zinc-300 hover:bg-zinc-800 flex items-center gap-2"
              onClick={() => {
                const task = tasks.find((task) => task.id === ctxMenu.taskId);
                if (task) setEditingTask(task);
                setCtxMenu(null);
              }}
            >
              <Icon name="settings" className="w-3.5 h-3.5" /> {t('tasks.edit')}
            </button>
            <div className="my-1 border-t border-zinc-800/70" />
            {!ctxMenu.confirming ? (
              <button
                className="w-full text-left px-3 py-1.5 text-[12.5px] text-red-400 hover:bg-zinc-800 flex items-center gap-2"
                onClick={() => setCtxMenu((prev) => (prev ? { ...prev, confirming: true } : null))}
              >
                <Icon name="x" className="w-3.5 h-3.5" /> {t('tasks.delete')}
              </button>
            ) : (
              <>
                <button
                  className="w-full text-left px-3 py-1.5 text-[12.5px] text-red-400 hover:bg-zinc-800 flex items-center gap-2 font-medium"
                  onClick={() => {
                    deleteTask(ctxMenu.taskId);
                    setCtxMenu(null);
                  }}
                >
                  <Icon name="x" className="w-3.5 h-3.5" /> {t('tasks.confirmDelete')}
                </button>
                <button
                  className="w-full text-left px-3 py-1.5 text-[12.5px] text-zinc-400 hover:bg-zinc-800 flex items-center gap-2"
                  onClick={() => setCtxMenu(null)}
                >
                  <Icon name="chevronRight" className="w-3.5 h-3.5 rotate-180" />{' '}
                  {t('common.cancel')}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---- New Task / Edit Task modal ---- */
function NewTaskDialog({
  onClose,
  onSubmit,
  editTask,
  onEdit,
}: {
  onClose: () => void;
  onSubmit: (t: Omit<Task, 'id' | 'status'>) => void;
  editTask?: Task;
  onEdit?: (id: string, changes: Omit<Task, 'id' | 'status'>) => void;
}) {
  const { t } = useT();
  const [keyword, setKeyword] = useState(editTask?.keyword ?? '');
  const [product, setProduct] = useState(editTask?.product ?? '');
  const [filters, setFilters] = useState(editTask?.filters?.join(', ') ?? '');
  const [minCost, setMinCost] = useState(editTask?.minCost ? String(editTask.minCost) : '');
  const [maxCost, setMaxCost] = useState(editTask?.maxCost ? String(editTask.maxCost) : '');
  const valid = keyword.trim() && product.trim();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    const payload = {
      keyword: keyword.trim(),
      product: product.trim(),
      filters: filters
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      minCost: minCost ? Number(minCost) : undefined,
      maxCost: maxCost ? Number(maxCost) : undefined,
    };
    if (editTask && onEdit) {
      onEdit(editTask.id, payload);
    } else {
      onSubmit(payload);
    }
  };

  return (
    <div
      className="absolute inset-0 z-50 grid place-items-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-[460px] rounded-lg border border-zinc-800 bg-zinc-950 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]"
      >
        <div className="px-5 pt-5 pb-4 border-b border-zinc-800/70">
          <h2 className="text-[14px] font-semibold text-zinc-100 tracking-tight">
            {editTask ? t('modal.edit.title') : t('modal.new.title')}
          </h2>
          <p className="text-[11.5px] text-zinc-500 mt-0.5">
            {editTask ? t('modal.edit.subtitle') : t('modal.new.subtitle')}
          </p>
        </div>
        <div className="px-5 py-4 space-y-3.5">
          <Field label={t('modal.keywordLabel')} hint={t('modal.keywordHint')}>
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder={t('modal.keywordPlaceholder')}
              autoFocus
            />
          </Field>
          <Field label={t('modal.productLabel')} hint={t('modal.productHint')}>
            <Input
              value={product}
              onChange={(e) => setProduct(e.target.value)}
              placeholder={t('modal.productPlaceholder')}
            />
          </Field>
          <Field label={t('modal.filtersLabel')} hint={t('modal.filtersHint')}>
            <Input
              value={filters}
              onChange={(e) => setFilters(e.target.value)}
              placeholder={t('modal.filtersPlaceholder')}
            />
          </Field>
          <Field label={t('modal.priceRangeLabel')}>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                placeholder="0"
                value={minCost}
                onChange={(e) => setMinCost(e.target.value)}
                className="flex-1"
              />
              <span className="text-zinc-600 text-[12px] shrink-0">~</span>
              <Input
                type="number"
                placeholder="0"
                value={maxCost}
                onChange={(e) => setMaxCost(e.target.value)}
                className="flex-1"
              />
              <span className="text-[11px] text-zinc-500 shrink-0">원</span>
            </div>
          </Field>
        </div>
        <div className="px-5 py-3.5 border-t border-zinc-800/70 flex items-center justify-between bg-zinc-900/30">
          <p className="text-[11px] text-zinc-500 inline-flex items-center gap-1.5">
            <Kbd>{t('common.esc')}</Kbd> {t('common.toCancel')}
          </p>
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="md" type="button" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" size="md" type="submit" disabled={!valid}>
              {editTask ? t('modal.save') : t('modal.create')}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

const PROBLEM_TYPE_KEYS = [
  'report.type.stuck',
  'report.type.notFound',
  'report.type.login',
  'report.type.browser',
  'report.type.schedule',
  'report.type.other',
] as const;

function ReportModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (payload: {
    type: string;
    description: string;
  }) => Promise<{ success: boolean; error?: string }>;
}) {
  const { t } = useT();
  const [typeKey, setTypeKey] = useState<string>(PROBLEM_TYPE_KEYS[0]);
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) return;
    setStatus('sending');
    const result = await onSubmit({ type: t(typeKey), description: description.trim() });
    if (result.success) {
      setStatus('success');
    } else {
      setErrorMsg(result.error ?? 'Unknown error');
      setStatus('error');
    }
  };

  return (
    <div
      className="absolute inset-0 z-50 grid place-items-center bg-black/50 backdrop-blur-sm"
      onClick={status === 'sending' ? undefined : onClose}
    >
      <div
        className="w-[460px] rounded-lg border border-zinc-800 bg-zinc-950 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-4 border-b border-zinc-800/70">
          <h2 className="text-[14px] font-semibold text-zinc-100 tracking-tight flex items-center gap-2">
            <Icon name="alert" className="w-4 h-4 text-amber-400" />
            {t('report.title')}
          </h2>
          <p className="text-[11.5px] text-zinc-500 mt-0.5">{t('report.subtitle')}</p>
        </div>

        {status === 'success' ? (
          <div className="px-5 py-8 text-center">
            <Icon name="check" className="w-8 h-8 text-emerald-400 mx-auto mb-3" />
            <p className="text-[13px] font-semibold text-zinc-100 mb-1">
              {t('report.success.title')}
            </p>
            <p className="text-[12px] text-zinc-500">{t('report.success.body')}</p>
            <div className="mt-5">
              <Button variant="secondary" size="md" onClick={onClose}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="px-5 py-4 space-y-3.5">
              <label className="block">
                <span className="text-[11.5px] font-medium text-zinc-300 block mb-1.5">
                  {t('report.typeLabel')}
                </span>
                <select
                  value={typeKey}
                  onChange={(e) => setTypeKey(e.target.value)}
                  className="h-8 w-full px-2.5 text-[13px] rounded-md bg-zinc-900/60 border border-zinc-800 text-zinc-100 focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 transition-colors"
                >
                  {PROBLEM_TYPE_KEYS.map((key) => (
                    <option key={key} value={key}>
                      {t(key)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-[11.5px] font-medium text-zinc-300 block mb-1.5">
                  {t('report.descLabel')}
                </span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t('report.descPlaceholder')}
                  rows={4}
                  className="w-full px-2.5 py-2 text-[13px] rounded-md bg-zinc-900/60 border border-zinc-800 text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 transition-colors resize-none"
                />
              </label>
              {status === 'error' && (
                <p className="text-[12px] text-red-400 flex items-center gap-1.5">
                  <Icon name="x" className="w-3.5 h-3.5" />{' '}
                  {t('report.failed', { error: errorMsg })}
                </p>
              )}
            </div>
            <div className="px-5 py-3.5 border-t border-zinc-800/70 flex items-center justify-between bg-zinc-900/30">
              <p className="text-[11px] text-zinc-500 inline-flex items-center gap-1.5">
                <Kbd>{t('common.esc')}</Kbd> {t('common.toCancel')}
              </p>
              <div className="flex items-center gap-1.5">
                <Button variant="ghost" size="md" type="button" onClick={onClose}>
                  {t('common.cancel')}
                </Button>
                <Button
                  variant="primary"
                  size="md"
                  type="submit"
                  disabled={!description.trim()}
                  loading={status === 'sending'}
                >
                  {t('report.send')}
                </Button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

const INTERVAL_OPTIONS: { label: string; value: number }[] = [
  { label: '1 hour', value: 1 },
  { label: '2 hours', value: 2 },
  { label: '3 hours', value: 3 },
  { label: '6 hours', value: 6 },
  { label: '12 hours', value: 12 },
  { label: '24 hours', value: 24 },
];

function formatTimeUntil(isoString: string): string {
  const diff = new Date(isoString).getTime() - Date.now();
  if (diff <= 0) return 'soon';
  const totalMin = Math.floor(diff / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function ScheduleModal({
  config,
  onClose,
  onSave,
}: {
  config: ScheduleConfig;
  onClose: () => void;
  onSave: (cfg: Omit<ScheduleConfig, 'nextRunAt'>) => Promise<void>;
}) {
  const [enabled, setEnabled] = useState(config.enabled);
  const [intervalHours, setIntervalHours] = useState(config.intervalHours);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await onSave({ enabled, intervalHours });
    setSaving(false);
  };

  return (
    <div
      className="absolute inset-0 z-50 grid place-items-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[400px] rounded-lg border border-zinc-800 bg-zinc-950 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-4 border-b border-zinc-800/70">
          <h2 className="text-[14px] font-semibold text-zinc-100 tracking-tight">
            Scheduled Search
          </h2>
          <p className="text-[11.5px] text-zinc-500 mt-0.5">
            Automatically run searches in the background
          </p>
        </div>
        <div className="px-5 py-4 space-y-4">
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="w-4 h-4 rounded accent-emerald-500"
            />
            <span className="text-[13px] text-zinc-200">Enable automatic scheduled runs</span>
          </label>
          <div className={enabled ? '' : 'opacity-40 pointer-events-none'}>
            <label className="block">
              <span className="text-[11.5px] font-medium text-zinc-300 block mb-1.5">
                Repeat every
              </span>
              <select
                value={intervalHours}
                onChange={(e) => setIntervalHours(Number(e.target.value))}
                className="h-8 w-full px-2.5 text-[13px] rounded-md bg-zinc-900/60 border border-zinc-800 text-zinc-100 focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 transition-colors"
              >
                {INTERVAL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {enabled && config.nextRunAt && (
            <p className="text-[11.5px] text-zinc-500">
              Next run in:{' '}
              <span className="text-zinc-300">{formatTimeUntil(config.nextRunAt)}</span>
            </p>
          )}
        </div>
        <div className="px-5 py-3.5 border-t border-zinc-800/70 flex items-center justify-end gap-1.5 bg-zinc-900/30">
          <Button variant="ghost" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="md" onClick={handleSave} loading={saving}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

const Field = ({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) => (
  <label className="block">
    <div className="flex items-baseline justify-between mb-1.5">
      <span className="text-[11.5px] font-medium text-zinc-300">{label}</span>
      {hint && <span className="text-[10.5px] text-zinc-600">{hint}</span>}
    </div>
    {children}
  </label>
);

const TaskRow = ({
  task,
  selected,
  onClick,
  found,
  foundLabel,
}: {
  task: Task;
  selected: boolean;
  onClick: () => void;
  found: boolean;
  foundLabel: string;
}) => {
  return (
    <button
      onClick={onClick}
      className={`group w-full text-left px-4 py-3 border-b border-zinc-800/50 transition-colors ${
        selected ? 'bg-zinc-900/60' : 'hover:bg-zinc-900/30'
      }`}
    >
      <div className="flex items-start justify-between gap-3 mb-1.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Icon name="target" className="w-3 h-3 text-zinc-600 shrink-0" />
            <span className="text-[12px] font-medium text-zinc-300 truncate">{task.keyword}</span>
          </div>
          <p className="text-[13px] font-medium text-zinc-100 tracking-tight truncate">
            {task.product}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {found && (
            <span className="inline-flex items-center gap-0.5 h-5 px-1.5 rounded-full border bg-emerald-500/[0.06] border-emerald-500/15 text-emerald-300/90 text-[10.5px] font-medium tracking-[0.04em] uppercase">
              <Icon name="check" className="w-2.5 h-2.5" /> {foundLabel}
            </span>
          )}
          <StatusBadge
            status={task.status}
            label={task.status}
            size="sm"
            pulse={task.status === 'running'}
          />
        </div>
      </div>
      <div className="flex items-center gap-3 pl-[18px] text-[11px] text-zinc-500 font-mono tabular-nums">
        <span
          className={`ml-auto px-1.5 py-px text-[10px] rounded font-sans ${
            selected ? 'text-zinc-400' : 'text-zinc-600 group-hover:text-zinc-400'
          }`}
        >
          #{task.id}
        </span>
      </div>
    </button>
  );
};
