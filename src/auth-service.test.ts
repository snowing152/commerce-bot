import { startTelegramAuth, checkAuthToken, getSubscriptionStatus } from './auth-service';

// ── Shared mock state ──────────────────────────────────────────────────────────

const mockInsert = jest.fn().mockResolvedValue({ error: null });

type SelectChain = {
  eq: jest.Mock;
  single: jest.Mock;
};
const mockSingle = jest.fn();
const mockEq = jest.fn(() => ({ single: mockSingle }));
const mockSelect = jest.fn((): SelectChain => ({ eq: mockEq, single: mockSingle }));

function makeTable() {
  return {
    insert: mockInsert,
    delete: jest.fn(() => ({ eq: mockEq })),
    update: jest.fn(() => ({ eq: mockEq })),
    select: mockSelect,
  };
}

const mockFrom = jest.fn(() => makeTable());

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ from: mockFrom })),
}));

jest.mock('electron', () => ({
  shell: { openExternal: jest.fn() },
}));

// Provide minimal env vars so getSupabase() doesn't throw
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_ANON_KEY = 'test-anon-key';
process.env.BOT_USERNAME = 'test_bot';

// ── startTelegramAuth ──────────────────────────────────────────────────────────

describe('startTelegramAuth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInsert.mockResolvedValue({ error: null });
    mockFrom.mockReturnValue(makeTable());
  });

  it('inserts a token row and opens the Telegram deep-link', async () => {
    const { shell } = await import('electron');
    const token = await startTelegramAuth();

    // Token is a 32-char hex string
    expect(token).toMatch(/^[0-9a-f]{32}$/);

    // Auth token row was inserted
    expect(mockFrom).toHaveBeenCalledWith('auth_tokens');
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ token, confirmed: false }));

    // Telegram deep-link was opened
    expect(shell.openExternal).toHaveBeenCalledWith(expect.stringContaining(`login_${token}`));
  });
});

// ── checkAuthToken ─────────────────────────────────────────────────────────────

describe('checkAuthToken', () => {
  const futureDate = new Date(Date.now() + 60_000).toISOString();
  const pastDate = new Date(Date.now() - 60_000).toISOString();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns success when token is confirmed and not expired', async () => {
    mockSingle.mockResolvedValue({
      data: { confirmed: true, telegram_id: 42, expires_at: futureDate },
    });
    mockEq.mockReturnValue({ single: mockSingle });
    mockSelect.mockReturnValue({ eq: mockEq, single: mockSingle });
    mockFrom.mockReturnValue({ ...makeTable(), select: mockSelect });

    const result = await checkAuthToken('abc123');
    expect(result).toEqual({ success: true, telegramId: 42 });
  });

  it('returns failure when token is not yet confirmed', async () => {
    mockSingle.mockResolvedValue({
      data: { confirmed: false, telegram_id: null, expires_at: futureDate },
    });
    mockEq.mockReturnValue({ single: mockSingle });
    mockSelect.mockReturnValue({ eq: mockEq, single: mockSingle });
    mockFrom.mockReturnValue({ ...makeTable(), select: mockSelect });

    const result = await checkAuthToken('abc123');
    expect(result).toEqual({ success: false });
  });

  it('returns failure and deletes the row when token is expired', async () => {
    const deleteEq = jest.fn().mockResolvedValue({ error: null });
    const mockDeleteChain = jest.fn(() => ({ eq: deleteEq }));

    mockSingle.mockResolvedValue({
      data: { confirmed: false, telegram_id: null, expires_at: pastDate },
    });
    mockEq.mockReturnValue({ single: mockSingle });
    mockSelect.mockReturnValue({ eq: mockEq, single: mockSingle });
    mockFrom.mockReturnValue({
      ...makeTable(),
      select: mockSelect,
      delete: mockDeleteChain,
    });

    const result = await checkAuthToken('expired-token');
    expect(result).toEqual({ success: false });
    expect(mockDeleteChain).toHaveBeenCalled();
  });

  it('returns failure when no row is found', async () => {
    mockSingle.mockResolvedValue({ data: null });
    mockEq.mockReturnValue({ single: mockSingle });
    mockSelect.mockReturnValue({ eq: mockEq, single: mockSingle });
    mockFrom.mockReturnValue({ ...makeTable(), select: mockSelect });

    const result = await checkAuthToken('unknown-token');
    expect(result).toEqual({ success: false });
  });
});

// ── getSubscriptionStatus ──────────────────────────────────────────────────────

describe('getSubscriptionStatus', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('maps live_status fields to the returned object', async () => {
    mockSingle.mockResolvedValue({
      data: {
        first_name: 'Alice',
        photo_url: null,
        live_status: 'active',
        subscription_status: 'active',
        days_left: 14,
        trial_start: null,
        period_end: '2026-06-01T00:00:00Z',
      },
      error: null,
    });
    mockEq.mockReturnValue({ single: mockSingle });
    mockSelect.mockReturnValue({ eq: mockEq, single: mockSingle });
    const mockUpdateChain = { eq: jest.fn().mockResolvedValue({}) };
    mockFrom.mockReturnValue({
      ...makeTable(),
      select: mockSelect,
      update: jest.fn(() => mockUpdateChain),
    });

    const result = await getSubscriptionStatus(99);
    expect(result.user).toEqual({ first_name: 'Alice', photo_url: null });
    expect(result.status).toBe('active');
    expect(result.daysLeft).toBe(14);
    expect(result.periodEnd).toBe('2026-06-01T00:00:00Z');
  });

  it('throws when user is not found', async () => {
    mockSingle.mockResolvedValue({ data: null, error: new Error('not found') });
    mockEq.mockReturnValue({ single: mockSingle });
    mockSelect.mockReturnValue({ eq: mockEq, single: mockSingle });
    mockFrom.mockReturnValue({ ...makeTable(), select: mockSelect });

    await expect(getSubscriptionStatus(404)).rejects.toThrow('User not found');
  });

  it('syncs live_status to subscription_status when they diverge', async () => {
    const updateEq = jest.fn().mockResolvedValue({});
    const mockUpdateChain = jest.fn(() => ({ eq: updateEq }));

    mockSingle.mockResolvedValue({
      data: {
        first_name: 'Bob',
        photo_url: null,
        live_status: 'expired',
        subscription_status: 'active', // stale — needs sync
        days_left: 0,
        trial_start: null,
        period_end: null,
      },
      error: null,
    });
    mockEq.mockReturnValue({ single: mockSingle });
    mockSelect.mockReturnValue({ eq: mockEq, single: mockSingle });
    mockFrom.mockReturnValue({
      ...makeTable(),
      select: mockSelect,
      update: mockUpdateChain,
    });

    const result = await getSubscriptionStatus(7);
    expect(result.status).toBe('expired');
    expect(mockUpdateChain).toHaveBeenCalledWith({ subscription_status: 'expired' });
  });
});
