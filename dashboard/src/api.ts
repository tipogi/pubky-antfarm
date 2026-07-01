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
  if (!res.ok) {
    // Surface the backend's error payload (when present) instead of a bare status.
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) detail = body.error;
    } catch {
      // Non-JSON error body — keep the status-based message.
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

async function postJson(url: string, body: unknown): Promise<ControlResponse> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    // Parse the JSON body if there is one; failures surface as a structured error
    // (matching getJson) rather than being silently swallowed.
    let data: ControlResponse | null = null;
    try {
      data = (await res.json()) as ControlResponse;
    } catch {
      data = null;
    }

    if (!res.ok) {
      return { ok: false, error: data?.error ?? `HTTP ${res.status}` };
    }
    return data ?? { ok: false, error: "empty response from antfarm" };
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
  changeHomeserver: (userIndex: number, targetSeed: number) =>
    postJson("/api/user/change-homeserver", { userIndex, targetSeed }),
  follow: (from: number, target: string) =>
    postJson("/api/follow", { from, target }),
  tag: (from: number, target: string, label: string) =>
    postJson("/api/tag", { from, target, label }),
  batch: (req: { from: number; posts: number; tags: number }) =>
    postJson("/api/batch", req),
  socialPost: (req: {
    from: string;
    kind: string;
    mentionKey?: string;
    postUri?: string;
  }) => postJson("/api/post/social", req),
  fetchUsersStorage: (seed: number) =>
    getJson<UserStorageStats[]>(`/api/homeserver/${seed}/users/storage`),
  fetchUserKeys: (index: number) =>
    getJson<UserKeys>(`/api/user/${index}/keys`),
};
