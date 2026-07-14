import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import { api, type UserStorageStats } from "./api";
import type { RunAction } from "./App";
import { BatchEventsModal } from "./BatchEventsModal";
import { SocialPostModal } from "./SocialPostModal";
import { PkarrRecordModal } from "./PkarrRecordModal";
import { PkarrRecordIcon } from "./PkarrRecordIcon";
import { EventActionIcon, UserEventsModal } from "./UserEventsModal";
import { AuthActionIcon, AuthApproveModal } from "./AuthApproveModal";
import { DetailsActionIcon, UserDetailsModal } from "./UserDetailsModal";
import { loadProfile, loadAvatar, type UserStorageContext } from "./pubky";
import { hubColorFor } from "./hubColors";
import { ROOT_VIEWBOX, RootPaths } from "./RootMark";
import type { Homeserver } from "./useDashboard";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  modalContentSm,
  modalField,
  modalFooter,
  modalForm,
  modalHint,
  modalInput,
  modalLabel,
} from "@/lib/modal-layout";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

function shortKey(key: string): string {
  return key.length > 16 ? `${key.slice(0, 8)}…${key.slice(-6)}` : key;
}

function userHue(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

/** Bare z32 pubky public key — not a URI. */
function isValidPubkyKey(value: string): boolean {
  const key = value.trim();
  if (!key || key.includes("://") || key.includes("/")) return false;
  return /^[a-z0-9]{40,64}$/.test(key);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function KeyGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="hs-users-id-key-icon" aria-hidden="true">
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  );
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

function UserAvatar({
  publicKey,
  avatar,
  name,
}: {
  publicKey: string;
  avatar?: string | null;
  name: string;
}) {
  return (
    <span
      className={`hs-users-avatar${avatar ? " has-avatar" : ""}`}
      style={{ "--chip-hue": userHue(publicKey) } as CSSProperties}
      aria-hidden
      title={name}
    >
      {avatar ? (
        <img className="hs-users-avatar-img" src={avatar} alt="" loading="lazy" />
      ) : (
        <svg viewBox={ROOT_VIEWBOX} className="hs-users-avatar-icon">
          <RootPaths />
        </svg>
      )}
    </span>
  );
}

function StorageCell({
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
  const pct = Math.round(ratio * 100);
  const risk = quotaRisk(used, quotaMb);

  return (
    <div className="hs-store">
      <div className="hs-store-head">
        <span className="hs-store-used">{formatBytes(used)}</span>
        <span className="hs-store-limit">
          {unlimited ? "unlimited" : `/ ${quotaMb} MB`}
        </span>
        {!unlimited && <span className={`hs-store-pct ${risk}`}>{pct}%</span>}
      </div>
      <div
        className={`hs-store-track ${unlimited ? "unlimited" : risk}`}
        role="meter"
        aria-valuenow={unlimited ? undefined : pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {unlimited ? (
          <span className="hs-store-flow" aria-hidden />
        ) : (
          <span
            className="hs-store-fill"
            style={{ width: `${Math.max(used > 0 ? 4 : 0, Math.min(100, ratio * 100))}%` }}
            aria-hidden
          />
        )}
      </div>
    </div>
  );
}

interface RowState {
  storage?: UserStorageStats;
  displayName?: string;
  avatar?: string | null;
}

type ActionKind = "follow" | "tag" | "batch" | "social";

type FollowTagModal = {
  kind: "follow" | "tag";
  userIndex: number;
  displayName: string;
};

interface ActionModalState {
  kind: ActionKind;
  userIndex: number;
  displayName: string;
  publicKey?: string;
}

function FollowActionIcon() {
  return (
    <svg viewBox="0 0 24 24" className="hs-user-action-icon" aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="3.5" />
      <path d="M19 8v6M16 11h6" />
    </svg>
  );
}

function TagActionIcon() {
  return (
    <svg viewBox="0 0 24 24" className="hs-user-action-icon" aria-hidden="true">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <circle cx="7.5" cy="7.5" r="1.25" fill="currentColor" stroke="none" />
    </svg>
  );
}

function SpamActionIcon() {
  return (
    <svg viewBox="0 0 24 24" className="hs-user-action-icon" aria-hidden="true">
      <circle cx="5" cy="12" r="1.75" fill="currentColor" stroke="none" />
      <path d="M9 8.5a5.5 5.5 0 0 1 0 7" />
      <path d="M12 6a9 9 0 0 1 0 12" />
      <path d="M15 3.5a12.5 12.5 0 0 1 0 17" />
    </svg>
  );
}

function PostActionIcon() {
  return (
    <svg viewBox="0 0 24 24" className="hs-user-action-icon" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <path d="M8 9h8M8 13h5" />
    </svg>
  );
}

function PkarrActionIcon() {
  return <PkarrRecordIcon className="hs-user-action-icon" />;
}

function HomeserverActionIcon() {
  return (
    <svg viewBox="0 0 24 24" className="hs-user-action-icon" aria-hidden="true">
      <path d="M7 7h13m0 0-4-4m4 4-4 4" />
      <path d="M17 17H4m0 0 4 4m-4-4 4-4" />
    </svg>
  );
}

function UserActionTooltipButton({
  tip,
  label,
  disabled,
  onClick,
  children,
}: {
  tip: string;
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="hs-user-action-trigger"
          disabled={disabled}
          onClick={onClick}
        >
          <span className="hs-user-action-glyph">{children}</span>
          <span className="hs-user-action-label">{label}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}

function UserActionButtons({
  busy,
  processDown,
  onFollow,
  onTag,
  onPost,
  onBatch,
  onEvents,
  onPkarr,
  onHomeserver,
  onAuth,
  onDetails,
}: {
  busy: boolean;
  processDown: boolean;
  onFollow: () => void;
  onTag: () => void;
  onPost: () => void;
  onBatch: () => void;
  onEvents: () => void;
  onPkarr: () => void;
  onHomeserver: () => void;
  onAuth: () => void;
  onDetails: () => void;
}) {
  const writesOff = busy || processDown;

  return (
    <div className="hs-user-action-btns" role="group" aria-label="User actions">
      <UserActionTooltipButton
        tip="Follow another user"
        label="Follow"
        disabled={writesOff}
        onClick={onFollow}
      >
        <FollowActionIcon />
      </UserActionTooltipButton>
      <UserActionTooltipButton
        tip="Tag a user or post"
        label="Tag"
        disabled={writesOff}
        onClick={onTag}
      >
        <TagActionIcon />
      </UserActionTooltipButton>
      <UserActionTooltipButton
        tip="Create a post, mention, or repost"
        label="Post"
        disabled={writesOff}
        onClick={onPost}
      >
        <PostActionIcon />
      </UserActionTooltipButton>
      <UserActionTooltipButton
        tip="Spam random posts and tags"
        label="Spam"
        disabled={writesOff}
        onClick={onBatch}
      >
        <SpamActionIcon />
      </UserActionTooltipButton>
      <UserActionTooltipButton
        tip="View user events"
        label="Event"
        disabled={writesOff}
        onClick={onEvents}
      >
        <EventActionIcon className="hs-user-action-icon" />
      </UserActionTooltipButton>
      <UserActionTooltipButton
        tip="View pkarr record"
        label="Pkarr"
        disabled={busy}
        onClick={onPkarr}
      >
        <PkarrActionIcon />
      </UserActionTooltipButton>
      <UserActionTooltipButton
        tip="Change homeserver"
        label="Homeserver"
        disabled={busy}
        onClick={onHomeserver}
      >
        <HomeserverActionIcon />
      </UserActionTooltipButton>
      <UserActionTooltipButton
        tip="Approve a pubkyauth request as this user (Ring simulator)"
        label="Auth"
        disabled={writesOff}
        onClick={onAuth}
      >
        <AuthActionIcon className="hs-user-action-icon" />
      </UserActionTooltipButton>
      <UserActionTooltipButton
        tip="View recovery phrase (mnemonic)"
        label="Mnemonic"
        disabled={busy}
        onClick={onDetails}
      >
        <DetailsActionIcon className="hs-user-action-icon" />
      </UserActionTooltipButton>
    </div>
  );
}

function UserActionModal({
  modal,
  busy,
  onClose,
  onAction,
}: {
  modal: FollowTagModal;
  busy: boolean;
  onClose: () => void;
  onAction: RunAction;
}) {
  const [target, setTarget] = useState("");
  const [label, setLabel] = useState("");

  const isFollow = modal.kind === "follow";
  const targetKey = target.trim();
  const keyValid = isFollow ? targetKey.length > 0 : isValidPubkyKey(targetKey);
  const labelValid = label.trim().length > 0;
  const title = isFollow ? "Follow user" : "Tag user";
  const canSubmit = isFollow ? keyValid : keyValid && labelValid;

  const handleTargetChange = (value: string) => {
    setTarget(value);
    if (!isFollow && !isValidPubkyKey(value.trim())) {
      setLabel("");
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    onAction(async () => {
      const res = isFollow
        ? await api.follow(modal.userIndex, targetKey)
        : await api.tag(modal.userIndex, targetKey, label.trim());
      if (res.ok) onClose();
      return res;
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={modalContentSm()}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            as #{modal.userIndex} · {modal.displayName}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className={modalForm()}>
          <div className={modalField()}>
            <Label htmlFor="user-action-target" className={modalLabel()}>
              Target pubky
            </Label>
            <Input
              id="user-action-target"
              type="text"
              placeholder="z32 public key"
              value={target}
              onChange={(e) => handleTargetChange(e.target.value)}
              disabled={busy}
              spellCheck={false}
              className={modalInput()}
              autoFocus
            />
            {!isFollow && targetKey.length > 0 && !keyValid && (
              <p className="text-xs leading-snug text-destructive">
                Enter a z32 public key, not a URL
              </p>
            )}
          </div>

          {!isFollow && (
            <div className={modalField()}>
              <Label htmlFor="user-action-label" className={modalLabel()}>
                Label
              </Label>
              <Input
                id="user-action-label"
                type="text"
                placeholder="Tag label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                disabled={busy || !keyValid}
                spellCheck={false}
                className={modalInput()}
              />
            </div>
          )}

          <DialogFooter className={modalFooter()}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={busy || !canSubmit}>
              {isFollow ? "Follow" : "Tag"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ChangeHomeserverModal({
  label,
  kindLabel,
  userIndex,
  currentSeed,
  homeservers,
  busy,
  onClose,
  onAction,
}: {
  label: string;
  kindLabel: string;
  userIndex: number;
  currentSeed: number;
  homeservers: Homeserver[];
  busy: boolean;
  onClose: () => void;
  onAction: RunAction;
}) {
  const targetHomeservers = useMemo(
    () =>
      homeservers
        .filter(
          (target) =>
            !target.pending && !target.down && target.seed !== currentSeed
        )
        .sort((a, b) => a.seed - b.seed),
    [currentSeed, homeservers]
  );
  const [targetSeed, setTargetSeed] = useState<number | null>(
    targetHomeservers[0]?.seed ?? null
  );

  useEffect(() => {
    setTargetSeed((current) =>
      current != null && targetHomeservers.some((target) => target.seed === current)
        ? current
        : targetHomeservers[0]?.seed ?? null
    );
  }, [targetHomeservers]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (targetSeed == null || targetHomeservers.length === 0) return;

    const target = targetHomeservers.find((item) => item.seed === targetSeed);
    onAction(
      async () => {
        const res = await api.changeHomeserver(userIndex, targetSeed);
        if (res.ok) onClose();
        return res;
      },
      `Changing ${label} to ${target?.label ?? `hs${targetSeed + 1}`}…`
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={modalContentSm()}>
        <DialogHeader>
          <DialogTitle>Change homeserver</DialogTitle>
          <DialogDescription>
            {kindLabel} · {label}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className={modalForm()}>
          <div className={modalField()}>
            <Label htmlFor="change-hs-target" className={modalLabel()}>
              Target homeserver
            </Label>
            {targetHomeservers.length === 0 ? (
              <p className={modalHint()}>No other homeservers</p>
            ) : (
              <Select
                value={targetSeed != null ? String(targetSeed) : undefined}
                disabled={busy}
                onValueChange={(value) => setTargetSeed(Number(value))}
              >
                <SelectTrigger
                  id="change-hs-target"
                  aria-label="Target homeserver"
                  className="h-9"
                  autoFocus
                >
                  <SelectValue placeholder="Select homeserver" />
                </SelectTrigger>
                <SelectContent portalled={false} position="popper" sideOffset={4}>
                  {targetHomeservers.map((target) => (
                    <SelectItem key={target.seed} value={String(target.seed)}>
                      {target.label} (seed {target.seed})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <p className={modalHint()}>
              Updates this user&apos;s pkarr record only. Existing data stays on the
              previous homeserver.
            </p>
          </div>

          <DialogFooter className={modalFooter()}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={busy || targetSeed == null || targetHomeservers.length === 0}
            >
              Change homeserver
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function HomeserverUsersView({
  hs,
  homeservers,
  pkarrRelay,
  httpRelayInbox,
  busy,
  onAction,
  onCopyKey,
}: {
  hs: Homeserver;
  homeservers: Homeserver[];
  pkarrRelay: string;
  httpRelayInbox: string;
  busy: boolean;
  onAction: RunAction;
  onCopyKey: (key: string) => void | Promise<void>;
}) {
  const [rows, setRows] = useState<Record<number, RowState>>({});
  const [storageLoading, setStorageLoading] = useState(true);
  const [actionModal, setActionModal] = useState<ActionModalState | null>(null);
  const [pkarrModal, setPkarrModal] = useState<{
    label: string;
    kindLabel: string;
    publicKey: string;
  } | null>(null);
  const [homeserverModal, setHomeserverModal] = useState<{
    label: string;
    kindLabel: string;
    userIndex: number;
  } | null>(null);
  const [eventsModal, setEventsModal] = useState<{
    label: string;
    kindLabel: string;
    publicKey: string;
  } | null>(null);
  const [detailsModal, setDetailsModal] = useState<{
    label: string;
    kindLabel: string;
    userIndex: number;
    publicKey: string;
  } | null>(null);
  const [authModal, setAuthModal] = useState<{
    label: string;
    userIndex: number;
  } | null>(null);

  // Stable key so SSE state refreshes (new `users` array refs) don't retrigger fetches.
  const usersKey = useMemo(
    () => hs.users.map((u) => `${u.index}:${u.publicKey}`).join("|"),
    [hs.users],
  );

  useEffect(() => {
    if (hs.down) {
      setStorageLoading(false);
      return;
    }

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
  }, [hs.seed, hs.down, usersKey]);

  useEffect(() => {
    if (hs.down) return;

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
        if (!profile?.image) return;
        loadAvatar(profile.image, ctx).then((url) => {
          if (!alive || !url) return;
          setRows((prev) => ({
            ...prev,
            [user.index]: { ...prev[user.index], avatar: url },
          }));
        });
      });
    }

    return () => {
      alive = false;
    };
  }, [hs.down, hs.httpUrl, usersKey]);

  const openModal = (
    kind: ActionKind,
    userIndex: number,
    displayName: string,
    publicKey?: string
  ) => {
    setActionModal({ kind, userIndex, displayName, publicKey });
  };

  const openPkarrModal = (
    userIndex: number,
    displayName: string,
    publicKey: string
  ) => {
    setPkarrModal({
      label: displayName,
      kindLabel: `User #${userIndex} · ${hs.label}`,
      publicKey,
    });
  };

  const openHomeserverModal = (userIndex: number, displayName: string) => {
    setHomeserverModal({
      label: displayName,
      kindLabel: `User #${userIndex} · ${hs.label}`,
      userIndex,
    });
  };

  const openEventsModal = (
    userIndex: number,
    displayName: string,
    publicKey: string
  ) => {
    setEventsModal({
      label: displayName,
      kindLabel: `User #${userIndex} · ${hs.label}`,
      publicKey,
    });
  };

  const openDetailsModal = (
    userIndex: number,
    displayName: string,
    publicKey: string
  ) => {
    setDetailsModal({
      label: displayName,
      kindLabel: `User #${userIndex} · ${hs.label}`,
      userIndex,
      publicKey,
    });
  };

  const openAuthModal = (userIndex: number, displayName: string) => {
    setAuthModal({ label: displayName, userIndex });
  };

  const { color, keyColor } = hubColorFor(hs.seed);
  const totalUsed = hs.users.reduce(
    (sum, u) => sum + (rows[u.index]?.storage?.usedBytes ?? 0),
    0
  );
  const profiled = hs.users.filter((u) => rows[u.index]?.avatar).length;
  const quotaLabel =
    hs.storageQuotaMb != null ? `${hs.storageQuotaMb} MB / user` : "Unlimited";

  return (
    <div
      className="hs-detail"
      style={
        {
          "--hs-accent": color,
          "--hs-key": keyColor,
        } as CSSProperties
      }
    >
      {hs.users.length === 0 ? (
        <p className="muted hs-detail-empty">No users on this homeserver yet.</p>
      ) : (
        <>
          <div className="hs-users-toolbar">
            <span className="hs-users-stat">
              <span className="hs-users-stat-value">{hs.users.length}</span>
              <span className="hs-users-stat-label">
                {hs.users.length === 1 ? "user" : "users"}
              </span>
            </span>
            <span className="hs-users-stat-sep" aria-hidden />
            <span className="hs-users-stat">
              <span className="hs-users-stat-value">
                {storageLoading ? "…" : formatBytes(totalUsed)}
              </span>
              <span className="hs-users-stat-label">stored</span>
            </span>
            <span className="hs-users-stat-sep" aria-hidden />
            <span className="hs-users-stat">
              <span className="hs-users-stat-value">{quotaLabel}</span>
              <span className="hs-users-stat-label">quota</span>
            </span>
            {profiled > 0 && (
              <span className="hs-users-stat hs-users-stat-soft">
                <span className="hs-users-stat-value">{profiled}</span>
                <span className="hs-users-stat-label">with profile</span>
              </span>
            )}
          </div>

          <div className="hs-users-table-wrap">
            <Table className="border-collapse text-sm">
              <TableHeader>
                <TableRow className="border-b border-border hover:bg-transparent">
                  <TableHead className="hs-users-th-num h-auto bg-[color-mix(in_srgb,var(--panel-2)_55%,var(--panel))] px-[18px] py-3 text-[11px] font-semibold uppercase tracking-[0.6px] text-muted-foreground">
                    #
                  </TableHead>
                  <TableHead className="h-auto bg-[color-mix(in_srgb,var(--panel-2)_55%,var(--panel))] px-[18px] py-3 text-[11px] font-semibold uppercase tracking-[0.6px] text-muted-foreground">
                    User
                  </TableHead>
                  <TableHead className="h-auto bg-[color-mix(in_srgb,var(--panel-2)_55%,var(--panel))] px-[18px] py-3 text-[11px] font-semibold uppercase tracking-[0.6px] text-muted-foreground">
                    Storage
                  </TableHead>
                  <TableHead className="hs-users-th-actions h-auto bg-[color-mix(in_srgb,var(--panel-2)_55%,var(--panel))] px-[18px] py-3 text-right text-[11px] font-semibold uppercase tracking-[0.6px] text-muted-foreground">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="[&_tr:first-child_td]:border-t-0">
                {hs.users.map((user) => {
                  const row = rows[user.index];
                  const storage = row?.storage;
                  const used = storage?.usedBytes ?? 0;
                  const quotaMb = storage?.storageQuotaMb ?? hs.storageQuotaMb;
                  const displayName = row?.displayName ?? user.name;

                  return (
                    <TableRow
                      key={user.index}
                      className="border-0 transition-colors hover:bg-[color-mix(in_srgb,var(--hs-accent,var(--accent))_7%,transparent)]"
                    >
                      <TableCell className="hs-users-num w-14 whitespace-nowrap border-t border-[color-mix(in_srgb,var(--border)_70%,transparent)] px-[18px] py-3">
                        <span className="hs-users-rank">{user.index}</span>
                      </TableCell>
                      <TableCell className="hs-users-id whitespace-nowrap border-t border-[color-mix(in_srgb,var(--border)_70%,transparent)] px-[18px] py-3">
                        <div className="hs-users-id-cell">
                          <UserAvatar
                            publicKey={user.publicKey}
                            avatar={row?.avatar}
                            name={displayName}
                          />
                          <div className="hs-users-id-text">
                            <span className="hs-users-id-name" title={displayName}>
                              {displayName}
                            </span>
                            <button
                              type="button"
                              className="hs-users-id-key"
                              title={`${user.publicKey} — click to copy`}
                              onClick={() => void onCopyKey(user.publicKey)}
                            >
                              <KeyGlyph />
                              {shortKey(user.publicKey)}
                            </button>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hs-users-storage whitespace-nowrap border-t border-[color-mix(in_srgb,var(--border)_70%,transparent)] px-[18px] py-3">
                        <StorageCell
                          used={used}
                          quotaMb={quotaMb}
                          loading={storageLoading && !storage}
                        />
                      </TableCell>
                      <TableCell className="hs-users-actions whitespace-nowrap border-t border-[color-mix(in_srgb,var(--border)_70%,transparent)] px-[18px] py-3">
                        <UserActionButtons
                          busy={busy}
                          processDown={hs.down}
                          onFollow={() => openModal("follow", user.index, displayName)}
                          onTag={() => openModal("tag", user.index, displayName)}
                          onPost={() =>
                            openModal("social", user.index, displayName, user.publicKey)
                          }
                          onBatch={() => openModal("batch", user.index, displayName)}
                          onEvents={() =>
                            openEventsModal(user.index, displayName, user.publicKey)
                          }
                          onPkarr={() =>
                            openPkarrModal(user.index, displayName, user.publicKey)
                          }
                          onHomeserver={() =>
                            openHomeserverModal(user.index, displayName)
                          }
                          onAuth={() => openAuthModal(user.index, displayName)}
                          onDetails={() =>
                            openDetailsModal(user.index, displayName, user.publicKey)
                          }
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {actionModal?.kind === "batch" ? (
        <BatchEventsModal
          key={`batch-${actionModal.userIndex}`}
          userIndex={actionModal.userIndex}
          displayName={actionModal.displayName}
          busy={busy}
          onClose={() => setActionModal(null)}
          onAction={onAction}
        />
      ) : actionModal?.kind === "social" && actionModal.publicKey ? (
        <SocialPostModal
          key={`social-${actionModal.userIndex}`}
          userIndex={actionModal.userIndex}
          displayName={actionModal.displayName}
          publicKey={actionModal.publicKey}
          busy={busy}
          onClose={() => setActionModal(null)}
          onAction={onAction}
        />
      ) : actionModal && (actionModal.kind === "follow" || actionModal.kind === "tag") ? (
        <UserActionModal
          key={`${actionModal.kind}-${actionModal.userIndex}`}
          modal={{
            kind: actionModal.kind,
            userIndex: actionModal.userIndex,
            displayName: actionModal.displayName,
          }}
          busy={busy}
          onClose={() => setActionModal(null)}
          onAction={onAction}
        />
      ) : null}

      {pkarrModal && (
        <PkarrRecordModal
          label={pkarrModal.label}
          kindLabel={pkarrModal.kindLabel}
          seed={hs.seed}
          publicKey={pkarrModal.publicKey}
          pkarrRelay={pkarrRelay}
          onClose={() => setPkarrModal(null)}
        />
      )}

      {homeserverModal && (
        <ChangeHomeserverModal
          label={homeserverModal.label}
          kindLabel={homeserverModal.kindLabel}
          userIndex={homeserverModal.userIndex}
          currentSeed={hs.seed}
          homeservers={homeservers}
          busy={busy}
          onClose={() => setHomeserverModal(null)}
          onAction={onAction}
        />
      )}

      {eventsModal && (
        <UserEventsModal
          label={eventsModal.label}
          kindLabel={eventsModal.kindLabel}
          seed={hs.seed}
          userPk={eventsModal.publicKey}
          homeserverUrl={hs.httpUrl}
          onClose={() => setEventsModal(null)}
        />
      )}

      {detailsModal && (
        <UserDetailsModal
          label={detailsModal.label}
          kindLabel={detailsModal.kindLabel}
          seed={hs.seed}
          userIndex={detailsModal.userIndex}
          publicKey={detailsModal.publicKey}
          onClose={() => setDetailsModal(null)}
        />
      )}

      {authModal && (
        <AuthApproveModal
          userIndex={authModal.userIndex}
          displayName={authModal.label}
          homeserverZ32={hs.publicKey}
          httpRelayInbox={httpRelayInbox}
          busy={busy}
          onClose={() => setAuthModal(null)}
          onAction={onAction}
        />
      )}
    </div>
  );
}
