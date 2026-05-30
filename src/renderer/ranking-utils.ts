import { BotResult } from './types';

export interface RankPoint {
  page: number;
  pos: number;
}

export interface RankingStat {
  keyword: string;
  targetName: string;
  first: RankPoint;
  latest: RankPoint;
  pageImprovement: number;
  posImprovement: number;
  history: RankPoint[];
  runCount: number;
}

export function parseLocation(location: string): RankPoint | null {
  const m = location.match(/page\s+(\d+)\s+position\s+(\d+)/i);
  if (!m) return null;
  const page = parseInt(m[1], 10),
    pos = parseInt(m[2], 10);
  if (isNaN(page) || isNaN(pos) || page < 1 || pos < 1) return null;
  return { page, pos };
}

export function computeRankingStats(results: BotResult[]): RankingStat[] {
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
}
