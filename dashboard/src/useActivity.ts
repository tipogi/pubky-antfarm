import { useEffect, useState } from "react";

export interface TickEvent {
  tick: number;
  users: number;
  posts: number;
  tags: number;
  follows: number;
}

/** Recent simulator ticks kept for the graph timeline and analytics feed. */
const MAX_FEED = 160;

/**
 * Subscribe to the per-tick simulator activity SSE stream, keeping the most
 * recent ticks (newest first) for a live feed.
 */
export function useActivity() {
  const [feed, setFeed] = useState<TickEvent[]>([]);

  useEffect(() => {
    const es = new EventSource("/api/activity");

    es.addEventListener("tick", (event) => {
      const ev = JSON.parse((event as MessageEvent).data) as TickEvent;
      setFeed((prev) => [ev, ...prev].slice(0, MAX_FEED));
    });

    return () => es.close();
  }, []);

  return feed;
}
