import "./env";
import { mock } from "node:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as text from "../../src/common/text";
import { trackKey } from "../../src/common/text";
import { DatabaseService } from "../../src/db/database.service";
import { CleanupService } from "../../src/discovery/cleanup.service";
import { DiscoveryService } from "../../src/discovery/discovery.service";
import { RunsRepository } from "../../src/discovery/runs.repository";
import { WeeksRepository } from "../../src/discovery/weeks.repository";
import { discoveryDir, env } from "../../src/env";
import type { Candidate, PickOptions } from "../../src/integrations/lastfm.service";
import { PickarrService } from "../../src/integrations/pickarr.service";
import { PlexService } from "../../src/integrations/plex.service";
import { ProfilesService, type ProfileInput } from "../../src/profiles/profiles.service";
import { SettingsService } from "../../src/settings/settings.service";
import { FakePickarr, FakePlex, serve, ytLink } from "./fakes";

// Les attentes (scan Plex, sondage pickarr, essais HTTP) deviennent instantanées.
mock.method(text as { sleep: (ms: number) => Promise<unknown> }, "sleep", async () => undefined);

export const PLEX_ROOT = "/media/Musiques";

export const candidate = (artist: string, title: string, kind: Candidate["kind"] = "similar"): Candidate => ({
  artist,
  title,
  key: trackKey(artist, title),
  score: 1,
  kind,
});

export interface WorldOptions {
  /** Découvertes dans la bibliothèque du pickarr principal (PICKARR_SUBFOLDER) au lieu d'une instance dédiée. */
  shared?: boolean;
}

/** Une installation complète : vrais services discoverr, base et dossier de musique temporaires, faux Plex et pickarr. */
export async function createWorld(options: WorldOptions = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "discoverr-test-"));
  const musicRoot = path.join(root, "Musiques");

  env.dataDir = path.join(root, "data");
  env.paths.musicRoot = musicRoot;
  env.paths.plexMusicRoot = PLEX_ROOT;
  env.pickarr.librarySubdir = options.shared ? "pickarr" : "Decouvertes";
  env.pickarr.subfolder = options.shared ? "Decouvertes" : "";
  env.paths.discoverySubdir = options.shared ? "pickarr/Decouvertes" : "Decouvertes";
  env.pickarr.allowDeleteInLibrary = false;
  mkdirSync(discoveryDir(), { recursive: true });

  const plex = new FakePlex(musicRoot, PLEX_ROOT);
  const pickarr = new FakePickarr(path.join(musicRoot, env.pickarr.librarySubdir));
  const plexServer = await serve(plex.handle);
  const pickarrServer = await serve(pickarr.handle);
  env.plex.url = plexServer.url;
  env.pickarr.url = pickarrServer.url;

  const database = new DatabaseService();
  const settings = new SettingsService(database);
  settings.update({ dryRun: false });
  const profiles = new ProfilesService(database);
  const weeks = new WeeksRepository(database);
  const runs = new RunsRepository(database);
  const plexService = new PlexService();
  const pickarrService = new PickarrService();
  const cleanup = new CleanupService(weeks, plexService, pickarrService, settings, profiles);

  /** Last.fm simulé : propose `pool` dans l'ordre, en appliquant le vrai filtre d'exclusion (déjà proposé, déjà dans Plex…). */
  const lastfm = {
    pool: [] as Candidate[],
    async pickCandidates(opts: PickOptions) {
      const picked: Candidate[] = [];
      for (const c of this.pool) {
        if (picked.length >= opts.count) break;
        if (!(await opts.exclude(c))) picked.push(c);
      }
      return picked;
    },
  };
  const discord = {
    messages: [] as { level: string; title: string; text: string }[],
    async error(title: string, details: string) {
      this.messages.push({ level: "error", title, text: details });
    },
    async warning(title: string, details: string) {
      this.messages.push({ level: "warning", title, text: details });
    },
    async summary(title: string, lines: string[]) {
      this.messages.push({ level: "summary", title, text: lines.join("\n") });
    },
  };
  const ytmusic = { findSong: async (artist: string, title: string) => ({ link: ytLink(artist, title), coverUrl: null }) };
  const itunes = { preview: async () => null };

  const newDiscovery = () =>
    new DiscoveryService(
      profiles,
      settings,
      weeks,
      runs,
      lastfm as never,
      itunes as never,
      pickarrService,
      plexService,
      cleanup,
      discord as never,
      ytmusic as never,
      database,
    );
  const discovery = newDiscovery();

  /** Attend la fin du travail en arrière-plan d'un profil, puis renvoie la trace du lancement. */
  async function settle(profileId: number, service = discovery) {
    while (service.isRunning(profileId)) await new Promise((resolve) => setTimeout(resolve, 5));
    return runs.list(profileId, 1)[0]!;
  }

  return {
    root,
    musicRoot,
    plex,
    pickarr,
    database,
    settings,
    profiles,
    weeks,
    runs,
    plexService,
    pickarrService,
    cleanup,
    lastfm,
    discord,
    discovery,
    newDiscovery,
    settle,

    addProfile(input: Partial<ProfileInput> = {}) {
      return profiles.create({
        name: "Moi",
        lastfmUser: "moi",
        plexToken: null,
        playlistTitle: "Découvertes de la semaine",
        tracks: 3,
        likedSubdir: "pickarr",
        reviewMode: false,
        enabled: true,
        ...input,
      });
    },

    /** Lancement complet avec `pool` comme candidats Last.fm. */
    async run(profileId: number, pool: Candidate[]) {
      lastfm.pool = pool;
      discovery.start(profileId, "manual");
      return settle(profileId);
    },

    async approve(weekId: number) {
      discovery.approve(weekId);
      return settle(weeks.week(weekId).profileId);
    },

    local: (...parts: string[]) => path.join(musicRoot, ...parts),

    async close() {
      await plexServer.close();
      await pickarrServer.close();
      database.onModuleDestroy();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export type World = Awaited<ReturnType<typeof createWorld>>;
