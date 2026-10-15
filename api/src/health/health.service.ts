import { Injectable } from "@nestjs/common";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Check } from "../contracts";
import { discoveryDir, env, musicDir, sharedPickarrLibrary, toPlexPath } from "../env";
import { LastfmService } from "../integrations/lastfm.service";
import { PickarrService } from "../integrations/pickarr.service";
import { PlexService } from "../integrations/plex.service";
import { ProfilesService } from "../profiles/profiles.service";

const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} Go`;

/** Page « État » : tout ce qui doit marcher pour qu'un lancement réussisse, vérifié en direct. */
@Injectable()
export class HealthService {
  constructor(
    private readonly plex: PlexService,
    private readonly pickarr: PickarrService,
    private readonly lastfm: LastfmService,
    private readonly profiles: ProfilesService,
  ) {}

  private async check(name: string, fn: () => Promise<string>): Promise<Check> {
    try {
      return { name, ok: true, detail: await fn() };
    } catch (err) {
      return { name, ok: false, detail: (err as Error).message };
    }
  }

  async details() {
    const profiles = this.profiles.list();
    const checks = await Promise.all([
      this.check("Plex", async () => {
        const id = await this.plex.identity();
        return `joignable${id.version ? ` (version ${id.version})` : ""}`;
      }),
      this.check("pickarr", async () => {
        await this.pickarr.ping();
        return `joignable (${env.pickarr.url})`;
      }),
      this.check("Dossier des découvertes", async () => {
        await fs.access(discoveryDir(), fs.constants.W_OK).catch(() => {
          throw new Error(`${discoveryDir()} introuvable ou non accessible en écriture`);
        });
        if (!(await this.plex.folderInLibrary(toPlexPath(discoveryDir())))) throw new Error(`${toPlexPath(discoveryDir())} n'est dans aucune bibliothèque musicale Plex`);
        return `${discoveryDir()} : accessible en écriture et dans Plex`;
      }),
      ...(sharedPickarrLibrary()
        ? [
            this.check("Bibliothèque pickarr partagée", async () => {
              const expected = path.posix.join(env.pickarr.librarySubdir, env.pickarr.subfolder);
              if (!env.pickarr.subfolder || expected !== env.paths.discoverySubdir) {
                throw new Error(`DISCOVERY_SUBDIR (${env.paths.discoverySubdir}) doit valoir PICKARR_LIBRARY_SUBDIR/PICKARR_SUBFOLDER (${expected})`);
              }
              if (!env.pickarr.allowDeleteInLibrary) throw new Error("ALLOW_DELETE_IN_PICKARR_LIBRARY n'est pas à true : le ménage ne supprimera rien");
              return `suppression autorisée dans ${discoveryDir()}`;
            }),
          ]
        : []),
      this.check("Espace disque", async () => {
        const s = await fs.statfs(env.paths.musicRoot);
        const free = s.bavail * s.bsize;
        if (free < 5 * 1024 ** 3) throw new Error(`plus que ${gb(free)} libres`);
        return `${gb(free)} libres sur ${gb(s.blocks * s.bsize)}`;
      }),
      ...profiles.flatMap((p) => [
        this.check(`Last.fm (${p.name})`, async () => {
          const info = await this.lastfm.checkUser(p.lastfmUser);
          if (info.playcount === 0) throw new Error(`${p.lastfmUser} n'a aucune écoute : le scrobbling est-il actif ?`);
          return `${p.lastfmUser} : ${info.playcount.toLocaleString("fr-FR")} écoutes`;
        }),
        this.check(`Plex (${p.name})`, async () => {
          if (p.plexToken) await this.plex.identity(p.plexToken);
          const liked = musicDir(p.likedSubdir);
          await fs.access(liked, fs.constants.W_OK).catch(() => {
            throw new Error(`dossier des aimés ${liked} introuvable ou non accessible en écriture`);
          });
          if (!(await this.plex.folderInLibrary(toPlexPath(liked)))) throw new Error(`${toPlexPath(liked)} n'est dans aucune bibliothèque musicale Plex`);
          return `${p.plexToken ? "jeton du profil valide, " : ""}dossier des aimés ${liked} prêt`;
        }),
      ]),
    ]);
    return { ok: checks.every((c) => c.ok), checks };
  }
}
