# Antfarm Dashboard Design Tokens

Decisions for the shadcn/Tailwind migration (Phase 0).

## Primary action

- `--primary` / shadcn primary = `#fefa3d` (brand yellow, same as legacy `--accent`)

## Status colors

- **Online / connected:** `#fefa3d` (yellow — matches legacy `--green` and rail status dot)
- **Offline / disconnected:** `#5a5a5a` (legacy `--grey`)
- **Info / links:** `#6db5ff` (legacy `--blue`)

## Private resources (search)

- `--priv: #c4a8ff` — unchanged

## Hub accents

Per-seed colors remain in `hubColors.ts` as inline `--hs-accent` / `--hs-key`.

## PR split

- PR1: Phases 0–1 (foundation, zero visual change)
- PR2: Phases 2–3 (Dialog + Sonner pilot)
