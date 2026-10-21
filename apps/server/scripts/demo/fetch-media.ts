// Fetches the demo library: 3-minute clips of public-domain films and TV episodes from
// the Internet Archive, named the way Strata expects (Movies/…, Shows/<Show>/Season 01/…).
// Only the clip is downloaded (ffmpeg reads the needed byte ranges and copies streams).
//
//   bun scripts/demo/fetch-media.ts [--out ~/StrataDemo/media]
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

interface Clip {
  /** archive.org item and file */
  item: string;
  file: string;
  /** Where in the library it goes. */
  path: string;
  /** Start of the 3-minute clip, in seconds. */
  start: number;
}

const CLIPS: Clip[] = [
  { item: "night_of_the_living_dead_dvd", file: "VTS_01_2.mp4", path: "Movies/Night of the Living Dead (1968).mp4", start: 120 },
  { item: "Nosferatu_most_complete_version_93_mins.", file: "Nosferatu_1922_Symphony_of_Horror_512kb.mp4", path: "Movies/Nosferatu (1922).mp4", start: 900 },
  { item: "The_General_Buster_Keaton", file: "The_General.mp4", path: "Movies/The General (1926).mp4", start: 1800 },
  { item: "his_girl_friday", file: "his_girl_friday.mp4", path: "Movies/His Girl Friday (1940).mp4", start: 300 },
  { item: "sherlockjr1924_201909", file: "Sherlock Jr. - Buster Keaton (1924) HD [720p].mp4", path: "Movies/Sherlock Jr. (1924).mp4", start: 600 },
  { item: "Detour", file: "Detour.mp4", path: "Movies/Detour (1945).mp4", start: 240 },
  { item: "CarnivalofSouls", file: "CarnivalOfSouls.mp4", path: "Movies/Carnival of Souls (1962).mp4", start: 420 },
  { item: "Beverly_Hillbillies_Ep01_The_Clampetts_Strike_Oil", file: "BH01_The_Clampetts_Strike_Oil.mp4", path: "Shows/The Beverly Hillbillies/Season 01/The Beverly Hillbillies - S01E01.mp4", start: 60 },
  { item: "Beverly_Hillbillies_Ep07_The_Servants", file: "BH07_The_Servants.mp4", path: "Shows/The Beverly Hillbillies/Season 01/The Beverly Hillbillies - S01E07.mp4", start: 60 },
  { item: "Beverly_Hillbillies_Ep13_Home_For_Christmas", file: "BH13_Home_For_Christmas.mp4", path: "Shows/The Beverly Hillbillies/Season 01/The Beverly Hillbillies - S01E13.mp4", start: 60 },
  { item: "Bonanza_pd", file: "Bonanza s01e20.mp4", path: "Shows/Bonanza/Season 01/Bonanza - S01E20.mp4", start: 120 },
  { item: "Bonanza_pd", file: "Bonanza s01e21.mp4", path: "Shows/Bonanza/Season 01/Bonanza - S01E21.mp4", start: 120 },
  { item: "Bonanza_pd", file: "Bonanza s01e23.mp4", path: "Shows/Bonanza/Season 01/Bonanza - S01E23.mp4", start: 120 },
];

const outArg = process.argv.indexOf("--out");
const out = outArg > 0 ? process.argv[outArg + 1]! : join(homedir(), "StrataDemo", "media");

for (const clip of CLIPS) {
  const dest = join(out, clip.path);
  if (existsSync(dest)) {
    console.log(`have  ${clip.path}`);
    continue;
  }
  mkdirSync(dirname(dest), { recursive: true });
  const url = `https://archive.org/download/${encodeURIComponent(clip.item)}/${encodeURIComponent(clip.file)}`;
  const tmp = `${dest}.part.mp4`;
  const proc = Bun.spawn(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", String(clip.start), "-i", url, "-t", "180", "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy", "-movflags", "+faststart", tmp], { stderr: "inherit" });
  if ((await proc.exited) !== 0) {
    console.error(`FAILED ${clip.path}`);
    continue;
  }
  await Bun.write(dest, Bun.file(tmp));
  await Bun.file(tmp).delete();
  console.log(`got   ${clip.path} (${Math.round(Bun.file(dest).size / 1048576)} MB)`);
}
