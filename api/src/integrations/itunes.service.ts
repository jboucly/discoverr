import { Injectable, Logger } from "@nestjs/common";
import { fetchJson, HttpError } from "../common/http";
import { mainArtist, normalize, sleep, stripVersion } from "../common/text";

export interface ItunesSong {
  artistName: string;
  trackName: string;
  previewUrl?: string;
}

/** Le résultat qui est vraiment ce titre : bon artiste et même titre, toutes versions confondues. */
export function matchSong(results: ItunesSong[], artist: string, title: string): ItunesSong | null {
  const wantedArtist = normalize(mainArtist(artist));
  const wantedTitle = normalize(stripVersion(title));
  return (
    results.find(
      (r) => !!r.previewUrl && normalize(r.artistName).includes(wantedArtist) && normalize(stripVersion(r.trackName)) === wantedTitle,
    ) ?? null
  );
}

/** Apple limite l'API de recherche à une vingtaine d'appels par minute. */
const MIN_INTERVAL_MS = 3_000;
/** Après un refus (403, 429), on laisse l'API tranquille : insister finit par faire bloquer l'IP. */
const PAUSE_AFTER_REFUSAL_MS = 3_600_000;

/**
 * Extraits de 30 s pour écouter les candidats dans l'interface, via l'API de recherche iTunes (sans clé).
 * Facultatif : sans extrait, le titre reste proposé avec son lien YouTube Music.
 */
@Injectable()
export class ItunesService {
  private readonly logger = new Logger(ItunesService.name);
  private nextCallAt = 0;
  private pausedUntil = 0;

  private async search(term: string): Promise<ItunesSong[]> {
    const wait = this.nextCallAt - Date.now();
    this.nextCallAt = Math.max(Date.now(), this.nextCallAt) + MIN_INTERVAL_MS;
    if (wait > 0) await sleep(wait);
    const query = new URLSearchParams({ term, entity: "song", limit: "25", country: "FR" });
    const res = await fetchJson<{ results?: ItunesSong[] }>(`https://itunes.apple.com/search?${query}`, {}, 1);
    return res.results ?? [];
  }

  async preview(artist: string, title: string): Promise<string | null> {
    if (Date.now() < this.pausedUntil) return null;
    try {
      const results = await this.search(`${mainArtist(artist)} ${stripVersion(title)}`);
      return matchSong(results, artist, title)?.previewUrl ?? null;
    } catch (err) {
      if (err instanceof HttpError && (err.status === 403 || err.status === 429)) {
        this.pausedUntil = Date.now() + PAUSE_AFTER_REFUSAL_MS;
        this.logger.warn(`iTunes refuse les recherches (${err.status}) : pas d'extraits pendant une heure`);
      }
      return null;
    }
  }

  /** Page État : l'API répond-elle depuis ce serveur ? */
  async check(): Promise<void> {
    if (Date.now() < this.pausedUntil) throw new Error("en pause après un refus d'iTunes");
    await this.search("Daft Punk One More Time");
  }
}
