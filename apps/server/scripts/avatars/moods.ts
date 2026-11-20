// "Moods": soft, clay-like faces pulling an expression. Each surface is a radial gradient
// (light top-left, dark bottom-right) so the shapes read as rounded 3D forms. Gradient and
// filter ids are prefixed with the character's id, since the contact sheet puts every
// character in one SVG.
import type { Character } from "./characters";

const DARK = "#2b1a2e";
const MOUTH = "#3b1224";

/** `hex` moved `t` of the way towards `to`. */
export const mix = (hex: string, to: string, t: number) => {
  const a = parseInt(hex.slice(1), 16);
  const b = parseInt(to.slice(1), 16);
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return `#${((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1)}`;
};

const clay = (id: string, base: string) =>
  `<radialGradient id="${id}" cx=".42" cy=".36" r=".74" fx=".32" fy=".24"><stop offset="0" stop-color="${mix(base, "#ffffff", 0.4)}"/><stop offset=".5" stop-color="${base}"/><stop offset="1" stop-color="${mix(base, "#000000", 0.34)}"/></radialGradient>`;

interface Paint {
  /** The skin, shirt, white and extra fills, as `url(#…)`. */
  skin: string;
  shirt: string;
  white: string;
  extra: string;
  /** Soft-blur filters, as `url(#…)`. */
  soft: string;
  blur: string;
  base: string;
}

interface Mood {
  id: string;
  name: string;
  background: string;
  skin: string;
  shirt: string;
  /** A fourth clay colour, for hair, hats and props. */
  extra?: string;
  /** Drawn behind the head (hair, hats that hang behind). */
  back?: (p: Paint) => string;
  /** The face and anything in front of it. */
  face: (p: Paint) => string;
  /** Shown instead of ears. */
  noEars?: boolean;
}

const orb = (x: number, y: number, rx: number, ry: number, fill: string) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${fill}"/>`;
const eyeball = (x: number, y: number, r: number, p: Paint, pupil = 0.48, look = [1, 1]) =>
  orb(x, y, r, r, p.white) +
  `<circle cx="${x + look[0]! * 2}" cy="${y + look[1]! * 2}" r="${r * pupil}" fill="${DARK}"/>` +
  `<circle cx="${x + look[0]! * 2 + r * pupil * 0.4}" cy="${y + look[1]! * 2 - r * pupil * 0.45}" r="${Math.max(2, r * pupil * 0.36)}" fill="#fff"/>`;
const arc = (d: string, width = 7, color = DARK) => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
const blushes = (p: Paint, y = 142, gap = 46, color = "#ff4f7b") =>
  `<ellipse cx="${128 - gap}" cy="${y}" rx="16" ry="10" fill="${color}" opacity=".45" filter="${p.blur}"/><ellipse cx="${128 + gap}" cy="${y}" rx="16" ry="10" fill="${color}" opacity=".45" filter="${p.blur}"/>`;
const heart = (x: number, y: number, s: number, fill: string) =>
  `<path d="M${x} ${y + s * 0.9} C${x - s * 1.4} ${y - s * 0.05} ${x - s * 0.8} ${y - s * 1.05} ${x} ${y - s * 0.35} C${x + s * 0.8} ${y - s * 1.05} ${x + s * 1.4} ${y - s * 0.05} ${x} ${y + s * 0.9} Z" fill="${fill}"/>`;
const drop = (x: number, y: number, s: number) =>
  `<path d="M${x} ${y - s} Q${x + s * 0.85} ${y + s * 0.3} ${x} ${y + s} Q${x - s * 0.85} ${y + s * 0.3} ${x} ${y - s} Z" fill="#8fe3ff"/><ellipse cx="${x - s * 0.22}" cy="${y + s * 0.2}" rx="${s * 0.16}" ry="${s * 0.26}" fill="#fff" opacity=".85"/>`;
const zee = (x: number, y: number, s: number) => arc(`M${x} ${y} h${s} l${-s} ${s} h${s}`, 4, "#fff");

function mood(m: Mood): Character {
  const u = (k: string) => `url(#${m.id}-${k})`;
  const p: Paint = { skin: u("skin"), shirt: u("shirt"), white: u("white"), extra: u("extra"), soft: u("soft"), blur: u("blur"), base: m.skin };
  const defs =
    `<defs>${clay(`${m.id}-skin`, m.skin)}${clay(`${m.id}-shirt`, m.shirt)}${clay(`${m.id}-white`, "#eef1f7")}${clay(`${m.id}-extra`, m.extra ?? m.shirt)}` +
    `<filter id="${m.id}-soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9"/></filter>` +
    `<filter id="${m.id}-blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4"/></filter></defs>`;
  return {
    id: m.id,
    name: m.name,
    background: m.background,
    body:
      defs +
      `<ellipse cx="128" cy="244" rx="150" ry="40" fill="#000" opacity=".12" filter="${p.soft}"/>` +
      orb(128, 264, 114, 78, p.shirt) +
      `<ellipse cx="134" cy="194" rx="60" ry="15" fill="#000" opacity=".3" filter="${p.soft}"/>` +
      (m.back?.(p) ?? "") +
      (m.noEars ? "" : orb(60, 130, 13, 17, p.skin) + orb(196, 130, 13, 17, p.skin)) +
      orb(128, 122, 70, 66, p.skin) +
      m.face(p),
  };
}

export const moods: Character[] = [
  mood({
    id: "joy",
    name: "Joy",
    background: "#ffd23f",
    skin: "#ff7a3d",
    shirt: "#3a86ff",
    face: (p) =>
      arc("M90 118 Q103 100 116 118") +
      arc("M140 118 Q153 100 166 118") +
      `<path d="M88 138 Q128 200 168 138 Q128 152 88 138 Z" fill="${MOUTH}"/>` +
      `<path d="M108 168 Q128 154 148 168 Q128 184 108 168 Z" fill="#ff5d73"/>` +
      blushes(p, 140, 52),
  }),
  mood({
    id: "chill",
    name: "Chill",
    background: "#06d6a0",
    skin: "#c0703a",
    shirt: "#ef476f",
    extra: "#2b2340",
    back: (p) => `<path d="M56 116 Q56 46 128 46 Q200 46 200 116 Q186 70 128 72 Q70 70 56 116 Z" fill="${p.extra}"/>`,
    face: (p) =>
      `<path d="M58 112 Q60 50 128 50 Q196 50 198 112 Q174 78 128 80 Q82 78 58 112 Z" fill="${p.extra}"/>` +
      `<rect x="76" y="98" width="48" height="30" rx="12" fill="#111"/><rect x="132" y="98" width="48" height="30" rx="12" fill="#111"/>` +
      `<rect x="120" y="104" width="16" height="7" rx="3" fill="#111"/>` +
      `<path d="M58 108 L78 106 M178 106 L198 108" stroke="#111" stroke-width="6" stroke-linecap="round"/>` +
      arc("M88 122 L104 104", 5, "#fff") +
      arc("M144 122 L160 104", 5, "#fff") +
      arc("M108 156 Q132 170 154 148", 7) +
      blushes(p, 146, 50, "#ff7a59"),
  }),
  mood({
    id: "teary",
    name: "Teary",
    background: "#4cc9f0",
    skin: "#ffd6a5",
    shirt: "#7209b7",
    face: (p) =>
      arc("M84 92 L112 84", 7) +
      arc("M144 84 L172 92", 7) +
      eyeball(102, 116, 19, p, 0.56, [0, 1]) +
      eyeball(154, 116, 19, p, 0.56, [0, 1]) +
      `<circle cx="96" cy="124" r="2.5" fill="#fff"/><circle cx="148" cy="124" r="2.5" fill="#fff"/>` +
      arc("M106 166 Q117 152 128 160 Q139 152 150 166", 7) +
      blushes(p, 150, 52) +
      drop(86, 150, 15) +
      drop(172, 158, 12) +
      drop(78, 184, 9),
  }),
  mood({
    id: "sleepy",
    name: "Sleepy",
    background: "#5a189a",
    skin: "#9b8cff",
    shirt: "#ffbe0b",
    extra: "#3a86ff",
    face: (p) =>
      `<path d="M58 104 Q62 40 128 38 Q172 38 198 64 L224 122 L182 82 Q150 72 58 104 Z" fill="${p.extra}"/>` +
      arc("M58 104 Q128 76 198 104", 14, "#f4f6fb") +
      orb(224, 126, 14, 14, p.white) +
      arc("M90 120 Q103 132 116 120") +
      arc("M140 120 Q153 132 166 120") +
      `<ellipse cx="128" cy="156" rx="8" ry="10" fill="${MOUTH}"/>` +
      blushes(p, 144, 50, "#ff7ab8") +
      zee(26, 120, 16) +
      zee(42, 92, 12) +
      zee(60, 70, 8),
  }),
  mood({
    id: "smitten",
    name: "Smitten",
    background: "#ffe066",
    skin: "#ff6b6b",
    shirt: "#118ab2",
    face: (p) =>
      heart(102, 114, 17, "#d90429") +
      heart(154, 114, 17, "#d90429") +
      `<ellipse cx="96" cy="106" rx="4" ry="5" fill="#fff" opacity=".8"/><ellipse cx="148" cy="106" rx="4" ry="5" fill="#fff" opacity=".8"/>` +
      `<path d="M102 146 Q128 178 154 146 Q128 154 102 146 Z" fill="${MOUTH}"/>` +
      blushes(p, 146, 54, "#ff2e63") +
      heart(212, 56, 11, "#ef233c") +
      heart(42, 74, 8, "#ef233c") +
      heart(222, 92, 6, "#ef233c"),
  }),
  mood({
    id: "shook",
    name: "Shook",
    background: "#00b4d8",
    skin: "#ffd166",
    shirt: "#ef476f",
    face: (p) =>
      arc("M84 82 Q100 70 116 78", 7) +
      arc("M140 78 Q156 70 172 82", 7) +
      eyeball(102, 112, 21, p, 0.26, [0, 0]) +
      eyeball(154, 112, 21, p, 0.26, [0, 0]) +
      `<ellipse cx="128" cy="162" rx="14" ry="20" fill="${MOUTH}"/>` +
      drop(190, 76, 10) +
      orb(66, 164, 22, 32, p.skin) +
      orb(190, 164, 22, 32, p.skin),
  }),
  mood({
    id: "grumpy",
    name: "Grumpy",
    background: "#ff9f1c",
    skin: "#80b918",
    shirt: "#3d405b",
    face: (p) =>
      eyeball(104, 118, 14, p, 0.5, [0, 2]) +
      eyeball(152, 118, 14, p, 0.5, [0, 2]) +
      `<path d="M88 118 A16 16 0 0 1 120 118 Z M136 118 A16 16 0 0 1 168 118 Z" fill="${mix(p.base, "#000000", 0.12)}"/>` +
      arc("M86 94 L120 106", 9) +
      arc("M170 94 L136 106", 9) +
      arc("M106 164 Q128 146 150 164", 7) +
      arc("M180 66 Q188 74 196 66 M180 82 Q188 74 196 82", 5, "#d00000") +
      `<rect x="44" y="210" width="168" height="42" rx="21" fill="${p.shirt}"/>` +
      orb(62, 228, 19, 18, p.skin) +
      orb(194, 228, 19, 18, p.skin),
  }),
  mood({
    id: "giggle",
    name: "Giggle",
    background: "#f15bb5",
    skin: "#00bbf9",
    shirt: "#fee440",
    face: (p) =>
      arc("M90 120 Q103 106 116 120") +
      arc("M140 120 Q153 106 166 120") +
      blushes(p, 142, 50, "#ff4fa3") +
      `<path d="M98 144 Q128 190 158 144 Q128 156 98 144 Z" fill="${MOUTH}"/>` +
      `<path d="M114 168 Q128 158 142 168 Q128 178 114 168 Z" fill="#ff5d73"/>` +
      drop(80, 132, 9) +
      drop(176, 132, 9) +
      arc("M196 70 L206 60 M208 86 L222 84 M188 54 L190 40", 5, "#fff"),
  }),
];
