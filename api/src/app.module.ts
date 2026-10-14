import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthController } from "./auth/auth.controller";
import { AuthGuard } from "./auth/auth.guard";
import { AuthService } from "./auth/auth.service";
import { DatabaseService } from "./db/database.service";
import { CleanupService } from "./discovery/cleanup.service";
import { DiscoveryController } from "./discovery/discovery.controller";
import { DiscoveryService } from "./discovery/discovery.service";
import { RunsRepository } from "./discovery/runs.repository";
import { SchedulerService } from "./discovery/scheduler.service";
import { WeeksRepository } from "./discovery/weeks.repository";
import { HealthService } from "./health/health.service";
import { DeezerService } from "./integrations/deezer.service";
import { DiscordService } from "./integrations/discord.service";
import { LastfmService } from "./integrations/lastfm.service";
import { PickarrService } from "./integrations/pickarr.service";
import { PlexService } from "./integrations/plex.service";
import { YtmusicService } from "./integrations/ytmusic.service";
import { MiscController } from "./misc.controller";
import { ProfilesController } from "./profiles/profiles.controller";
import { ProfilesService } from "./profiles/profiles.service";
import { SettingsController } from "./settings/settings.controller";
import { SettingsService } from "./settings/settings.service";
import { StatsService } from "./stats/stats.service";

@Module({
  controllers: [AuthController, SettingsController, ProfilesController, DiscoveryController, MiscController],
  providers: [
    DatabaseService,
    SettingsService,
    ProfilesService,
    AuthService,
    { provide: APP_GUARD, useClass: AuthGuard },
    LastfmService,
    YtmusicService,
    DeezerService,
    PickarrService,
    PlexService,
    DiscordService,
    WeeksRepository,
    RunsRepository,
    CleanupService,
    DiscoveryService,
    SchedulerService,
    StatsService,
    HealthService,
  ],
})
export class AppModule {}
