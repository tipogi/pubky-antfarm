export interface DnsRecord {
  name?: string;
  ttl?: number;
  rdata?: Record<string, unknown> | string;
}

function rdataObject(record: DnsRecord): Record<string, unknown> | null {
  const rdata = record.rdata;
  if (!rdata || typeof rdata !== "object") return null;
  return rdata;
}

function readParams(rdata: Record<string, unknown>): Record<string, unknown> | null {
  const params = rdata.params;
  if (params && typeof params === "object") {
    return params as Record<string, unknown>;
  }
  return null;
}

function readParamString(
  params: Record<string, unknown> | null,
  key: string
): string | null {
  if (!params) return null;
  const value = params[key];
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function readPort(rdata: Record<string, unknown>): number | null {
  const params = readParams(rdata);
  const fromParams = readParamString(params, "port");
  if (fromParams != null) {
    const parsed = Number(fromParams);
    if (Number.isFinite(parsed)) return parsed;
  }

  const direct = rdata.port;
  if (typeof direct === "number" && Number.isFinite(direct)) return direct;
  if (typeof direct === "string") {
    const parsed = Number(direct);
    if (Number.isFinite(parsed)) return parsed;
  }

  return null;
}

function readIpv4Hint(rdata: Record<string, unknown>): string | null {
  return (
    readParamString(readParams(rdata), "ipv4hint") ||
    (typeof rdata.ipv4hint === "string" && rdata.ipv4hint ? rdata.ipv4hint : null)
  );
}

function readIpv6Hint(rdata: Record<string, unknown>): string | null {
  return (
    readParamString(readParams(rdata), "ipv6hint") ||
    (typeof rdata.ipv6hint === "string" && rdata.ipv6hint ? rdata.ipv6hint : null)
  );
}

function readTarget(rdata: Record<string, unknown>): string | null {
  const target = rdata.target;
  if (typeof target !== "string" || !target || target === ".") return null;
  return target;
}

export function recordType(record: DnsRecord): string {
  return String(rdataObject(record)?.type ?? "—");
}

export function recordPort(record: DnsRecord): string {
  const rdata = rdataObject(record);
  if (!rdata) return "—";

  const type = String(rdata.type ?? "");
  if (type !== "HTTPS" && type !== "SVCB") return "—";

  const port = readPort(rdata);
  return port != null ? String(port) : "—";
}

export function formatRecordValue(record: DnsRecord): string {
  const rdata = record.rdata;
  if (rdata == null) return "—";
  if (typeof rdata === "string") return rdata;

  const type = String(rdata.type ?? "UNKNOWN");
  switch (type) {
    case "A":
    case "AAAA":
      return String(rdata.address ?? "—");
    case "CNAME":
      return String(rdata.target ?? "—");
    case "TXT":
      return String(rdata.text ?? rdata.data ?? "—");
    case "NS":
      return String(rdata.ns ?? rdata.target ?? "—");
    case "HTTPS":
    case "SVCB": {
      const params = readParams(rdata);
      const parts = [
        rdata.priority != null ? String(rdata.priority) : null,
        readTarget(rdata),
        readIpv4Hint(rdata),
        readIpv6Hint(rdata),
        readParamString(params, "alpn"),
      ].filter(Boolean);
      return parts.length > 0 ? parts.join(" · ") : "—";
    }
    default:
      return JSON.stringify(rdata);
  }
}

/** First HTTPS/SVCB endpoint as host:port when available. */
export function extractEndpoint(records: DnsRecord[]): string | null {
  let fallbackHost: string | null = null;

  for (const record of records) {
    const rdata = rdataObject(record);
    if (!rdata) continue;

    const type = String(rdata.type ?? "");
    if (type === "A" && typeof rdata.address === "string") {
      fallbackHost = rdata.address;
      continue;
    }
    if (type === "AAAA" && typeof rdata.address === "string") {
      fallbackHost = rdata.address;
      continue;
    }

    if (type !== "HTTPS" && type !== "SVCB") continue;

    const host =
      readIpv4Hint(rdata) ||
      readIpv6Hint(rdata) ||
      readTarget(rdata) ||
      fallbackHost;
    const port = readPort(rdata);

    if (host && port != null) return `${host}:${port}`;
    if (port != null) return `:${port}`;
    if (host) return host;
  }

  return fallbackHost;
}
