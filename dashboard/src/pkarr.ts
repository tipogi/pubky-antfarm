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

async function createClient(pkarrRelay: string) {
  const { Client } = await import("@synonymdev/pkarr");
  return new Client([pkarrRelay], 8000);
}

/**
 * Resolve a homeserver's signed pkarr packet via the testnet relay.
 */
export async function loadPkarrRecord(
  publicKey: string,
  pkarrRelay: string
): Promise<PkarrRecordResult> {
  const relay = pkarrRelay.replace(/\/$/, "");
  const client = await createClient(relay);

  try {
    const packet = await client.resolveMostRecent(publicKey);
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
