# App Store listing

The text for App Store Connect, kept here so it's reviewed like code. Limits are
Apple's: name and subtitle 30 characters, promotional text 170, keywords 100,
description 4000.

## Identity

- **Name:** Strata TV *(the record's name; "Strata" alone was taken. The home-screen name is Strata.)*
- **Subtitle:** Your media server, anywhere
- **Bundle ID:** com.sehalsein.strata (iOS, iPadOS, tvOS)
- **Primary category:** Entertainment
- **Secondary category:** Photo & Video
- **Price:** Free
- **Age rating:** answer "None" to every content question, since the app ships no
  content. If App Review objects that it plays whatever a user's server holds, set 17+,
  which is what similar media-server apps use.

## URLs

- **Privacy policy:** https://github.com/Sehalsein/strata/blob/main/PRIVACY.md
- **Support:** https://github.com/Sehalsein/strata/issues
- **Marketing:** https://github.com/Sehalsein/strata

## Promotional text

Browse your movies, shows and anime in one beautiful catalog, and play them from your own
Strata server on iPhone, iPad and Apple TV.

## Description

Strata is the app for your own Strata media server. Point it at the server running on your
Mac or home computer, and your whole library is on your iPhone, iPad and Apple TV.

ONE CATALOG
Browse movies, shows and anime with artwork, ratings, cast and trailers. See what's new and
what's trending, filter by genre, and pick up exactly where you left off with Continue
Watching and Next Up.

MADE FOR EVERY SCREEN
A full-screen experience on Apple TV, built for the Siri Remote. A Liquid Glass design on
iPhone and iPad, with Picture in Picture, AirPlay, subtitles, audio track choice and
playback speed.

PROFILES FOR EVERYONE
Each person gets their own profile, watch history and list. Kids profiles show only what's
right for their age, and a PIN keeps a profile to itself.

SIGN IN WITHOUT TYPING
On your home network, the app finds your server on its own. On Apple TV, scan a code with
your iPhone and you're in.

YOUR SERVER, YOUR DATA
Strata doesn't collect anything about you. Your library, accounts and watch history stay on
the server you run.

Want to try it first? Connect to https://strata-demo.seinsehal.workers.dev and sign in as
demo / strata-demo to browse and play a demo library of public-domain films.

Strata requires a Strata server, which is free and open source:
github.com/Sehalsein/strata. Strata doesn't provide or sell any movies or shows; it plays
media from your own server.

## Keywords

media server,home theater,movies,tv shows,anime,library,self-hosted,stream,player

## What's New (first release)

The first release of Strata for iPhone, iPad and Apple TV.

## App Review notes

Strata is a client for a self-hosted media server; it has no content of its own. For review,
a demo server with public-domain films is available:

- Server address: https://strata-demo.seinsehal.workers.dev
- Username: demo
- Password: strata-demo

iPhone and iPad: type the server address (including https://) on the Connect screen, then
sign in. Apple TV: choose **Enter Address**, type the address, then sign in.
The demo server sleeps when idle, so the first connection can take a few seconds. It is
viewer-only: server settings aren't available to this account.

## Screenshots

Generated from the demo server (`apps/server/scripts/demo`), which plays public-domain
films and shows only. Files go in `AppStore/screenshots/<device>/` (not in git; Apple TV shots come from `testAppStoreScreenshots` in the tvOS UI tests):

| Device | Size | Shots |
|---|---|---|
| iPhone 6.9" | 1320 x 2868 | Home, Title page, Episodes, Player, Profiles |
| iPad 13" | 2064 x 2752 | Home, Title page, Player |
| Apple TV | 1920 x 1080 | Home, Title page, Episodes, Player, Profiles |
