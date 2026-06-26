import { Pubky } from "@synonymdev/pubky";

export interface Profile {
  name?: string;
  bio?: string;
  image?: string;
}

interface PubkyFile {
  src?: string;
  content_type?: string;
}

interface PubkyTag {
  label?: string;
}

export interface UserStorageContext {
  pk: string;
  homeserverUrl: string;
  userIndex?: number;
}

const profileCache = new Map<string, Promise<Profile | null>>();
const avatarCache = new Map<string, Promise<string | null>>();
const tagsCache = new Map<string, Promise<string[]>>();

export const USER_EVENTS_PAGE_SIZE = 200;

export interface UserEvent {
  /** "PUT" or "DEL". */
  type: string;
  uri: string;
  path: string;
  contentHash?: string;
  /** Homeserver event cursor (monotonic id, newest-first when reversed). */
  cursor?: string;
}

export interface UserEventsResult {
  ok: boolean;
  events: UserEvent[];
  error?: string;
}

// Shared SDK client wired for the local testnet. We use its low-level
// `client.fetch` (a raw HTTP bridge) against direct homeserver URLs, rather than
// `publicStorage` with `pubky://…` addresses: the latter forces browser-side
// pkarr/DHT resolution, which only works for the built-in homeserver on its
// fixed port. Reusing the SDK client keeps cookie/credentials handling consistent.
const pubky = Pubky.testnet("127.0.0.1");

function storageKey(ctx: UserStorageContext): string {
  return `${ctx.pk}@${ctx.homeserverUrl}`;
}

/**
 * Build a direct homeserver URL for `pk`'s absolute path.
 *
 * The dashboard backend has already resolved every homeserver's key record, so
 * `homeserverUrl` is the homeserver's real ICANN HTTP endpoint (correct port and
 * all). We hit it directly and identify the tenant with the `pubky-host` query
 * param — no browser-side pkarr/DHT resolution, which only ever works for the
 * built-in homeserver on its fixed port. The homeserver serves these reads with
 * a very-permissive CORS policy.
 *
 * `0.0.0.0` (the wildcard the built-in homeserver binds to) is rewritten to
 * loopback so browsers can actually connect.
 */
function directUrl(
  homeserverUrl: string,
  pk: string,
  path: string,
  extraQuery?: Record<string, string>
): string {
  const base = homeserverUrl.replace("0.0.0.0", "127.0.0.1").replace(/\/$/, "");
  const query = new URLSearchParams({ "pubky-host": pk, ...extraQuery });
  return `${base}${path}?${query.toString()}`;
}

/** Split a `pubky://<pk>/<path>` URI into its public key and absolute path. */
function parsePubkyUri(uri: string): { pk: string; path: string } | null {
  const match = /^pubky:\/\/([^/]+)(\/.*)$/.exec(uri);
  return match ? { pk: match[1], path: match[2] } : null;
}

/** Raw HTTP GET through the SDK client (no `pubky://` resolution). */
function hsFetch(url: string): Promise<Response> {
  return pubky.client.fetch(url);
}

/**
 * Fetch JSON, distinguishing a definitive "not found" (`404` → `null`, cacheable)
 * from a transient/network failure (throws, so the caller can retry later).
 */
async function getJsonOrNull<T>(url: string): Promise<T | null> {
  const res = await hsFetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Read a user's public profile directly from their homeserver. */
export function loadProfile(ctx: UserStorageContext): Promise<Profile | null> {
  const key = storageKey(ctx);
  let p = profileCache.get(key);
  if (!p) {
    p = getJsonOrNull<Profile>(
      directUrl(ctx.homeserverUrl, ctx.pk, "/pub/pubky.app/profile.json")
    ).catch(() => {
      // Transient failure — evict so a later render retries instead of being
      // stuck on a cached null. (A real 404 resolves to null and is kept.)
      profileCache.delete(key);
      return null;
    });
    profileCache.set(key, p);
  }
  return p;
}

/** Resolve a profile avatar to an object URL by reading the file + blob directly. */
export function loadAvatar(
  imageUri: string | undefined,
  ctx: UserStorageContext
): Promise<string | null> {
  const key = storageKey(ctx);
  let p = avatarCache.get(key);
  if (!p) {
    p = (async () => {
      if (!imageUri) return null;

      const fileRef = parsePubkyUri(imageUri);
      if (!fileRef) return null;
      const file = await getJsonOrNull<PubkyFile>(
        directUrl(ctx.homeserverUrl, fileRef.pk, fileRef.path)
      );
      if (!file?.src) return null;

      const blobRef = parsePubkyUri(file.src);
      if (!blobRef) return null;
      const res = await hsFetch(
        directUrl(ctx.homeserverUrl, blobRef.pk, blobRef.path)
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const blob = new Blob([await res.arrayBuffer()], {
        type: file.content_type ?? "image/jpeg",
      });
      return URL.createObjectURL(blob);
    })().catch(() => {
      avatarCache.delete(key);
      return null;
    });
    avatarCache.set(key, p);
  }
  return p;
}

/**
 * Parse the homeserver `/events-stream` SSE body into events.
 *
 * Each event is a block of `data:` lines separated by a blank line:
 *   event: PUT
 *   data: pubky://<pk>/pub/posts/003
 *   data: cursor: 42
 *   data: content_hash: <base64>
 *
 * The first `data:` line is the full resource URL; subsequent ones are the
 * `cursor:`/`content_hash:` fields.
 */
function parseEventStream(body: string): UserEvent[] {
  const events: UserEvent[] = [];
  let type: string | null = null;
  let uri: string | null = null;
  let cursor: string | undefined;
  let contentHash: string | undefined;

  const flush = () => {
    if (type && uri) {
      const ref = parsePubkyUri(uri);
      events.push({
        type,
        uri,
        path: ref?.path ?? uri,
        cursor,
        contentHash,
      });
    }
    type = null;
    uri = null;
    cursor = undefined;
    contentHash = undefined;
  };

  for (const raw of body.split("\n")) {
    const line = raw.trimEnd();
    if (line === "") {
      flush();
      continue;
    }
    if (line.startsWith("event:")) {
      type = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      const value = line.slice("data:".length).trim();
      if (value.startsWith("cursor:")) {
        cursor = value.slice("cursor:".length).trim();
      } else if (value.startsWith("content_hash:")) {
        contentHash = value.slice("content_hash:".length).trim();
      } else if (value) {
        uri = value;
      }
    }
  }
  flush();
  return events;
}

/**
 * Read a user's recent homeserver events directly from their homeserver via the
 * SDK client, newest-first. Uses the `/events-stream` endpoint with `reverse`
 * (so the stream sends history then closes) filtered to this single user.
 *
 * Always fetched fresh from the homeserver — events are intentionally not cached
 * so each click reflects the live state.
 */
export async function loadUserEvents(
  userPk: string,
  homeserverUrl: string
): Promise<UserEventsResult> {
  try {
    const res = await hsFetch(
      directUrl(homeserverUrl, userPk, "/events-stream", {
        user: userPk,
        reverse: "true",
        limit: String(USER_EVENTS_PAGE_SIZE),
      })
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { ok: true, events: parseEventStream(await res.text()) };
  } catch (e) {
    return {
      ok: false,
      events: [] as UserEvent[],
      error: e instanceof Error ? e.message : "Failed to load events",
    };
  }
}

export interface EventContentResult {
  ok: boolean;
  /** Response `Content-Type`, when the homeserver reported one. */
  contentType?: string;
  /** Raw response body (pretty-printed by the caller when it is JSON). */
  body?: string;
  error?: string;
}

/**
 * Read the stored content of a single event by its `pubky://<pk>/<path>` URI,
 * directly from the homeserver via the SDK client. Useful for inspecting what a
 * PUT event actually wrote. Not cached — each open reflects live storage.
 */
export async function loadEventContent(
  uri: string,
  homeserverUrl: string
): Promise<EventContentResult> {
  const ref = parsePubkyUri(uri);
  if (!ref) return { ok: false, error: "Invalid event URI" };
  try {
    const res = await hsFetch(directUrl(homeserverUrl, ref.pk, ref.path));
    if (res.status === 404) {
      return { ok: false, error: "Content no longer exists (deleted)" };
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return {
      ok: true,
      contentType: res.headers.get("content-type") ?? undefined,
      body: await res.text(),
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to load content",
    };
  }
}

/** List the unique tag labels a user has authored, read directly from their homeserver. */
export function loadTags(ctx: UserStorageContext): Promise<string[]> {
  const key = storageKey(ctx);
  let p = tagsCache.get(key);
  if (!p) {
    p = (async () => {
      const res = await hsFetch(
        directUrl(ctx.homeserverUrl, ctx.pk, "/pub/pubky.app/tags/", {
          shallow: "true",
          limit: "30",
        })
      );
      if (res.status === 404) return [];
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      // The listing is newline-separated `pubky://…` URLs.
      const urls = (await res.text())
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 30);

      const labels = await Promise.all(
        urls.map(async (url) => {
          const ref = parsePubkyUri(url);
          if (!ref) return null;
          const tag = await getJsonOrNull<PubkyTag>(
            directUrl(ctx.homeserverUrl, ref.pk, ref.path)
          );
          return tag?.label ?? null;
        })
      );

      return [...new Set(labels.filter((label): label is string => label !== null))];
    })().catch(() => {
      tagsCache.delete(key);
      return [] as string[];
    });
    tagsCache.set(key, p);
  }
  return p;
}
