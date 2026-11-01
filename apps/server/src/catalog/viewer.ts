import { HTTPException } from "hono/http-exception";
import type { Household } from "../household";
import type { MediaInfo } from "../media/probe";
import type { PlayRequest } from "../playback/service";
import type { DiscoveryTarget } from "../sources/discovery";
import type { Shelf, TitleType } from "./service";

type Target = { mediaType: "movie" | "episode"; tmdbId: number; season?: number; episode?: number };

const titleType = (mediaType: "movie" | "episode"): TitleType => (mediaType === "movie" ? "movie" : "show");

/**
 * One person's view of their household's catalog: pages, titles, sources, playback and
 * files, with their content limit already applied. Nothing above the limit leaves here,
 * whichever page, card list or file it's asked for, so a route can't forget to check.
 */
export class Viewer {
  constructor(
    private readonly household: Household,
    readonly userId: string,
  ) {}

  home(): Promise<Shelf[]> {
    return this.household.catalog.home(this.userId).then((s) => this.shelves(s));
  }

  genres(type: TitleType) {
    return this.household.catalog.genres(type);
  }

  genreShelves(type: TitleType, genreId: number): Promise<Shelf[]> {
    return this.household.catalog.genreShelves(type, genreId).then((s) => this.shelves(s));
  }

  showsPage(): Promise<Shelf[]> {
    return this.household.catalog.showsPage().then((s) => this.shelves(s));
  }

  animeCategories() {
    return this.household.catalog.animeCategories();
  }

  animePage(category?: string): Promise<Shelf[]> {
    return this.household.catalog.animePage(category).then((s) => this.shelves(s));
  }

  /** My List: the titles on this person's list, newest first. */
  async watchlist() {
    return this.cards(await this.household.catalog.watchlist(this.userId));
  }

  /** Episodes of the shows on this person's list: the last week and the next month. */
  calendar() {
    return this.household.calendar.episodes(this.userId);
  }

  async person(id: number) {
    const person = await this.household.catalog.person(id);
    return { ...person, movies: await this.cards(person.movies), shows: await this.cards(person.shows) };
  }

  async browse(type: TitleType, list: "trending" | "popular" | "topRated" | "library") {
    return this.cards(await this.household.catalog.browse(type, list));
  }

  async search(query: string) {
    return this.cards(await this.household.catalog.search(query));
  }

  async movie(id: number) {
    await this.assertAllowed("movie", id);
    const movie = await this.household.catalog.movie(this.userId, id);
    return { ...movie, recommendations: await this.cards(movie.recommendations) };
  }

  async show(id: number) {
    await this.assertAllowed("show", id);
    const show = await this.household.catalog.show(this.userId, id);
    return { ...show, recommendations: await this.cards(show.recommendations) };
  }

  async season(showId: number, season: number) {
    await this.assertAllowed("show", showId);
    return this.household.catalog.season(this.userId, showId, season);
  }

  /** The library's copies of a title (instant). */
  async sources(target: Target) {
    await this.assertAllowed(titleType(target.mediaType), target.tmdbId);
    return this.household.catalog.sources(target.mediaType, target.tmdbId, target.season, target.episode);
  }

  /** Releases from the scrapers (a few seconds), within the household's hourly allowance. */
  async discover(target: DiscoveryTarget) {
    await this.assertAllowed(titleType(target.mediaType), target.tmdbId);
    await this.household.spendSearch();
    return this.household.discovery.candidates(target);
  }

  async play(req: PlayRequest) {
    await this.assertAllowed(titleType(req.mediaType), req.tmdbId);
    return this.household.playback.play({ userId: this.userId }, req);
  }

  async prepareDownload(req: Omit<PlayRequest, "startMs">) {
    await this.assertAllowed(titleType(req.mediaType), req.tmdbId);
    return this.household.playback.prepareDownload(req);
  }

  /** A fresh link for this person's TorBox play whose link expired; null when there's no such play. */
  async refreshPlayLink(sessionId: string): Promise<string | null> {
    const session = await this.household.plays.mine(this.userId, sessionId);
    if (!session) return null;
    await this.household.playback.refreshLink(session);
    return this.household.playback.handOff(session);
  }

  /** Stops this person's play (someone else's, or one that's over, is left alone). */
  async stopPlay(sessionId: string) {
    if (await this.household.plays.mine(this.userId, sessionId)) await this.household.plays.stop(sessionId);
  }

  /** Keeps this person's play alive while they report progress. */
  async touchPlay(sessionId: string) {
    await this.household.plays.mine(this.userId, sessionId);
  }

  /** May this person have `type`/`tmdbId` on their list? Taking it off always is. */
  async assertMayList(type: TitleType, tmdbId: number, on: boolean) {
    if (on) await this.assertAllowed(type, tmdbId);
  }

  /** A fresh link for a library file (null: it's on this server's disk). */
  async fileLink(fileId: number) {
    await this.assertFile(fileId);
    return this.household.playback.fileLink(fileId);
  }

  /** The path of a library file on this server's disk, or null. */
  async localPath(fileId: number) {
    if (!(await this.fileAllowed(fileId))) return null;
    return this.household.playback.localPath(fileId);
  }

  /** Media info the app read from a file; false when there's no such file for this person. */
  async acceptProbe(fileId: number, info: MediaInfo) {
    if (!(await this.fileAllowed(fileId))) return false;
    return this.household.playback.acceptProbe(fileId, info);
  }

  private maxAge?: Promise<number | null>;

  private limited(): Promise<boolean> {
    this.maxAge ??= this.household.content.maxAge(this.userId);
    return this.maxAge.then((age) => age !== null);
  }

  private async assertAllowed(type: TitleType, tmdbId: number) {
    if (await this.limited()) await this.household.content.assertAllowed(this.userId, type, tmdbId);
  }

  private async cards<T extends { type: TitleType; tmdbId: number }>(cards: T[]): Promise<T[]> {
    return (await this.limited()) ? this.household.content.filter(this.userId, cards) : cards;
  }

  /** Drops titles above the limit, and shelves left empty. */
  private async shelves(shelves: Shelf[]): Promise<Shelf[]> {
    if (!(await this.limited())) return shelves;
    const filtered = await Promise.all(shelves.map(async (shelf) => ({ ...shelf, items: await this.cards(shelf.items) })));
    return filtered.filter((shelf) => shelf.items.length > 0);
  }

  /**
   * A file is as visible as its title. Under a limit, a file that isn't matched to a
   * title yet isn't visible at all.
   */
  private async fileAllowed(fileId: number): Promise<boolean> {
    if (!(await this.limited())) return true;
    const file = await this.household.library.get(fileId);
    if (!file?.mediaType || file.tmdbId == null) return false;
    return this.household.content.allowed(this.userId, titleType(file.mediaType), file.tmdbId);
  }

  private async assertFile(fileId: number) {
    if (!(await this.fileAllowed(fileId))) throw new HTTPException(403, { message: "This title isn't available to this account." });
  }
}
