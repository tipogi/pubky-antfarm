import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { SignupInviteIcon } from "./SignupInviteIcon";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  modalContentSm,
  modalFooter,
  modalHint,
} from "@/lib/modal-layout";

/** Set to `true` to show a working invite-code control in the homeserver header. */
export const SIGNUP_INVITE_UI_ENABLED = false;

export function SignupInviteButton({
  disabled,
  onClick,
}: {
  disabled?: boolean;
  onClick: () => void;
}) {
  const inactive = disabled || !SIGNUP_INVITE_UI_ENABLED;

  return (
    <button
      type="button"
      className="hs-detail-meta-item hs-detail-invite"
      disabled={inactive}
      onClick={onClick}
      aria-label="Generate invite code"
      title={
        SIGNUP_INVITE_UI_ENABLED
          ? "Generate signup invite code for this homeserver"
          : "Invite codes are disabled"
      }
    >
      <SignupInviteIcon className="hs-link-icon" />
      <span>invite code</span>
    </button>
  );
}

export function SignupInviteModal({
  label,
  token,
  onClose,
}: {
  label: string;
  token: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard unavailable; token remains visible to copy manually.
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={modalContentSm()}>
        <DialogHeader>
          <DialogTitle>Invite code</DialogTitle>
          <DialogDescription>{label}</DialogDescription>
        </DialogHeader>

        <p
          className="break-all rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-sm tracking-wide"
          title={token}
        >
          {token}
        </p>

        <p className={modalHint()}>
          Single-use signup token (optional while antfarm signup is open).
        </p>

        <DialogFooter className={modalFooter()}>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button type="button" size="sm" onClick={() => void copy()}>
            {copied ? (
              <Check className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Copy className="h-4 w-4" aria-hidden="true" />
            )}
            {copied ? "Copied" : "Copy"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
