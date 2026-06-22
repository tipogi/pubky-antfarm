import { useEffect, useMemo, useState } from "react";
import { api, type UserStorageStats } from "./api";
import { loadProfile, type UserStorageContext } from "./pubky";
import type { Homeserver } from "./useDashboard";

function shortKey(key: string): string {
  return key.length > 16 ? `${key.slice(0, 8)}…${key.slice(-6)}` : key;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatLimit(quotaMb: number | null | undefined): string {
  if (quotaMb == null) return "Unlimited";
  return `${quotaMb} MB`;
}

function usageRatio(used: number, quotaMb: number | null | undefined): number {
  if (quotaMb == null || quotaMb === 0) return 0;
  return Math.min(1, used / (quotaMb * 1024 * 1024));
}

type QuotaRisk = "low" | "medium" | "high";

function quotaRisk(used: number, quotaMb: number | null | undefined): QuotaRisk {
  const ratio = usageRatio(used, quotaMb);
  if (quotaMb == null || quotaMb === 0) return "low";
  if (ratio >= 0.85) return "high";
  if (ratio >= 0.55) return "medium";
  return "low";
}

const QUOTA_SEGMENTS = 20;

function QuotaBar({
  used,
  quotaMb,
  loading,
}: {
  used: number;
  quotaMb: number | null | undefined;
  loading: boolean;
}) {
  if (loading) {
    return <span className="hs-users-muted">…</span>;
  }

  const unlimited = quotaMb == null || quotaMb === 0;
  const ratio = usageRatio(used, quotaMb);
  const filled = unlimited
    ? 0
    : Math.max(used > 0 ? 1 : 0, Math.round(ratio * QUOTA_SEGMENTS));
  const risk = quotaRisk(used, quotaMb);
  const label = unlimited
    ? `${formatBytes(used)} · unlimited`
    : `${formatBytes(used)} / ${quotaMb} MB (${Math.round(ratio * 100)}%)`;

  return (
    <div
      className="hs-quota-bar"
      role="meter"
      aria-valuenow={unlimited ? undefined : Math.round(ratio * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      title={label}
    >
      {Array.from({ length: QUOTA_SEGMENTS }, (_, i) => (
        <span
          key={i}
          className={`hs-quota-seg ${i < filled ? `filled ${risk}` : "empty"} ${
            unlimited ? "unlimited" : ""
          }`}
        />
      ))}
    </div>
  );
}

interface RowState {
  storage?: UserStorageStats;
  displayName?: string;
}

export function HomeserverUsersView({
  hs,
  onBack,
}: {
  hs: Homeserver;
  onBack: () => void;
}) {
  const [rows, setRows] = useState<Record<number, RowState>>({});
  const [storageLoading, setStorageLoading] = useState(true);

  // Stable key so SSE state refreshes (new `users` array refs) don't retrigger fetches.
  const usersKey = useMemo(
    () => hs.users.map((u) => `${u.index}:${u.publicKey}`).join("|"),
    [hs.users],
  );

  useEffect(() => {
    let alive = true;
    setStorageLoading(true);

    api
      .fetchUsersStorage(hs.seed)
      .then((stats) => {
        if (!alive) return;
        setRows((prev) => {
          const next = { ...prev };
          for (const s of stats) {
            next[s.index] = { ...next[s.index], storage: s };
          }
          return next;
        });
      })
      .catch(() => {
        // Old server binary or network error — show zeros instead of perpetual "…".
      })
      .finally(() => {
        if (alive) setStorageLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [hs.seed, usersKey]);

  useEffect(() => {
    let alive = true;

    for (const user of hs.users) {
      const ctx: UserStorageContext = {
        pk: user.publicKey,
        homeserverUrl: hs.httpUrl,
        userIndex: user.index,
      };
      loadProfile(ctx).then((profile) => {
        if (!alive) return;
        setRows((prev) => ({
          ...prev,
          [user.index]: {
            ...prev[user.index],
            displayName: profile?.name ?? user.name,
          },
        }));
      });
    }

    return () => {
      alive = false;
    };
  }, [hs.httpUrl, usersKey]);

  return (
    <div className="hs-detail">
      <button type="button" className="hs-detail-back" onClick={onBack}>
        ← Back to homeservers
      </button>

      {hs.users.length === 0 ? (
        <p className="muted hs-detail-empty">No users on this homeserver yet.</p>
      ) : (
        <div className="hs-users-table-wrap">
          <table className="hs-users-table">
            <thead>
              <tr>
                <th>#</th>
                <th>User</th>
                <th>Key</th>
                <th>Used</th>
                <th>Limit</th>
                <th>Quota</th>
              </tr>
            </thead>
            <tbody>
              {hs.users.map((user) => {
                const row = rows[user.index];
                const storage = row?.storage;
                const used = storage?.usedBytes ?? 0;
                const quotaMb = storage?.storageQuotaMb ?? hs.storageQuotaMb;
                const displayName = row?.displayName ?? user.name;

                return (
                  <tr key={user.index}>
                    <td className="hs-users-num">#{user.index}</td>
                    <td className="hs-users-name">{displayName}</td>
                    <td className="hs-users-key">
                      <button
                        type="button"
                        className="hs-users-key-btn"
                        title={`Copy ${user.publicKey}`}
                        onClick={() => void navigator.clipboard.writeText(user.publicKey)}
                      >
                        {shortKey(user.publicKey)}
                      </button>
                    </td>
                    <td className="hs-users-num">
                      {storageLoading && !storage ? "…" : formatBytes(used)}
                    </td>
                    <td className="hs-users-num">
                      {storageLoading && !storage ? "…" : formatLimit(quotaMb)}
                    </td>
                    <td className="hs-users-quota">
                      <QuotaBar
                        used={used}
                        quotaMb={quotaMb}
                        loading={storageLoading && !storage}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
