export interface ControlResponse {
  ok: boolean;
  label?: string;
  publicKey?: string;
  httpUrl?: string;
  message?: string;
  error?: string;
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
  createHomeserver: (index: number) =>
    postJson("/api/homeserver/create", { index }),
  seedHomeserver: (index: number) => postJson("/api/homeserver/seed", { index }),
  stopHomeserver: (index: number) => postJson("/api/homeserver/stop", { index }),
  addUser: (hs: number, profile: boolean) =>
    postJson("/api/user", { hs, profile }),
};
