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
   * Lien YouTube Music du titre, que pickarr sait lire. Pickarr retrouve ensuite les tags sur Deezer et cherche
   * d'abord sur Soulseek : ce lien sert surtout à identifier le morceau. null si rien ne correspond vraiment.
   */
  async findLink(artist: string, title: string): Promise<string | null> {
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
    return match ? `https://music.youtube.com/watch?v=${match.videoId}` : null;
  }
}
