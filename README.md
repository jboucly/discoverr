# discoverr

🇫🇷 [Version française](README_fr.md)

**Spotify's "Discover Weekly", but in your Plex library.**

Every week, discoverr picks tracks you have never listened to based on your **Last.fm** history, downloads them with [pickarr](https://gitlab.com/dhmetha/pickarr) (FLAC via Soulseek when available, YouTube otherwise), and replaces a playlist in **Plex**. The following week, what you liked (❤️ in Plexamp) joins your library and the rest is deleted: no useless files pile up.

- Web UI: current week, review with audio previews, history, statistics, service health, settings.
- Multiple profiles: each Plex user has their own Last.fm account, ❤️ and playlist.
- Cautious by design: nothing is ever deleted outside the discoveries folder, and when in doubt the file is kept.
- Discord notifications, password, API key for scripts.

---

## Contents

- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Installation](#installation)
- [Getting started](#getting-started)
- [The interface](#the-interface)
- [Profiles and Plex accounts](#profiles-and-plex-accounts)
- [Cleanup, and what makes it safe](#cleanup-and-what-makes-it-safe)
- [Configuration](#configuration)
- [API](#api)
- [Remote access](#remote-access)
- [Development](#development)
- [Known limitations](#known-limitations)
- [Credits and licenses](#credits-and-licenses)

---

## How it works

```
          Last.fm                 YouTube Music + Deezer            pickarr-discovery              Plex
   (your scrobbles, similar ──►  (track link, 30 s         ──►   (Soulseek, else YouTube,   ──►  "Discoveries"
    tracks and artists)           preview, cover art)              Deezer tags, filing)            playlist
```

Every week (Monday 3 AM by default), for each active profile:

1. **Selection.** discoverr starts from your top tracks, loved tracks and recent scrobbles on Last.fm, then looks for:
   - **similar tracks** (`track.getSimilar`);
   - **artists you have never listened to**, close to your favorites (30% by default).

   It excludes what you have already listened to, what is already in Plex, what was already suggested to you, and blocked artists. It keeps at most 2 tracks per artist.
2. **Review** (optional). If the profile is in review mode, the selection waits in the UI. You listen to the previews, discard what you don't fancy, then approve. Without any action, it is auto-approved after 48 h.
3. **Download.** Each track is sent to a dedicated pickarr instance, which imports it into `Musiques/Decouvertes`.
4. **Playlist.** The profile's Plex playlist is emptied, then filled with the new tracks. It is the same playlist every week, so it stays pinned in Plexamp.
5. **Cleanup of the previous week**, once the new playlist is in place:
   - **kept**: ❤️ tracks (rating ≥ 10), tracks marked "Keep" in the UI, and tracks added to another of your playlists. They are moved to your folder (`Musiques/pickarr` by default) and their rating is preserved;
   - **deleted**: all the others, file and empty folders included.

### Why a dedicated pickarr instance?

pickarr only writes to a single folder. By dedicating an instance that writes to `Musiques/Decouvertes`, everything discoverr downloads is isolated. discoverr can then refuse any deletion elsewhere: your main library is out of reach.

Once pickarr can write to a per-link subfolder, the `PICKARR_SUBFOLDER` variable will allow using a single instance, without code changes.

---

## Requirements

| What | Why |
|---|---|
| **Plex** with a Music library | Playlist, ❤️, playback via Plexamp |
| **A Last.fm account receiving your plays** (scrobbling) | No history, no recommendations. Enable scrobbling from Plex/Plexamp or a tool like [multi-scrobbler](https://github.com/FoxxMD/multi-scrobbler). |
| **A Last.fm API key** | Free: <https://www.last.fm/api/account/create> |
| **pickarr** | Downloading and tagging. The example compose file starts an instance. |
| **slskd** (optional) | To get FLAC via Soulseek. Without it, pickarr falls back to YouTube / SoundCloud. |
| **Docker** | amd64 or arm64 |

---

## Installation

### 1. Folders

discoverr needs your music folder mounted **as is**, with at least:

```
Musiques/
├── Decouvertes/   ← created for discoverr: only the tracks currently on trial
└── pickarr/       ← (or any other) where liked tracks land
```

```bash
mkdir -p /mnt/media/Musiques/Decouvertes ./appdata/discoverr ./appdata/pickarr-discovery
chown -R 1000:1000 ./appdata /mnt/media/Musiques/Decouvertes
```

Containers run with UID/GID 1000.

### 2. Plex

In your Music library (**Edit → Add folders**), add:
- `Musiques/Decouvertes`;
- the liked-tracks folder, if it isn't already there.

### 3. Variables

```bash
cp .env.example .env
```

Fill in at least:
- `MUSIC_DIR`
- `PLEX_MUSIC_ROOT`: the same folder, as seen by Plex
- `DISCOVERR_PASSWORD`
- `LASTFM_USER`
- `LASTFM_API_KEY`
- `PLEX_TOKEN`
- `PICKARR_PASSWORD`
- `DISCOVERY_PICKARR_API_KEY`: generate with `openssl rand -hex 24`

Each variable is detailed in [Configuration](#configuration).

> **Finding your Plex token:**
> ```bash
> docker exec plex grep -o 'PlexOnlineToken="[^"]*"' "/config/Library/Application Support/Plex Media Server/Preferences.xml"
> ```
> Alternatively: in Plex Web, open a media item, then **⋯ → Get Info → View XML**, and grab the `X-Plex-Token` value from the URL.

### 4. Run

```bash
docker compose -f docker-compose.example.yml up -d
```

The UI is at **http://&lt;your-server&gt;:8091**.

> The example assumes Plex runs on the same host with `network_mode: host`, reachable at `host.docker.internal:32400`. Adjust `PLEX_URL` and `Pickarr__Plex__Url` otherwise.

---

## Getting started

1. **Log in** with `DISCOVERR_PASSWORD`.
2. Open **Health** (État): everything should be green (Plex, pickarr, Last.fm, folders, Plex libraries, disk space). Each error tells you what to fix.
3. The first boot is in **dry-run mode**. In **Week** (Semaine), click **Run now**: you see what would have been suggested, but nothing is downloaded or deleted.
4. If you like the selection, go to **Settings** (Réglages), uncheck **Dry-run mode** and run again.
5. Listen to your playlist in Plexamp and ❤️ what you want to keep. The rest will disappear on the next run.

> The UI is in French; English page names are given here with the French label in parentheses.

---

## The interface

| Page | Content |
|---|---|
| **Week** (Semaine) | Progress of the current run. Selection to review, with 30 s previews, "Discard" and "Block artist" buttons. Current playlist, with ❤️ state read live from Plex and a "Keep" button. Resume an interrupted download. |
| **History** (Historique) | Each week (kept and deleted tracks) and each run, with duration and any error. |
| **Statistics** (Statistiques) | ❤️ rate overall, per week, and per origin (tracks close to your listening or new artists). Download success, FLAC share, audio sources, most-kept artists. |
| **Health** (État) | Live check of everything a run needs, and real-time log. |
| **Settings** (Réglages) | Profiles, schedule, selection, cleanup, dry run, Discord notifications, blocked artists. |

---

## Profiles and Plex accounts

A **profile** ties together:
- a Last.fm account;
- a Plex playlist;
- a number of tracks;
- a folder for liked tracks;
- optionally, review mode.

On Plex, ❤️ and playlists are **specific to each account**. For another household member, create a profile and enter **their** Plex token:
- their playlist will be created on their account;
- only **their** ❤️ count for their cleanup.

Without a token, the profile uses the admin account (`PLEX_TOKEN`).

**The same track suggested to two profiles** is downloaded only once. It is only deleted when no profile has it in progress anymore.

---

## Cleanup, and what makes it safe

Cleanup deletes files: it is designed to err on the side of caution.

- **Scope:** nothing is ever deleted outside the discoveries folder. The real path is checked, with symlinks resolved. The liked-tracks folder cannot be placed inside the discoveries folder.
- **When in doubt, keep:** if Plex doesn't respond, cleanup doesn't run. If a track can't be found in Plex, it is set aside ("cleanup postponed") and retried on the next run. Each time, you get a Discord notification.
- **The rating survives the move:** Plex sometimes sees a moved file as a new item. discoverr therefore re-applies the rating, and the track stays in ❤️ Tracks.
- **Dry run:** in dry-run mode, everything is logged and nothing is touched.
- **Resume after interruption:** a download stopped by a restart or a pickarr failure resumes on startup, or via "Resume". Tracks already sent are not resent.

---

## Configuration

### Environment variables

Only secrets, URLs and paths live in the environment. Everything else is set in the UI, without restarting.

| Variable | Default | Purpose |
|---|---|---|
| `DISCOVERR_PASSWORD` | *(empty)* | UI password. Empty: open UI (a warning is logged). Changing it closes all sessions. |
| `DISCOVERR_API_KEY` | *(empty)* | Key for scripts, sent in the `X-Api-Key` header. Empty: disabled. |
| `LASTFM_API_KEY` | — | Last.fm API key. **Required.** |
| `PLEX_URL` | `http://host.docker.internal:32400` | Plex address. |
| `PLEX_TOKEN` | — | Admin token (scans, trash, profiles without a token). **Required.** |
| `PICKARR_URL` | `http://pickarr-discovery:8080` | Discovery pickarr instance. |
| `PICKARR_API_KEY` | — | Its API key (`Pickarr__ApiKey`). **Required.** |
| `PICKARR_LIBRARY_SUBDIR` | `Decouvertes` | Folder, under `MUSIC_ROOT`, matching this pickarr instance's library folder. |
| `PICKARR_SUBFOLDER` | *(empty)* | Subfolder of the pickarr library sent with each link (e.g. `Decouvertes`), to use the main pickarr instead of a dedicated one. Then `DISCOVERY_SUBDIR` must be `PICKARR_LIBRARY_SUBDIR/PICKARR_SUBFOLDER`. |
| `ALLOW_DELETE_IN_PICKARR_LIBRARY` | `false` | Required (`true`) for the cleanup to delete files when discoveries live inside a shared pickarr library (`DISCOVERY_SUBDIR` ≠ `PICKARR_LIBRARY_SUBDIR`). Otherwise unliked tracks are kept as pending. |
| `MUSIC_ROOT` | `/music` | The music folder, as seen by discoverr. |
| `PLEX_MUSIC_ROOT` | `/media/Musiques` | The same folder, as seen by Plex. |
| `DISCOVERY_SUBDIR` | `Decouvertes` | Discoveries folder, under `MUSIC_ROOT`. |
| `TZ` | `Europe/Paris` | Schedule time zone. |
| `LASTFM_USER` | — | *First boot:* creates the "Moi" profile with this account. |
| `DRY_RUN` | — | *First boot:* enables dry-run mode. |
| `DATA_DIR` | `/data` | SQLite database and session key. |

### Settings (in the UI)

| Setting | Default | Purpose |
|---|---|---|
| Automatic run | yes | For all active profiles. |
| When | `0 3 * * 1` | Cron expression (Monday 3 AM). |
| New artists share | 30% | The rest: tracks close to your listening. |
| Max tracks per artist | 2 | Per week. |
| Auto-approve after | 48 h | Profiles in review mode; 0 = wait forever. |
| Max download wait | 6 h | Beyond that, unfinished tracks count as failures. |
| Minimum rating to keep | 10 | Plexamp ❤️ = 10; a star rating ranges from 2 to 10. |
| Keep tracks added to another playlist | yes | Even without ❤️. |
| Dry-run mode | — | Nothing is downloaded, moved or deleted. |
| Discord webhook | — | Failures, warnings and weekly summary (can be disabled). |

---

## API

The whole UI is built on a JSON API under `/api`. Scripts authenticate with the `X-Api-Key: <DISCOVERR_API_KEY>` header.

| Method | Route | |
|---|---|---|
| GET | `/api/health` | Liveness probe (public) |
| GET | `/api/health/details` | Status of each service |
| GET | `/api/status` | Runs in progress, next run, last run per profile |
| POST | `/api/profiles/:id/run` | Run a profile now |
| POST | `/api/profiles/:id/cleanup` | Re-run cleanup only |
| GET | `/api/profiles/:id/weeks` | Weeks and tracks (live ❤️ state for the current week) |
| POST | `/api/weeks/:id/approve` | Approve a selection |
| POST | `/api/weeks/:id/resume` | Resume an interrupted download |
| DELETE | `/api/weeks/:id` | Delete a selection that hasn't been downloaded |
| PATCH | `/api/tracks/:id` | `{ "keep": true }` or `{ "rejected": true }` |
| GET | `/api/profiles/:id/stats` | Statistics |
| GET / PUT | `/api/settings` | Settings |
| GET / POST / PUT / DELETE | `/api/profiles[/:id]` | Profiles (the Plex token is never returned) |
| GET / POST / DELETE | `/api/profiles/:id/blocked` | Blocked artists (`{ "artist": "…" }`) |
| GET | `/api/runs?profileId=` | Run history |
| GET | `/api/logs?after=` | Log |

Example: run profile 1 from a script.

```bash
curl -X POST -H "X-Api-Key: $DISCOVERR_API_KEY" http://localhost:8091/api/profiles/1/run
```

With a (browser) session, mutating requests must carry the `X-Requested-With: discoverr` header (CSRF protection).

---

## Remote access

The UI works over HTTP on the local network. To access it from outside, use an HTTPS reverse proxy (Traefik, Caddy, Cloudflare Tunnel…):
- the session cookie automatically becomes `Secure` when the request arrives over HTTPS;
- the `X-Forwarded-Proto` header is honored.

If you expose it to the Internet, choose a strong password. Ideally add an authentication layer in front (Cloudflare Access, Authelia…). Login is limited to 5 failed attempts per IP every 15 minutes.

---

## Development

```
discoverr/
├── api/        NestJS 11 + Fastify, SQLite (node:sqlite built into Node 22)
│   └── src/
│       ├── discovery/     cycle, cleanup, scheduling, weeks and runs
│       ├── integrations/  Last.fm, YouTube Music, Deezer, pickarr, Plex, Discord
│       ├── profiles/  settings/  stats/  health/  auth/
│       └── db/            connection and migrations
├── web/        Vue 3 + Vite + vue-router
└── Dockerfile  builds the front and the API into a single image
```

```bash
# API (port 3000)
cd api && npm ci
cp ../.env.example .env   # then export the variables, with DATA_DIR and MUSIC_ROOT as local paths
npm run build && npm start

# Front (port 5175, /api proxied to localhost:3000)
cd web && npm ci && npm run dev

# Checks
cd api && npm run typecheck
cd web && npm run typecheck

# Image
docker build -t discoverr .
```

**Database:** migrations live in `api/src/db/migrations.ts` and are applied on startup. Never modify a published one: add a new one.

**CI:** CI (`.github/workflows/docker.yml`) type-checks and builds both parts on every push and pull request, then publishes the image to GHCR:
- `latest` on `main`;
- `X.Y.Z` and `X.Y` on `vX.Y.Z` tags;
- `sha-…` on each commit.

---

## Known limitations

- **Recommendations:** they are only as good as your Last.fm history. A few weeks of scrobbling are needed.
- **YouTube Music links:** search goes through an unofficial library (`ytmusic-api`). A track that can't be found is simply skipped.
- **Deezer previews:** they come from Deezer's public API. If unavailable, the track has no preview, but everything else works.
- **pickarr:** a dedicated instance is required until pickarr can write to a per-link subfolder.
- **One discoverr instance at a time:** state lives in a local SQLite database.

---

## Credits and licenses

discoverr is licensed under the [GNU GPL v3](LICENSE).

- [pickarr](https://gitlab.com/dhmetha/pickarr) by dhmetha: downloading, tagging and importing into Plex.
- [Last.fm API](https://www.last.fm/api), [Deezer API](https://developers.deezer.com/api), [ytmusic-api](https://github.com/zS1L3NT/ts-npm-ytmusic-api) (GPL-3.0 license).

discoverr only finds tracks and hands them to pickarr: it is up to you to make sure what you download complies with the law in your country.
