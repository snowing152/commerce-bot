import React, { forwardRef } from 'react';

/* ---------- Icons ---------- */
const iconPaths: Record<string, React.ReactNode> = {
  check: <polyline points="20 6 9 17 4 12" />,
  x: (
    <>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </>
  ),
  chevronRight: <polyline points="9 18 15 12 9 6" />,
  play: <polygon points="6 4 20 12 6 20 6 4" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="1" />,
  pause: (
    <>
      <rect x="6" y="5" width="4" height="14" rx="0.5" />
      <rect x="14" y="5" width="4" height="14" rx="0.5" />
    </>
  ),
  plus: (
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </>
  ),
  logout: (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </>
  ),
  send: (
    <>
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </>
  ),
  user: (
    <>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </>
  ),
  crown: <path d="M2 7l5 5 5-7 5 7 5-5-2 13H4L2 7z" />,
  activity: <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />,
  terminal: (
    <>
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </>
  ),
  spark: (
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2 2M16.4 16.4l2 2M5.6 18.4l2-2M16.4 7.6l2-2" />
  ),
  minimize: <line x1="5" y1="12" x2="19" y2="12" />,
  maximize: <rect x="4" y="4" width="16" height="16" rx="0.5" />,
  close: (
    <>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>
  ),
  package: (
    <>
      <path d="M16.5 9.4 7.55 4.24" />
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </>
  ),
  won: (
    <>
      <path d="M3 6h18l-2 13H5L3 6z" />
      <path d="M3 6L2 3" />
    </>
  ),
  refresh: (
    <>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </>
  ),
  alert: (
    <>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </>
  ),
  telegram: <path d="M21.5 4.5 2.5 12l5.5 2 2 6 3.5-4 5.5 4 3-15.5z M9.5 14.5l9-7-7 8.5" />,
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </>
  ),
};

export interface IconProps {
  name: string;
  className?: string;
  strokeWidth?: number;
}

export const Icon = ({ name, className = 'w-4 h-4', strokeWidth = 1.5 }: IconProps) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    {iconPaths[name]}
  </svg>
);

/* ---------- Button ---------- */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'secondary',
      size = 'md',
      className = '',
      children,
      leadingIcon,
      trailingIcon,
      loading,
      ...props
    },
    ref,
  ) => {
    const base =
      'inline-flex items-center justify-center gap-1.5 font-medium tracking-tight rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed select-none focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400';
    const sizes = { sm: 'h-7 px-2.5 text-[12.5px]', md: 'h-8 px-3 text-[13px]' };
    const variants = {
      primary:
        'bg-zinc-50 text-zinc-950 hover:bg-white shadow-[0_1px_0_0_rgba(255,255,255,0.08)_inset]',
      secondary: 'bg-zinc-800/60 text-zinc-100 hover:bg-zinc-800 border border-zinc-700/60',
      ghost: 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60',
      danger: 'bg-red-500/10 text-red-300 hover:bg-red-500/15 border border-red-500/20',
    };
    return (
      <button
        ref={ref}
        className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
        {...props}
      >
        {loading ? <Spinner size={12} /> : leadingIcon}
        {children}
        {trailingIcon}
      </button>
    );
  },
);
Button.displayName = 'Button';

/* ---------- Input ---------- */
export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className = '', ...props }, ref) => (
    <input
      ref={ref}
      className={`h-8 w-full px-2.5 text-[13px] rounded-md bg-zinc-900/60 border border-zinc-800 text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 transition-colors ${className}`}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

/* ---------- Card ---------- */
export const Card = ({
  className = '',
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={`rounded-lg border border-zinc-800/80 bg-zinc-900/40 ${className}`} {...props}>
    {children}
  </div>
);

/* ---------- StatusBadge ---------- */
type BadgeStatus =
  | 'waiting'
  | 'confirmed'
  | 'success'
  | 'active'
  | 'running'
  | 'error'
  | 'expired'
  | 'idle'
  | 'warn'
  | 'info';

export interface StatusBadgeProps {
  status: BadgeStatus | string;
  label?: string;
  pulse?: boolean;
  size?: 'sm' | 'md';
}

export const StatusBadge = ({ status, label, pulse = false, size = 'md' }: StatusBadgeProps) => {
  const map: Record<string, { dot: string; text: string; bg: string }> = {
    waiting: {
      dot: 'bg-amber-400',
      text: 'text-amber-300/90',
      bg: 'bg-amber-500/[0.06] border-amber-500/15',
    },
    confirmed: {
      dot: 'bg-emerald-400',
      text: 'text-emerald-300/90',
      bg: 'bg-emerald-500/[0.06] border-emerald-500/15',
    },
    success: {
      dot: 'bg-emerald-400',
      text: 'text-emerald-300/90',
      bg: 'bg-emerald-500/[0.06] border-emerald-500/15',
    },
    active: {
      dot: 'bg-emerald-400',
      text: 'text-emerald-300/90',
      bg: 'bg-emerald-500/[0.06] border-emerald-500/15',
    },
    running: {
      dot: 'bg-emerald-400',
      text: 'text-emerald-300/90',
      bg: 'bg-emerald-500/[0.06] border-emerald-500/15',
    },
    error: {
      dot: 'bg-red-400',
      text: 'text-red-300/90',
      bg: 'bg-red-500/[0.06] border-red-500/15',
    },
    expired: {
      dot: 'bg-zinc-500',
      text: 'text-zinc-400',
      bg: 'bg-zinc-500/[0.06] border-zinc-500/20',
    },
    idle: {
      dot: 'bg-zinc-500',
      text: 'text-zinc-400',
      bg: 'bg-zinc-500/[0.06] border-zinc-500/20',
    },
    warn: {
      dot: 'bg-amber-400',
      text: 'text-amber-300/90',
      bg: 'bg-amber-500/[0.06] border-amber-500/15',
    },
    info: { dot: 'bg-sky-400', text: 'text-sky-300/90', bg: 'bg-sky-500/[0.06] border-sky-500/15' },
  };
  const c = map[status] ?? map.idle;
  const sz = size === 'sm' ? 'h-5 px-1.5 text-[10.5px] gap-1' : 'h-6 px-2 text-[11px] gap-1.5';
  return (
    <span
      className={`inline-flex items-center font-medium tracking-tight rounded-full border ${sz} ${c.bg} ${c.text}`}
    >
      <span className={`relative w-1.5 h-1.5 rounded-full ${c.dot}`}>
        {pulse && (
          <span className={`absolute inset-0 rounded-full ${c.dot} animate-ping opacity-60`} />
        )}
      </span>
      <span className="uppercase tracking-[0.04em]">{label ?? status}</span>
    </span>
  );
};

/* ---------- LogLine ---------- */
export const levelColor: Record<string, string> = {
  INFO: 'text-zinc-400',
  WARN: 'text-amber-300',
  ERROR: 'text-red-300',
  SUCCESS: 'text-emerald-300',
  DEBUG: 'text-zinc-600',
};
const levelBg: Record<string, string> = {
  INFO: '',
  WARN: 'bg-amber-500/[0.025]',
  ERROR: 'bg-red-500/[0.04]',
  SUCCESS: 'bg-emerald-500/[0.025]',
  DEBUG: '',
};

export interface LogLineProps {
  time: string;
  level: string;
  message: string;
  source?: string;
}

export const LogLine = React.memo(({ time, level, message, source }: LogLineProps) => (
  <div
    className={`flex items-baseline gap-3 px-4 py-[3px] font-mono text-[11.5px] leading-[1.55] hover:bg-zinc-800/30 ${levelBg[level] ?? ''}`}
    style={{ contentVisibility: 'auto', containIntrinsicSize: '20px' }}
  >
    <span className="text-zinc-600 tabular-nums shrink-0 w-[68px]">{time}</span>
    <span
      className={`shrink-0 w-[58px] font-semibold tracking-[0.04em] ${levelColor[level] ?? 'text-zinc-400'}`}
    >
      {level}
    </span>
    {source && <span className="text-zinc-600 shrink-0 w-[88px] truncate">[{source}]</span>}
    <span className="text-zinc-300 break-all">{message}</span>
  </div>
));
LogLine.displayName = 'LogLine';

/* ---------- ProgressBar ---------- */
export interface ProgressBarProps {
  value?: number;
  indeterminate?: boolean;
  label?: string;
  className?: string;
}

export const ProgressBar = ({
  value = 0,
  indeterminate = false,
  label,
  className = '',
}: ProgressBarProps) => (
  <div className={`flex items-center gap-2.5 ${className}`}>
    {label && <span className="text-[11px] text-zinc-500 tabular-nums shrink-0">{label}</span>}
    <div className="relative h-[3px] flex-1 rounded-full bg-zinc-800/80 overflow-hidden">
      {indeterminate ? (
        <div className="absolute inset-y-0 w-1/3 bg-zinc-300 rounded-full animate-[indeterminate_1.6s_ease-in-out_infinite]" />
      ) : (
        <div
          className="absolute inset-y-0 left-0 bg-zinc-200 rounded-full transition-[width] duration-300"
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      )}
    </div>
    {!indeterminate && (
      <span className="text-[11px] text-zinc-400 tabular-nums w-9 text-right">
        {Math.round(value)}%
      </span>
    )}
  </div>
);

/* ---------- Spinner ---------- */
export interface SpinnerProps {
  size?: number;
  className?: string;
}

export const Spinner = ({ size = 14, className = '' }: SpinnerProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className={`animate-spin ${className}`}
    fill="none"
  >
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.18" strokeWidth="2.5" />
    <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

/* ---------- Kbd ---------- */
export const Kbd = ({ children }: { children: React.ReactNode }) => (
  <kbd className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-mono rounded bg-zinc-800/80 border border-zinc-700/60 text-zinc-400">
    {children}
  </kbd>
);

/* ---------- SectionHeader ---------- */
export interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  className?: string;
}

export const SectionHeader = ({ title, subtitle, right, className = '' }: SectionHeaderProps) => (
  <div
    className={`flex items-center justify-between px-4 h-10 border-b border-zinc-800/70 ${className}`}
  >
    <div className="flex items-baseline gap-2">
      <h3 className="text-[12px] font-semibold tracking-tight text-zinc-200 uppercase">{title}</h3>
      {subtitle && <span className="text-[11px] text-zinc-500">{subtitle}</span>}
    </div>
    {right}
  </div>
);

/* ---------- Wordmark ---------- */
export interface WordmarkProps {
  size?: 'sm' | 'md' | 'lg';
}

export const Wordmark = ({ size = 'md' }: WordmarkProps) => {
  const dim = size === 'lg' ? 'w-9 h-9' : size === 'sm' ? 'w-5 h-5' : 'w-6 h-6';
  const text = size === 'lg' ? 'text-[15px]' : 'text-[12.5px]';
  return (
    <div className="flex items-center gap-2">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 200 200"
        className={`${dim} rounded-md flex-shrink-0`}
        aria-label="Coupang Bot"
      >
        <defs>
          <linearGradient id="wm-bg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#27272a" />
            <stop offset="100%" stopColor="#09090b" />
          </linearGradient>
          <linearGradient id="wm-br" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fafafa" />
            <stop offset="100%" stopColor="#a1a1aa" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="200" height="200" rx="40" fill="url(#wm-bg)" />
        <rect
          x="0.5"
          y="0.5"
          width="199"
          height="199"
          rx="39.5"
          fill="none"
          stroke="#3f3f46"
          strokeWidth="1"
        />
        <path
          d="M 70 50 L 50 50 L 50 150 L 70 150"
          fill="none"
          stroke="url(#wm-br)"
          strokeWidth="14"
          strokeLinecap="square"
          strokeLinejoin="miter"
        />
        <path
          d="M 130 50 L 150 50 L 150 150 L 130 150"
          fill="none"
          stroke="url(#wm-br)"
          strokeWidth="14"
          strokeLinecap="square"
          strokeLinejoin="miter"
        />
        <circle cx="100" cy="100" r="10" fill="#10b981" />
        <circle cx="100" cy="100" r="4" fill="#022c22" />
      </svg>
      <div className="flex flex-col leading-none">
        <span className={`${text} font-semibold tracking-tight text-zinc-100`}>Coupang Bot</span>
        {size === 'lg' && (
          <span className="text-[10.5px] text-zinc-500 mt-0.5 tracking-tight">
            Automation Client
          </span>
        )}
      </div>
    </div>
  );
};
