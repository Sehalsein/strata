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

Your movies, shows and anime from your own home server, beautifully organized and ready
to play on iPhone, iPad and Apple TV.

## Description

Strata is the app for your own Strata media server. It plays the movies and shows stored
on the computer you run Strata on, at home, on your iPhone, iPad and Apple TV.

YOUR LIBRARY, BEAUTIFULLY ORGANIZED
Strata shows your files with artwork, cast, ratings and trailers, sorted into movies,
shows and anime. Pick up exactly where you left off with Continue Watching and Next Up.

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
Strata connects only to the server you choose and plays only what's in that server's
library. It doesn't collect anything about you, and it doesn't provide, sell or stream any
movies or shows of its own.

Want to try it first? Connect to https://strata-demo.seinsehal.workers.dev and sign in as
demo / strata-demo to browse and play a demo library of public-domain films.

Strata requires a Strata server, which is free and open source:
github.com/Sehalsein/strata.

## Keywords

media server,home theater,movies,tv shows,anime,library,self-hosted,stream,player

## What's New (first release)

The first release of Strata for iPhone, iPad and Apple TV.

## App Review notes

Strata is a client for a self-hosted media server. It connects only to the server the user
chooses and plays only media already in that server's library; it has no content, store or
way of obtaining media of its own. For review, a demo server with public-domain films is
available:

- Server address: https://strata-demo.seinsehal.workers.dev
- Username: demo
- Password: strata-demo

iPhone and iPad: type the server address (including https://) on the Connect screen, then
sign in. Apple TV: choose **Enter Address**, type the address, then sign in.
The demo server sleeps when idle, so the first connection can take a few seconds. It is
viewer-only: server settings aren't available to this account.

The demo server is rate limited, per network: about 10 plays and 20 sign-ins an hour,
60 requests a minute, and a few viewers at once across the whole demo. If the app says to
try again later, please wait a few minutes. This limit is on our demo server only; a
user's own server has no such limits.

## Screenshots

Generated from the demo server (`apps/server/scripts/demo`), which plays public-domain
films and shows only. Files go in `AppStore/screenshots/<device>/` (not in git; Apple TV shots come from `testAppStoreScreenshots` in the tvOS UI tests):

| Device | Size | Shots |
|---|---|---|
| iPhone 6.3" | 1206 x 2622 (player: 2622 x 1206, landscape) | Home, Title page, Episodes, Player, Profiles |
| iPad 13" | 2064 x 2752 | Home, Title page, Player |
| Apple TV | 1920 x 1080 | Home, Title page, Episodes, Player, Profiles |
