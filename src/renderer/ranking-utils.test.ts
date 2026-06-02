import { parseLocation, computeRankingStats } from './ranking-utils';
import { BotResult } from './types';

const result = (over: Partial<BotResult> & Pick<BotResult, 'id'>): BotResult => ({
  date: '2026-05-30',
  keyword: 'kw',
  targetName: 'product',
  location: 'page 1 position 1',
  ...over,
});

describe('parseLocation', () => {
  test('parses a well-formed location string (case-insensitive)', () => {
    expect(parseLocation('Page 2 Position 7')).toEqual({ page: 2, pos: 7 });
  });

  test('returns null for non-matching strings', () => {
    expect(parseLocation('not found')).toBeNull();
    expect(parseLocation('')).toBeNull();
  });

  test('rejects zero/negative page or position', () => {
    expect(parseLocation('page 0 position 3')).toBeNull();
    expect(parseLocation('page 1 position 0')).toBeNull();
  });
});

describe('computeRankingStats', () => {
  test('skips keyword/target groups with fewer than two parseable runs', () => {
    const stats = computeRankingStats([
      result({ id: 1, keyword: 'a', location: 'page 3 position 5' }),
      // unparseable second run -> only one valid point
      result({ id: 2, keyword: 'a', location: 'pending' }),
    ]);
    expect(stats).toEqual([]);
  });

  test('computes improvement from first to latest run ordered by id', () => {
    const stats = computeRankingStats([
      result({ id: 2, keyword: 'a', targetName: 'p', location: 'page 1 position 2' }),
      result({ id: 1, keyword: 'a', targetName: 'p', location: 'page 3 position 8' }),
    ]);
    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({
      keyword: 'a',
      targetName: 'p',
      first: { page: 3, pos: 8 },
      latest: { page: 1, pos: 2 },
      pageImprovement: 2,
      posImprovement: 6,
      runCount: 2,
    });
    expect(stats[0].history).toEqual([
      { page: 3, pos: 8 },
      { page: 1, pos: 2 },
    ]);
  });

  test('groups by keyword AND targetName, sorting by page then position improvement', () => {
    const stats = computeRankingStats([
      // group A: page improvement 1
      result({ id: 1, keyword: 'a', targetName: 'p', location: 'page 2 position 1' }),
      result({ id: 2, keyword: 'a', targetName: 'p', location: 'page 1 position 1' }),
      // group B: same keyword, different target, page improvement 1 but bigger pos improvement
      result({ id: 3, keyword: 'a', targetName: 'q', location: 'page 2 position 9' }),
      result({ id: 4, keyword: 'a', targetName: 'q', location: 'page 1 position 1' }),
    ]);
    expect(stats.map((s) => s.targetName)).toEqual(['q', 'p']);
  });
});
