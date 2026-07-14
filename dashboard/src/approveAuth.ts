import {
  Keypair,
  Pubky,
  PublicKey,
  validateCapabilities,
} from "@synonymdev/pubky";
import { api } from "./api";
import { secretFromMnemonic } from "./searchPubky";

export type AuthFlowIntent = "signin" | "signup";

export interface AuthFields {
  flow: AuthFlowIntent;
  caps: string;
  relay: string;
  secret: string;
  hs?: string;
  st?: string;
}

const pubky = Pubky.testnet("127.0.0.1");

/** Bare z32 pubky public key — not a URI. */
function isValidPubkyKey(value: string): boolean {
  const key = value.trim();
  if (!key || key.includes("://") || key.includes("/")) return false;
  return /^[a-z0-9]{40,64}$/.test(key);
}

function decodeBase64Url(value: string): Uint8Array | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const base64 = trimmed.replace(/-/g, "+").replace(/_/g, "/");
    const pad = base64.length % 4;
    const padded = pad ? base64 + "=".repeat(4 - pad) : base64;
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

function intentHost(url: URL): string {
  const host = url.host.trim();
  if (host) return host;
  const path = url.pathname.replace(/^\/+/, "").split("/")[0];
  return path;
}

function parseFlowIntent(url: URL): AuthFlowIntent {
  const host = intentHost(url);
  if (host.includes("grant")) {
    throw new Error(
      "Grant auth flows (signin_grant / signup_grant) are not supported yet"
    );
  }
  if (host === "signup") return "signup";
  return "signin";
}

export function parseAuthUrl(raw: string): AuthFields {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("pubkyauth://")) {
    throw new Error("URL must start with pubkyauth://");
  }

  const url = new URL(trimmed);
  const flow = parseFlowIntent(url);
  const caps = url.searchParams.get("caps") ?? "";
  const relay = url.searchParams.get("relay") ?? "";
  const secret = url.searchParams.get("secret") ?? "";
  const hs = url.searchParams.get("hs") ?? undefined;
  const st = url.searchParams.get("st") ?? undefined;

  if (!caps || !relay || !secret) {
    throw new Error("URL must include caps, relay, and secret query parameters");
  }

  return {
    flow,
    caps,
    relay,
    secret,
    hs: hs || undefined,
    st: st || undefined,
  };
}

export function buildAuthUrl(fields: AuthFields): string {
  const intent = fields.flow === "signup" ? "signup" : "signin";
  const url = new URL(`pubkyauth://${intent}`);
  url.searchParams.set("caps", fields.caps.trim());
  url.searchParams.set("relay", fields.relay.trim());
  url.searchParams.set("secret", fields.secret.trim());

  if (fields.flow === "signup") {
    if (fields.hs?.trim()) {
      url.searchParams.set("hs", fields.hs.trim());
    }
    if (fields.st?.trim()) {
      url.searchParams.set("st", fields.st.trim());
    }
  }

  return url.toString();
}

export function validateAuthFields(
  fields: AuthFields,
  defaultHomeserverZ32: string
): string | null {
  const caps = fields.caps.trim();
  if (!caps) return "Capabilities (caps) are required";

  try {
    validateCapabilities(caps);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Invalid capabilities";
    return message;
  }

  const relay = fields.relay.trim();
  if (!relay) return "Relay URL is required";
  try {
    new URL(relay);
  } catch {
    return "Relay must be a valid URL";
  }

  const secretBytes = decodeBase64Url(fields.secret);
  if (!secretBytes || secretBytes.length !== 32) {
    return "Secret must be a base64url-encoded 32-byte client secret";
  }

  if (fields.flow === "signup") {
    const hs = (fields.hs?.trim() || defaultHomeserverZ32).trim();
    if (!isValidPubkyKey(hs)) {
      return "Homeserver (hs) must be a z32 public key";
    }
  }

  return null;
}

async function signupBestEffort(
  signer: ReturnType<typeof pubky.signer>,
  homeserverZ32: string,
  signupToken?: string
): Promise<void> {
  try {
    await signer.signup(
      PublicKey.from(homeserverZ32),
      signupToken?.trim() || null
    );
  } catch {
    // Already registered on this homeserver is OK before approve.
  }
}

export async function approveAuthAsUser(options: {
  userIndex: number;
  fields: AuthFields;
  defaultHomeserverZ32: string;
}): Promise<void> {
  const { userIndex, fields, defaultHomeserverZ32 } = options;

  const validationError = validateAuthFields(fields, defaultHomeserverZ32);
  if (validationError) {
    throw new Error(validationError);
  }

  const keys = await api.fetchUserKeys(userIndex);
  const secret = await secretFromMnemonic(keys.mnemonic);
  const signer = pubky.signer(Keypair.fromSecret(secret));

  const authUrl = buildAuthUrl({
    ...fields,
    hs:
      fields.flow === "signup"
        ? fields.hs?.trim() || defaultHomeserverZ32
        : fields.hs,
  });

  if (fields.flow === "signup") {
    const hs = fields.hs?.trim() || defaultHomeserverZ32;
    await signupBestEffort(signer, hs, fields.st);
  }

  await signer.approveAuthRequest(authUrl);
}
