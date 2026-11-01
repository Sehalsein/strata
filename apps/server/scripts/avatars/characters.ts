// Strata's profile pictures: original characters drawn for Strata (no third-party art),
// as SVG on a 256×256 canvas. `bun scripts/avatars/build.ts` renders them to PNG for the
// server to serve (apps can't draw SVG from the network). The apps show them in a circle,
// so each character sits centred on a full-bleed background.

const INK = "#1d1b2b";

/** A round, friendly eye: dark with a highlight. */
const eye = (x: number, y: number, r = 11, color = INK) =>
  `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/><circle cx="${x + r * 0.35}" cy="${y - r * 0.38}" r="${r * 0.36}" fill="#fff"/>`;
const eyes = (y: number, gap = 26, r = 11, cx = 128, color = INK) => eye(cx - gap, y, r, color) + eye(cx + gap, y, r, color);
const smile = (x: number, y: number, w = 24, color = INK, width = 6) =>
  `<path d="M${x - w / 2} ${y} Q${x} ${y + w * 0.65} ${x + w / 2} ${y}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>`;
const blush = (x: number, y: number, color = "#ff8fa3") => `<ellipse cx="${x}" cy="${y}" rx="11" ry="7" fill="${color}" opacity=".55"/>`;
const cheeks = (y: number, gap = 50, cx = 128, color?: string) => blush(cx - gap, y, color) + blush(cx + gap, y, color);
const mirror = (shape: string) => `${shape}<g transform="translate(256 0) scale(-1 1)">${shape}</g>`;

export interface Character {
  id: string;
  name: string;
  background: string;
  body: string;
}

export const characters: Character[] = [
  {
    id: "fox",
    name: "Fox",
    background: "#1f6f78",
    body:
      mirror(`<path d="M66 108 L86 38 L124 84 Z" fill="#f2762e"/><path d="M76 96 L88 56 L108 82 Z" fill="#8a3a12"/>`) +
      `<path d="M56 112 Q128 40 200 112 Q208 172 128 214 Q48 172 56 112 Z" fill="#f2762e"/>` +
      mirror(`<path d="M64 140 Q104 148 128 206 Q84 196 64 140 Z" fill="#fff4e8"/>`) +
      eyes(134) +
      `<ellipse cx="128" cy="186" rx="10" ry="7" fill="${INK}"/>`,
  },
  {
    id: "cat",
    name: "Cat",
    background: "#f6c445",
    body:
      mirror(`<path d="M60 116 L70 44 L120 82 Z" fill="#8e7cc3"/><path d="M72 104 L78 62 L106 86 Z" fill="#f4a7c0"/>`) +
      `<ellipse cx="128" cy="142" rx="78" ry="66" fill="#8e7cc3"/>` +
      eyes(134, 30) +
      `<path d="M120 158 L136 158 L128 168 Z" fill="#f4a7c0"/>` +
      `<path d="M114 172 Q121 182 128 172 Q135 182 142 172" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>` +
      mirror(`<path d="M44 150 L84 156 M46 170 L84 166" stroke="#5b4a92" stroke-width="4" stroke-linecap="round"/>`) +
      cheeks(162, 52),
  },
  {
    id: "panda",
    name: "Panda",
    background: "#7cc47f",
    body:
      mirror(`<circle cx="76" cy="80" r="26" fill="#25232f"/>`) +
      `<ellipse cx="128" cy="142" rx="80" ry="70" fill="#fbfbf8"/>` +
      mirror(`<ellipse cx="98" cy="136" rx="20" ry="27" transform="rotate(-28 98 136)" fill="#25232f"/>`) +
      eye(100, 134, 8, "#fff") +
      eye(156, 134, 8, "#fff") +
      `<ellipse cx="128" cy="166" rx="12" ry="8" fill="#25232f"/>` +
      smile(128, 180, 20) +
      cheeks(168, 56),
  },
  {
    id: "owl",
    name: "Owl",
    background: "#3b3561",
    body:
      mirror(`<path d="M66 92 L74 44 L104 76 Z" fill="#a0673f"/>`) +
      `<ellipse cx="128" cy="150" rx="74" ry="82" fill="#a0673f"/>` +
      mirror(`<circle cx="100" cy="126" r="32" fill="#f1d3a8"/>`) +
      eyes(126, 28, 17) +
      `<path d="M118 146 L138 146 L128 166 Z" fill="#f4a261"/>` +
      `<path d="M104 196 l8 8 8-8 M122 196 l6 8 6-8 M136 196 l8 8 8-8" fill="none" stroke="#7a4b2a" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  {
    id: "frog",
    name: "Frog",
    background: "#ffb4a2",
    body:
      `<ellipse cx="128" cy="156" rx="86" ry="60" fill="#4caf50"/>` +
      mirror(`<circle cx="90" cy="100" r="30" fill="#4caf50"/><circle cx="90" cy="100" r="19" fill="#fff"/>`) +
      eye(92, 102, 10) +
      eye(164, 102, 10) +
      `<path d="M80 162 Q128 204 176 162" fill="none" stroke="#1b5e20" stroke-width="7" stroke-linecap="round"/>` +
      cheeks(172, 62),
  },
  {
    id: "penguin",
    name: "Penguin",
    background: "#8ecae6",
    body:
      `<ellipse cx="128" cy="152" rx="74" ry="86" fill="#22223b"/>` +
      `<path d="M128 108 C98 76 58 108 78 152 C90 178 110 196 128 202 C146 196 166 178 178 152 C198 108 158 76 128 108 Z" fill="#fff"/>` +
      eyes(138, 24, 10) +
      `<path d="M116 156 L140 156 L128 170 Z" fill="#f4a261"/>` +
      cheeks(162, 44),
  },
  {
    id: "robot",
    name: "Robot",
    background: "#ef476f",
    body:
      `<path d="M128 80 L128 52" stroke="#cfd8e3" stroke-width="6" stroke-linecap="round"/><circle cx="128" cy="46" r="10" fill="#ffd166"/>` +
      mirror(`<rect x="40" y="122" width="22" height="36" rx="8" fill="#9aa8b8"/>`) +
      `<rect x="56" y="78" width="144" height="124" rx="28" fill="#cfd8e3"/>` +
      `<rect x="76" y="100" width="104" height="70" rx="18" fill="#1d2a3a"/>` +
      mirror(`<rect x="94" y="116" width="18" height="24" rx="7" fill="#5ef2ff"/>`) +
      `<path d="M112 152 Q128 162 144 152" fill="none" stroke="#5ef2ff" stroke-width="5" stroke-linecap="round"/>` +
      mirror(`<circle cx="76" cy="186" r="5" fill="#9aa8b8"/>`),
  },
  {
    id: "alien",
    name: "Alien",
    background: "#2b2d42",
    body:
      `<circle cx="40" cy="48" r="3" fill="#fff" opacity=".7"/><circle cx="214" cy="70" r="2.5" fill="#fff" opacity=".6"/><circle cx="200" cy="214" r="3" fill="#fff" opacity=".5"/>` +
      mirror(`<path d="M100 70 L82 34" stroke="#7bd389" stroke-width="6" stroke-linecap="round"/><circle cx="80" cy="32" r="9" fill="#ffd166"/>`) +
      `<path d="M128 56 C198 56 212 124 188 164 C170 196 148 210 128 210 C108 210 86 196 68 164 C44 124 58 56 128 56 Z" fill="#7bd389"/>` +
      `<ellipse cx="98" cy="134" rx="23" ry="15" transform="rotate(22 98 134)" fill="${INK}"/><ellipse cx="158" cy="134" rx="23" ry="15" transform="rotate(-22 158 134)" fill="${INK}"/>` +
      `<circle cx="104" cy="129" r="5" fill="#fff"/><circle cx="164" cy="129" r="5" fill="#fff"/>` +
      smile(128, 176, 18),
  },
  {
    id: "ghost",
    name: "Ghost",
    background: "#6c63ff",
    body:
      `<path d="M68 206 L68 122 C68 60 188 60 188 122 L188 206 Q174 190 160 206 Q144 222 128 206 Q112 190 96 206 Q82 222 68 206 Z" fill="#f7f7ff"/>` +
      `<ellipse cx="104" cy="128" rx="10" ry="14" fill="${INK}"/><ellipse cx="152" cy="128" rx="10" ry="14" fill="${INK}"/><circle cx="107" cy="122" r="4" fill="#fff"/><circle cx="155" cy="122" r="4" fill="#fff"/>` +
      `<ellipse cx="128" cy="160" rx="10" ry="12" fill="${INK}"/>` +
      cheeks(150, 46),
  },
  {
    id: "monster",
    name: "Monster",
    background: "#ffd166",
    body:
      mirror(`<path d="M80 74 L70 40 L100 66 Z" fill="#f8f9fa"/>`) +
      `<path d="M128 58 C196 58 212 112 208 150 C204 200 168 214 128 214 C88 214 52 200 48 150 C44 112 60 58 128 58 Z" fill="#7b2cbf"/>` +
      `<circle cx="128" cy="122" r="34" fill="#fff"/><circle cx="128" cy="124" r="18" fill="#2ec4b6"/><circle cx="128" cy="124" r="9" fill="${INK}"/><circle cx="134" cy="117" r="5" fill="#fff"/>` +
      `<path d="M92 170 Q128 196 164 170 Z" fill="${INK}"/><path d="M110 176 L116 186 L122 179 Z M134 179 L140 186 L146 176 Z" fill="#fff"/>`,
  },
  {
    id: "dino",
    name: "Dino",
    background: "#f4a261",
    body:
      `<path d="M78 72 L92 48 L104 70 L118 44 L130 68 L146 46 L156 72 L172 54 L178 84 Z" fill="#e9c46a"/>` +
      `<path d="M60 130 C60 84 196 84 196 130 C196 188 160 212 128 212 C96 212 60 188 60 130 Z" fill="#2a9d8f"/>` +
      eyes(128, 30, 12) +
      `<circle cx="116" cy="160" r="4" fill="#1e6f66"/><circle cx="140" cy="160" r="4" fill="#1e6f66"/>` +
      `<path d="M94 176 Q128 198 162 176" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>` +
      mirror(`<path d="M104 182 L110 192 L116 184 Z" fill="#fff"/>`),
  },
  {
    id: "octopus",
    name: "Octopus",
    background: "#48cae4",
    body:
      `<path d="M70 180 Q56 212 76 222 M96 186 Q90 222 108 226 M128 188 Q128 226 148 222 M160 186 Q170 222 186 216 M186 178 Q206 206 196 222" fill="none" stroke="#ff70a6" stroke-width="16" stroke-linecap="round"/>` +
      `<path d="M128 46 C188 46 208 98 204 140 C200 178 168 192 128 192 C88 192 56 178 52 140 C48 98 68 46 128 46 Z" fill="#ff70a6"/>` +
      mirror(`<circle cx="84" cy="80" r="7" fill="#ffa6c9"/><circle cx="74" cy="104" r="5" fill="#ffa6c9"/>`) +
      eyes(132, 28, 12) +
      smile(128, 160, 26) +
      cheeks(152, 58, 128, "#ff3d8a"),
  },
  {
    id: "bear",
    name: "Bear",
    background: "#90be6d",
    body:
      mirror(`<circle cx="74" cy="82" r="26" fill="#9c6644"/><circle cx="74" cy="82" r="13" fill="#e6b88a"/>`) +
      `<ellipse cx="128" cy="144" rx="80" ry="72" fill="#9c6644"/>` +
      `<ellipse cx="128" cy="170" rx="38" ry="28" fill="#e6b88a"/>` +
      eyes(132, 32, 10) +
      `<ellipse cx="128" cy="160" rx="13" ry="9" fill="${INK}"/>` +
      smile(128, 176, 18, INK, 5),
  },
  {
    id: "bunny",
    name: "Bunny",
    background: "#ffafcc",
    body:
      mirror(`<ellipse cx="100" cy="68" rx="20" ry="52" transform="rotate(-10 100 68)" fill="#fbfbf8"/><ellipse cx="100" cy="72" rx="9" ry="36" transform="rotate(-10 100 72)" fill="#ffc8dd"/>`) +
      `<ellipse cx="128" cy="160" rx="74" ry="62" fill="#fbfbf8"/>` +
      eyes(150, 28, 10) +
      `<path d="M120 168 L136 168 L128 177 Z" fill="#ff8fab"/>` +
      `<rect x="120" y="180" width="16" height="12" rx="3" fill="#fff" stroke="#e5d9e0" stroke-width="2"/>` +
      cheeks(174, 50),
  },
  {
    id: "koala",
    name: "Koala",
    background: "#a2d2ff",
    body:
      mirror(`<circle cx="62" cy="104" r="36" fill="#9aa5b1"/><circle cx="62" cy="104" r="20" fill="#e6e9ee"/>`) +
      `<ellipse cx="128" cy="146" rx="74" ry="68" fill="#9aa5b1"/>` +
      eyes(132, 34, 9) +
      `<ellipse cx="128" cy="160" rx="18" ry="24" fill="#3d3a4b"/><ellipse cx="122" cy="150" rx="5" ry="7" fill="#6b6780"/>` +
      smile(128, 192, 16, INK, 5),
  },
  {
    id: "pup",
    name: "Pup",
    background: "#ffd6a5",
    body:
      mirror(`<ellipse cx="66" cy="132" rx="22" ry="48" transform="rotate(18 66 132)" fill="#7f5539"/>`) +
      `<ellipse cx="128" cy="140" rx="70" ry="70" fill="#c68b59"/>` +
      `<ellipse cx="128" cy="172" rx="36" ry="26" fill="#f1dcc0"/>` +
      eyes(130, 28, 11) +
      `<ellipse cx="128" cy="160" rx="12" ry="9" fill="${INK}"/>` +
      `<path d="M120 182 Q128 202 136 182 Z" fill="#ef476f"/>`,
  },
  {
    id: "lion",
    name: "Lion",
    background: "#3a86ff",
    body:
      Array.from({ length: 14 }, (_, i) => {
        const a = (i / 14) * Math.PI * 2;
        return `<circle cx="${(128 + Math.cos(a) * 74).toFixed(1)}" cy="${(136 + Math.sin(a) * 74).toFixed(1)}" r="26" fill="#b5651d"/>`;
      }).join("") +
      `<circle cx="128" cy="136" r="74" fill="#b5651d"/>` +
      `<circle cx="128" cy="140" r="58" fill="#ffc857"/>` +
      eyes(130, 24, 10) +
      `<path d="M118 152 L138 152 L128 164 Z" fill="#7a3e12"/>` +
      `<path d="M128 164 L128 172 M116 176 Q128 184 140 176" fill="none" stroke="#7a3e12" stroke-width="5" stroke-linecap="round"/>` +
      mirror(`<circle cx="100" cy="166" r="2.5" fill="#b5651d"/><circle cx="94" cy="174" r="2.5" fill="#b5651d"/>`),
  },
  {
    id: "whale",
    name: "Whale",
    background: "#ffbe0b",
    body:
      `<path d="M128 74 Q128 52 116 44 M128 74 Q128 52 140 44 M128 74 L128 48" fill="none" stroke="#4cc9f0" stroke-width="6" stroke-linecap="round"/>` +
      `<path d="M184 150 Q214 128 222 104 Q226 136 208 158 Z" fill="#4361ee"/>` +
      `<path d="M44 148 C44 100 92 82 132 82 C178 82 204 112 204 150 C204 190 170 206 124 206 C80 206 44 190 44 148 Z" fill="#4361ee"/>` +
      `<path d="M58 168 C80 198 168 200 196 166 C178 196 82 206 58 168 Z" fill="#bde0fe"/>` +
      eye(96, 136, 11) +
      smile(118, 158, 26) +
      blush(92, 160),
  },
  {
    id: "cactus",
    name: "Cactus",
    background: "#ff9f1c",
    body:
      `<path d="M78 174 L178 174 L166 222 L90 222 Z" fill="#c8553d"/><rect x="72" y="166" width="112" height="16" rx="6" fill="#d96c4f"/>` +
      `<path d="M70 104 Q70 92 82 92 Q94 92 94 104 L94 128 L104 128 L104 140 L82 140 Q70 140 70 128 Z" fill="#2d6a4f"/>` +
      `<path d="M186 96 Q186 84 174 84 Q162 84 162 96 L162 118 L152 118 L152 130 L174 130 Q186 130 186 118 Z" fill="#2d6a4f"/>` +
      `<rect x="96" y="58" width="64" height="112" rx="32" fill="#40916c"/>` +
      `<circle cx="128" cy="54" r="12" fill="#ff70a6"/><circle cx="128" cy="54" r="5" fill="#ffd166"/>` +
      eyes(108, 14, 8) +
      smile(128, 126, 16, INK, 5),
  },
  {
    id: "avocado",
    name: "Avocado",
    background: "#bde0fe",
    body:
      `<path d="M128 40 C162 40 172 84 186 120 C204 168 180 216 128 216 C76 216 52 168 70 120 C84 84 94 40 128 40 Z" fill="#3a5a40"/>` +
      `<path d="M128 56 C154 56 160 92 172 124 C186 164 168 202 128 202 C88 202 70 164 84 124 C96 92 102 56 128 56 Z" fill="#c5e17a"/>` +
      `<circle cx="128" cy="160" r="28" fill="#8b5a2b"/><circle cx="120" cy="152" r="8" fill="#a8743f"/>` +
      eyes(110, 20, 8) +
      smile(128, 120, 16, INK, 5) +
      cheeks(118, 36),
  },
  {
    id: "toast",
    name: "Toast",
    background: "#cdb4db",
    body:
      `<path d="M66 112 C46 112 46 64 82 62 C98 46 158 46 174 62 C210 64 210 112 190 112 L190 206 Q190 214 182 214 L74 214 Q66 214 66 206 Z" fill="#b5713b"/>` +
      `<path d="M80 116 C64 114 66 78 90 76 C104 64 152 64 166 76 C190 78 192 114 176 116 L176 200 L80 200 Z" fill="#f2c27b"/>` +
      `<rect x="138" y="90" width="28" height="22" rx="5" fill="#ffe066" transform="rotate(8 152 101)"/>` +
      eyes(144, 26, 10) +
      smile(128, 170, 22),
  },
  {
    id: "mushroom",
    name: "Mushroom",
    background: "#caffbf",
    body:
      `<path d="M92 132 L164 132 L172 206 Q172 216 162 216 L94 216 Q84 216 84 206 Z" fill="#fff1e0"/>` +
      `<path d="M40 136 C40 64 216 64 216 136 Q216 146 204 146 L52 146 Q40 146 40 136 Z" fill="#e63946"/>` +
      `<circle cx="92" cy="98" r="13" fill="#fff"/><circle cx="148" cy="84" r="16" fill="#fff"/><circle cx="186" cy="118" r="9" fill="#fff"/><circle cx="64" cy="128" r="7" fill="#fff"/>` +
      eyes(172, 22, 9) +
      smile(128, 192, 16, INK, 5) +
      cheeks(186, 34),
  },
  {
    id: "astronaut",
    name: "Astronaut",
    background: "#14213d",
    body:
      `<circle cx="36" cy="40" r="3" fill="#fff" opacity=".8"/><circle cx="222" cy="58" r="2" fill="#fff" opacity=".7"/><circle cx="210" cy="206" r="3" fill="#fff" opacity=".6"/><circle cx="46" cy="196" r="2" fill="#fff" opacity=".7"/>` +
      mirror(`<rect x="44" y="118" width="20" height="40" rx="8" fill="#c9d1dc"/>`) +
      `<circle cx="128" cy="138" r="78" fill="#eef2f7"/>` +
      `<rect x="70" y="92" width="116" height="88" rx="44" fill="#1b263b"/>` +
      `<path d="M86 108 Q100 98 116 100" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".5"/>` +
      eyes(136, 24, 10, 128, "#ffd166") +
      smile(128, 156, 18, "#ffd166", 5) +
      `<rect x="108" y="194" width="40" height="12" rx="6" fill="#ef476f"/>`,
  },
  {
    id: "popcorn",
    name: "Popcorn",
    background: "#e63946",
    body:
      [
        [92, 82, 22],
        [124, 66, 26],
        [160, 80, 22],
        [76, 104, 18],
        [180, 104, 18],
        [110, 92, 20],
        [144, 96, 20],
      ]
        .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff3c4"/>`)
        .join("") +
      `<path d="M62 112 L194 112 L178 218 L78 218 Z" fill="#fff"/>` +
      `<path d="M88 112 L104 112 L104 218 L92 218 Z M128 112 L144 112 L140 218 L128 218 Z M168 112 L184 112 L172 218 L164 218 Z" fill="#e63946" opacity=".85"/>` +
      `<rect x="88" y="138" width="80" height="58" rx="18" fill="#fff"/>` +
      eyes(160, 20, 9) +
      smile(128, 176, 16, INK, 5),
  },
  // Story archetypes: generic types, not anyone's character.
  {
    id: "pirate",
    name: "Pirate",
    background: "#00b4d8",
    body:
      `<circle cx="128" cy="150" r="66" fill="#f1c27d"/>` +
      `<path d="M80 176 Q128 238 176 176 Q160 196 128 196 Q96 196 80 176 Z" fill="#6f4518"/>` +
      `<path d="M40 112 Q128 20 216 112 Q128 92 40 112 Z" fill="#2b2d42"/><path d="M52 108 Q128 88 204 108" fill="none" stroke="#ffd166" stroke-width="5"/>` +
      `<circle cx="128" cy="72" r="9" fill="#ffd166"/>` +
      `<path d="M70 118 L186 152" stroke="${INK}" stroke-width="4"/><ellipse cx="102" cy="140" rx="16" ry="13" fill="${INK}"/>` +
      eye(154, 140, 10) +
      smile(128, 170, 24),
  },
  {
    id: "ninja",
    name: "Ninja",
    background: "#ffd60a",
    body:
      `<path d="M176 92 Q214 84 226 60 M176 98 Q218 104 232 90" fill="none" stroke="#e63946" stroke-width="10" stroke-linecap="round"/>` +
      `<circle cx="128" cy="138" r="78" fill="#2b2d42"/>` +
      `<rect x="54" y="88" width="148" height="18" rx="4" fill="#e63946"/>` +
      `<rect x="66" y="118" width="124" height="44" rx="22" fill="#f1c27d"/>` +
      `<path d="M86 128 L114 134 M170 128 L142 134" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>` +
      eyes(142, 22, 9),
  },
  {
    id: "wizard",
    name: "Wizard",
    background: "#80ed99",
    body:
      `<path d="M128 18 L184 112 L72 112 Z" fill="#5a189a"/><path d="M118 52 l4 8 9 1 -7 6 2 9 -8-5 -8 5 2-9 -7-6 9-1 Z" fill="#ffd166"/><circle cx="152" cy="86" r="5" fill="#ffd166"/>` +
      `<ellipse cx="128" cy="112" rx="84" ry="14" fill="#5a189a"/>` +
      `<circle cx="128" cy="150" r="48" fill="#f1c27d"/>` +
      `<path d="M80 160 Q86 238 128 240 Q170 238 176 160 Q128 186 80 160 Z" fill="#f8f9fa"/>` +
      `<path d="M104 132 Q112 126 120 132 M136 132 Q144 126 152 132" fill="none" stroke="#adb5bd" stroke-width="6" stroke-linecap="round"/>` +
      eyes(146, 18, 8) +
      `<ellipse cx="128" cy="164" rx="8" ry="6" fill="#e09f6f"/>`,
  },
  {
    id: "hero",
    name: "Hero",
    background: "#ffbe0b",
    body:
      `<path d="M58 250 L80 150 L176 150 L198 250 Z" fill="#d00000"/>` +
      `<circle cx="128" cy="136" r="66" fill="#e0ac69"/>` +
      `<path d="M62 132 C58 70 198 70 194 132 C182 98 150 88 128 96 C106 88 74 98 62 132 Z" fill="#3d2b1f"/>` +
      `<path d="M70 128 Q128 108 186 128 L180 152 Q154 162 128 146 Q102 162 76 152 Z" fill="#3a86ff"/>` +
      eyes(136, 26, 9, 128, "#fff") +
      `<circle cx="102" cy="136" r="5" fill="${INK}"/><circle cx="154" cy="136" r="5" fill="${INK}"/>` +
      smile(128, 172, 26),
  },
  {
    id: "vampire",
    name: "Vampire",
    background: "#7209b7",
    body:
      mirror(`<path d="M40 230 L56 130 L104 196 Z" fill="#d00000"/>`) +
      `<circle cx="128" cy="140" r="66" fill="#dfe7e2"/>` +
      `<path d="M62 132 C58 70 198 70 194 132 C178 100 150 92 128 120 C106 92 78 100 62 132 Z" fill="#14121c"/>` +
      eyes(146, 24, 9) +
      `<path d="M104 172 Q128 186 152 172" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>` +
      `<path d="M112 176 L116 190 L120 178 Z M136 178 L140 190 L144 176 Z" fill="#fff"/>` +
      cheeks(164, 46),
  },
  {
    id: "dragon",
    name: "Dragon",
    background: "#2ec4b6",
    body:
      mirror(`<path d="M86 84 L70 40 L106 74 Z" fill="#ffd166"/>`) +
      `<path d="M128 66 C190 66 206 116 200 150 C194 196 166 214 128 214 C90 214 62 196 56 150 C50 116 66 66 128 66 Z" fill="#e85d04"/>` +
      `<ellipse cx="128" cy="178" rx="50" ry="30" fill="#faa307"/>` +
      eyes(128, 32, 12) +
      `<circle cx="114" cy="170" r="5" fill="#9d0208"/><circle cx="142" cy="170" r="5" fill="#9d0208"/>` +
      `<path d="M106 190 Q128 204 150 190" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>` +
      `<circle cx="210" cy="190" r="10" fill="#fff" opacity=".7"/><circle cx="226" cy="172" r="7" fill="#fff" opacity=".5"/>`,
  },
];

/** How the pickers group them, in this order. */
export const groups: { title: string; ids: string[] }[] = [
  { title: "Animals", ids: ["fox", "cat", "pup", "bunny", "bear", "panda", "koala", "lion", "owl", "penguin", "frog", "whale", "octopus"] },
  { title: "Creatures", ids: ["monster", "alien", "ghost", "robot", "dino", "dragon"] },
  { title: "Adventurers", ids: ["pirate", "ninja", "wizard", "hero", "vampire", "astronaut"] },
  { title: "Snacks & Plants", ids: ["popcorn", "toast", "avocado", "mushroom", "cactus"] },
];

export function svgFor(c: Character): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256"><rect width="256" height="256" fill="${c.background}"/>${c.body}</svg>`;
}
