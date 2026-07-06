import { useState, type FormEvent } from "react";
import { Key } from "lucide-react";
import { api } from "./api";
import type { RunAction } from "./App";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  modalCheckboxRow,
  modalContentSm,
  modalFooter,
  modalForm,
  modalHelpText,
  modalHint,
} from "@/lib/modal-layout";

export function CreateUserModal({
  hs,
  maxUsers,
  busy,
  onClose,
  onAction,
}: {
  hs: Homeserver;
  maxUsers: number;
  busy: boolean;
  onClose: () => void;
  onAction: RunAction;
}) {
  const [withProfile, setWithProfile] = useState(true);
  const unlimited = maxUsers === 0;
  const atCapacity = !unlimited && hs.userCount >= maxUsers;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy || atCapacity) return;
    onClose();
    onAction(
      () => api.addUser(hs.seed, withProfile),
      `Creating user on ${hs.label}…`
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={modalContentSm()}>
        <DialogHeader>
          <DialogTitle>Create user</DialogTitle>
          <DialogDescription>
            on {hs.label} · seed {hs.seed}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className={modalForm()}>
          <p className={modalHelpText()}>
            Signs up a new pubky key on this homeserver and publishes its pkarr
            record — useful for testing external apps against these keys.
          </p>

          <label className={cn(modalCheckboxRow(), "cursor-pointer")}>
            <span className="flex items-start gap-2.5">
              <Checkbox
                id="create-user-profile"
                checked={withProfile}
                disabled={busy || atCapacity}
                onCheckedChange={(checked) => setWithProfile(checked === true)}
                className="mt-0.5"
              />
              <span className="grid min-w-0 gap-0.5">
                <Label
                  htmlFor="create-user-profile"
                  className="cursor-pointer text-[13px] font-semibold leading-tight text-foreground"
                >
                  With profile
                </Label>
                <span className={modalHint()}>
                  Writes profile.json and avatar to the homeserver
                </span>
              </span>
            </span>
          </label>

          {atCapacity && (
            <p className="text-xs leading-snug text-destructive">
              Homeserver is at capacity ({hs.userCount} / {maxUsers}). Stop the
              simulator or raise the limit before adding users.
            </p>
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
            <Button type="submit" size="sm" disabled={busy || atCapacity}>
              <Key className="h-4 w-4" />
              Create key
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AddUserKeyButton({
  disabled,
  onClick,
}: {
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="hs-detail-meta-item hs-detail-add-key"
      disabled={disabled}
      onClick={onClick}
      title="Create a new user key"
    >
      <svg viewBox="0 0 24 24" className="hs-link-icon" aria-hidden="true">
        <path d="M12 5v14M5 12h14" />
      </svg>
      key
    </button>
  );
}
