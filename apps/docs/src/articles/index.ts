import type { ComponentType } from "react";
import { AioMetadata, AioStreams, Cinemeta, Comet, Directory, Jackettio, MdbList, MediaFusion, OpenSubtitles, Torrentio } from "./addon-guides";
import { AddonsInstall, AddonsOrder, AddonsPages, AddonsSubtitles } from "./addons";
import { Remote, SettingsReference, Troubleshooting } from "./beyond";
import { Apps, FirstRun } from "./get-started";
import { Install } from "./install";
import { Connections, Folders } from "./library";
import { Passkeys } from "./passkeys";
import { Devices, Invites, Kids } from "./people";

export type Article = { path: string; section: string; title: string; summary: string; keywords?: string; body: ComponentType };

/** Every guide, by section, in reading order (Previous and Next follow it). */
export const SECTIONS: { name: string; blurb: string; articles: Omit<Article, "section">[] }[] = [
  {
    name: "Get started",
    blurb: "The server, setup and the apps",
    articles: [
      { path: "/get-started/install", title: "Install the server", summary: "Run Strata on a Mac or a Linux machine, as an app or a service.", keywords: "mac dmg homebrew linux binary service systemd update", body: Install },
      { path: "/get-started/first-run", title: "First-run setup", summary: "The setup code, the admin account and the wizard, step by step.", keywords: "setup code wizard admin account household", body: FirstRun },
      { path: "/get-started/apps", title: "Connect the apps", summary: "Find your server from iPhone, iPad and Apple TV, and sign in.", keywords: "iphone ipad apple tv connect discovery bonjour qr", body: Apps },
    ],
  },
  {
    name: "Your library",
    blurb: "Your files and the services behind them",
    articles: [
      { path: "/library/folders", title: "Add your media", summary: "Point Strata at your folders, name things so they match, and fix what doesn't.", keywords: "folders scan naming season episode match fix ignore", body: Folders },
      { path: "/library/connections", title: "Connect TMDB, TorBox and OMDb", summary: "Get each key, paste it in, and choose how TorBox syncs.", keywords: "tmdb torbox omdb api key token sync anilist", body: Connections },
    ],
  },
  {
    name: "Add-ons",
    blurb: "More to play, subtitles and rows",
    articles: [
      { path: "/addons/install", title: "Install add-ons", summary: "Add Stremio add-ons for streams, subtitles and catalogs, set up with TorBox.", keywords: "stremio manifest torrentio comet aiostreams mediafusion jackettio configure debrid", body: AddonsInstall },
      { path: "/addons/order", title: "Order, health and sources", summary: "Which add-on Strata asks first, what the lights mean, and choosing a source.", keywords: "order drag health failing paused filters choose source discovery quality", body: AddonsOrder },
      { path: "/addons/pages", title: "Home rows and pages", summary: "Turn catalog add-ons into rows, lay out each page, and use the calendar.", keywords: "pages rows home movies shows anime catalog cinemeta mdblist for you calendar remind", body: AddonsPages },
      { path: "/addons/subtitles", title: "Subtitles", summary: "Fetch subtitles in your languages, and choose when they turn on.", keywords: "subtitles opensubtitles languages foreign", body: AddonsSubtitles },
    ],
  },
  {
    name: "Add-on guides",
    blurb: "Set up each add-on, step by step",
    articles: [
      { path: "/addons/guides", title: "All add-on guides", summary: "Every add-on with a guide, what it adds, and a good set to start with.", keywords: "directory list recommended starter", body: Directory },
      { path: "/addons/guides/aiostreams", title: "AIOStreams", summary: "Combine many stream add-ons into one list, with TorBox.", keywords: "aiostreams aio streams uuid password torbox elfhosted", body: AioStreams },
      { path: "/addons/guides/comet", title: "Comet", summary: "Fast debrid streams, set up with your TorBox key.", keywords: "comet elfhosted torbox debrid", body: Comet },
      { path: "/addons/guides/torrentio", title: "Torrentio", summary: "Your own Torrentio, with TorBox and your filters.", keywords: "torrentio torbox tb+ cached", body: Torrentio },
      { path: "/addons/guides/mediafusion", title: "MediaFusion", summary: "Streams with filters for size, quality and seeders.", keywords: "mediafusion elfhosted torbox", body: MediaFusion },
      { path: "/addons/guides/jackettio", title: "Jackettio", summary: "Streams from the Jackett indexers you run yourself.", keywords: "jackettio jackett self-hosted indexers", body: Jackettio },
      { path: "/addons/guides/opensubtitles", title: "OpenSubtitles v3", summary: "Subtitles in your languages, with nothing to set up.", keywords: "opensubtitles subtitles", body: OpenSubtitles },
      { path: "/addons/guides/cinemeta", title: "Cinemeta", summary: "Stremio's popular and featured catalogs as rows.", keywords: "cinemeta catalogs rows", body: Cinemeta },
      { path: "/addons/guides/aiometadata", title: "AIOMetadata", summary: "Catalogs from TMDB, AniList, MDBList, Trakt and more.", keywords: "aiometadata catalogs mdblist trakt tmdb anilist", body: AioMetadata },
      { path: "/addons/guides/mdblist", title: "MDBList", summary: "Your own MDBList lists as rows in the apps.", keywords: "mdblist lists catalogs api key", body: MdbList },
    ],
  },
  {
    name: "People",
    blurb: "The household, kids and screens",
    articles: [
      { path: "/people/invites", title: "Invite the household", summary: "Invite people with a QR code or link, and choose what they can do.", keywords: "invite qr members roles owner admin sign-in code", body: Invites },
      { path: "/people/kids", title: "Kids and content limits", summary: "Keep each person to the ratings that suit them.", keywords: "kids parental ratings pg limit", body: Kids },
      { path: "/people/devices", title: "TVs and devices", summary: "Sign in an Apple TV without typing, and manage what's signed in.", keywords: "apple tv link code approve devices sign out password home", body: Devices },
      { path: "/people/passkeys", title: "Sign in with a passkey", summary: "Use Face ID, Touch ID or your phone instead of a password.", keywords: "passkey webauthn face id touch id sign in https public url autofill", body: Passkeys },
    ],
  },
  {
    name: "Beyond home",
    blurb: "Remote access, settings and fixes",
    articles: [
      { path: "/beyond/remote", title: "Watch away from home", summary: "Reach your server from outside, safely, or run it in the cloud.", keywords: "remote reverse proxy nginx caddy tunnel tailscale cloud docker cloudflare", body: Remote },
      { path: "/beyond/settings", title: "Settings reference", summary: "Every section of Settings, and what's in it.", keywords: "settings reference server network updates", body: SettingsReference },
      { path: "/beyond/troubleshooting", title: "Troubleshooting", summary: "Fixes for the things most likely to go wrong.", keywords: "troubleshooting error logs debug not found", body: Troubleshooting },
    ],
  },
];

export const ARTICLES: Article[] = SECTIONS.flatMap((s) => s.articles.map((a) => ({ ...a, section: s.name })));
