import { BadRequestException, Injectable } from "@nestjs/common";
import { validateCronExpression } from "cron";
import { DatabaseService } from "../db/database.service";

export interface Settings {
  /** Planification du lancement hebdomadaire (expression cron, fuseau TZ). */
  cron: string;
  /** Lancement planifié actif. */
  scheduleEnabled: boolean;
  /** Ne télécharge, ne déplace et ne supprime rien : journalise seulement. */
  dryRun: boolean;
  /** Note Plex minimale pour qu'un titre compte comme aimé (❤️ = 10). */
  likedMinRating: number;
  /** Un titre ajouté à une autre playlist manuelle est gardé. */
  keepIfInOtherPlaylist: boolean;
  /** Part de titres d'artistes jamais écoutés (0 à 1). */
  newArtistRatio: number;
  maxPerArtist: number;
  /** Délai max d'attente des téléchargements pickarr. */
  pickarrTimeoutHours: number;
  /** En mode validation : délai après lequel les candidats sont validés d'office (0 = jamais). */
  reviewAutoApproveHours: number;
  discordWebhookUrl: string;
  notifySuccess: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  cron: "0 3 * * 1",
  scheduleEnabled: true,
  dryRun: false,
  likedMinRating: 10,
  keepIfInOtherPlaylist: true,
  newArtistRatio: 0.3,
  maxPerArtist: 2,
  pickarrTimeoutHours: 6,
  reviewAutoApproveHours: 48,
  discordWebhookUrl: "",
  notifySuccess: true,
};

type Listener = (settings: Settings) => void;

@Injectable()
export class SettingsService {
  private cache?: Settings;
  private readonly listeners: Listener[] = [];

  constructor(private readonly db: DatabaseService) {}

  /** Valeurs en base, complétées par les valeurs par défaut (et, au premier démarrage, par l'environnement). */
  get(): Settings {
    if (this.cache) return this.cache;
    const rows = this.db.all<{ key: string; value: string }>("SELECT key, value FROM settings");
    const stored = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)])) as Partial<Settings>;
    const fromEnv: Partial<Settings> = {
      ...(process.env.DISCOVERR_CRON ? { cron: process.env.DISCOVERR_CRON } : {}),
      ...(process.env.DISCORD_WEBHOOK_URL ? { discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL } : {}),
      ...(process.env.DRY_RUN ? { dryRun: ["1", "true"].includes(process.env.DRY_RUN.toLowerCase()) } : {}),
    };
    this.cache = { ...DEFAULT_SETTINGS, ...fromEnv, ...stored };
    return this.cache;
  }

  update(patch: Partial<Settings>): Settings {
    const next = { ...this.get() };
    for (const [key, value] of Object.entries(patch) as [keyof Settings, unknown][]) {
      if (!(key in DEFAULT_SETTINGS)) throw new BadRequestException(`Réglage inconnu : ${key}`);
      if (typeof value !== typeof DEFAULT_SETTINGS[key]) throw new BadRequestException(`Type invalide pour ${key}`);
      (next as Record<string, unknown>)[key] = value;
    }
    const valid = validateCronExpression(next.cron);
    if (!valid.valid) throw new BadRequestException(`Planification invalide : ${valid.error?.message ?? next.cron}`);
    if (next.newArtistRatio < 0 || next.newArtistRatio > 1) throw new BadRequestException("newArtistRatio doit être entre 0 et 1");
    if (next.maxPerArtist < 1) throw new BadRequestException("maxPerArtist doit être au moins 1");
    if (next.likedMinRating < 1 || next.likedMinRating > 10) throw new BadRequestException("likedMinRating doit être entre 1 et 10");
    if (next.discordWebhookUrl && !/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(next.discordWebhookUrl)) {
      throw new BadRequestException("URL de webhook Discord invalide");
    }

    this.db.transaction(() => {
      for (const [key, value] of Object.entries(next)) {
        this.db.run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [
          key,
          JSON.stringify(value),
        ]);
      }
    });
    this.cache = next;
    this.listeners.forEach((l) => l(next));
    return next;
  }

  onChange(listener: Listener) {
    this.listeners.push(listener);
  }
}
