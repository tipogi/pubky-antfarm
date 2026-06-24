export interface ControlResponse {
  ok: boolean;
  label?: string;
  publicKey?: string;
  httpUrl?: string;
  message?: string;
  error?: string;
}

export interface UserStorageStats {
  index: number;
  publicKey: string;
  usedBytes: number;
  storageQuotaMb?: number | null;
}

export interface UserKeys {
  index: number;
  publicKey: string;
  /** BIP39 recovery phrase (mnemonic seed) for this user. */
  mnemonic: string;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function postJson(url: string, body: unknown): Promise<ControlResponse> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await res.json()) as ControlResponse;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "request failed" };
  }
}

export const api = {
  createHomeserver: (index: number, island = false) =>
    postJson("/api/homeserver/create", { index, island }),
  seedHomeserver: (index: number) => postJson("/api/homeserver/seed", { index }),
  stopHomeserver: (index: number) => postJson("/api/homeserver/stop", { index }),
  setIsland: (index: number, island: boolean) =>
    postJson("/api/homeserver/island", { index, island }),
  addUser: (hs: number, profile: boolean) =>
    postJson("/api/user", { hs, profile }),
  follow: (from: number, target: string) =>
    postJson("/api/follow", { from, target }),
  tag: (from: number, target: string, label: string) =>
    postJson("/api/tag", { from, target, label }),
  batch: (req: { from: number; posts: number; tags: number }) =>
    postJson("/api/batch", req),
  fetchUsersStorage: (seed: number) =>
    getJson<UserStorageStats[]>(`/api/homeserver/${seed}/users/storage`),
  fetchUserKeys: (index: number) =>
    getJson<UserKeys>(`/api/user/${index}/keys`),
};
