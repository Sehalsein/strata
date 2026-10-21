/* tslint:disable */
/* eslint-disable */
/**
 * One parsed element: its [`ElementKind`], the matched substring, and the
 * element\'s codepoint position in the input.
 */
export interface Element {
    kind: ElementKind;
    value: string;
    position: number;
}

/**
 * The kind of a parsed [`Element`], serialized as the snake_case
 * strings used across every anitomy-ng binding.
 */
export type ElementKind = "audio_term" | "device" | "episode" | "episode_title" | "file_checksum" | "file_extension" | "language" | "other" | "part" | "release_group" | "release_information" | "release_version" | "season" | "source" | "subtitles" | "title" | "type" | "video_resolution" | "video_term" | "volume" | "year";

/**
 * Which element kinds to extract. Every field defaults to `true`; pass
 * a partial object to disable specific kinds, e.g. `{ parse_title: false }`.
 */
export interface Options {
    parse_episode?: boolean;
    parse_episode_title?: boolean;
    parse_file_checksum?: boolean;
    parse_file_extension?: boolean;
    parse_part?: boolean;
    parse_release_group?: boolean;
    parse_season?: boolean;
    parse_title?: boolean;
    parse_video_resolution?: boolean;
    parse_year?: boolean;
}


/**
 * Parse an anime video filename into its elements, ordered by position.
 *
 * `options` is optional; omit it (or pass a partial object) to use the
 * defaults. There may be multiple elements of the same kind (e.g. an episode
 * range yields two `episode` elements).
 */
export function parse(filename: string, options?: Options | null): Element[];

/**
 * Parse a single filename that may carry a directory prefix, so the result
 * describes the file rather than the folder.
 *
 * `parse` leaves a path's separators and duplicated folder text in the title;
 * this strips a real directory prefix and recovers a title that lives only in
 * the parent folder. Without a prefix it is exactly `parse`, and a separator
 * inside a title (`Fate/stay night`) is left alone. For a set of related files,
 * prefer `parse_together`.
 */
export function parse_path(path: string, options?: Options | null): Element[];

/**
 * Parse a set of related filenames together, returning one `Element[]` per
 * input in the same order (result `i` is for `filenames[i]`).
 *
 * The shared context resolves ambiguities a single filename can't — e.g. a
 * directory batch range vs. the real per-file episode, or a series title that
 * lives only in a parent folder. `options` is optional, as in `parse`.
 */
export function parse_together(filenames: string[], options?: Options | null): Element[][];
