import { Injectable, NotFoundException } from "@nestjs/common";
import type { SQLInputValue } from "node:sqlite";
import { now } from "../common/text";
import { DatabaseService } from "../db/database.service";

export type WeekStatus = "dryrun" | "review" | "downloading" | "active" | "cleaned";
export type TrackStatus =
  | "candidate" // proposé, en attente de validation
  | "rejected" // écarté à la validation
  | "queued" // validé, envoyé (ou à envoyer) à pickarr
  | "imported" // dans la bibliothèque et la playlist
  | "failed" // téléchargement en échec
  | "pending" // ménage reporté (doute, Plex injoignable)
  | "liked" // gardé et déplacé
  | "deleted"; // supprimé au ménage

export interface Week {
  id: number;
  profileId: number;
  status: WeekStatus;
  createdAt: string;
  activatedAt: string | null;
  cleanedAt: string | null;
}

export interface Track {
  id: number;
  weekId: number;
  artist: string;
  title: string;
  key: string;
  kind: "similar" | "new-artist";
  score: number;
  status: TrackStatus;
  link: string | null;
  previewUrl: string | null;
  coverUrl: string | null;
  pickId: number | null;
  file: string | null;
  ratingKey: string | null;
  rating: number | null;
  keep: boolean;
  lossless: boolean | null;
  origin: string | null;
  quality: string | null;
  error: string | null;
  position: number;
  updatedAt: string;
}

const toWeek = (r: Record<string, unknown>): Week => ({
  id: r.id as number,
  profileId: r.profile_id as number,
  status: r.status as WeekStatus,
  createdAt: r.created_at as string,
  activatedAt: (r.activated_at as string) ?? null,
  cleanedAt: (r.cleaned_at as string) ?? null,
});

const toTrack = (r: Record<string, unknown>): Track => ({
  id: r.id as number,
  weekId: r.week_id as number,
  artist: r.artist as string,
  title: r.title as string,
  key: r.key as string,
  kind: r.kind as Track["kind"],
  score: r.score as number,
  status: r.status as TrackStatus,
  link: (r.link as string) ?? null,
  previewUrl: (r.preview_url as string) ?? null,
  coverUrl: (r.cover_url as string) ?? null,
  pickId: (r.pick_id as number) ?? null,
  file: (r.file as string) ?? null,
  ratingKey: (r.rating_key as string) ?? null,
  rating: (r.rating as number) ?? null,
  keep: r.keep === 1,
  lossless: r.lossless === null || r.lossless === undefined ? null : r.lossless === 1,
  origin: (r.origin as string) ?? null,
  quality: (r.quality as string) ?? null,
  error: (r.error as string) ?? null,
  position: r.position as number,
  updatedAt: r.updated_at as string,
});

const COLUMNS: Record<string, string> = {
  status: "status",
  link: "link",
  previewUrl: "preview_url",
  coverUrl: "cover_url",
  pickId: "pick_id",
  file: "file",
  ratingKey: "rating_key",
  rating: "rating",
  keep: "keep",
  lossless: "lossless",
  origin: "origin",
  quality: "quality",
  error: "error",
};

@Injectable()
export class WeeksRepository {
  constructor(private readonly db: DatabaseService) {}

  createWeek(profileId: number, status: WeekStatus): Week {
    const { lastInsertRowid } = this.db.run("INSERT INTO weeks (profile_id, status, created_at) VALUES (?, ?, ?)", [profileId, status, now()]);
    return this.week(lastInsertRowid);
  }

  week(id: number): Week {
    const row = this.db.get<Record<string, unknown>>("SELECT * FROM weeks WHERE id = ?", [id]);
    if (!row) throw new NotFoundException("Semaine introuvable");
    return toWeek(row);
  }

  weeks(profileId: number, limit = 60): Week[] {
    return this.db.all<Record<string, unknown>>("SELECT * FROM weeks WHERE profile_id = ? ORDER BY id DESC LIMIT ?", [profileId, limit]).map(toWeek);
  }

  weeksWithStatus(profileId: number, status: WeekStatus): Week[] {
    return this.db.all<Record<string, unknown>>("SELECT * FROM weeks WHERE profile_id = ? AND status = ? ORDER BY id", [profileId, status]).map(toWeek);
  }

  setWeekStatus(id: number, status: WeekStatus) {
    // node:sqlite refuse un paramètre nommé non utilisé : la date n'est passée que si la colonne est mise à jour.
    if (status === "active") this.db.run("UPDATE weeks SET status = ?, activated_at = ? WHERE id = ?", [status, now(), id]);
    else if (status === "cleaned") this.db.run("UPDATE weeks SET status = ?, cleaned_at = ? WHERE id = ?", [status, now(), id]);
    else this.db.run("UPDATE weeks SET status = ? WHERE id = ?", [status, id]);
  }

  deleteWeek(id: number) {
    this.db.run("DELETE FROM weeks WHERE id = ?", [id]);
  }

  addTracks(weekId: number, tracks: Omit<Track, "id" | "weekId" | "updatedAt" | "pickId" | "file" | "ratingKey" | "rating" | "keep" | "lossless" | "origin" | "quality" | "error">[]) {
    this.db.transaction(() => {
      for (const t of tracks) {
        this.db.run(
          `INSERT INTO tracks (week_id, artist, title, key, kind, score, status, link, preview_url, cover_url, position, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [weekId, t.artist, t.title, t.key, t.kind, t.score, t.status, t.link, t.previewUrl, t.coverUrl, t.position, now()],
        );
      }
    });
  }

  tracks(weekId: number): Track[] {
    return this.db.all<Record<string, unknown>>("SELECT * FROM tracks WHERE week_id = ? ORDER BY position", [weekId]).map(toTrack);
  }

  track(id: number): Track {
    const row = this.db.get<Record<string, unknown>>("SELECT * FROM tracks WHERE id = ?", [id]);
    if (!row) throw new NotFoundException("Titre introuvable");
    return toTrack(row);
  }

  updateTrack(id: number, patch: Partial<Track>) {
    const sets: string[] = [];
    const params: Record<string, SQLInputValue> = { id, updated_at: now() };
    for (const [key, value] of Object.entries(patch)) {
      const column = COLUMNS[key];
      if (!column) continue;
      sets.push(`${column} = :${column}`);
      params[column] = typeof value === "boolean" ? (value ? 1 : 0) : (value as SQLInputValue);
    }
    if (sets.length === 0) return;
    this.db.run(`UPDATE tracks SET ${sets.join(", ")}, updated_at = :updated_at WHERE id = :id`, params);
  }

  /** Clés déjà proposées à ce profil (hors simulations et rejets), pour ne jamais reproposer un titre. */
  proposedKeys(profileId: number): Set<string> {
    return new Set(
      this.db
        .all<{ key: string }>(
          `SELECT DISTINCT t.key FROM tracks t JOIN weeks w ON w.id = t.week_id
           WHERE w.profile_id = ? AND w.status != 'dryrun' AND t.status != 'rejected'`,
          [profileId],
        )
        .map((r) => r.key),
    );
  }

  /** Autres titres encore « vivants » (tous profils) qui pointent sur le même fichier. */
  othersUsingFile(file: string, exceptTrackId: number): Track[] {
    return this.db
      .all<Record<string, unknown>>("SELECT * FROM tracks WHERE file = ? AND id != ? AND status IN ('imported', 'pending')", [file, exceptTrackId])
      .map(toTrack);
  }

  moveFileReferences(from: string, to: string) {
    this.db.run("UPDATE tracks SET file = ?, updated_at = ? WHERE file = ?", [to, now(), from]);
  }

  pickStillUsed(pickId: number, exceptTrackId: number): boolean {
    return !!this.db.get("SELECT 1 FROM tracks WHERE pick_id = ? AND id != ? AND status IN ('queued', 'imported', 'pending')", [pickId, exceptTrackId]);
  }
}
