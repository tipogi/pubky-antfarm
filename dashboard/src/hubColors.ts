// Per-homeserver accent colors — spread across the hue wheel to avoid blue clusters.
// Order for seeds 0–7: red → teal → orange → green → magenta → amber → rust → violet.
export const HUB_THEMES: readonly { hub: string; key: string }[] = [
  { hub: "#E05454", key: "#FF8B7A" }, // 0 red
  { hub: "#1F6F5F", key: "#5DD3B6" }, // 1 teal
  { hub: "#FF9B51", key: "#FFBE7D" }, // 2 orange
  { hub: "#7CB342", key: "#A5D66A" }, // 3 green
  { hub: "#D946A8", key: "#F082C8" }, // 4 magenta
  { hub: "#E6A817", key: "#F5C842" }, // 5 amber
  { hub: "#C45C3E", key: "#E8896E" }, // 6 rust
  { hub: "#7B4FD9", key: "#A07FEE" }, // 7 violet

  { hub: "#22A6B3", key: "#5DD5E0" }, // 8 cyan
  { hub: "#E8788A", key: "#F5A0AE" }, // 9 rose
  { hub: "#6B8E23", key: "#9CB865" }, // 10 olive
  { hub: "#B83280", key: "#E060A8" }, // 11 fuchsia
];

export function hubColorFor(seed: number): { color: string; keyColor: string } {
  const theme = HUB_THEMES[seed % HUB_THEMES.length];
  return { color: theme.hub, keyColor: theme.key };
}
