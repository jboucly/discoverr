import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { CronJob } from "cron";
import { env } from "../env";
import { ProfilesService } from "../profiles/profiles.service";
import { SettingsService } from "../settings/settings.service";
import { DiscoveryService } from "./discovery.service";

/** Weekly run (configurable in the UI, no restart needed) and auto-approval of selections. */
@Injectable()
export class SchedulerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private weekly?: CronJob;
  private hourly?: CronJob;

  constructor(
    private readonly settings: SettingsService,
    private readonly profiles: ProfilesService,
    private readonly discovery: DiscoveryService,
  ) {}

  onApplicationBootstrap() {
    this.schedule();
    this.settings.onChange(() => this.schedule());
    this.hourly = CronJob.from({ cronTime: "0 * * * *", timeZone: env.timezone, start: true, onTick: () => this.discovery.autoApprove() });
  }

  private schedule() {
    this.weekly?.stop();
    this.weekly = undefined;
    const { cron, scheduleEnabled } = this.settings.get();
    if (!scheduleEnabled) {
      this.logger.log("Lancement planifié désactivé");
      return;
    }
    this.weekly = CronJob.from({ cronTime: cron, timeZone: env.timezone, start: true, onTick: () => this.tick() });
    this.logger.log(`Planifié « ${cron} » (${env.timezone}), prochain : ${this.nextRun()}`);
  }

  private tick() {
    for (const profile of this.profiles.list().filter((p) => p.enabled)) {
      try {
        this.discovery.start(profile.id, "cron");
      } catch (err) {
        this.logger.warn(`[${profile.name}] lancement planifié ignoré : ${(err as Error).message}`);
      }
    }
  }

  nextRun(): string | null {
    return this.weekly?.nextDate().toISO() ?? null;
  }

  onModuleDestroy() {
    this.weekly?.stop();
    this.hourly?.stop();
  }
}
