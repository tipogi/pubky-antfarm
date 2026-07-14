import {
  Keypair,
  Pubky,
  PublicKey,
  type Event,
  type Address,
  type Session,
} from "@synonymdev/pubky";
import type { EventContentResult } from "./pubky";

export const SEARCH_EVENTS_LIMIT = 200;

const pubky = Pubky.testnet("127.0.0.1");

/** SessionStorage Path type only covers /pub/; /priv/ works at runtime. */
type StoragePath = `/pub/${string}`;

function asStoragePath(path: string): StoragePath {
  return path as StoragePath;
}

/** Whether a resource path belongs to the private (`/priv/`) namespace. */
export function isPrivPath(path: string): boolean {
  return path.startsWith("/priv/");
}

/**
 * Normalized event used by the Search table, merging both transports:
 * public events (SDK live stream) and private events (raw live fetch).
 */
export interface SearchEvent {
  cursor: string;
  /** "PUT" | "DEL". */
  eventType: string;
  /** Absolute resource path, e.g. `/pub/…` or `/priv/…`. */
  path: string;
  /** Full `pubky://<owner>/<path>` URL. */
  uri: string;
  ownerZ32: string;
  contentHash?: string;
  scope: "pub" | "priv";
}

/** Map an SDK event into the normalized {@link SearchEvent} shape. */
export function toSearchEvent(event: Event): SearchEvent {
  const path = event.resource.path;
  return {
    cursor: event.cursor,
    eventType: event.eventType,
    path,
    uri: event.resource.toPubkyUrl(),
    ownerZ32: event.resource.owner.z32(),
    contentHash: event.contentHash ?? undefined,
    scope: isPrivPath(path) ? "priv" : "pub",
  };
}

/** Parse one SSE event block (`event:`/`data:` lines) into a {@link SearchEvent}. */
function parsePrivEventBlock(block: string): SearchEvent | null {
  let eventType: string | null = null;
  let uri: string | null = null;
  let cursor: string | undefined;
  let contentHash: string | undefined;

  for (const raw of block.split("\n")) {
    const line = raw.trimEnd();
    if (line.startsWith("event:")) {
      eventType = line.slice("event:".length).trim();
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

  if (!eventType || !uri || !cursor) return null;

  const match = /^pubky:\/\/([^/]+)(\/.*)$/.exec(uri);
  if (!match) return null;

  return {
    cursor,
    eventType,
    path: match[2],
    uri,
    ownerZ32: match[1],
    contentHash,
    scope: "priv",
  };
}

/**
 * Subscribe to a user's private (`/priv/`) events via a raw live SSE fetch.
 *
 * The SDK's `eventStreamForUser` addresses the request to the homeserver host,
 * so its cookie session (named after the user) is never matched for `/priv/`.
 * We instead address the request to the user's own `_pubky.<user>` host, which
 * makes the transport send `pubky-host: <user>` and the browser attach the
 * session cookie — the same mechanism `session.storage` uses for `/priv/` reads.
 *
 * Failures are surfaced via `onError` (soft); returns a cancel function.
 */
export async function subscribePrivateEvents(
  userZ32: string,
  onEvent: (event: SearchEvent) => void,
  onError?: (error: Error) => void
): Promise<() => void> {
  const url = new URL(`https://_pubky.${userZ32}/events-stream`);
  url.searchParams.set("user", userZ32);
  url.searchParams.set("limit", String(SEARCH_EVENTS_LIMIT));
  url.searchParams.set("live", "true");
  url.searchParams.set("path", "/priv/");

  const res = await pubky.client.fetch(url.toString(), {
    credentials: "include",
  });

  if (!res.ok || !res.body) {
    onError?.(new Error(`HTTP ${res.status}`));
    return () => {};
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let stopped = false;
  let buffer = "";

  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done || stopped) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 2);
          if (!block) continue;
          const event = parsePrivEventBlock(block);
          if (event && !stopped) onEvent(event);
        }
      }
    } catch (e) {
      if (!stopped) {
        onError?.(e instanceof Error ? e : new Error("Private stream failed"));
      }
    }
  })();

  return () => {
    stopped = true;
    void reader.cancel();
  };
}

export function parseSearchKey(input: string): PublicKey {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Public key is required");
  }
  return PublicKey.from(trimmed);
}

export async function restoreSessionFromRecovery(
  file: File,
  passphrase: string
): Promise<{ session: Session; publicKeyZ32: string }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const keypair = Keypair.fromRecoveryFile(bytes, passphrase);
  const session = await pubky.signer(keypair).signin();
  return {
    session,
    publicKeyZ32: keypair.publicKey.z32(),
  };
}

/**
 * Derive the 32-byte secret from a BIP39 mnemonic, matching the backend
 * (`src/commands/keygen.rs`): PBKDF2-HMAC-SHA512 over the NFKD-normalized
 * phrase with salt "mnemonic", 2048 iterations, then take the first 32 bytes.
 */
export async function secretFromMnemonic(mnemonic: string): Promise<Uint8Array> {
  const normalized = mnemonic.trim().replace(/\s+/g, " ").normalize("NFKD");
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(normalized),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const seed = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: encoder.encode("mnemonic"),
      iterations: 2048,
      hash: "SHA-512",
    },
    keyMaterial,
    512
  );
  return new Uint8Array(seed).slice(0, 32);
}

export async function restoreSessionFromMnemonic(
  mnemonic: string
): Promise<{ session: Session; publicKeyZ32: string }> {
  const secret = await secretFromMnemonic(mnemonic);
  const keypair = Keypair.fromSecret(secret);
  const session = await pubky.signer(keypair).signin();
  return {
    session,
    publicKeyZ32: keypair.publicKey.z32(),
  };
}

export async function signOutSession(session: Session | null): Promise<void> {
  if (!session) return;
  try {
    await session.signout();
  } catch {
    // Best-effort cleanup when the stream or tab is torn down.
  }
}

async function loadSessionPathContent(
  session: Session,
  path: string
): Promise<EventContentResult> {
  const storagePath = asStoragePath(path);
  try {
    const [body, stats] = await Promise.all([
      session.storage.getText(storagePath),
      session.storage.stats(storagePath),
    ]);
    return {
      ok: true,
      contentType: stats?.contentType,
      body,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load content";
    if (message.includes("404") || message.toLowerCase().includes("not found")) {
      return { ok: false, error: "Content no longer exists (deleted)" };
    }
    return { ok: false, error: message };
  }
}

async function loadPublicContent(
  address: Address
): Promise<EventContentResult> {
  try {
    const [body, stats] = await Promise.all([
      pubky.publicStorage.getText(address),
      pubky.publicStorage.stats(address),
    ]);
    return {
      ok: true,
      contentType: stats?.contentType,
      body,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load content";
    if (message.includes("404") || message.toLowerCase().includes("not found")) {
      return { ok: false, error: "Content no longer exists (deleted)" };
    }
    return { ok: false, error: message };
  }
}

/**
 * Subscribe to a user's homeserver event stream (history + live).
 * The SDK resolves the homeserver internally on subscribe.
 *
 * Returns a cleanup function that cancels the stream reader.
 */
export async function subscribeUserEvents(
  user: PublicKey,
  onEvent: (event: Event) => void,
  onError?: (error: Error) => void
): Promise<() => void> {
  const stream = await pubky
    .eventStreamForUser(user, null)
    .live()
    .limit(SEARCH_EVENTS_LIMIT)
    .subscribe();

  const reader = stream.getReader();
  let cancelled = false;

  void (async () => {
    try {
      while (!cancelled) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!cancelled) onEvent(value);
      }
    } catch (e) {
      if (!cancelled) {
        onError?.(e instanceof Error ? e : new Error("Event stream failed"));
      }
    }
  })();

  return () => {
    cancelled = true;
    void reader.cancel();
  };
}

export async function loadSearchEventContent(
  event: SearchEvent,
  session: Session | null
): Promise<EventContentResult> {
  if (event.eventType === "DEL") {
    return { ok: false, error: "Content deleted" };
  }

  if (event.scope === "priv") {
    if (!session) {
      return {
        ok: false,
        error: "Import recovery file to view private content",
      };
    }
    return loadSessionPathContent(session, event.path);
  }

  return loadPublicContent(event.uri as Address);
}
