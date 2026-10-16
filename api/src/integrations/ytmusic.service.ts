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
   * The track's YouTube Music link, which pickarr can read (it then finds the tags and tries Soulseek first:
   * the link mostly identifies the song), and its cover. null if nothing really matches.
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
    // 60 and 120 px thumbnails: the size is in the URL (…=w120-h120-l90-rj), so ask for a bigger one.
    const thumbnail = [...match.thumbnails].sort((a, b) => b.width - a.width)[0]?.url;
    return {
      link: `https://music.youtube.com/watch?v=${match.videoId}`,
      coverUrl: thumbnail?.replace(/=w\d+-h\d+/, "=w300-h300") ?? null,
    };
  }
}
