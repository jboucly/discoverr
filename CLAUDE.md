# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

discoverr builds a weekly "Discover Weekly"-style Plex playlist from Last.fm listening history, downloads the tracks through [pickarr](https://gitlab.com/dhmetha/pickarr), and deletes the ones the user did not ❤️. UI and code comments are in French. See [README.md](README.md) for the user-facing description and [CONTEXT.md](CONTEXT.md) for project history, decisions, what is verified or not, and open items — read it before starting new work.

## Commands

```bash
cd api && npm ci && npm run typecheck   # type-check the API
cd api && npm run build && npm start     # build and run the API (needs the env vars from .env.example)
cd web && npm ci && npm run dev          # Vite dev server on :5175, proxies /api to localhost:3000
cd web && npm run build                  # vue-tsc + vite build
docker build -t discoverr .              # full image (front + API)
```

There is no test suite. CI ([.github/workflows/docker.yml](.github/workflows/docker.yml)) type-checks and builds both packages, then publishes `ghcr.io/<owner>/discoverr` (`latest` on main, semver on `v*` tags).

## Architecture

One container, two packages built by [Dockerfile](Dockerfile):
- [api/](api/) — NestJS 11 on Fastify, CommonJS, SQLite via Node's built-in `node:sqlite` (no native deps; migrations in `src/db/migrations.ts`, append-only). Serves the built front and the JSON API under `/api`.
- [web/](web/) — Vue 3 + Vite + vue-router, no UI library. `npm run dev` proxies `/api` to `localhost:3000`.

Cycle per profile (`discovery/discovery.service.ts`): Last.fm candidates → YouTube Music link + Deezer 30 s preview → week `review` (if the profile has review mode, waits for approval in the UI or auto-approval after `reviewAutoApproveHours`) → `downloading` (picks sent to **pickarr-discovery**, a second pickarr instance writing only to `Musiques/Decouvertes`, needed because pickarr has a single output folder) → `active` (Plex playlist replaced) → then the previous active weeks are cleaned (`discovery/cleanup.service.ts`): tracks rated ≥ `likedMinRating`, kept in the UI, or in another manual playlist are moved to `Musiques/<likedSubdir>` and re-rated; the rest are deleted.

Invariants to preserve:
- Never delete outside `Musiques/Decouvertes` (realpath check); on any doubt (Plex unreachable, item not found) keep the file, mark the track `pending`, and notify Discord. Pending tracks are retried on the next run.
- A file can be shared by several tracks/profiles: only delete it when no other `imported`/`pending` track points to it.
- Per-profile Plex token: ratings (❤️) and playlists are per Plex account; library operations (scan, emptyTrash) use the admin `PLEX_TOKEN`.
- Only secrets, URLs and paths live in env vars; everything else (schedule, profiles, thresholds, Discord webhook) is in the `settings`/`profiles` tables, edited in the UI. `LASTFM_USER` and `DRY_RUN` only seed the first boot.
- Auth: `DISCOVERR_PASSWORD` → signed session cookie (Secure only when the request is HTTPS, so LAN HTTP works, unlike pickarr); `DISCOVERR_API_KEY` via `X-Api-Key` for scripts; mutating requests need `X-Requested-With: discoverr`.
