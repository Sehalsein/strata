export type Palette = readonly [string, string, string];

export const aurora = {
  name: "Cinemathèque",
  bg: "#0c0a08",
  bg2: "#1a1611",
  panel: "rgba(243,233,211,0.04)",
  panelStrong: "rgba(243,233,211,0.07)",
  border: "rgba(243,233,211,0.12)",
  borderStrong: "rgba(243,233,211,0.22)",
  text: "#f3e9d3",
  text2: "rgba(243,233,211,0.62)",
  text3: "rgba(243,233,211,0.4)",
  accent: "#e8331f",
  accent2: "#e8b341",
  accentInk: "#f3e9d3",
  gradient: "linear-gradient(135deg, #e8331f 0%, #e8b341 100%)",
  backdropTint:
    "radial-gradient(60% 70% at 70% 20%, rgba(232,179,65,0.18), transparent), radial-gradient(50% 60% at 20% 80%, rgba(232,51,31,0.12), transparent)",
  chipBg: "rgba(232,179,65,0.12)",
  chipText: "#f3d59a",
  danger: "#e8331f",
  success: "#6aa37a",
};

export type Theme = typeof aurora;

export const hexA = (hex: string, a: number): string => {
  if (!hex || hex[0] !== "#") return hex;
  let r: number, g: number, b: number;
  if (hex.length === 4) {
    r = parseInt(hex[1] + hex[1], 16);
    g = parseInt(hex[2] + hex[2], 16);
    b = parseInt(hex[3] + hex[3], 16);
  } else if (hex.length === 7) {
    r = parseInt(hex.slice(1, 3), 16);
    g = parseInt(hex.slice(3, 5), 16);
    b = parseInt(hex.slice(5, 7), 16);
  } else {
    return hex;
  }
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

/* Warm-leaning, cinematic palettes — burnt amber, oxblood, ochre, ink,
 * sepia, brick, jade — built for a print-magazine palette wash. */
const PALETTES: Palette[] = [
  ["#c2683a", "#1a0d05", "#f0c987"],
  ["#a72a1f", "#1a0a08", "#f4d77c"],
  ["#3a2412", "#d97c2b", "#f4e5c7"],
  ["#2a0e0e", "#c83e2a", "#f4d77c"],
  ["#1a1612", "#d97c2b", "#f4e5c7"],
  ["#5a4030", "#1a1410", "#d8a868"],
  ["#6a2818", "#f0d088", "#1a0a05"],
  ["#1a3a3a", "#7ec8c0", "#0e1a1a"],
  ["#0d2a4a", "#7ec8f0", "#f5f1eb"],
  ["#3a5a3a", "#f4c87a", "#1a0e2a"],
  ["#6a1818", "#1a0a0a", "#f0c8a8"],
  ["#1a3a4a", "#c87a3a", "#0a1a2a"],
  ["#d97c2b", "#1a0a0a", "#7ec0d0"],
  ["#0a1a2a", "#c87a3a", "#1a0e2a"],
  ["#3a2a6a", "#f4c87a", "#1a0e2a"],
  ["#6a4818", "#1a0a05", "#f0c060"],
  ["#3a3a1a", "#1a1a0a", "#f4c84a"],
  ["#1a2a1a", "#3aa860", "#f4e8c2"],
];

const MOTIFS = [
  "sun-horizon",
  "corridor",
  "atom",
  "rising-sun",
  "bands",
  "split",
  "neon",
  "twin-arc",
  "archway",
  "rings",
  "aurora",
  "court",
  "eye",
  "moon-prairie",
  "flag-torn",
  "vault",
  "pod",
  "megacity",
] as const;

export type MotifKey = (typeof MOTIFS)[number];

const hashStr = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

export const paletteFor = (key: string): Palette =>
  PALETTES[hashStr(key) % PALETTES.length];

export const motifFor = (key: string): MotifKey =>
  MOTIFS[hashStr(key + "::motif") % MOTIFS.length];

export const titleAmbience = (
  palette: Palette | null,
  theme: Theme,
  intensity = 1,
): string => {
  if (!palette) return theme.backdropTint;
  const [c1, c2, c3] = palette;
  const a1 = 0.32 * intensity;
  const a2 = 0.22 * intensity;
  const a3 = 0.14 * intensity;
  return [
    `radial-gradient(70% 80% at 75% 15%, ${hexA(c1, a1)} 0%, transparent 55%)`,
    `radial-gradient(60% 70% at 15% 90%, ${hexA(c2, a2)} 0%, transparent 60%)`,
    `radial-gradient(40% 60% at 10% 5%, ${hexA(c3, a3)} 0%, transparent 65%)`,
    `linear-gradient(180deg, ${hexA(c2, 0.08 * intensity)} 0%, transparent 60%)`,
  ].join(", ");
};

/* Stable opus catalog number for a title — gives every item a № XXX */
export const opusFor = (key: string): string => {
  const n = (hashStr(key) % 899) + 100;
  return String(n);
};

/* Format a hashed roman-numeral volume label per session/run */
export const volumeFor = (key: string): string => {
  const roman = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
  return roman[hashStr(key) % roman.length];
};
