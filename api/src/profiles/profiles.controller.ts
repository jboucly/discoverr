import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put } from "@nestjs/common";
import type { ProfileDto } from "../contracts";
import { LastfmService } from "../integrations/lastfm.service";
import { ProfilesService, type Profile, type ProfileInput } from "./profiles.service";

/** Le jeton Plex n'est jamais renvoyé au navigateur. */
const toDto = ({ plexToken, ...rest }: Profile): ProfileDto => ({ ...rest, hasPlexToken: !!plexToken });

function parseInput(body: Record<string, unknown>, partial: boolean): Partial<ProfileInput> {
  const out: Partial<ProfileInput> = {};
  const str = (k: keyof ProfileInput) => {
    if (body[k] === undefined) return;
    if (typeof body[k] !== "string") throw new BadRequestException(`${k} doit être un texte`);
    (out as Record<string, unknown>)[k] = body[k];
  };
  (["name", "lastfmUser", "playlistTitle", "likedSubdir"] as const).forEach(str);
  if (body.plexToken !== undefined) {
    if (body.plexToken !== null && typeof body.plexToken !== "string") throw new BadRequestException("plexToken invalide");
    out.plexToken = (body.plexToken as string | null) || null;
  }
  if (body.tracks !== undefined) out.tracks = Number(body.tracks);
  if (body.reviewMode !== undefined) out.reviewMode = body.reviewMode === true;
  if (body.enabled !== undefined) out.enabled = body.enabled === true;
  if (!partial) {
    out.plexToken ??= null;
    out.reviewMode ??= false;
    out.enabled ??= true;
    out.tracks ??= 30;
    out.likedSubdir ??= "pickarr";
  }
  return out;
}

@Controller("profiles")
export class ProfilesController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly lastfm: LastfmService,
  ) {}

  @Get()
  list() {
    return this.profiles.list().map(toDto);
  }

  @Post()
  create(@Body() body: Record<string, unknown>) {
    return toDto(this.profiles.create(parseInput(body ?? {}, false) as ProfileInput));
  }

  @Put(":id")
  update(@Param("id", ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return toDto(this.profiles.update(id, parseInput(body ?? {}, true)));
  }

  @Delete(":id")
  @HttpCode(204)
  remove(@Param("id", ParseIntPipe) id: number) {
    this.profiles.remove(id);
  }

  @Post("check-lastfm")
  async checkLastfm(@Body() body: { user?: string }) {
    if (!body?.user) throw new BadRequestException("Compte manquant");
    try {
      return await this.lastfm.checkUser(body.user);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
  }

  @Get(":id/blocked")
  blocked(@Param("id", ParseIntPipe) id: number) {
    return this.profiles.blocked(id);
  }

  @Post(":id/blocked")
  block(@Param("id", ParseIntPipe) id: number, @Body() body: { artist?: string }) {
    this.profiles.block(id, String(body?.artist ?? ""));
    return this.profiles.blocked(id);
  }

  @Delete(":id/blocked")
  unblock(@Param("id", ParseIntPipe) id: number, @Body() body: { artist?: string }) {
    this.profiles.unblock(id, String(body?.artist ?? ""));
    return this.profiles.blocked(id);
  }
}
