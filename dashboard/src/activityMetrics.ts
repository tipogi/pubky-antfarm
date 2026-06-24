import type { TickEvent } from "./useActivity";
import type { ActivityTotals, Range, SimulatorInfo } from "./useDashboard";

export const ENTITY_KEYS = ["users", "posts", "tags", "follows"] as const;
export type EntityKey = (typeof ENTITY_KEYS)[number];

export const ENTITY_META: Record<
  EntityKey,
  { label: string; short: string; color: string }
> = {
  users: { label: "Users", short: "u", color: "#ffc93c" },
  posts: { label: "Posts", short: "p", color: "#fefa3d" },
  tags: { label: "Tags", short: "t", color: "#ff9e2c" },
  follows: { label: "Follows", short: "f", color: "#e07b1e" },
};

export function tickTotal(tick: TickEvent): number {
  return tick.users + tick.posts + tick.tags + tick.follows;
}

export function activityGrandTotal(totals: ActivityTotals): number {
  return totals.users + totals.posts + totals.tags + totals.follows;
}

export function entitiesPerMinute(
  feed: TickEvent[],
  intervalSecs: number
): number | null {
  if (feed.length === 0 || intervalSecs <= 0) return null;
  const window = feed.slice(0, Math.min(feed.length, 10));
  const sum = window.reduce((acc, tick) => acc + tickTotal(tick), 0);
  const minutes = (window.length * intervalSecs) / 60;
  if (minutes <= 0) return null;
  return sum / minutes;
}

export function feedAverages(feed: TickEvent[]): Record<EntityKey, number> {
  if (feed.length === 0) {
    return { users: 0, posts: 0, tags: 0, follows: 0 };
  }
  const sum = feed.reduce(
    (acc, tick) => ({
      users: acc.users + tick.users,
      posts: acc.posts + tick.posts,
      tags: acc.tags + tick.tags,
      follows: acc.follows + tick.follows,
    }),
    { users: 0, posts: 0, tags: 0, follows: 0 }
  );
  const n = feed.length;
  return {
    users: sum.users / n,
    posts: sum.posts / n,
    tags: sum.tags / n,
    follows: sum.follows / n,
  };
}

export function rangeMidpoint(range: Range): number {
  return (range[0] + range[1]) / 2;
}

export function formatRate(value: number | null): string {
  if (value === null) return "—";
  if (value >= 100) return `${Math.round(value)}`;
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

export function formatCompact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1000)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(Math.round(value));
}

export function simulatorRows(
  simulator: SimulatorInfo,
  observed: Record<EntityKey, number>
) {
  return [
    { key: "users" as const, label: "Users / tick", range: simulator.usersPerTick },
    { key: "posts" as const, label: "Posts / tick", range: simulator.postsPerTick },
    { key: "tags" as const, label: "Tags / tick", range: simulator.tagsPerTick },
    { key: "follows" as const, label: "Follows / tick", range: simulator.followsPerTick },
  ].map((row) => ({
    ...row,
    observed: observed[row.key],
    expected: rangeMidpoint(row.range),
    inRange:
      observed[row.key] >= row.range[0] - 0.01 &&
      observed[row.key] <= row.range[1] + 0.01,
  }));
}
