import { useEffect, useState } from "react";

export type HomeserverStatus = "active" | "dormant";

export interface User {
  index: number;
  name: string;
  publicKey: string;
}

export interface Homeserver {
  label: string;
  seed: number;
  publicKey: string;
  httpUrl: string;
  status: HomeserverStatus;
  userCount: number;
  users: User[];
  /** Per-user storage quota in MB from antfarm config. Omitted when unlimited. */
  storageQuotaMb?: number;
  /** When true, no one can reference this homeserver's users (isolated island). */
  island: boolean;
}

export interface NetworkInfo {
  bootstrap: string;
  pkarrRelay: string;
}

export type Range = [number, number];

export interface SimulatorInfo {
  intervalSecs: number;
  maxUsersPerHomeserver: number;
  usersPerTick: Range;
  postsPerTick: Range;
  tagsPerTick: Range;
  followsPerTick: Range;
}

export interface ActivityTotals {
  ticks: number;
  users: number;
  posts: number;
  tags: number;
  follows: number;
}

export interface Edge {
  from: string;
  to: string;
  follows: number;
}

export interface FollowEdge {
  from: number;
  to: number;
}

export interface DashboardState {
  network: NetworkInfo;
  simulator: SimulatorInfo;
  activity: ActivityTotals;
  homeservers: Homeserver[];
  edges: Edge[];
  follows: FollowEdge[];
}

/**
 * Subscribe to the antfarm dashboard SSE stream. The server pushes the full
 * dashboard state on connect and on every change, so there is no polling.
 */
export function useDashboard() {
  const [state, setState] = useState<DashboardState | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const es = new EventSource("/api/events");

    es.addEventListener("state", (event) => {
      setState(JSON.parse((event as MessageEvent).data) as DashboardState);
      setConnected(true);
    });

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    return () => es.close();
  }, []);

  return { state, connected };
}
