import { useEffect, useState, type FormEvent } from "react";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import {
  modalCheckboxRow,
  modalContentSm,
  modalField,
  modalFooter,
  modalForm,
  modalHint,
  modalInput,
  modalLabel,
  modalRadioOption,
} from "@/lib/modal-layout";
import { hubColorFor } from "./hubColors";
import { ROOT_VIEWBOX, RootPaths } from "./RootMark";
import type { CSSProperties } from "react";

type HomeserverStart = "dormant" | "active";

export function AddHomeserverTile({
  nextIndex,
  busy,
  onClick,
}: {
  nextIndex: number;
  busy: boolean;
  onClick: () => void;
}) {
  const { color, keyColor } = hubColorFor(nextIndex);

  return (
    <button
      type="button"
      className="hs-card hs-card-add"
      style={
        {
          "--hs-accent": color,
          "--hs-key": keyColor,
        } as CSSProperties
      }
      disabled={busy}
      onClick={onClick}
      aria-label={`Deploy homeserver hs${nextIndex + 1}`}
    >
      <header className="hs-card-head">
        <span className="hs-card-avatar" aria-hidden>
          <svg viewBox={ROOT_VIEWBOX} className="hs-card-avatar-icon">
            <RootPaths />
          </svg>
        </span>
        <div className="hs-card-title">
          <div className="hs-card-title-row">
            <h2>Deploy node</h2>
            <span className="hs-card-pill hs-card-add-pill">new</span>
          </div>
          <span className="hs-card-seed">
            hs{nextIndex + 1} · seed {nextIndex}
          </span>
        </div>
      </header>

      <div className="hs-card-add-body">
        <p className="hs-card-add-copy">
          Spin up another homeserver — choose dormant or active in the
          configurator
        </p>
      </div>

      <div className="hs-card-divider" role="separator" />

      <div className="hs-card-row hs-card-add-foot">
        <span className="hs-card-add-cta">
          Configure &amp; deploy
          <svg viewBox="0 0 24 24" className="hs-card-add-arrow" aria-hidden>
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </span>
      </div>
    </button>
  );
}

export function CreateHomeserverModal({
  nextIndex,
  busy,
  onClose,
  onCreate,
}: {
  nextIndex: number;
  busy: boolean;
  onClose: () => void;
  onCreate: (index: number, island: boolean, activate: boolean) => void;
}) {
  const [seed, setSeed] = useState(String(nextIndex));
  const [start, setStart] = useState<HomeserverStart>("dormant");
  const [island, setIsland] = useState(false);

  useEffect(() => {
    setSeed(String(nextIndex));
  }, [nextIndex]);

  const seedNum = Number(seed);
  const seedValid = Number.isInteger(seedNum) && seedNum >= 1 && seedNum <= 23;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy || !seedValid) return;
    onClose();
    onCreate(seedNum, island, start === "active");
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={modalContentSm()}>
        <DialogHeader>
          <DialogTitle>Create homeserver</DialogTitle>
          <DialogDescription>
            Adds hs{seedValid ? seedNum + 1 : "?"} to the testnet
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className={modalForm()}>
          <div className={modalField()}>
            <Label htmlFor="create-hs-seed" className={modalLabel()}>
              Seed index
            </Label>
            <Input
              id="create-hs-seed"
              type="number"
              min={1}
              max={23}
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              disabled={busy}
              aria-describedby="create-hs-seed-hint"
              className={cn(modalInput(), "max-w-[120px] font-mono")}
              autoFocus
            />
            <p id="create-hs-seed-hint" className={modalHint()}>
              Index 1–23 · seed 0 is reserved for hs1
            </p>
          </div>

          <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
            <legend className={cn(modalLabel(), "mb-0")}>
              Simulator status
            </legend>
            <RadioGroup
              value={start}
              onValueChange={(v) => setStart(v as HomeserverStart)}
              disabled={busy}
            >
              {(
                [
                  {
                    value: "dormant" as const,
                    title: "Dormant",
                    desc: "Reachable via DHT, no simulated activity",
                  },
                  {
                    value: "active" as const,
                    title: "Active",
                    desc: "Join the simulator rotation immediately",
                  },
                ] as const
              ).map((opt) => (
                <label
                  key={opt.value}
                  className={modalRadioOption(start === opt.value)}
                >
                  <RadioGroupItem
                    value={opt.value}
                    id={`hs-start-${opt.value}`}
                    className="mt-px"
                  />
                  <span className="grid min-w-0 gap-0.5">
                    <span className="text-[13px] font-semibold leading-tight">
                      {opt.title}
                    </span>
                    <span className={modalHint()}>{opt.desc}</span>
                  </span>
                </label>
              ))}
            </RadioGroup>
          </fieldset>

          <label className={cn(modalCheckboxRow(), "cursor-pointer")}>
            <span className="flex items-center gap-2">
              <Checkbox
                id="create-hs-island"
                checked={island}
                disabled={busy}
                onCheckedChange={(checked) => setIsland(checked === true)}
              />
              <span className="text-[13px] font-semibold leading-tight">
                Island (isolated)
              </span>
            </span>
            <span className={cn(modalHint(), "pl-[22px]")}>
              Other users can&apos;t follow or tag this homeserver&apos;s users
            </span>
          </label>

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
            <Button type="submit" size="sm" disabled={busy || !seedValid}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
