import { Injectable } from "@nestjs/common";
import type { Stats, WeekStat } from "../contracts";
import { DatabaseService } from "../db/database.service";

/** Chiffres calculés sur l'historique en base. Une semaine compte dès qu'elle a été téléchargée. */
@Injectable()
export class StatsService {
  constructor(private readonly db: DatabaseService) {}

  forProfile(profileId: number): Stats {
    const weeks = this.db.all<WeekStat>(
      `SELECT w.id AS weekId, substr(w.created_at, 1, 10) AS date,
              SUM(t.status IN ('imported', 'pending', 'liked', 'deleted')) AS proposed,
              SUM(t.status = 'liked') AS liked,
              SUM(t.status = 'deleted') AS deleted,
              SUM(t.status = 'failed') AS failed
       FROM weeks w JOIN tracks t ON t.week_id = w.id
       WHERE w.profile_id = ? AND w.status IN ('downloading', 'active', 'cleaned')
       GROUP BY w.id ORDER BY w.id`,
      [profileId],
    );

    const totals = this.db.get<{ proposed: number; liked: number; decided: number; queued: number; failed: number; lossless: number }>(
      `SELECT SUM(t.status IN ('imported', 'pending', 'liked', 'deleted')) AS proposed,
              SUM(t.status = 'liked') AS liked,
              SUM(t.status IN ('liked', 'deleted')) AS decided,
              SUM(t.status NOT IN ('candidate', 'rejected')) AS queued,
              SUM(t.status = 'failed') AS failed,
              SUM(t.lossless = 1) AS lossless
       FROM tracks t JOIN weeks w ON w.id = t.week_id
       WHERE w.profile_id = ? AND w.status IN ('downloading', 'active', 'cleaned')`,
      [profileId],
    ) ?? { proposed: 0, liked: 0, decided: 0, queued: 0, failed: 0, lossless: 0 };

    // Taux de ❤️ selon l'origine : titres proches de tes écoutes vs nouveaux artistes.
    const byKind = this.db.all<{ kind: string; decided: number; liked: number }>(
      `SELECT t.kind, SUM(t.status IN ('liked', 'deleted')) AS decided, SUM(t.status = 'liked') AS liked
       FROM tracks t JOIN weeks w ON w.id = t.week_id
       WHERE w.profile_id = ? GROUP BY t.kind`,
      [profileId],
    );

    const sources = this.db.all<{ origin: string; count: number }>(
      `SELECT COALESCE(t.origin, 'Inconnue') AS origin, COUNT(*) AS count
       FROM tracks t JOIN weeks w ON w.id = t.week_id
       WHERE w.profile_id = ? AND t.status IN ('imported', 'pending', 'liked', 'deleted')
       GROUP BY 1 ORDER BY count DESC`,
      [profileId],
    );

    const topArtists = this.db.all<{ artist: string; liked: number }>(
      `SELECT t.artist, COUNT(*) AS liked FROM tracks t JOIN weeks w ON w.id = t.week_id
       WHERE w.profile_id = ? AND t.status = 'liked'
       GROUP BY lower(t.artist) ORDER BY liked DESC, t.artist LIMIT 10`,
      [profileId],
    );

    const rejected = this.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM tracks t JOIN weeks w ON w.id = t.week_id WHERE w.profile_id = ? AND t.status = 'rejected'",
      [profileId],
    )?.n ?? 0;

    const rate = (liked: number, decided: number) => (decided > 0 ? liked / decided : null);
    return {
      weeks: weeks.map((w) => ({ ...w, likeRate: rate(w.liked, w.liked + w.deleted) })),
      totals: {
        weeks: weeks.length,
        proposed: totals.proposed ?? 0,
        liked: totals.liked ?? 0,
        likeRate: rate(totals.liked ?? 0, totals.decided ?? 0),
        downloadSuccess: totals.queued ? 1 - (totals.failed ?? 0) / totals.queued : null,
        losslessRate: totals.proposed ? (totals.lossless ?? 0) / totals.proposed : null,
        rejected,
      },
      byKind: byKind.map((k) => ({ kind: k.kind, decided: k.decided, liked: k.liked, likeRate: rate(k.liked, k.decided) })),
      sources,
      topArtists,
    };
  }
}
