import { PubkyResource, type Session } from "@synonymdev/pubky";
import type { EventContentResult } from "./pubky";

export interface PrivRef {
  raw: string;
  path: string;
  ownerZ32: string;
}

type StoragePath = `/pub/${string}`;

function asStoragePath(path: string): StoragePath {
  return path as StoragePath;
}

const PRIV_PUBKY_URI =
  /pubky:?\/\/[a-z0-9]+\/priv\/[^\s"'<>,\]\}]+/gi;

const PRIV_ABS_PATH = /\/priv\/[a-zA-Z0-9_./-]+/g;

function refKey(ref: PrivRef): string {
  return `${ref.ownerZ32}:${ref.path}`;
}

function tryParsePubkyPrivRef(raw: string): PrivRef | null {
  try {
    const resource = PubkyResource.parse(raw);
    if (!resource.path.startsWith("/priv/")) return null;
    return {
      raw,
      path: resource.path,
      ownerZ32: resource.owner.z32(),
    };
  } catch {
    return null;
  }
}

export function extractPrivReferences(
  body: string,
  sessionUserZ32: string
): PrivRef[] {
  const found = new Map<string, PrivRef>();

  for (const match of body.matchAll(PRIV_PUBKY_URI)) {
    const raw = match[0];
    const parsed = tryParsePubkyPrivRef(raw);
    if (parsed) found.set(refKey(parsed), parsed);
  }

  for (const match of body.matchAll(PRIV_ABS_PATH)) {
    const raw = match[0];
    const ref: PrivRef = {
      raw,
      path: raw,
      ownerZ32: sessionUserZ32,
    };
    found.set(refKey(ref), ref);
  }

  return [...found.values()];
}

export async function resolvePrivRef(
  session: Session,
  ref: PrivRef,
  sessionUserZ32: string
): Promise<EventContentResult> {
  if (ref.ownerZ32 !== sessionUserZ32) {
    return { ok: false, error: "Not accessible with this session" };
  }

  const storagePath = asStoragePath(ref.path);

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
  } catch {
    try {
      const bytes = await session.storage.getBytes(storagePath);
      return {
        ok: true,
        contentType: "application/octet-stream",
        body: `[Binary content: ${bytes.length} bytes]`,
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to load content";
      if (
        message.includes("404") ||
        message.toLowerCase().includes("not found")
      ) {
        return { ok: false, error: "Content no longer exists (deleted)" };
      }
      return { ok: false, error: message };
    }
  }
}

export function privContentKey(rowIndex: number, path: string): string {
  return `${rowIndex}:${path}`;
}
