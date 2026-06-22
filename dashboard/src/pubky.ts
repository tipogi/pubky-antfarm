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
