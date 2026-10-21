# Demo server

A Strata server with a library of public-domain films and TV episodes, for App Store
screenshots, App Review and trying the apps without your own media.

```sh
bun scripts/demo/fetch-media.ts                  # ~210 MB of 3-minute clips from archive.org
TMDB_API_KEY=… bun scripts/demo/serve.ts         # http://<this machine>:8460
```

Sign in as **Alex** / **demo-password** (profiles: Alex, Sam, Kids). Every catalog list
(trending, new, popular, "More Like This") is limited to the demo library, so no current
titles show up; anime rails are empty. The server's data lives in a temporary folder and
starts fresh each run.

Films: Night of the Living Dead, Nosferatu, The General, His Girl Friday, Sherlock Jr.,
Detour, Carnival of Souls. Episodes: The Beverly Hillbillies and Bonanza (season 1). All
are public domain in the US, as listed by the Internet Archive.
