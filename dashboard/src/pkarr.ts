export interface PkarrRecordResult {
  ok: boolean;
  publicKey: string;
  pkarrRelay: string;
  timestamp?: string;
  recordCount?: number;
  records?: unknown[];
  valid?: boolean;
  error?: string;
}

const PKARR_RESOLVE_TIMEOUT_MS = 10_000;

async function createClient(pkarrRelay: string) {
  const { Client } = await import("@synonymdev/pkarr");
  return new Client([pkarrRelay], 8000);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new Error(`Pkarr resolution timed out after ${timeoutMs / 1000}s`)),
      timeoutMs
    );

    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeout);
        reject(error);
      }
    );
  });
}

/**
 * Resolve a homeserver's signed pkarr packet via the testnet relay.
 */
export async function loadPkarrRecord(
  publicKey: string,
  pkarrRelay: string
): Promise<PkarrRecordResult> {
  const relay = pkarrRelay.replace(/\/$/, "");

  try {
    const client = await createClient(relay);
    const packet = await withTimeout(
      client.resolveMostRecent(publicKey),
      PKARR_RESOLVE_TIMEOUT_MS
    );
    if (!packet) {
      return {
        ok: false,
        publicKey,
        pkarrRelay: relay,
        error: "No pkarr record found",
      };
    }

    // pkarr WASM returns microseconds despite the `timestampMs` property name.
    const timestampMs = packet.timestampMs / 1000;

    return {
      ok: true,
      publicKey: packet.publicKeyString,
      timestamp: new Date(timestampMs).toISOString(),
      recordCount: packet.recordCount,
      records: packet.records,
      valid: packet.isValid(),
      pkarrRelay: relay,
    };
  } catch (e) {
    return {
      ok: false,
      publicKey,
      pkarrRelay: relay,
      error: e instanceof Error ? e.message : "Pkarr resolution failed",
    };
  }
}
