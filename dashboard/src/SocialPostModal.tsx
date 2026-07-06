import { useState, type FormEvent } from "react";
import { api } from "./api";
import type { RunAction } from "./App";
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
import { cn } from "@/lib/utils";
import {
  modalContentSm,
  modalField,
  modalFooter,
  modalForm,
  modalHint,
  modalInput,
  modalLabel,
  modalRadioOptionCompact,
} from "@/lib/modal-layout";

export type SocialPostKind = "short" | "mention" | "repost" | "repost_mention";

function isValidPubkyKey(value: string): boolean {
  const key = value.trim();
  if (!key || key.includes("://") || key.includes("/")) return false;
  return /^[a-z0-9]{40,64}$/.test(key);
}

function isValidPostUri(value: string): boolean {
  const uri = value.trim();
  return (
    uri.startsWith("pubky://") && uri.includes("/pub/pubky.app/posts/")
  );
}

export function SocialPostModal({
  userIndex,
  displayName,
  publicKey,
  busy,
  onClose,
  onAction,
}: {
  userIndex: number;
  displayName: string;
  publicKey: string;
  busy: boolean;
  onClose: () => void;
  onAction: RunAction;
}) {
  const [kind, setKind] = useState<SocialPostKind>("short");
  const [mentionKey, setMentionKey] = useState("");
  const [postUri, setPostUri] = useState("");

  const mentionValid = isValidPubkyKey(mentionKey);
  const postUriValid = isValidPostUri(postUri);

  const canSubmit =
    !busy &&
    (kind === "short" ||
      (kind === "mention" && mentionValid) ||
      (kind === "repost" && postUriValid) ||
      (kind === "repost_mention" && mentionValid && postUriValid));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    onAction(async () => {
      const res = await api.socialPost({
        from: publicKey,
        kind,
        mentionKey:
          kind === "mention" || kind === "repost_mention"
            ? mentionKey.trim()
            : undefined,
        postUri:
          kind === "repost" || kind === "repost_mention"
            ? postUri.trim()
            : undefined,
      });
      if (res.ok) onClose();
      return res;
    });
  };

  const postTypes = [
    { value: "short" as const, title: "Short post" },
    { value: "mention" as const, title: "Mention" },
    { value: "repost" as const, title: "Repost" },
    { value: "repost_mention" as const, title: "Repost + mention" },
  ];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={modalContentSm()}>
        <DialogHeader className="pb-2">
          <DialogTitle>Create</DialogTitle>
          <DialogDescription>
            as #{userIndex} · {displayName}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className={modalForm()}>
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className={cn(modalLabel(), "mb-0")}>Post type</legend>
            <RadioGroup
              value={kind}
              onValueChange={(v) => setKind(v as SocialPostKind)}
              disabled={busy}
            >
              {postTypes.map((opt) => (
                <label
                  key={opt.value}
                  className={modalRadioOptionCompact(kind === opt.value)}
                >
                  <RadioGroupItem
                    value={opt.value}
                    id={`post-kind-${opt.value}`}
                  />
                  <span className="text-[13px] font-semibold leading-none">
                    {opt.title}
                  </span>
                </label>
              ))}
            </RadioGroup>

            {kind === "short" && (
              <p className={modalHint()}>Publishes a short post with random generated content.</p>
            )}

            {(kind === "mention" || kind === "repost_mention") && (
              <div className={modalField()}>
                <Label htmlFor="social-mention-key" className={modalLabel()}>
                  Mention user key
                </Label>
                <Input
                  id="social-mention-key"
                  type="text"
                  placeholder="z32 public key"
                  value={mentionKey}
                  onChange={(e) => setMentionKey(e.target.value)}
                  disabled={busy}
                  spellCheck={false}
                  className={modalInput()}
                  autoFocus
                />
                {mentionKey.trim().length > 0 && !mentionValid && (
                  <p className="text-xs leading-snug text-destructive">
                    Enter a z32 public key, not a URL
                  </p>
                )}
              </div>
            )}

            {(kind === "repost" || kind === "repost_mention") && (
              <div className={modalField()}>
                <Label htmlFor="social-post-uri" className={modalLabel()}>
                  Post URI
                </Label>
                <Input
                  id="social-post-uri"
                  type="text"
                  placeholder="pubky://…/pub/pubky.app/posts/…"
                  value={postUri}
                  onChange={(e) => setPostUri(e.target.value)}
                  disabled={busy}
                  spellCheck={false}
                  className={modalInput()}
                  autoFocus={kind === "repost"}
                />
                {postUri.trim().length > 0 && !postUriValid && (
                  <p className="text-xs leading-snug text-destructive">
                    Must be a pubky.app post URI
                  </p>
                )}
              </div>
            )}
          </fieldset>

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
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
