import { Injectable } from "@nestjs/common";
import YTMusic from "ytmusic-api";
import { mainArtist, normalize } from "../common/text";

@Injectable()
export class YtmusicService {
  private client?: Promise<YTMusic>;

  private ytmusic(): Promise<YTMusic> {
    this.client ??= (async () => {
      const client = new YTMusic();
      await client.initialize();
      return client;
    })().catch((err) => {
      this.client = undefined;
      throw err;
    });
    return this.client;
  }

  /**
   * Lien YouTube Music du titre, que pickarr sait lire (il retrouve ensuite les tags et cherche d'abord sur Soulseek :
   * ce lien sert surtout à identifier le morceau), et sa pochette. null si rien ne correspond vraiment.
   */
  async findSong(artist: string, title: string): Promise<{ link: string; coverUrl: string | null } | null> {
    const songs = await (await this.ytmusic()).searchSongs(`${artist} ${title}`);
    const wantedArtist = normalize(mainArtist(artist));
    const wantedTitle = normalize(title);
    const match = songs.slice(0, 5).find((song) => {
      const songArtist = normalize(song.artist.name);
      const songTitle = normalize(song.name);
      return (
        songArtist.length > 0 &&
        songTitle.length > 0 &&
        (songArtist.includes(wantedArtist) || wantedArtist.includes(songArtist)) &&
        (songTitle === wantedTitle || songTitle.startsWith(wantedTitle) || wantedTitle.startsWith(songTitle))
      );
    });
    if (!match) return null;
    // Vignettes de 60 et 120 px : la taille est dans l'URL (…=w120-h120-l90-rj), on en demande une plus grande.
    const thumbnail = [...match.thumbnails].sort((a, b) => b.width - a.width)[0]?.url;
    return {
      link: `https://music.youtube.com/watch?v=${match.videoId}`,
      coverUrl: thumbnail?.replace(/=w\d+-h\d+/, "=w300-h300") ?? null,
    };
  }
}
