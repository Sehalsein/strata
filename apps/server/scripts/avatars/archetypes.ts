// "Archetypes": flat, editorial-style people at their hobby or job, drawn large and cropped
// by the circle. Flat fills, a dark line for details, no gradients. Clip-path ids are
// prefixed with the character's id, since the contact sheet puts every character in one SVG.
import type { Character } from "./characters";
import { mix } from "./moods";

const LINE = "#2b2340";

const line = (d: string, width = 4, color = LINE) => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
const torso = (fill: string, top = 186) => `<path d="M24 256 Q30 ${top + 6} 128 ${top} Q226 ${top + 6} 232 256 Z" fill="${fill}"/>`;
const neck = (skin: string) => `<rect x="110" y="150" width="36" height="44" rx="10" fill="${mix(skin, "#000000", 0.14)}"/>`;
/** A face looking slightly to the viewer's right: head, ears, nose and simple features. */
const head = (skin: string, cy = 116, rx = 46, ry = 54) =>
  `<ellipse cx="${128 - rx + 2}" cy="${cy + 8}" rx="9" ry="13" fill="${skin}"/><ellipse cx="${128 + rx - 2}" cy="${cy + 8}" rx="9" ry="13" fill="${skin}"/>` +
  `<ellipse cx="128" cy="${cy}" rx="${rx}" ry="${ry}" fill="${skin}"/>`;
const nose = (skin: string, y = 122) => line(`M130 ${y - 10} Q140 ${y + 6} 128 ${y + 8}`, 4, mix(skin, "#000000", 0.3));
const dotEyes = (y = 112, gap = 19) => `<ellipse cx="${128 - gap}" cy="${y}" rx="4.5" ry="6" fill="${LINE}"/><ellipse cx="${128 + gap}" cy="${y}" rx="4.5" ry="6" fill="${LINE}"/>`;
const brows = (y = 98, gap = 19) => line(`M${128 - gap - 9} ${y + 2} Q${128 - gap} ${y - 4} ${128 - gap + 9} ${y} M${128 + gap - 9} ${y} Q${128 + gap} ${y - 4} ${128 + gap + 9} ${y + 2}`, 4);
const clip = (id: string, shape: string, inner: string) => `<clipPath id="${id}">${shape}</clipPath><g clip-path="url(#${id})">${inner}</g>`;

const SKIN = { light: "#f6cfa8", tan: "#e0a676", brown: "#b0703f", deep: "#6e4127" };

export const archetypes: Character[] = [
  {
    id: "painter",
    name: "Painter",
    background: "#3a86ff",
    body:
      clip(
        "painter-shirt",
        torso("#fff"),
        torso("#fff") + [196, 212, 228, 244].map((y) => `<rect x="0" y="${y}" width="256" height="7" fill="#1d3557"/>`).join(""),
      ) +
      neck(SKIN.light) +
      `<path d="M78 110 Q74 150 96 166 L96 120 Z M178 110 Q182 150 160 166 L160 120 Z" fill="#6f4518"/>` +
      head(SKIN.light) +
      `<path d="M92 150 Q128 196 164 150 Q160 176 128 182 Q96 176 92 150 Z" fill="#6f4518"/>` +
      `<path d="M104 142 Q116 132 128 140 Q140 132 152 142 Q140 150 128 145 Q116 150 104 142 Z" fill="#6f4518"/>` +
      dotEyes() +
      brows() +
      nose(SKIN.light, 120) +
      `<ellipse cx="122" cy="70" rx="62" ry="22" transform="rotate(-10 122 70)" fill="#e63946"/><rect x="132" y="38" width="7" height="14" rx="3" fill="#e63946"/>` +
      `<path d="M150 256 Q138 212 182 204 Q234 196 238 236 L238 256 Z" fill="#e9c46a"/>` +
      `<ellipse cx="170" cy="226" rx="8" ry="6" fill="#c9a227"/>` +
      [["#ef476f", 196, 216], ["#06d6a0", 216, 222], ["#118ab2", 208, 240], ["#ffd166", 226, 244]].map(([c, x, y]) => `<circle cx="${x}" cy="${y}" r="8" fill="${c}"/>`).join("") +
      line("M58 250 L98 176", 8, "#8b5a2b") +
      `<path d="M98 176 L106 160 Q110 154 112 162 L104 180 Z" fill="#118ab2"/>` +
      `<ellipse cx="70" cy="230" rx="17" ry="20" fill="${SKIN.light}"/>`,
  },
  {
    id: "chef",
    name: "Chef",
    background: "#ffb703",
    body:
      torso("#f8f9fa") +
      line("M128 196 L150 256", 4, "#ced4da") +
      [[110, 214], [110, 238], [168, 214], [168, 238]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5" fill="#adb5bd"/>`).join("") +
      neck(SKIN.brown) +
      `<path d="M104 184 L152 184 L128 214 Z" fill="#e63946"/>` +
      head(SKIN.brown, 124) +
      `<rect x="86" y="58" width="84" height="26" fill="#fff"/>` +
      `<circle cx="96" cy="50" r="24" fill="#fff"/><circle cx="128" cy="36" r="28" fill="#fff"/><circle cx="160" cy="50" r="24" fill="#fff"/>` +
      line("M86 84 L170 84", 3, "#dee2e6") +
      line("M100 118 Q109 110 118 118 M138 118 Q147 110 156 118", 4) +
      nose(SKIN.brown, 128) +
      `<path d="M98 148 Q112 136 128 146 Q144 136 158 148 Q164 156 172 150 Q164 164 150 156 Q140 152 128 152 Q116 152 106 156 Q92 164 84 150 Q92 156 98 148 Z" fill="${LINE}"/>` +
      line("M114 164 Q128 172 142 164", 4) +
      line("M200 256 L222 168", 8, "#c68642") +
      `<ellipse cx="224" cy="156" rx="13" ry="18" transform="rotate(14 224 156)" fill="#c68642"/>` +
      `<ellipse cx="206" cy="236" rx="16" ry="18" fill="${SKIN.brown}"/>`,
  },
  {
    id: "explorer",
    name: "Explorer",
    background: "#2a9d8f",
    body:
      torso("#c9a66b") +
      `<rect x="62" y="214" width="40" height="34" rx="4" fill="#b08d54"/><rect x="154" y="214" width="40" height="34" rx="4" fill="#b08d54"/>` +
      line("M62 222 L102 222 M154 222 L194 222", 3, "#8f6f3c") +
      `<path d="M110 190 L128 214 L146 190 Z" fill="#8f6f3c"/>` +
      neck(SKIN.tan) +
      head(SKIN.tan, 122) +
      `<path d="M74 86 Q76 28 128 26 Q180 28 182 86 Z" fill="#e9d8a6"/>` +
      line("M128 28 L128 84 M102 34 Q96 60 96 84 M154 34 Q160 60 160 84", 3, "#d4c08a") +
      `<rect x="76" y="76" width="104" height="10" fill="#6f4518"/>` +
      `<ellipse cx="128" cy="88" rx="74" ry="12" fill="#d4c08a"/>` +
      `<rect x="88" y="98" width="80" height="34" rx="10" fill="${LINE}"/>` +
      `<circle cx="106" cy="116" r="21" fill="${LINE}"/><circle cx="150" cy="116" r="21" fill="${LINE}"/>` +
      `<circle cx="106" cy="116" r="13" fill="#4cc9f0"/><circle cx="150" cy="116" r="13" fill="#4cc9f0"/>` +
      line("M100 110 L106 104 M144 110 L150 104", 3, "#fff") +
      `<ellipse cx="96" cy="148" rx="16" ry="12" fill="${SKIN.tan}"/><ellipse cx="160" cy="148" rx="16" ry="12" fill="${SKIN.tan}"/>` +
      `<ellipse cx="128" cy="160" rx="7" ry="8" fill="${LINE}"/>`,
  },
  {
    id: "rocker",
    name: "Rocker",
    background: "#7209b7",
    body:
      Array.from({ length: 13 }, (_, i) => {
        const a = Math.PI * (0.9 + (i / 12) * 1.2);
        return `<circle cx="${(128 + Math.cos(a) * 62).toFixed(1)}" cy="${(126 + Math.sin(a) * 62).toFixed(1)}" r="26" fill="#1d1b2b"/>`;
      }).join("") +
      `<circle cx="72" cy="168" r="24" fill="#1d1b2b"/><circle cx="184" cy="168" r="24" fill="#1d1b2b"/>` +
      torso("#1d1b2b") +
      `<path d="M96 190 L128 256 L72 256 L60 206 Z M160 190 L128 256 L184 256 L196 206 Z" fill="#3d3d4e"/>` +
      `<path d="M110 192 L146 192 L128 236 Z" fill="#ef233c"/>` +
      neck(SKIN.deep) +
      head(SKIN.deep, 124) +
      `<path d="M80 108 Q86 62 128 62 Q170 62 176 108 Q150 84 128 96 Q106 84 80 108 Z" fill="#1d1b2b"/>` +
      `<circle cx="108" cy="122" r="15" fill="#ff70a6"/><circle cx="148" cy="122" r="15" fill="#ff70a6"/>` +
      line("M123 120 L133 120", 4) +
      line("M100 116 L106 112 M140 116 L146 112", 3, "#fff") +
      `<path d="M106 152 Q128 174 150 152 Z" fill="#fff" stroke="${LINE}" stroke-width="4" stroke-linejoin="round"/>` +
      `<g transform="rotate(-28 210 200)"><rect x="200" y="120" width="20" height="150" fill="#8b5a2b"/>` +
      line("M200 148 L220 148 M200 172 L220 172 M200 196 L220 196 M200 220 L220 220", 2, "#e9c46a") +
      `<rect x="194" y="96" width="32" height="30" rx="6" fill="#1d1b2b"/>` +
      `<circle cx="190" cy="104" r="4" fill="#e9ecef"/><circle cx="190" cy="118" r="4" fill="#e9ecef"/><circle cx="230" cy="104" r="4" fill="#e9ecef"/><circle cx="230" cy="118" r="4" fill="#e9ecef"/></g>`,
  },
  {
    id: "scientist",
    name: "Scientist",
    background: "#ff6b6b",
    body:
      torso("#f8f9fa") +
      `<path d="M96 188 L128 250 L160 188 Z" fill="#2a9d8f"/>` +
      line("M96 188 L128 250 L160 188", 4, "#ced4da") +
      neck(SKIN.deep) +
      `<circle cx="128" cy="54" r="22" fill="#1d1b2b"/>` +
      head(SKIN.deep, 122) +
      `<path d="M80 112 Q80 66 128 66 Q176 66 176 112 Q160 84 128 84 Q96 84 80 112 Z" fill="#1d1b2b"/>` +
      line("M78 92 Q128 74 178 92", 8, "#ffd166") +
      `<rect x="92" y="78" width="30" height="22" rx="10" fill="#bde0fe" stroke="#ffd166" stroke-width="5"/><rect x="134" y="78" width="30" height="22" rx="10" fill="#bde0fe" stroke="#ffd166" stroke-width="5"/>` +
      dotEyes(122) +
      nose(SKIN.deep, 130) +
      line("M114 154 Q128 166 142 154", 4) +
      `<path d="M176 156 L176 182 L152 230 Q148 244 162 244 L214 244 Q228 244 224 230 L200 182 L200 156 Z" fill="#e0fbfc" fill-opacity=".9" stroke="${LINE}" stroke-width="4" stroke-linejoin="round"/>` +
      `<path d="M163 208 L213 208 L222 232 Q224 240 214 240 L162 240 Q152 240 155 232 Z" fill="#80ed99"/>` +
      `<rect x="170" y="150" width="36" height="9" rx="4" fill="${LINE}"/>` +
      `<circle cx="182" cy="222" r="4" fill="#fff" opacity=".8"/><circle cx="196" cy="230" r="3" fill="#fff" opacity=".8"/>` +
      `<circle cx="192" cy="134" r="6" fill="none" stroke="#fff" stroke-width="3"/><circle cx="204" cy="114" r="4" fill="none" stroke="#fff" stroke-width="3"/>` +
      `<ellipse cx="160" cy="244" rx="17" ry="13" fill="${SKIN.deep}"/>`,
  },
  {
    id: "racer",
    name: "Racer",
    background: "#ffd60a",
    body:
      clip(
        "racer-flag",
        `<rect x="0" y="0" width="90" height="70" transform="rotate(-14 0 0)"/>`,
        Array.from({ length: 30 }, (_, i) => {
          const x = (i % 6) * 15;
          const y = Math.floor(i / 6) * 15;
          return `<rect x="${x}" y="${y}" width="15" height="15" transform="rotate(-14 0 0)" fill="${(i + Math.floor(i / 6)) % 2 ? "#fff" : "#1d1b2b"}"/>`;
        }).join(""),
      ) +
      torso("#ef233c") +
      `<rect x="110" y="190" width="36" height="66" fill="#fff"/>` +
      `<circle cx="128" cy="120" r="78" fill="#ef233c"/>` +
      clip("racer-stripe", `<circle cx="128" cy="120" r="78"/>`, `<rect x="114" y="30" width="28" height="200" fill="#fff"/>`) +
      `<rect x="70" y="86" width="116" height="18" rx="9" fill="#14213d"/>` +
      `<rect x="74" y="104" width="108" height="56" rx="24" fill="${SKIN.tan}"/>` +
      line("M96 116 L112 120 M160 116 L144 120", 4) +
      dotEyes(130, 18) +
      line("M114 148 Q128 156 142 148", 4) +
      `<path d="M66 156 Q128 192 190 156 L184 180 Q128 206 72 180 Z" fill="#d90429"/>`,
  },
  {
    id: "gamer",
    name: "Gamer",
    background: "#06d6a0",
    body:
      torso("#7b2cbf") +
      `<path d="M78 196 Q128 226 178 196" fill="none" stroke="#5a189a" stroke-width="8"/>` +
      line("M112 210 L108 240 M144 210 L148 240", 4, "#fff") +
      neck(SKIN.light) +
      head(SKIN.light, 122) +
      `<path d="M78 112 Q74 60 128 60 Q182 60 178 112 L166 92 L156 106 L146 86 L128 102 L112 84 L100 104 L90 90 Z" fill="#00b4d8"/>` +
      line("M74 120 Q74 46 128 46 Q182 46 182 120", 12, "#1d1b2b") +
      `<rect x="62" y="104" width="26" height="44" rx="12" fill="#1d1b2b"/><rect x="168" y="104" width="26" height="44" rx="12" fill="#1d1b2b"/>` +
      `<rect x="66" y="112" width="8" height="28" rx="4" fill="#ff006e"/><rect x="182" y="112" width="8" height="28" rx="4" fill="#ff006e"/>` +
      line("M76 146 Q84 168 108 164", 5, "#1d1b2b") +
      `<circle cx="110" cy="164" r="6" fill="#1d1b2b"/>` +
      dotEyes(120) +
      line("M100 106 L118 110 M156 106 L138 110", 4) +
      line("M120 158 Q132 164 144 156", 4) +
      `<path d="M134 160 Q140 172 146 160 Z" fill="#ff5d73"/>` +
      `<path d="M74 214 Q74 194 98 194 L158 194 Q182 194 182 214 L188 240 Q190 256 174 252 L156 232 L100 232 L82 252 Q66 256 68 240 Z" fill="#3d405b"/>` +
      `<rect x="90" y="206" width="20" height="6" rx="2" fill="#e9ecef"/><rect x="97" y="199" width="6" height="20" rx="2" fill="#e9ecef"/>` +
      `<circle cx="160" cy="202" r="5" fill="#ffd166"/><circle cx="170" cy="212" r="5" fill="#ef476f"/><circle cx="150" cy="212" r="5" fill="#06d6a0"/><circle cx="160" cy="222" r="5" fill="#118ab2"/>` +
      `<ellipse cx="72" cy="232" rx="16" ry="18" fill="${SKIN.light}"/><ellipse cx="184" cy="232" rx="16" ry="18" fill="${SKIN.light}"/>`,
  },
  {
    id: "diver",
    name: "Diver",
    background: "#0077b6",
    body:
      [[44, 70, 10], [60, 44, 6], [214, 150, 9], [222, 120, 6], [40, 150, 5]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="#caf0f8" stroke-width="3"/>`).join("") +
      torso("#1d1b2b") +
      line("M40 236 Q128 196 216 236", 10, "#4cc9f0") +
      `<ellipse cx="128" cy="118" rx="60" ry="68" fill="#1d1b2b"/>` +
      `<ellipse cx="128" cy="126" rx="46" ry="52" fill="${SKIN.tan}"/>` +
      `<rect x="70" y="92" width="116" height="52" rx="22" fill="#fb8500"/>` +
      `<rect x="80" y="100" width="96" height="36" rx="15" fill="#a2e8f5"/>` +
      `<circle cx="108" cy="118" r="9" fill="#fff"/><circle cx="148" cy="118" r="9" fill="#fff"/>` +
      `<circle cx="110" cy="119" r="5" fill="${LINE}"/><circle cx="150" cy="119" r="5" fill="${LINE}"/>` +
      line("M88 108 L100 104", 4, "#fff") +
      `<ellipse cx="98" cy="160" rx="12" ry="9" fill="${mix(SKIN.tan, "#ff4f7b", 0.3)}"/><ellipse cx="158" cy="160" rx="12" ry="9" fill="${mix(SKIN.tan, "#ff4f7b", 0.3)}"/>` +
      line("M190 60 Q192 140 176 162 L150 166", 10, "#ffd60a") +
      `<rect x="140" y="158" width="18" height="16" rx="5" fill="#ffd60a"/>` +
      `<circle cx="196" cy="42" r="8" fill="none" stroke="#caf0f8" stroke-width="3"/><circle cx="206" cy="24" r="5" fill="none" stroke="#caf0f8" stroke-width="3"/>`,
  },
];
