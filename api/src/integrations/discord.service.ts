import { Injectable, Logger } from "@nestjs/common";
import { SettingsService } from "../settings/settings.service";

const RED = 0xe74c3c;
const GREEN = 0x2ecc71;
const ORANGE = 0xf39c12;

@Injectable()
export class DiscordService {
  private readonly logger = new Logger(DiscordService.name);

  constructor(private readonly settings: SettingsService) {}

  private async send(title: string, description: string, color: number, url = this.settings.get().discordWebhookUrl): Promise<void> {
    if (!url) return;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "discoverr",
          embeds: [{ title: title.slice(0, 250), description: description.slice(0, 4000), color, timestamp: new Date().toISOString() }],
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) this.logger.warn(`Discord : ${res.status} ${await res.text()}`);
    } catch (err) {
      this.logger.warn(`Discord : envoi impossible (${(err as Error).message})`);
    }
  }

  error(title: string, details: string) {
    return this.send(`❌ ${title}`, details, RED);
  }

  warning(title: string, details: string) {
    return this.send(`⚠️ ${title}`, details, ORANGE);
  }

  summary(title: string, lines: string[]) {
    if (!this.settings.get().notifySuccess) return Promise.resolve();
    return this.send(`🎧 ${title}`, lines.join("\n"), GREEN);
  }

  test(url: string) {
    return this.send("🔔 Test discoverr", "Les notifications fonctionnent.", GREEN, url);
  }
}
