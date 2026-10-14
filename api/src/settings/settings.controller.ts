import { BadRequestException, Body, Controller, Get, HttpCode, Post, Put } from "@nestjs/common";
import { DiscordService } from "../integrations/discord.service";
import { SettingsService, type Settings } from "./settings.service";

@Controller("settings")
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly discord: DiscordService,
  ) {}

  @Get()
  get() {
    return this.settings.get();
  }

  @Put()
  update(@Body() body: Partial<Settings>) {
    if (!body || typeof body !== "object") throw new BadRequestException("Corps invalide");
    return this.settings.update(body);
  }

  @Post("test-discord")
  @HttpCode(204)
  async testDiscord(@Body() body: { url?: string }) {
    const url = body?.url || this.settings.get().discordWebhookUrl;
    if (!url) throw new BadRequestException("Aucun webhook configuré");
    await this.discord.test(url);
  }
}
