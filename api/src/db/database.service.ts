import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { env } from "../env";
import { MIGRATIONS } from "./migrations";

type Params = Record<string, SQLInputValue> | SQLInputValue[];

/** Nombre de sauvegardes gardées dans DATA_DIR/backups. */
const BACKUPS_KEPT = 10;

/** SQLite intégré à Node (node:sqlite) : pas de dépendance native à compiler dans l'image. */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  readonly db: DatabaseSync;

  constructor() {
    mkdirSync(env.dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(env.dataDir, "discoverr.db"));
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    this.migrate();
  }

  private migrate() {
    this.db.exec("CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
    const done = new Set(this.all<{ version: number }>("SELECT version FROM migrations").map((m) => m.version));
    for (const [index, sql] of MIGRATIONS.entries()) {
      const version = index + 1;
      if (done.has(version)) continue;
      this.transaction(() => {
        this.db.exec(sql);
        this.run("INSERT INTO migrations (version, applied_at) VALUES (?, ?)", [version, new Date().toISOString()]);
      });
      this.logger.log(`Migration ${version} appliquée`);
    }
  }

  /**
   * Copie cohérente de la base (VACUUM INTO, sûr pendant que la base est ouverte) dans DATA_DIR/backups,
   * en ne gardant que les BACKUPS_KEPT plus récentes. Renvoie le chemin du fichier créé.
   */
  backup(): string {
    const dir = path.join(env.dataDir, "backups");
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(dir, `discoverr-${stamp}.db`);
    this.db.prepare("VACUUM INTO ?").run(file);
    const old = readdirSync(dir)
      .filter((f) => /^discoverr-.*\.db$/.test(f))
      .sort()
      .reverse()
      .slice(BACKUPS_KEPT);
    for (const f of old) rmSync(path.join(dir, f), { force: true });
    return file;
  }

  private args(params?: Params): SQLInputValue[] | [Record<string, SQLInputValue>] {
    if (!params) return [];
    return Array.isArray(params) ? params : [params];
  }

  all<T>(sql: string, params?: Params): T[] {
    return this.db.prepare(sql).all(...(this.args(params) as SQLInputValue[])) as T[];
  }

  get<T>(sql: string, params?: Params): T | undefined {
    return this.db.prepare(sql).get(...(this.args(params) as SQLInputValue[])) as T | undefined;
  }

  run(sql: string, params?: Params): { changes: number; lastInsertRowid: number } {
    const result = this.db.prepare(sql).run(...(this.args(params) as SQLInputValue[]));
    return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) };
  }

  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  onModuleDestroy() {
    this.db.close();
  }
}
