import { Injectable } from "@nestjs/common";
import { fetchJson } from "../common/http";
import { mainArtist, normalize, sleep, stripVersion } from "../common/text";
import { env } from "../env";

export interface PlexTrack {
  ratingKey: string;
  title: string;
  grandparentTitle?: string;
  originalTitle?: string;
  userRating?: number;
  Media?: { Part?: { file: string }[] }[];
}

interface Section {
  key: string;
  type: string;
  title: string;
  Location?: { path: string }[];
}

interface Container<T> {
  MediaContainer: { Metadata?: T[]; Directory?: T[]; machineIdentifier?: string; friendlyName?: string; version?: string };
}

interface Playlist {
  ratingKey: string;
  title: string;
  smart: boolean | number;
}

/**
 * Ratings (❤️) and playlists belong to each Plex account: these calls take the profile's token.
 * Library operations (scan, trash) use the admin token.
 */
@Injectable()
export class PlexService {
  private machineId?: string;

  private request<T>(pathAndQuery: string, token = env.plex.token, method = "GET", attempts = 3): Promise<T> {
    const sep = pathAndQuery.includes("?") ? "&" : "?";
    return fetchJson<T>(
      `${env.plex.url}${pathAndQuery}${sep}X-Plex-Token=${encodeURIComponent(token)}`,
      { method, headers: { Accept: "application/json" } },
      attempts,
    );
  }

  async identity(token = env.plex.token): Promise<{ machineIdentifier: string; version?: string }> {
    const c = (await this.request<Container<never>>("/identity", token, "GET", 1)).MediaContainer;
    if (!c.machineIdentifier) throw new Error("Plex : machineIdentifier introuvable");
    this.machineId = c.machineIdentifier;
    return { machineIdentifier: c.machineIdentifier, version: c.version };
  }

  private async machineIdentifier(): Promise<string> {
    return this.machineId ?? (await this.identity()).machineIdentifier;
  }

  private async musicSections(token = env.plex.token): Promise<Section[]> {
    const sections = (await this.request<Container<Section>>("/library/sections", token)).MediaContainer.Directory ?? [];
    return sections.filter((s) => s.type === "artist");
  }

  private async sectionFor(plexPath: string): Promise<Section> {
    const section = (await this.musicSections()).find((s) => s.Location?.some((l) => plexPath.startsWith(l.path)));
    if (!section) throw new Error(`Plex : aucune bibliothèque musicale ne contient ${plexPath}`);
    return section;
  }

  /** Is the folder covered by a music library? ("État" page) */
  async folderInLibrary(plexPath: string): Promise<boolean> {
    return this.sectionFor(plexPath).then(
      () => true,
      () => false,
    );
  }

  private async searchTracks(section: Section, title: string, token = env.plex.token): Promise<PlexTrack[]> {
    const query = new URLSearchParams({ type: "10", title });
    return (await this.request<Container<PlexTrack>>(`/library/sections/${section.key}/all?${query}`, token)).MediaContainer.Metadata ?? [];
  }

  private files(t: PlexTrack) {
    return t.Media?.flatMap((m) => m.Part?.map((p) => p.file) ?? []) ?? [];
  }

  async isInLibrary(artist: string, title: string): Promise<boolean> {
    const wantedArtist = normalize(mainArtist(artist));
    // Across all versions: if the user has the original, the remix is not suggested (and vice versa).
    const wantedTitle = normalize(stripVersion(title));
    for (const section of await this.musicSections()) {
      for (const track of await this.searchTracks(section, stripVersion(title))) {
        const trackArtist = normalize(mainArtist(track.originalTitle ?? track.grandparentTitle ?? ""));
        if (normalize(stripVersion(track.title)) === wantedTitle && trackArtist === wantedArtist) return true;
      }
    }
    return false;
  }

  /**
   * Finds a file's item, giving the scan time to add it (up to `waitMs`).
   * The search uses the title without its version: Last.fm writes "Machete - A.M.C Remix", pickarr's tags
   * "Machete (A.M.C Remix)", and Plex only searches by substring. The file path then settles it.
   */
  async findByFile(plexPath: string, title: string, token = env.plex.token, waitMs = 5 * 60_000): Promise<PlexTrack | null> {
    const section = await this.sectionFor(plexPath);
    const deadline = Date.now() + waitMs;
    do {
      const found = (await this.searchTracks(section, stripVersion(title), token)).find((t) => this.files(t).includes(plexPath));
      if (found) return found;
      if (waitMs > 0) await sleep(15_000);
    } while (Date.now() < deadline);
    return null;
  }

  async getTrack(ratingKey: string, token = env.plex.token, attempts = 3): Promise<PlexTrack | null> {
    return (await this.request<Container<PlexTrack>>(`/library/metadata/${ratingKey}`, token, "GET", attempts)).MediaContainer.Metadata?.[0] ?? null;
  }

  async rate(ratingKey: string, rating: number, token = env.plex.token): Promise<void> {
    const query = new URLSearchParams({ key: ratingKey, identifier: "com.plexapp.plugins.library", rating: String(rating) });
    await this.request(`/:/rate?${query}`, token, "PUT");
  }

  async scanFolder(plexPath: string): Promise<void> {
    const section = await this.sectionFor(plexPath);
    await this.request(`/library/sections/${section.key}/refresh?${new URLSearchParams({ path: plexPath })}`);
  }

  async emptyTrash(plexPath: string): Promise<void> {
    const section = await this.sectionFor(plexPath);
    await this.request(`/library/sections/${section.key}/emptyTrash`, env.plex.token, "PUT");
  }

  private async audioPlaylists(token: string): Promise<Playlist[]> {
    return (await this.request<Container<Playlist>>("/playlists?playlistType=audio", token)).MediaContainer.Metadata ?? [];
  }

  /** Titles of the account's manual playlists, except `exceptTitles` (discoverr's playlists). */
  async tracksInOtherPlaylists(exceptTitles: string[], token = env.plex.token): Promise<Set<string>> {
    const keys = new Set<string>();
    for (const playlist of await this.audioPlaylists(token)) {
      if (exceptTitles.includes(playlist.title) || playlist.smart === true || playlist.smart === 1) continue;
      const items = (await this.request<Container<PlexTrack>>(`/playlists/${playlist.ratingKey}/items`, token)).MediaContainer.Metadata ?? [];
      items.forEach((i) => keys.add(i.ratingKey));
    }
    return keys;
  }

  /** Replaces the playlist's content (created if needed), keeping the same playlist for Plexamp. */
  async replacePlaylist(title: string, ratingKeys: string[], token = env.plex.token): Promise<void> {
    const uri = `server://${await this.machineIdentifier()}/com.plexapp.plugins.library/library/metadata/${ratingKeys.join(",")}`;
    const existing = (await this.audioPlaylists(token)).find((p) => p.title === title);
    if (!existing) {
      await this.request(`/playlists?${new URLSearchParams({ type: "audio", title, smart: "0", uri })}`, token, "POST");
      return;
    }
    await this.request(`/playlists/${existing.ratingKey}/items`, token, "DELETE");
    await this.request(`/playlists/${existing.ratingKey}/items?${new URLSearchParams({ uri })}`, token, "PUT");
  }
}
