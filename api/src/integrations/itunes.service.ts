import { Injectable, Logger } from "@nestjs/common";
import { fetchJson, HttpError } from "../common/http";
import { mainArtist, normalize, sleep, stripVersion } from "../common/text";

export interface ItunesSong {
  artistName: string;
  trackName: string;
  previewUrl?: string;
}

/** The result that really is this track: right artist and same title, across all versions. */
export function matchSong(results: ItunesSong[], artist: string, title: string): ItunesSong | null {
  const wantedArtist = normalize(mainArtist(artist));
  const wantedTitle = normalize(stripVersion(title));
  return (
    results.find(
      (r) => !!r.previewUrl && normalize(r.artistName).includes(wantedArtist) && normalize(stripVersion(r.trackName)) === wantedTitle,
    ) ?? null
  );
}

/** Apple limits the search API to about twenty calls per minute. */
const MIN_INTERVAL_MS = 3_000;
/** After a refusal (403, 429), leave the API alone: insisting ends up getting the IP blocked. */
const PAUSE_AFTER_REFUSAL_MS = 3_600_000;

/**
 * 30 s previews to listen to candidates in the UI, through the iTunes search API (no key).
 * Optional: without a preview, the track is still suggested with its YouTube Music link.
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

  /** "État" page: does the API answer from this server? */
  async check(): Promise<void> {
    if (Date.now() < this.pausedUntil) throw new Error("en pause après un refus d'iTunes");
    await this.search("Daft Punk One More Time");
  }
}
