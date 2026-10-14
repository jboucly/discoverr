import { Injectable, Logger } from "@nestjs/common";
import path from "node:path";
import { fetchJson, HttpError } from "../common/http";
import { sleep } from "../common/text";
import { env } from "../env";

export interface PickarrTrack {
  id: number;
  status: string;
  error: string | null;
  title: string;
  artist: string;
  quality: string | null;
  origin: string | null;
  lossless: boolean;
  libraryFile: string | null;
}

export interface PickarrPick {
  id: number;
  url: string;
  error: string | null;
  expanded: boolean;
  tracks: PickarrTrack[];
}

const FINAL = new Set(["Imported", "Failed", "Skipped"]);

@Injectable()
export class PickarrService {
  private readonly logger = new Logger(PickarrService.name);

  private headers() {
    return {
      "X-Api-Key": env.pickarr.apiKey,
      "X-Requested-With": "pickarr",
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  async ping(): Promise<void> {
    await fetchJson(`${env.pickarr.url}/api/status`, { headers: this.headers() }, 1);
  }

  async addPick(url: string): Promise<PickarrPick> {
    const body: Record<string, unknown> = { url, autoImport: true };
    if (env.pickarr.subfolder) body.subfolder = env.pickarr.subfolder;
    const res = await fetchJson<{ pick: PickarrPick }>(`${env.pickarr.url}/api/picks`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    return res.pick;
  }

  getPick(id: number): Promise<PickarrPick> {
    return fetchJson<PickarrPick>(`${env.pickarr.url}/api/picks/${id}`, { headers: this.headers() });
  }

  async deletePick(id: number): Promise<void> {
    try {
      await fetchJson(`${env.pickarr.url}/api/picks/${id}`, { method: "DELETE", headers: this.headers() });
    } catch (err) {
      if (!(err instanceof HttpError && err.status === 404)) throw err;
    }
  }

  private isDone(pick: PickarrPick) {
    return pick.error !== null || (pick.expanded && pick.tracks.every((t) => FINAL.has(t.status)));
  }

  /** Attend la fin de tous les picks (ou le délai) ; `onProgress` est appelé à chaque tour avec le dernier état. */
  async waitForPicks(ids: number[], timeoutHours: number, onProgress?: (picks: Map<number, PickarrPick>) => void) {
    const deadline = Date.now() + timeoutHours * 3_600_000;
    const latest = new Map<number, PickarrPick>();
    let pending = [...ids];
    while (pending.length > 0 && Date.now() < deadline) {
      const still: number[] = [];
      for (const id of pending) {
        const pick = await this.getPick(id);
        latest.set(id, pick);
        if (!this.isDone(pick)) still.push(id);
      }
      pending = still;
      onProgress?.(latest);
      if (pending.length > 0) {
        this.logger.log(`${ids.length - pending.length}/${ids.length} téléchargements terminés`);
        await sleep(60_000);
      }
    }
    if (pending.length > 0) this.logger.warn(`Délai dépassé : ${pending.length} téléchargements non terminés`);
    return latest;
  }

  /** Fichier importé, vu par discoverr (LibraryFile est relatif au LibraryPath de l'instance pickarr). */
  localFile(track: PickarrTrack): string | null {
    if (track.status !== "Imported" || !track.libraryFile) return null;
    return path.join(env.paths.musicRoot, env.pickarr.librarySubdir, track.libraryFile);
  }
}
