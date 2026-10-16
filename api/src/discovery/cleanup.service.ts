import { Injectable, Logger } from "@nestjs/common";
import { promises as fs } from "node:fs";
import path from "node:path";
import { sleep } from "../common/text";
import { discoveryDir, env, musicDir, sharedPickarrLibrary, toPlexPath } from "../env";
import { PickarrService } from "../integrations/pickarr.service";
import { PlexService, type PlexTrack } from "../integrations/plex.service";
import { ProfilesService, type Profile } from "../profiles/profiles.service";
import { SettingsService } from "../settings/settings.service";
import { WeeksRepository, type Track, type Week } from "./weeks.repository";

export interface CleanupResult {
  liked: string[];
  deleted: string[];
  pending: string[];
  warnings: string[];
}

const label = (t: Track) => `${t.artist} - ${t.title}`;

const exists = (p: string) =>
  fs.access(p).then(
    () => true,
    () => false,
  );

/**
 * Cleanup of a week: liked tracks (❤️, "Garder", another playlist) are moved to the profile's folder,
 * the others deleted. Golden rule: never delete outside the discoveries folder, and keep the file on any doubt.
 */
@Injectable()
export class CleanupService {
  private readonly logger = new Logger(CleanupService.name);

  constructor(
    private readonly weeks: WeeksRepository,
    private readonly plex: PlexService,
    private readonly pickarr: PickarrService,
    private readonly settings: SettingsService,
    private readonly profiles: ProfilesService,
  ) {}

  private async assertInDiscovery(file: string) {
    const root = await fs.realpath(discoveryDir());
    const real = await fs.realpath(file);
    if (!real.startsWith(root + path.sep)) throw new Error(`Refusé : ${real} n'est pas dans ${root}`);
  }

  /** Removes emptied folders (or ones left with only cover.jpg), never going above the discoveries folder. */
  private async pruneDirs(startDir: string, dryRun: boolean) {
    const root = path.resolve(discoveryDir());
    let dir = path.resolve(startDir);
    while (dir.startsWith(root + path.sep)) {
      const entries = await fs.readdir(dir).catch(() => null);
      if (entries === null || entries.some((e) => e !== "cover.jpg" && !e.startsWith("."))) break;
      if (dryRun) break;
      await fs.rm(dir, { recursive: true });
      dir = path.dirname(dir);
    }
  }

  private async releasePick(track: Track) {
    if (!track.pickId || this.weeks.pickStillUsed(track.pickId, track.id)) return;
    await this.pickarr.deletePick(track.pickId).catch((err) => this.logger.warn(`Pick ${track.pickId} non retiré de pickarr : ${err.message}`));
  }

  private async moveLiked(track: Track, plexTrack: PlexTrack, profile: Profile, dryRun: boolean, result: CleanupResult) {
    const file = track.file!;
    const dest = path.join(musicDir(profile.likedSubdir), path.relative(discoveryDir(), file));
    if (await exists(dest)) {
      result.warnings.push(`${label(track)} : déjà présent dans ${profile.likedSubdir}, laissé dans les découvertes`);
      if (!dryRun) this.weeks.updateTrack(track.id, { status: "liked", error: "Déjà présent dans le dossier des aimés" });
      result.liked.push(label(track));
      return;
    }
    if (dryRun) {
      this.logger.log(`[DRY_RUN] déplacement ${file} -> ${dest}`);
      result.liked.push(label(track));
      return;
    }

    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.rename(file, dest);
    const cover = path.join(path.dirname(file), "cover.jpg");
    const destCover = path.join(path.dirname(dest), "cover.jpg");
    if ((await exists(cover)) && !(await exists(destCover))) await fs.copyFile(cover, destCover);
    await this.pruneDirs(path.dirname(file), false);
    this.weeks.moveFileReferences(file, dest);
    this.weeks.updateTrack(track.id, { status: "liked", rating: plexTrack.userRating ?? null });

    // Plex may see the moved file as a new item: set the rating again so it stays in ❤️ Tracks.
    const token = profile.plexToken ?? undefined;
    await this.plex.scanFolder(toPlexPath(path.dirname(file))).catch(() => undefined);
    await this.plex.scanFolder(toPlexPath(path.dirname(dest)));
    const moved = await this.plex.findByFile(toPlexPath(dest), plexTrack.title, token);
    if (!moved) result.warnings.push(`${label(track)} : déplacé, mais introuvable dans Plex après le scan (note à remettre à la main)`);
    else if ((moved.userRating ?? 0) < (plexTrack.userRating ?? 0)) await this.plex.rate(moved.ratingKey, plexTrack.userRating!, token);
    this.weeks.updateTrack(track.id, { ratingKey: moved?.ratingKey ?? null });
    await this.releasePick(track);
    result.liked.push(label(track));
  }

  private async deleteTrack(track: Track, dryRun: boolean, result: CleanupResult) {
    const file = track.file!;
    if (sharedPickarrLibrary() && !env.pickarr.allowDeleteInLibrary) {
      throw new Error(`Suppression refusée : ${discoveryDir()} est dans la bibliothèque de pickarr, il faut ALLOW_DELETE_IN_PICKARR_LIBRARY=true`);
    }
    // The same file is still suggested elsewhere (another profile, another week): leave it to that other week.
    const shared = this.weeks.othersUsingFile(file, track.id).length > 0;
    if (!shared) await this.assertInDiscovery(file);
    if (dryRun) {
      this.logger.log(`[DRY_RUN] suppression ${file}${shared ? " (partagé, conservé)" : ""}`);
    } else {
      if (!shared) {
        await fs.unlink(file);
        await this.pruneDirs(path.dirname(file), false);
      }
      this.weeks.updateTrack(track.id, { status: "deleted" });
      await this.releasePick(track);
    }
    result.deleted.push(label(track));
  }

  async cleanWeek(week: Week, profile: Profile): Promise<CleanupResult> {
    const { dryRun, likedMinRating, keepIfInOtherPlaylist } = this.settings.get();
    const result: CleanupResult = { liked: [], deleted: [], pending: [], warnings: [] };
    const token = profile.plexToken ?? undefined;
    await this.plex.identity(); // Plex unreachable: fail before touching any file.
    // Other profiles' playlists on the same Plex account do not count: they are discoveries, not a choice.
    const discoverrPlaylists = this.profiles
      .list()
      .filter((p) => (p.plexToken ?? "") === (profile.plexToken ?? ""))
      .map((p) => p.playlistTitle);
    const inOtherPlaylists = keepIfInOtherPlaylist ? await this.plex.tracksInOtherPlaylists(discoverrPlaylists, token) : new Set<string>();

    for (const track of this.weeks.tracks(week.id).filter((t) => t.status === "imported" || t.status === "pending")) {
      try {
        if (!track.file || !(await exists(track.file))) {
          if (!dryRun) this.weeks.updateTrack(track.id, { status: "deleted", error: "Fichier déjà absent" });
          continue;
        }
        let plexTrack = track.ratingKey ? await this.plex.getTrack(track.ratingKey, token).catch(() => null) : null;
        plexTrack ??= await this.plex.findByFile(toPlexPath(track.file), track.title, token, 0);
        if (!plexTrack) {
          result.pending.push(label(track));
          result.warnings.push(`${label(track)} : introuvable dans Plex, gardé par prudence`);
          if (!dryRun) this.weeks.updateTrack(track.id, { status: "pending", error: "Introuvable dans Plex" });
          continue;
        }
        const liked = track.keep || (plexTrack.userRating ?? 0) >= likedMinRating || inOtherPlaylists.has(plexTrack.ratingKey);
        if (liked) await this.moveLiked(track, plexTrack, profile, dryRun, result);
        else await this.deleteTrack(track, dryRun, result);
      } catch (err) {
        result.pending.push(label(track));
        result.warnings.push(`${label(track)} : ${(err as Error).message}`);
        if (!dryRun) this.weeks.updateTrack(track.id, { status: "pending", error: (err as Error).message });
      }
    }

    // Tracks never imported: their pick is no longer useful in pickarr.
    if (!dryRun) {
      for (const track of this.weeks.tracks(week.id).filter((t) => t.status === "failed")) await this.releasePick(track);
    }

    if (!dryRun && result.deleted.length > 0) {
      await this.plex.scanFolder(toPlexPath(discoveryDir()));
      await sleep(60_000); // give the scan time to mark the missing files
      await this.plex.emptyTrash(toPlexPath(discoveryDir()));
    }
    if (!dryRun && result.pending.length === 0) this.weeks.setWeekStatus(week.id, "cleaned");
    this.logger.log(
      `[${profile.name}] ménage semaine ${week.id} : ${result.liked.length} gardés, ${result.deleted.length} supprimés, ${result.pending.length} en attente`,
    );
    return result;
  }

  /** Used by the "État" page. */
  static libraryPaths(profile: Profile) {
    return { discovery: toPlexPath(discoveryDir()), liked: toPlexPath(musicDir(profile.likedSubdir)), musicRoot: env.paths.musicRoot };
  }
}
