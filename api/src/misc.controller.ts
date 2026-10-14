import { Controller, Get, Param, ParseIntPipe, Query } from "@nestjs/common";
import { Public } from "./auth/auth.guard";
import { logBuffer } from "./common/log-buffer.logger";
import { HealthService } from "./health/health.service";
import { ProfilesService } from "./profiles/profiles.service";
import { StatsService } from "./stats/stats.service";

@Controller()
export class MiscController {
  constructor(
    private readonly health: HealthService,
    private readonly stats: StatsService,
    private readonly profiles: ProfilesService,
  ) {}

  /** Sonde de vie pour Docker : publique, ne révèle rien. */
  @Public()
  @Get("health")
  live() {
    return { ok: true };
  }

  @Get("health/details")
  details() {
    return this.health.details();
  }

  @Get("profiles/:id/stats")
  profileStats(@Param("id", ParseIntPipe) id: number) {
    this.profiles.get(id);
    return this.stats.forProfile(id);
  }

  @Get("logs")
  logs(@Query("after") after?: string) {
    return after ? logBuffer.filter((l) => l.at > after) : logBuffer.slice(-300);
  }
}
