import { Injectable } from "@nestjs/common";
import { fetchJson } from "../common/http";
import { mainArtist, normalize } from "../common/text";

interface DeezerTrack {
  title: string;
  preview: string;
  artist: { name: string };
  album: { cover_medium: string };
}

/** API publique Deezer (sans clé) : extrait de 30 s et pochette, pour écouter les candidats dans l'interface. */
@Injectable()
export class DeezerService {
  async preview(artist: string, title: string): Promise<{ previewUrl: string | null; coverUrl: string | null }> {
    try {
      const q = `artist:"${mainArtist(artist).replace(/"/g, "")}" track:"${title.replace(/"/g, "")}"`;
      const res = await fetchJson<{ data?: DeezerTrack[] }>(`https://api.deezer.com/search?${new URLSearchParams({ q, limit: "5" })}`, {}, 2);
      const wantedArtist = normalize(mainArtist(artist));
      const match = res.data?.find((t) => normalize(t.artist.name).includes(wantedArtist)) ?? res.data?.[0];
      return { previewUrl: match?.preview || null, coverUrl: match?.album.cover_medium || null };
    } catch {
      return { previewUrl: null, coverUrl: null };
    }
  }
}
