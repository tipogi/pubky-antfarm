import { useMemo, useState, type ClipboardEvent, type FormEvent } from "react";
import { ClipboardPaste } from "lucide-react";
import type { RunAction } from "./App";
import {
  approveAuthAsUser,
  buildAuthUrl,
  parseAuthUrl,
  validateAuthFields,
  type AuthFields,
  type AuthFlowIntent,
} from "./approveAuth";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  modalContentSm,
  modalField,
  modalFooter,
  modalForm,
  modalHint,
  modalInput,
  modalLabel,
} from "@/lib/modal-layout";

function defaultFields(
  httpRelayInbox: string,
  homeserverZ32: string
): AuthFields {
  return {
    flow: "signin",
    caps: "",
    relay: httpRelayInbox,
    secret: "",
    hs: homeserverZ32,
    st: "",
  };
}

function AuthActionIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M12 3l7 3v5c0 4.6-3 7.7-7 9-4-1.3-7-4.4-7-9V6z" />
      <path d="M8 11h8M12 8v6" />
    </svg>
  );
}

export { AuthActionIcon };

export function AuthApproveModal({
  userIndex,
  displayName,
  homeserverZ32,
  httpRelayInbox,
  busy,
  onClose,
  onAction,
}: {
  userIndex: number;
  displayName: string;
  homeserverZ32: string;
  httpRelayInbox: string;
  busy: boolean;
  onClose: () => void;
  onAction: RunAction;
}) {
  const [fields, setFields] = useState<AuthFields>(() =>
    defaultFields(httpRelayInbox, homeserverZ32)
  );
  const [pasteUrl, setPasteUrl] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);

  const validationError = useMemo(
    () => validateAuthFields(fields, homeserverZ32),
    [fields, homeserverZ32]
  );

  const previewUrl = useMemo(() => {
    if (validationError) return null;
    try {
      return buildAuthUrl({
        ...fields,
        hs:
          fields.flow === "signup"
            ? fields.hs?.trim() || homeserverZ32
            : fields.hs,
      });
    } catch {
      return null;
    }
  }, [fields, homeserverZ32, validationError]);

  const patchFields = (patch: Partial<AuthFields>) => {
    setFields((current) => ({ ...current, ...patch }));
  };

  const applyFromUrl = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      setPasteUrl("");
      setPasteError(null);
      return;
    }
    try {
      const parsed = parseAuthUrl(trimmed);
      setPasteUrl(trimmed);
      setFields({
        ...parsed,
        hs: parsed.hs ?? homeserverZ32,
        st: parsed.st ?? "",
      });
      setPasteError(null);
    } catch (e) {
      setPasteUrl(trimmed);
      setPasteError(e instanceof Error ? e.message : "Invalid pubkyauth URL");
    }
  };

  const handlePasteFromClipboard = async () => {
    if (busy) return;
    try {
      const text = await navigator.clipboard.readText();
      applyFromUrl(text);
    } catch {
      setPasteError("Could not read clipboard");
    }
  };

  const handleInputPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    applyFromUrl(e.clipboardData.getData("text"));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (validationError) return;

    onAction(async () => {
      try {
        await approveAuthAsUser({
          userIndex,
          fields,
          defaultHomeserverZ32: homeserverZ32,
        });
        onClose();
        return { ok: true, message: "Auth request approved" };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Approve auth failed",
        };
      }
    }, `Approving auth as ${displayName}…`);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={modalContentSm("sm:max-w-[480px]")}>
        <DialogHeader>
          <DialogTitle>Approve auth</DialogTitle>
          <DialogDescription>
            as #{userIndex} · {displayName} — simulates Pubky Ring for a waiting
            app
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className={modalForm()}>
          <div className={modalField()}>
            <Label htmlFor="auth-paste-url" className={modalLabel()}>
              Paste pubkyauth URL
            </Label>
            <div className="flex gap-2">
              <Input
                id="auth-paste-url"
                type="text"
                placeholder="pubkyauth://signin?caps=…&relay=…&secret=…"
                value={pasteUrl}
                onChange={(e) => {
                  setPasteUrl(e.target.value);
                  if (pasteError) setPasteError(null);
                }}
                onPaste={handleInputPaste}
                disabled={busy}
                spellCheck={false}
                className={modalInput()}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0"
                disabled={busy}
                onClick={() => void handlePasteFromClipboard()}
                aria-label="Paste pubkyauth URL from clipboard"
                title="Paste from clipboard"
              >
                <ClipboardPaste className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
            {pasteError && (
              <p className="text-xs leading-snug text-destructive">{pasteError}</p>
            )}
          </div>

          <div className={modalField()}>
            <Label className={modalLabel()}>Flow type</Label>
            <RadioGroup
              value={fields.flow}
              disabled={busy}
              onValueChange={(value) =>
                patchFields({ flow: value as AuthFlowIntent })
              }
              className="flex flex-row gap-4"
            >
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <RadioGroupItem value="signin" />
                Sign in
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <RadioGroupItem value="signup" />
                Sign up
              </label>
            </RadioGroup>
          </div>

          <div className={modalField()}>
            <Label htmlFor="auth-caps" className={modalLabel()}>
              Capabilities (caps)
            </Label>
            <Input
              id="auth-caps"
              type="text"
              placeholder="/pub/my-app/:rw"
              value={fields.caps}
              onChange={(e) => patchFields({ caps: e.target.value })}
              disabled={busy}
              spellCheck={false}
              className={modalInput()}
              autoFocus
            />
          </div>

          <div className={modalField()}>
            <Label htmlFor="auth-relay" className={modalLabel()}>
              Relay
            </Label>
            <Input
              id="auth-relay"
              type="text"
              placeholder="http://localhost:15412/inbox"
              value={fields.relay}
              onChange={(e) => patchFields({ relay: e.target.value })}
              disabled={busy}
              spellCheck={false}
              className={modalInput()}
            />
            <p className={modalHint()}>
              Must match the relay the waiting app is polling.
            </p>
          </div>

          <div className={modalField()}>
            <Label htmlFor="auth-secret" className={modalLabel()}>
              Client secret
            </Label>
            <Input
              id="auth-secret"
              type="text"
              placeholder="base64url secret from the waiting app"
              value={fields.secret}
              onChange={(e) => patchFields({ secret: e.target.value })}
              disabled={busy}
              spellCheck={false}
              className={modalInput()}
            />
          </div>

          {fields.flow === "signup" && (
            <>
              <div className={modalField()}>
                <Label htmlFor="auth-hs" className={modalLabel()}>
                  Homeserver (hs)
                </Label>
                <Input
                  id="auth-hs"
                  type="text"
                  value={fields.hs ?? homeserverZ32}
                  onChange={(e) => patchFields({ hs: e.target.value })}
                  disabled={busy}
                  spellCheck={false}
                  className={modalInput()}
                />
              </div>
              <div className={modalField()}>
                <Label htmlFor="auth-st" className={modalLabel()}>
                  Signup token (st, optional)
                </Label>
                <Input
                  id="auth-st"
                  type="text"
                  value={fields.st ?? ""}
                  onChange={(e) => patchFields({ st: e.target.value })}
                  disabled={busy}
                  spellCheck={false}
                  className={modalInput()}
                />
              </div>
            </>
          )}

          {previewUrl && (
            <div className={modalField()}>
              <Label className={modalLabel()}>Preview</Label>
              <p
                className="max-h-20 overflow-auto break-all rounded-md border border-border bg-muted/40 px-2 py-1.5 font-mono text-[11px] leading-snug text-muted-foreground"
                title={previewUrl}
              >
                {previewUrl}
              </p>
            </div>
          )}

          <p className={modalHint()}>
            The waiting app must still be polling. Auth URLs expire in about 5
            minutes.
          </p>

          {validationError && fields.caps.trim() && fields.secret.trim() && (
            <p className="text-xs leading-snug text-destructive">
              {validationError}
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
            <Button
              type="submit"
              size="sm"
              disabled={busy || validationError != null}
            >
              Approve
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
