import { BadRequestException, ConflictException, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import type { Activity } from "../contracts";
import { DatabaseService } from "../db/database.service";
import { discoveryDir, toPlexPath } from "../env";
import { DiscordService } from "../integrations/discord.service";
import { ItunesService } from "../integrations/itunes.service";
import { LastfmService } from "../integrations/lastfm.service";
import { PickarrService } from "../integrations/pickarr.service";
import { PlexService } from "../integrations/plex.service";
import { ProfilesService, type Profile } from "../profiles/profiles.service";
import { YtmusicService } from "../integrations/ytmusic.service";
import { SettingsService } from "../settings/settings.service";
import { CleanupService } from "./cleanup.service";
import { RunsRepository, type RunTrigger } from "./runs.repository";
import { WeeksRepository, type Week } from "./weeks.repository";

class StepError extends Error {
  constructor(
    readonly step: string,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
  }
}

/**
 * A profile's cycle:
 *   Last.fm selection -> (review in the UI) -> pickarr download -> Plex playlist -> cleanup of the previous weeks.
 * One run at a time per profile; a "downloading" week left hanging (restart) is resumed.
 */
@Injectable()
export class DiscoveryService implements OnModuleInit {
  private readonly logger = new Logger(DiscoveryService.name);
  private readonly activities = new Map<number, Activity>();

  constructor(
    private readonly profiles: ProfilesService,
    private readonly settings: SettingsService,
    private readonly weeks: WeeksRepository,
    private readonly runs: RunsRepository,
    private readonly lastfm: LastfmService,
    private readonly itunes: ItunesService,
    private readonly pickarr: PickarrService,
    private readonly plex: PlexService,
    private readonly cleanup: CleanupService,
    private readonly discord: DiscordService,
    private readonly ytmusic: YtmusicService,
    private readonly database: DatabaseService,
  ) {}

  onModuleInit() {
    this.runs.closeInterrupted();
    // Weeks whose download was interrupted: resumed in the background.
    for (const profile of this.profiles.list()) {
      const interrupted = this.weeks.weeksWithStatus(profile.id, "downloading")[0];
      if (interrupted) void this.execute(profile, "manual", () => this.downloadAndActivate(profile, interrupted));
    }
  }

  activity(): Activity[] {
    return [...this.activities.values()];
  }

  isRunning(profileId: number) {
    return this.activities.has(profileId);
  }

  private setStep(profileId: number, step: string, done?: number, total?: number) {
    const activity = this.activities.get(profileId);
    if (activity) Object.assign(activity, { step, done, total });
    this.logger.log(`[${this.profiles.get(profileId).name}] ${step}`);
  }

  private async step<T>(profileId: number, name: string, fn: () => Promise<T>): Promise<T> {
    this.setStep(profileId, name);
    try {
      return await fn();
    } catch (err) {
      throw err instanceof StepError ? err : new StepError(name, err);
    }
  }

  /** Runs `work` for a profile, with a lock, a record in "runs" and a notification on failure. */
  private async execute(profile: Profile, trigger: RunTrigger, work: () => Promise<void>): Promise<void> {
    if (this.activities.has(profile.id)) throw new ConflictException(`Un lancement est déjà en cours pour ${profile.name}`);
    const dryRun = this.settings.get().dryRun;
    this.activities.set(profile.id, { profileId: profile.id, trigger, step: "démarrage", startedAt: new Date().toISOString() });
    try {
      this.database.backup();
    } catch (err) {
      // A failed backup does not block the run: the database is untouched, just warn.
      this.logger.warn(`Sauvegarde de la base impossible : ${(err as Error).message}`);
      await this.discord.error("Sauvegarde de la base impossible", (err as Error).message);
    }
    const runId = this.runs.start(profile.id, trigger, dryRun);
    try {
      await work();
      this.runs.finish(runId, true);
    } catch (err) {
      const step = err instanceof StepError ? err.step : "inconnue";
      const message = (err as Error).message;
      this.runs.finish(runId, false, step, message);
      this.logger.error(`[${profile.name}] échec (${step}) : ${message}`);
      await this.discord.error(`${profile.name} : échec (${step})`, `${message}${dryRun ? "\n\n_Mode simulation_" : ""}`);
    } finally {
      this.activities.delete(profile.id);
    }
  }

  /** Full run (scheduled or manual). Returns right away: the work continues in the background. */
  start(profileId: number, trigger: RunTrigger): void {
    const profile = this.profiles.get(profileId);
    if (this.activities.has(profile.id)) throw new ConflictException(`Un lancement est déjà en cours pour ${profile.name}`);
    void this.execute(profile, trigger, () => this.cycle(profile, trigger));
  }

  private async cycle(profile: Profile, trigger: RunTrigger) {
    const settings = this.settings.get();

    // Previous dry runs: without files, they are no longer useful.
    this.weeks.weeksWithStatus(profile.id, "dryrun").forEach((w) => this.weeks.deleteWeek(w.id));

    const inReview = this.weeks.weeksWithStatus(profile.id, "review")[0];
    if (inReview) {
      if (trigger === "manual") throw new StepError("sélection", "Une sélection attend ta validation : valide-la ou supprime-la d'abord");
      return; // scheduled run: the pending selection will be approved by the user, or automatically after the delay
    }

    await this.step(profile.id, "connexion à Plex", () => this.plex.identity());
    const week = await this.generate(profile, settings.dryRun);
    if (settings.dryRun) {
      this.weeks.setWeekStatus(week.id, "dryrun");
      const tracks = this.weeks.tracks(week.id);
      await this.discord.summary(`${profile.name} : simulation`, [
        `${tracks.length} titres seraient proposés :`,
        ...tracks.map((t) => `• ${t.artist} - ${t.title}`),
      ]);
      return;
    }
    if (profile.reviewMode) {
      await this.discord.summary(`${profile.name} : sélection à valider`, [
        `${this.weeks.tracks(week.id).length} titres attendent ta validation dans discoverr.`,
      ]);
      return;
    }
    this.weeks.tracks(week.id).forEach((t) => this.weeks.updateTrack(t.id, { status: "queued" }));
    this.weeks.setWeekStatus(week.id, "downloading");
    await this.downloadAndActivate(profile, week);
  }

  /** Picks candidates, links and previews. The week is created in "review". */
  private async generate(profile: Profile, dryRun: boolean): Promise<Week> {
    const settings = this.settings.get();
    const proposed = this.weeks.proposedKeys(profile.id);
    const blocked = this.profiles.blockedKeys(profile.id);
    // Margin for failed downloads (and, in review mode, for the tracks the user rejects).
    const wanted = Math.ceil(profile.tracks * (profile.reviewMode ? 1.6 : 1.3));

    const candidates = await this.step(profile.id, "sélection Last.fm", () =>
      this.lastfm.pickCandidates({
        user: profile.lastfmUser,
        count: wanted,
        newArtistRatio: settings.newArtistRatio,
        maxPerArtist: settings.maxPerArtist,
        exclude: async (c) =>
          proposed.has(c.key) || blocked.has(c.key.split("::")[0]!) || (await this.plex.isInLibrary(c.artist, c.title)),
      }),
    );
    if (candidates.length === 0) throw new StepError("sélection Last.fm", "Aucun titre candidat trouvé");

    const rows = await this.step(profile.id, "recherche des liens", async () => {
      const result = [];
      for (const [index, c] of candidates.entries()) {
        this.setStep(profile.id, "recherche des liens", index, candidates.length);
        const song = await this.findSong(c.artist, c.title);
        if (!song) {
          this.logger.log(`✗ ${c.artist} - ${c.title} : introuvable sur YouTube Music`);
          continue;
        }
        const previewUrl = await this.itunes.preview(c.artist, c.title);
        result.push({ ...c, link: song.link, previewUrl, coverUrl: song.coverUrl, status: "candidate" as const, position: result.length });
      }
      return result;
    });
    if (rows.length === 0) throw new StepError("recherche des liens", "Aucun lien trouvé pour les candidats");

    const week = this.weeks.createWeek(profile.id, dryRun ? "dryrun" : "review");
    this.weeks.addTracks(week.id, rows);
    return week;
  }

  private findSong(artist: string, title: string) {
    return this.ytmusic.findSong(artist, title).catch(() => null);
  }

  /** Approval of the selection from the UI: tracks not rejected are downloaded. */
  approve(weekId: number, trigger: RunTrigger = "review") {
    const week = this.weeks.week(weekId);
    if (week.status !== "review") throw new BadRequestException("Cette sélection n'attend pas de validation");
    const profile = this.profiles.get(week.profileId);
    const tracks = this.weeks.tracks(week.id);
    // "queued": a previous approval failed before downloading, these tracks stay selected.
    const kept = tracks.filter((t) => t.status === "candidate" || t.status === "queued");
    if (kept.length === 0) throw new BadRequestException("Tous les titres ont été écartés");
    if (this.activities.has(profile.id)) throw new ConflictException(`Un lancement est déjà en cours pour ${profile.name}`);
    kept.forEach((t) => this.weeks.updateTrack(t.id, { status: "queued" }));
    this.weeks.setWeekStatus(week.id, "downloading");
    void this.execute(profile, trigger, () => this.downloadAndActivate(profile, week));
  }

  /** Resumes an interrupted download (pickarr unreachable, restart…). Picks already sent are not sent again. */
  resume(weekId: number) {
    const week = this.weeks.week(weekId);
    if (week.status !== "downloading") throw new BadRequestException("Ce téléchargement n'est pas à reprendre");
    const profile = this.profiles.get(week.profileId);
    if (this.activities.has(profile.id)) throw new ConflictException(`Un lancement est déjà en cours pour ${profile.name}`);
    void this.execute(profile, "manual", () => this.downloadAndActivate(profile, week));
  }

  /** Auto-approves selections pending for too long (called every hour). */
  autoApprove() {
    const hours = this.settings.get().reviewAutoApproveHours;
    if (hours <= 0) return;
    for (const profile of this.profiles.list()) {
      for (const week of this.weeks.weeksWithStatus(profile.id, "review")) {
        if (Date.now() - Date.parse(week.createdAt) < hours * 3_600_000 || this.activities.has(profile.id)) continue;
        this.logger.log(`[${profile.name}] sélection ${week.id} validée d'office après ${hours} h`);
        this.approve(week.id, "auto-approve");
      }
    }
  }

  private async downloadAndActivate(profile: Profile, week: Week) {
    const settings = this.settings.get();
    const token = profile.plexToken ?? undefined;

    await this.step(profile.id, "connexion à pickarr", () => this.pickarr.ping());
    const queued = this.weeks.tracks(week.id).filter((t) => t.status === "queued");

    await this.step(profile.id, "envoi à pickarr", async () => {
      for (const track of queued.filter((t) => !t.pickId)) {
        const pick = await this.pickarr.addPick(track.link!);
        this.weeks.updateTrack(track.id, { pickId: pick.id });
      }
    });

    const sent = this.weeks.tracks(week.id).filter((t) => t.status === "queued" && t.pickId);
    const finished = await this.step(profile.id, "téléchargement", () =>
      this.pickarr.waitForPicks(
        sent.map((t) => t.pickId!),
        settings.pickarrTimeoutHours,
        (picks) => {
          const done = [...picks.values()].filter((p) => p.error || (p.expanded && p.tracks.every((t) => ["Imported", "Failed", "Skipped"].includes(t.status)))).length;
          this.setStep(profile.id, "téléchargement", done, sent.length);
        },
      ),
    );

    for (const track of sent) {
      const pick = finished.get(track.pickId!);
      const pt = pick?.tracks[0];
      const file = pt ? this.pickarr.localFile(pt) : null;
      if (pt && file) {
        this.weeks.updateTrack(track.id, { status: "imported", file, quality: pt.quality, origin: pt.origin, lossless: pt.lossless, error: null });
      } else {
        this.weeks.updateTrack(track.id, { status: "failed", error: pick?.error ?? pt?.error ?? "Non terminé dans le délai" });
      }
    }
    const imported = this.weeks.tracks(week.id).filter((t) => t.status === "imported");
    if (imported.length === 0) throw new StepError("téléchargement", "Aucun titre n'a été importé par pickarr");

    const ratingKeys = await this.step(profile.id, "playlist Plex", async () => {
      // pickarr already requests a scan, but do not rely on it: one more scan costs nothing.
      await this.plex.scanFolder(toPlexPath(discoveryDir()));
      // One deadline shared by all tracks: a track never indexed must not make each following one wait 5 min.
      const deadline = Date.now() + 10 * 60_000;
      const keys: string[] = [];
      for (const [index, track] of imported.entries()) {
        this.setStep(profile.id, "playlist Plex", index, imported.length);
        const found = await this.plex.findByFile(toPlexPath(track.file!), track.title, token, Math.max(0, deadline - Date.now()));
        if (found) this.weeks.updateTrack(track.id, { ratingKey: found.ratingKey });
        if (found && keys.length < profile.tracks) keys.push(found.ratingKey);
      }
      if (keys.length === 0) throw new Error("Aucun titre importé n'a été trouvé dans Plex (le dossier des découvertes est-il dans la bibliothèque ?)");
      await this.plex.replacePlaylist(profile.playlistTitle, keys, token);
      return keys;
    });
    this.weeks.setWeekStatus(week.id, "active");

    // The cleanup runs once the new playlist is in place.
    const summary = [
      `**${ratingKeys.length}** titres dans « ${profile.playlistTitle} » (${imported.length} importés, ${sent.length - imported.length} échecs).`,
    ];
    for (const old of this.weeks.weeksWithStatus(profile.id, "active").filter((w) => w.id !== week.id)) {
      const result = await this.step(profile.id, `ménage de la semaine du ${old.createdAt.slice(0, 10)}`, () => this.cleanup.cleanWeek(old, profile));
      summary.push(`Semaine du ${old.createdAt.slice(0, 10)} : **${result.liked.length}** gardés, **${result.deleted.length}** supprimés`);
      summary.push(...result.liked.map((l) => `❤️ ${l}`));
      if (result.warnings.length) await this.discord.warning(`${profile.name} : ménage`, result.warnings.join("\n"));
    }
    if (ratingKeys.length < profile.tracks) {
      await this.discord.warning(`${profile.name} : playlist incomplète`, `${ratingKeys.length}/${profile.tracks} titres seulement cette semaine.`);
    }
    await this.discord.summary(`${profile.name} : ${profile.playlistTitle}`, summary);
  }

  /** Manual run of the cleanup alone (e.g. after a Plex outage). */
  startCleanup(profileId: number) {
    const profile = this.profiles.get(profileId);
    const current = this.weeks.weeksWithStatus(profile.id, "active").at(-1);
    void this.execute(profile, "manual", async () => {
      for (const old of this.weeks.weeksWithStatus(profile.id, "active").filter((w) => w.id !== current?.id)) {
        await this.step(profile.id, `ménage de la semaine du ${old.createdAt.slice(0, 10)}`, () => this.cleanup.cleanWeek(old, profile));
      }
    });
  }

  discardReview(weekId: number) {
    const week = this.weeks.week(weekId);
    if (week.status !== "review" && week.status !== "dryrun") throw new BadRequestException("Seule une sélection non téléchargée peut être supprimée");
    this.weeks.deleteWeek(week.id);
  }
}
