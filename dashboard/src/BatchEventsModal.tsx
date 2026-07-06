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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  modalContentSm,
  modalFooter,
  modalForm,
  modalHint,
  modalInput,
} from "@/lib/modal-layout";

const MAX_BATCH = 100;

function parseCount(value: string): number | null {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > MAX_BATCH) return null;
  return n;
}

function BatchRow({
  id,
  label,
  enabled,
  value,
  disabled,
  onEnabledChange,
  onChange,
}: {
  id: string;
  label: string;
  enabled: boolean;
  value: string;
  disabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onChange: (value: string) => void;
}) {
  const countValid = !enabled || parseCount(value) !== null;

  return (
    <div className="flex items-center gap-2.5 py-1">
      <Checkbox
        id={`${id}-enabled`}
        checked={enabled}
        disabled={disabled}
        onCheckedChange={(checked) => onEnabledChange(checked === true)}
      />
      <Label
        htmlFor={`${id}-enabled`}
        className="min-w-[4rem] cursor-pointer text-[13px] font-medium"
      >
        {label}
      </Label>
      <Input
        id={`${id}-count`}
        type="number"
        min={1}
        max={MAX_BATCH}
        value={value}
        disabled={disabled || !enabled}
        onChange={(e) => onChange(e.target.value)}
        className={cn(modalInput(), "max-w-[100px]")}
        aria-describedby={!countValid && enabled ? `${id}-hint` : undefined}
      />
      {!countValid && enabled && (
        <span id={`${id}-hint`} className={modalHint()}>
          1–{MAX_BATCH}
        </span>
      )}
    </div>
  );
}

export function BatchEventsModal({
  userIndex,
  displayName,
  busy,
  onClose,
  onAction,
}: {
  userIndex: number;
  displayName: string;
  busy: boolean;
  onClose: () => void;
  onAction: RunAction;
}) {
  const [postsEnabled, setPostsEnabled] = useState(true);
  const [tagsEnabled, setTagsEnabled] = useState(true);
  const [postsCount, setPostsCount] = useState("5");
  const [tagsCount, setTagsCount] = useState("5");

  const posts = postsEnabled ? parseCount(postsCount) : 0;
  const tags = tagsEnabled ? parseCount(tagsCount) : 0;
  const canSubmit =
    !busy &&
    ((postsEnabled && posts !== null && posts > 0) ||
      (tagsEnabled && tags !== null && tags > 0));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    onAction(async () => {
      const res = await api.batch({
        from: userIndex,
        posts: postsEnabled && posts ? posts : 0,
        tags: tagsEnabled && tags ? tags : 0,
      });
      if (res.ok) onClose();
      return res;
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={modalContentSm()}>
        <DialogHeader>
          <DialogTitle>Spam</DialogTitle>
          <DialogDescription>
            as #{userIndex} · {displayName}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className={modalForm()}>
          <div className="flex flex-col gap-2">
            <BatchRow
              id="batch-posts"
              label="Posts"
              enabled={postsEnabled}
              value={postsCount}
              disabled={busy}
              onEnabledChange={setPostsEnabled}
              onChange={setPostsCount}
            />
            <BatchRow
              id="batch-tags"
              label="Tags"
              enabled={tagsEnabled}
              value={tagsCount}
              disabled={busy}
              onEnabledChange={setTagsEnabled}
              onChange={setTagsCount}
            />
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
            <Button type="submit" size="sm" disabled={!canSubmit}>
              Spam
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
