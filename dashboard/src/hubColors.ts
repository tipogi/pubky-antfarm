// Graph node colors — UI chrome keeps yellow accent in styles.css.
// Order: main three → orange & purple → indigo (hs6) → slate (hs7) → orange & purple again (hs8–hs9).
export const HUB_THEMES: readonly { hub: string; key: string }[] = [
  { hub: "#293681", key: "#547792" }, // hs1 navy
  { hub: "#E05454", key: "#FF8B5A" }, // hs2 red
  { hub: "#1F6F5F", key: "#5DD3B6" }, // hs3 teal

  { hub: "#FF9B51", key: "#FF9B51" }, // hs4 orange
  { hub: "#4D2FB2", key: "#4D2FB2" }, // hs5 purple

  { hub: "#3D45AA", key: "#547792" }, // hs6 indigo
  { hub: "#547792", key: "#4274D9" }, // hs7 slate

  { hub: "#FF8B5A", key: "#FF8B5A" }, // hs8 orange
  { hub: "#4D2FB2", key: "#4D2FB2" }, // hs9 purple

  { hub: "#FF4400", key: "#FF9B51" }, // hs10+
  { hub: "#5DD3B6", key: "#6FCF97" },
];

export function hubColorFor(seed: number): { color: string; keyColor: string } {
  const theme = HUB_THEMES[seed % HUB_THEMES.length];
  return { color: theme.hub, keyColor: theme.key };
}
