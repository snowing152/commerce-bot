export interface ScheduleState {
  enabled: boolean;
  intervalHours: number;
  nextRunAt: string | null;
}

export function mergeNextRunAt(
  prev: ScheduleState | null,
  nextRunAt: string | null,
): ScheduleState | null {
  return prev ? { ...prev, nextRunAt } : null;
}
