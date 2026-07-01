import {
  useEffect,
  useState,
  type CSSProperties,
} from "react";
import { loadPkarrRecord, type PkarrRecordResult } from "./pkarr";
import {
  formatRecordValue,
  recordPort,
  recordType,
  type DnsRecord,
} from "./pkarrFormat";
import { PkarrRecordIcon } from "./PkarrRecordIcon";
import { hubColorFor } from "./hubColors";

function formatTimestamp(iso: string | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  });
}

export function PkarrRecordModal({
  label,
  seed,
  publicKey,
  pkarrRelay,
  kindLabel = "Pkarr record",
  onClose,
}: {
  label: string;
  seed: number;
  publicKey: string;
  pkarrRelay: string;
  kindLabel?: string;
  onClose: () => void;
}) {
  const { color } = hubColorFor(seed);
  const [loading, setLoading] = useState(true);
  const [record, setRecord] = useState<PkarrRecordResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setRecord(null);

    void loadPkarrRecord(publicKey, pkarrRelay)
      .then((result) => {
        if (cancelled) return;
        setRecord(result);
      })
      .catch((e) => {
        if (cancelled) return;
        setRecord({
          ok: false,
          publicKey,
          pkarrRelay: pkarrRelay.replace(/\/$/, ""),
          error: e instanceof Error ? e.message : "Pkarr resolution failed",
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [publicKey, pkarrRelay]);

  const records = (record?.records ?? []) as DnsRecord[];
  const relayUrl = `${pkarrRelay.replace(/\/$/, "")}/${publicKey}`;

  return (
    <div className="hs-action-modal-overlay" onClick={onClose}>
      <div
        className="hs-action-modal hs-pkarr-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pkarr-modal-title"
        aria-busy={loading}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="hs-action-modal-head hs-pkarr-modal-head"
          style={{ "--hs-accent": color } as CSSProperties}
        >
          <div className="hs-pkarr-head-main">
            <span className="hs-pkarr-head-icon" aria-hidden>
              <PkarrRecordIcon className="hs-pkarr-head-icon-svg" />
            </span>

            <div className="hs-pkarr-head-body">
              <div className="hs-pkarr-head-title-row">
                <h2 id="pkarr-modal-title">{label}</h2>
                {loading ? (
                  <span className="hs-pkarr-head-badge loading">Resolving…</span>
                ) : record?.ok ? (
                  <span
                    className={`hs-pkarr-head-badge ${record.valid ? "ok" : "bad"}`}
                  >
                    {record.valid ? "Valid signature" : "Invalid signature"}
                  </span>
                ) : (
                  <span className="hs-pkarr-head-badge bad">Not found</span>
                )}
              </div>

              <p className="hs-pkarr-head-kind">{kindLabel}</p>

              {!loading && record?.ok && (
                <p className="hs-pkarr-head-meta">
                  {formatTimestamp(record.timestamp)}
                </p>
              )}

              {!loading && record && !record.ok && (
                <p className="hs-pkarr-head-error">
                  {record.error ?? "Pkarr record not found"}
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            className="close-btn"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="hs-action-modal-form hs-pkarr-modal-body">
          {loading ? (
            <p className="hs-pkarr-loading muted">Fetching signed packet from relay…</p>
          ) : !record?.ok ? (
            <div className="hs-pkarr-error">
              <p className="hs-pkarr-relay muted">{relayUrl}</p>
            </div>
          ) : (
            <>
              {records.length > 0 ? (
                <div className="hs-pkarr-records">
                  <table className="hs-pkarr-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Type</th>
                        <th>Value</th>
                        <th>Port</th>
                        <th>TTL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {records.map((entry, index) => (
                        <tr key={`${entry.name ?? "record"}-${index}`}>
                          <td className="hs-pkarr-name">{entry.name || publicKey}</td>
                          <td className="hs-pkarr-type">{recordType(entry)}</td>
                          <td className="hs-pkarr-value">
                            {formatRecordValue(entry)}
                          </td>
                          <td className="hs-pkarr-port">{recordPort(entry)}</td>
                          <td className="hs-pkarr-ttl">{entry.ttl ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="muted hs-pkarr-empty">No DNS records in packet.</p>
              )}

              <details className="hs-pkarr-json">
                <summary>Raw JSON</summary>
                <pre>{JSON.stringify(record, null, 2)}</pre>
              </details>
            </>
          )}

          <div className="hs-action-modal-foot">
            <button type="button" className="action" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
