import { mergeNextRunAt } from './schedule-utils';

describe('mergeNextRunAt', () => {
  test('updates nextRunAt while preserving enabled and intervalHours', () => {
    const prev = { enabled: true, intervalHours: 6, nextRunAt: null };
    const result = mergeNextRunAt(prev, '2026-05-27T10:00:00.000Z');
    expect(result).toEqual({
      enabled: true,
      intervalHours: 6,
      nextRunAt: '2026-05-27T10:00:00.000Z',
    });
  });

  test('returns null when prev state is null', () => {
    expect(mergeNextRunAt(null, '2026-05-27T10:00:00.000Z')).toBeNull();
  });

  test('clears nextRunAt when incoming value is null', () => {
    const prev = { enabled: true, intervalHours: 6, nextRunAt: '2026-05-27T10:00:00.000Z' };
    const result = mergeNextRunAt(prev, null);
    expect(result).toEqual({ enabled: true, intervalHours: 6, nextRunAt: null });
  });
});
