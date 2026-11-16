/**
 * Subtitle files from add-ons (SubRip mostly, sometimes WebVTT or ASS/SSA) as WebVTT, in
 * plain TypeScript: the cloud server has no ffmpeg. Styling is dropped (the apps draw
 * plain lines in the system's caption style), so the text has no tags or entities.
 */
export function toWebVtt(bytes: Uint8Array): string {
  const text = decode(bytes).replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  // WebVTT's NOTE, STYLE and REGION blocks have no timing line, so blockCues skips them.
  const cues = /^\s*\[Script Info\]/im.test(text) || /^Dialogue:/m.test(text) ? assCues(text) : blockCues(text);
  if (!cues.length) throw new Error("No subtitle lines found in that file");
  return `WEBVTT\n\n${cues
    .sort((a, b) => a.start - b.start)
    .map((c) => `${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}`)
    .join("\n\n")}\n`;
}

interface Cue {
  start: number;
  end: number;
  text: string;
}

/** UTF-8 (or UTF-16 with a byte-order mark); anything that isn't valid UTF-8 as Windows-1252, the usual older encoding. */
function decode(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder("windows-1252").decode(bytes);
    } catch {
      return Array.from(bytes, (b) => String.fromCharCode(b)).join("");
    }
  }
}

const TIMING = /(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})\s*-->\s*(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})/;

const ms = (h: string | undefined, m: string, s: string, frac: string) => ((Number(h ?? 0) * 60 + Number(m)) * 60 + Number(s)) * 1000 + Number(frac.padEnd(3, "0"));

/** SubRip and WebVTT share a shape: blocks of an optional id, a timing line, then text. */
function blockCues(text: string): Cue[] {
  const cues: Cue[] = [];
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split("\n");
    const at = lines.findIndex((l) => TIMING.test(l));
    if (at < 0) continue;
    const t = TIMING.exec(lines[at]!)!;
    const start = ms(t[1], t[2]!, t[3]!, t[4]!);
    const end = ms(t[5], t[6]!, t[7]!, t[8]!);
    const body = clean(lines.slice(at + 1).join("\n"));
    if (body && end > start) cues.push({ start, end, text: body });
  }
  return cues;
}


/** ASS/SSA: the Dialogue lines of [Events], by the columns its Format line names. */
function assCues(text: string): Cue[] {
  let columns = ["layer", "start", "end", "style", "name", "marginl", "marginr", "marginv", "effect", "text"];
  const cues: Cue[] = [];
  let inEvents = false;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (/^\[.*\]$/.test(trimmed)) {
      inEvents = /^\[events\]$/i.test(trimmed);
      continue;
    }
    if (!inEvents) continue;
    if (/^format:/i.test(trimmed)) {
      columns = trimmed.slice(7).split(",").map((c) => c.trim().toLowerCase());
      continue;
    }
    if (!/^dialogue:/i.test(trimmed)) continue;
    // Text is the last column and may itself hold commas.
    const parts = trimmed.slice(9).split(",");
    const fields = [...parts.slice(0, columns.length - 1), parts.slice(columns.length - 1).join(",")].map((f) => f.trim());
    const get = (name: string) => fields[columns.indexOf(name)];
    const start = assTime(get("start"));
    const end = assTime(get("end"));
    const { text: raw, drawing } = stripMarkup(get("text") ?? "");
    // Drawings ({\p1}…) are shapes, not words.
    if (drawing) continue;
    const body = clean(raw.replace(/\\[Nn]/g, "\n").replace(/\\h/g, " "));
    if (start !== null && end !== null && body && end > start) cues.push({ start, end, text: body });
  }
  return cues;
}

function assTime(value?: string): number | null {
  const m = value && /^(\d+):(\d{2}):(\d{2})[.,](\d{1,3})$/.exec(value);
  return m ? ms(m[1], m[2]!, m[3]!, m[4]!) : null;
}

/**
 * The text without {…} blocks (ASS overrides like {\an8}) and <…> tags, in one pass over it
 * (a file is untrusted: no pattern that backtracks over a long line); `drawing` when a
 * block turns on shape drawing ({\p1}).
 */
function stripMarkup(text: string): { text: string; drawing: boolean } {
  const parts: string[] = [];
  let drawing = false;
  // Once a kind of bracket has no closing one ahead, it never will: stop looking.
  const unclosed = { "{": false, "<": false };
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if ((ch !== "{" && ch !== "<") || unclosed[ch]) continue;
    const close = text.indexOf(ch === "{" ? "}" : ">", i + 1);
    if (close < 0) {
      unclosed[ch] = true;
      continue;
    }
    if (ch === "{" && /\\p[1-9]/.test(text.slice(i + 1, close))) drawing = true;
    parts.push(text.slice(from, i));
    from = close + 1;
    i = close;
  }
  parts.push(text.slice(from));
  return { text: parts.join(""), drawing };
}

/** Plain lines: no ASS overrides ({\an8}), HTML-ish tags or entities, no blank lines. */
function clean(text: string): string {
  return stripMarkup(text)
    .text.replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    // "-->" would read as a timing line; a blank line would end the cue.
    .map((l) => l.replace(/-->/g, "->"))
    .join("\n");
}

function stamp(total: number): string {
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const f = total % 1000;
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(h)}:${two(m)}:${two(s)}.${String(f).padStart(3, "0")}`;
}
