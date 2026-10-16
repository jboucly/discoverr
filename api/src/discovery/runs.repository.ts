import { Injectable } from "@nestjs/common";
import { now } from "../common/text";
import type { Run, RunTrigger } from "../contracts";
import { DatabaseService } from "../db/database.service";

export type { Run, RunTrigger };

const toRun = (r: Record<string, unknown>): Run => ({
  id: r.id as number,
  profileId: (r.profile_id as number) ?? null,
  trigger: r.trigger as RunTrigger,
  dryRun: r.dry_run === 1,
  startedAt: r.started_at as string,
  finishedAt: (r.finished_at as string) ?? null,
  ok: r.ok === null || r.ok === undefined ? null : r.ok === 1,
  step: (r.step as string) ?? null,
  error: (r.error as string) ?? null,
});

@Injectable()
export class RunsRepository {
  constructor(private readonly db: DatabaseService) {}

  start(profileId: number, trigger: RunTrigger, dryRun: boolean): number {
    return this.db.run("INSERT INTO runs (profile_id, trigger, dry_run, started_at) VALUES (?, ?, ?, ?)", [profileId, trigger, dryRun ? 1 : 0, now()])
      .lastInsertRowid;
  }

  finish(id: number, ok: boolean, step?: string, error?: string) {
    this.db.run("UPDATE runs SET finished_at = ?, ok = ?, step = ?, error = ? WHERE id = ?", [now(), ok ? 1 : 0, step ?? null, error ?? null, id]);
  }

  list(profileId?: number, limit = 50): Run[] {
    return (
      profileId
        ? this.db.all<Record<string, unknown>>("SELECT * FROM runs WHERE profile_id = ? ORDER BY id DESC LIMIT ?", [profileId, limit])
        : this.db.all<Record<string, unknown>>("SELECT * FROM runs ORDER BY id DESC LIMIT ?", [limit])
    ).map(toRun);
  }

  /** Runs left open (container stopped mid-work): marked as failed at startup. */
  closeInterrupted() {
    this.db.run("UPDATE runs SET finished_at = ?, ok = 0, error = 'Interrompu (redémarrage)' WHERE finished_at IS NULL", [now()]);
  }
}
