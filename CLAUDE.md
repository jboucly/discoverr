# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

discoverr builds a weekly "Discover Weekly"-style Plex playlist from Last.fm listening history, downloads the tracks through [pickarr](https://gitlab.com/dhmetha/pickarr), and deletes the ones the user did not ❤️. UI and code comments are in French. See [README.md](README.md) for the user-facing description and [CONTEXT.md](CONTEXT.md) for project history, decisions, what is verified or not, and open items — read it before starting new work.

## Commands

```bash
pnpm install                             # whole workspace (pnpm 10, version pinned in package.json packageManager)
pnpm typecheck                           # api (src + test) and web
pnpm test                                # integration tests (node:test, fake Plex/pickarr over HTTP)
pnpm build                               # both packages
pnpm dev                                 # API (:3000, tsc --watch + node --watch, reads api/.env) and Vite (:5175, proxies /api)
cd api && pnpm build && pnpm start       # run the API once, without watching
docker build -t discoverr .              # full image (front + API)
```

Tests live in `api/test/` (`node:test`, compiled to `dist-test/`): `support/world.ts` wires the real services to a temp database and music folder, a fake Plex that indexes the real files (a moved file becomes a new unrated item) and a fake pickarr; Last.fm, YouTube Music, iTunes and Discord are stubbed. Add a scenario there when changing the cycle or the cleanup. CI ([.github/workflows/docker.yml](.github/workflows/docker.yml)) type-checks, tests and builds both packages, then publishes `ghcr.io/<owner>/discoverr` (`latest` on main, semver on `v*` tags).

## Architecture

A pnpm workspace ([pnpm-workspace.yaml](pnpm-workspace.yaml)) with two packages, built into one container by [Dockerfile](Dockerfile) (`pnpm deploy --prod` extracts the API with its production dependencies). pnpm does not hoist: declare every package you import.
- [api/](api/) — NestJS 11 on Fastify, CommonJS, SQLite via Node's built-in `node:sqlite` (no native deps; migrations in `src/db/migrations.ts`, append-only). Serves the built front and the JSON API under `/api`.
- [web/](web/) — Vue 3 + Vite + vue-router, no UI library. `pnpm dev` proxies `/api` to `localhost:3000`.
- API response types live in [api/src/contracts.ts](api/src/contracts.ts) (types only, no imports) and the front imports them as `discoverr-api/contracts` through [web/src/api.ts](web/src/api.ts). Change a response there, never by redeclaring a type in web/; internal types and `…Dto` (what leaves the API: no Plex token, no file path) are kept separate.

Cycle per profile (`discovery/discovery.service.ts`): Last.fm candidates → YouTube Music link and cover + iTunes 30 s preview (throttled to ~20 calls/min; Deezer is deliberately not used, its CDN blocked the home IP) → week `review` (if the profile has review mode, waits for approval in the UI or auto-approval after `reviewAutoApproveHours`) → `downloading` (picks sent to **pickarr-discovery**, a second pickarr instance writing only to `Musiques/Decouvertes`, needed because pickarr has a single output folder) → `active` (Plex playlist replaced) → then the previous active weeks are cleaned (`discovery/cleanup.service.ts`): tracks rated ≥ `likedMinRating`, kept in the UI, or in another manual playlist are moved to `Musiques/<likedSubdir>` and re-rated; the rest are deleted.

Invariants to preserve:
- Never delete outside `Musiques/Decouvertes` (realpath check); on any doubt (Plex unreachable, item not found) keep the file, mark the track `pending`, and notify Discord. Pending tracks are retried on the next run.
- A file can be shared by several tracks/profiles: only delete it when no other `imported`/`pending` track points to it.
- Per-profile Plex token: ratings (❤️) and playlists are per Plex account; library operations (scan, emptyTrash) use the admin `PLEX_TOKEN`.
- Only secrets, URLs and paths live in env vars; everything else (schedule, profiles, thresholds, Discord webhook) is in the `settings`/`profiles` tables, edited in the UI. `LASTFM_USER` and `DRY_RUN` only seed the first boot.
- Auth: `DISCOVERR_PASSWORD` → signed session cookie (Secure only when the request is HTTPS, so LAN HTTP works, unlike pickarr); `DISCOVERR_API_KEY` via `X-Api-Key` for scripts; mutating requests need `X-Requested-With: discoverr`.
