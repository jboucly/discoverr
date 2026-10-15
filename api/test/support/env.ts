// Importé en premier par chaque test : env.ts lit l'environnement au chargement et exige ces variables.
import { Logger } from "@nestjs/common";

process.env.LASTFM_API_KEY = "test";
process.env.PICKARR_API_KEY = "test";
process.env.PLEX_TOKEN = "admin-token";
for (const name of ["LASTFM_USER", "DRY_RUN", "DISCOVERR_CRON", "DISCORD_WEBHOOK_URL", "PICKARR_SUBFOLDER", "ALLOW_DELETE_IN_PICKARR_LIBRARY"]) {
  delete process.env[name];
}

Logger.overrideLogger(false);
