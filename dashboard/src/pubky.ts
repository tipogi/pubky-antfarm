import { Pubky } from "@synonymdev/pubky";

// Single shared client wired for the local testnet (pkarr relay on :15411).
let client: Pubky | null = null;
function pubky(): Pubky {
  if (!client) client = Pubky.testnet();
  return client;
}

export interface Profile {
  name?: string;
  bio?: string;
  image?: string;
}

const profileCache = new Map<string, Promise<Profile | null>>();
const avatarCache = new Map<string, Promise<string | null>>();
const tagsCache = new Map<string, Promise<string[]>>();

/** Read a user's public `profile.json` from their homeserver (cached). */
export function loadProfile(pk: string): Promise<Profile | null> {
  let p = profileCache.get(pk);
  if (!p) {
    p = (async () => {
      try {
        const json = await pubky().publicStorage.getJson(
          `pubky://${pk}/pub/pubky.app/profile.json` as never
        );
        return (json ?? null) as Profile | null;
      } catch {
        return null;
      }
    })();
    profileCache.set(pk, p);
  }
  return p;
}

/**
 * List the unique tag labels a user has authored, read from their
 * `/pub/pubky.app/tags/` directory on their homeserver (cached).
 */
export function loadTags(pk: string): Promise<string[]> {
  let p = tagsCache.get(pk);
  if (!p) {
    p = (async () => {
      try {
        const urls = await pubky().publicStorage.list(
          `pubky://${pk}/pub/pubky.app/tags/` as never,
          null,
          null,
          30,
          true
        );
        const labels = await Promise.all(
          urls.slice(0, 30).map(async (u) => {
            try {
              const tag = await pubky().publicStorage.getJson(u as never);
              return (tag?.label as string) ?? null;
            } catch {
              return null;
            }
          })
        );
        const seen = new Set<string>();
        const out: string[] = [];
        for (const l of labels) {
          if (l && !seen.has(l)) {
            seen.add(l);
            out.push(l);
          }
        }
        return out;
      } catch {
        return [];
      }
    })();
    tagsCache.set(pk, p);
  }
  return p;
}

/**
 * Resolve a profile's avatar to an object URL. `profile.image` points at a
 * PubkyAppFile resource whose `src` is the blob; fetch that and wrap the bytes.
 */
export function loadAvatar(imageUri: string | undefined): Promise<string | null> {
  if (!imageUri) return Promise.resolve(null);
  let p = avatarCache.get(imageUri);
  if (!p) {
    p = (async () => {
      try {
        const file = await pubky().publicStorage.getJson(imageUri as never);
        const src: string | undefined = file?.src;
        if (!src) return null;
        const bytes = await pubky().publicStorage.getBytes(src as never);
        const type: string = file?.content_type ?? "image/jpeg";
        return URL.createObjectURL(
          new Blob([bytes as unknown as BlobPart], { type })
        );
      } catch {
        return null;
      }
    })();
    avatarCache.set(imageUri, p);
  }
  return p;
}
