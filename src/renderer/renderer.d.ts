export {};

declare global {
  interface ScheduleConfig {
    enabled: boolean;
    intervalHours: number;
    nextRunAt: string | null;
  }

  interface Window {
    api: {
      startBot(tasks: unknown[]): void;
      stopBot(): void;
      saveSession(data: unknown): Promise<{ success: boolean }>;
      loadSession(): Promise<unknown>;
      loadResults(): Promise<unknown[]>;
      clearResults(): Promise<{ success: boolean; error?: string }>;
      exportResultsCsv(): Promise<{ success: boolean; path?: string; error?: string }>;
      sendLogToTelegram(): Promise<{ success: boolean; error?: string }>;
      openScreenshot(path: string): void;
      getVersion(): Promise<string>;
      getBotUsername(): Promise<string | undefined>;
      getSubscriptionStatus(): Promise<SubscriptionResult>;
      openPaymentBot(): Promise<void>;
      navigateTo(page: 'auth' | 'subscription' | 'main'): Promise<void>;
      logout(): Promise<void>;
      startTelegramAuth(): Promise<string>;
      checkAuthToken(token: string): Promise<{ success: boolean; telegramId?: number }>;
      clearChromeDebugProfile(): Promise<{ success: boolean; path: string; error?: string }>;
      sendProblemReport(payload: {
        type: string;
        description: string;
      }): Promise<{ success: boolean; error?: string }>;
      getSchedule(): Promise<ScheduleConfig>;
      saveSchedule(cfg: Omit<ScheduleConfig, 'nextRunAt'>): Promise<{ success: boolean }>;
      // event listeners — all return an unsubscribe cleanup function
      onLog(cb: (msg: string) => void): () => void;
      onRunning(cb: () => void): () => void;
      onDone(cb: (path: string | null) => void): () => void;
      onBotResult(cb: (data: unknown) => void): () => void;
      onUpdateProgress(cb: (percent: number) => void): () => void;
      onUpdateStatus(
        cb: (payload: { key: string; params?: Record<string, string | number> }) => void,
      ): () => void;
      onUpdateError(
        cb: (p: {
          message: string | null;
          retryInSec: number | null;
          attempt: number | null;
        }) => void,
      ): () => void;
      onSubscriptionUpdated(cb: () => void): () => void;
    };
  }

  interface SubscriptionResult {
    user: { first_name: string; photo_url: string | null };
    status: 'trial' | 'active' | 'expired';
    daysLeft: number | null;
    trialStart: string | null;
    periodEnd: string | null;
    price: string;
  }
}
