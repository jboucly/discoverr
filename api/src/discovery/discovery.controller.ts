import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query } from "@nestjs/common";
import type { Status, TrackDto, WeekDto } from "../contracts";
import { ProfilesService } from "../profiles/profiles.service";
import { PlexService } from "../integrations/plex.service";
import { SettingsService } from "../settings/settings.service";
import { DiscoveryService } from "./discovery.service";
import { RunsRepository } from "./runs.repository";
import { SchedulerService } from "./scheduler.service";
import { WeeksRepository, type Track } from "./weeks.repository";

/** Ce que le navigateur voit d'un titre (sans chemin de fichier). */
const trackDto = ({ file, ...t }: Track, liveRating?: number | null): TrackDto => ({
  ...t,
  hasFile: !!file,
  rating: liveRating === undefined ? t.rating : liveRating,
});

@Controller()
export class DiscoveryController {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scheduler: SchedulerService,
    private readonly weeks: WeeksRepository,
    private readonly runs: RunsRepository,
    private readonly profiles: ProfilesService,
    private readonly plex: PlexService,
    private readonly settings: SettingsService,
  ) {}

  @Get("status")
  status(): Status {
    const settings = this.settings.get();
    return {
      activity: this.discovery.activity(),
      nextRun: this.scheduler.nextRun(),
      scheduleEnabled: settings.scheduleEnabled,
      dryRun: settings.dryRun,
      likedMinRating: settings.likedMinRating,
      lastRuns: this.profiles.list().map((p) => ({ profileId: p.id, run: this.runs.list(p.id, 1)[0] ?? null })),
    };
  }

  @Post("profiles/:id/run")
  @HttpCode(202)
  run(@Param("id", ParseIntPipe) id: number) {
    this.discovery.start(id, "manual");
    return { started: true };
  }

  @Post("profiles/:id/cleanup")
  @HttpCode(202)
  cleanup(@Param("id", ParseIntPipe) id: number) {
    this.discovery.startCleanup(id);
    return { started: true };
  }

  /** Semaines d'un profil ; pour les semaines en cours, la note ❤️ est lue en direct dans Plex. */
  @Get("profiles/:id/weeks")
  async list(@Param("id", ParseIntPipe) id: number, @Query("limit") limit?: string): Promise<WeekDto[]> {
    const profile = this.profiles.get(id);
    const token = profile.plexToken ?? undefined;
    const weeks = this.weeks.weeks(id, Math.min(Number(limit) || 20, 100));
    return Promise.all(
      weeks.map(async (week) => {
        const tracks = this.weeks.tracks(week.id);
        const live = week.status === "active";
        return {
          ...week,
          tracks: await Promise.all(
            tracks.map(async (t) => {
              if (!live || !t.ratingKey || t.status !== "imported") return trackDto(t);
              const rating = await this.plex.getTrack(t.ratingKey, token, 1).then((p) => p?.userRating ?? 0, () => null);
              return trackDto(t, rating);
            }),
          ),
        };
      }),
    );
  }

  @Post("weeks/:id/approve")
  @HttpCode(202)
  approve(@Param("id", ParseIntPipe) id: number) {
    this.discovery.approve(id);
    return { started: true };
  }

  @Post("weeks/:id/resume")
  @HttpCode(202)
  resume(@Param("id", ParseIntPipe) id: number) {
    this.discovery.resume(id);
    return { started: true };
  }

  @Delete("weeks/:id")
  @HttpCode(204)
  discard(@Param("id", ParseIntPipe) id: number) {
    this.discovery.discardReview(id);
  }

  /** Garder un titre (sans ❤️), ou l'écarter / le reprendre pendant la validation. */
  @Patch("tracks/:id")
  updateTrack(@Param("id", ParseIntPipe) id: number, @Body() body: { keep?: unknown; rejected?: unknown }) {
    const track = this.weeks.track(id);
    const week = this.weeks.week(track.weekId);
    if (body?.keep !== undefined) {
      if (!["imported", "pending"].includes(track.status)) throw new BadRequestException("Seul un titre de la playlist peut être gardé");
      this.weeks.updateTrack(id, { keep: body.keep === true });
    }
    if (body?.rejected !== undefined) {
      if (week.status !== "review") throw new BadRequestException("La sélection n'est plus modifiable");
      this.weeks.updateTrack(id, { status: body.rejected === true ? "rejected" : "candidate" });
    }
    return trackDto(this.weeks.track(id));
  }

  @Get("runs")
  listRuns(@Query("profileId") profileId?: string) {
    return this.runs.list(profileId ? Number(profileId) : undefined);
  }
}
