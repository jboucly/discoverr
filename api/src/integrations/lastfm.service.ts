import { Injectable, Logger } from "@nestjs/common";
import { fetchJson } from "../common/http";
import { artistKey, normalize, sleep, trackKey } from "../common/text";
import { env } from "../env";

export interface Candidate {
  artist: string;
  title: string;
  key: string;
  score: number;
  kind: "similar" | "new-artist";
}

export interface PickOptions {
  user: string;
  count: number;
  newArtistRatio: number;
  maxPerArtist: number;
  /** Filtre supplémentaire : déjà proposé, artiste bloqué, déjà dans Plex… */
  exclude: (c: Candidate) => Promise<boolean>;
}

interface LfTrack {
  name: string;
  artist: { name?: string; "#text"?: string };
  match?: string;
}

interface Seed {
  artist: string;
  title: string;
  weight: number;
}

const artistName = (t: LfTrack) => t.artist.name ?? t.artist["#text"] ?? "";
const asArray = <T>(value: T | T[] | undefined): T[] => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

@Injectable()
export class LastfmService {
  private readonly logger = new Logger(LastfmService.name);
  private queue: Promise<unknown> = Promise.resolve();

  /** Appels en file, ~4 requêtes/s (Last.fm tolère 5/s). */
  private call<T>(method: string, params: Record<string, string | number>): Promise<T> {
    const task = this.queue.then(async () => {
      await sleep(250);
      const query = new URLSearchParams({
        method,
        api_key: env.lastfmApiKey,
        format: "json",
        autocorrect: "1",
        ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
      });
      const data = await fetchJson<T & { error?: number; message?: string }>(`https://ws.audioscrobbler.com/2.0/?${query}`);
      if (data?.error) throw new Error(`Last.fm ${method} : ${data.message} (${data.error})`);
      return data;
    });
    this.queue = task.catch(() => undefined);
    return task;
  }

  /** Vérifie que le compte existe et a des écoutes. */
  async checkUser(user: string): Promise<{ playcount: number; registered: string | null }> {
    const data = await this.call<{ user: { playcount: string; registered?: { "#text"?: number } } }>("user.getinfo", { user });
    const ts = data.user.registered?.["#text"];
    return { playcount: Number(data.user.playcount ?? 0), registered: ts ? new Date(ts * 1000).toISOString() : null };
  }

  private async seeds(user: string): Promise<Map<string, Seed>> {
    const [month, quarter, loved, recent] = await Promise.all([
      this.call<{ toptracks: { track: LfTrack[] } }>("user.gettoptracks", { user, period: "1month", limit: 30 }),
      this.call<{ toptracks: { track: LfTrack[] } }>("user.gettoptracks", { user, period: "3month", limit: 30 }),
      this.call<{ lovedtracks: { track: LfTrack[] } }>("user.getlovedtracks", { user, limit: 30 }),
      this.call<{ recenttracks: { track: LfTrack[] } }>("user.getrecenttracks", { user, limit: 50 }),
    ]);
    const result = new Map<string, Seed>();
    const add = (tracks: LfTrack[], weight: number) => {
      for (const t of tracks) {
        const artist = artistName(t);
        if (!artist || !t.name) continue;
        const key = trackKey(artist, t.name);
        const seed = result.get(key);
        if (seed) seed.weight += weight;
        else result.set(key, { artist, title: t.name, weight });
      }
    };
    add(asArray(loved.lovedtracks?.track), 2);
    add(asArray(month.toptracks?.track), 1.5);
    add(asArray(quarter.toptracks?.track), 1);
    add(asArray(recent.recenttracks?.track), 0.5);
    return result;
  }

  private async similarTracks(seeds: Seed[]): Promise<Candidate[]> {
    const scores = new Map<string, Candidate>();
    for (const seed of seeds) {
      try {
        const data = await this.call<{ similartracks: { track: LfTrack[] } }>("track.getsimilar", {
          artist: seed.artist,
          track: seed.title,
          limit: 20,
        });
        for (const t of asArray(data.similartracks?.track)) {
          const artist = artistName(t);
          const key = trackKey(artist, t.name);
          const score = seed.weight * Number(t.match ?? 0);
          const existing = scores.get(key);
          if (existing) existing.score += score;
          else scores.set(key, { artist, title: t.name, key, score, kind: "similar" });
        }
      } catch (err) {
        this.logger.warn(`track.getsimilar ignoré pour ${seed.artist} - ${seed.title} : ${(err as Error).message}`);
      }
    }
    return [...scores.values()].sort((a, b) => b.score - a.score);
  }

  private async newArtistTracks(user: string, knownArtists: Set<string>): Promise<Candidate[]> {
    const top = await this.call<{ topartists: { artist: { name: string }[] } }>("user.gettopartists", { user, period: "3month", limit: 20 });
    const favourites = asArray(top.topartists?.artist).map((a) => a.name);
    favourites.forEach((name) => knownArtists.add(artistKey(name)));

    const scores = new Map<string, { name: string; score: number }>();
    for (const [index, favourite] of favourites.entries()) {
      try {
        const data = await this.call<{ similarartists: { artist: { name: string; match: string }[] } }>("artist.getsimilar", {
          artist: favourite,
          limit: 15,
        });
        const weight = 1 - index / (favourites.length * 2);
        for (const a of asArray(data.similarartists?.artist)) {
          const key = artistKey(a.name);
          if (knownArtists.has(key)) continue;
          const entry = scores.get(key) ?? { name: a.name, score: 0 };
          entry.score += weight * Number(a.match ?? 0);
          scores.set(key, entry);
        }
      } catch (err) {
        this.logger.warn(`artist.getsimilar ignoré pour ${favourite} : ${(err as Error).message}`);
      }
    }

    const candidates: Candidate[] = [];
    for (const artist of [...scores.values()].sort((a, b) => b.score - a.score).slice(0, 25)) {
      if ((await this.userPlaycount(user, "artist.getinfo", { artist: artist.name })) > 0) continue;
      try {
        const data = await this.call<{ toptracks: { track: LfTrack[] } }>("artist.gettoptracks", { artist: artist.name, limit: 3 });
        for (const t of asArray(data.toptracks?.track)) {
          const name = artistName(t) || artist.name;
          candidates.push({ artist: name, title: t.name, key: trackKey(name, t.name), score: artist.score, kind: "new-artist" });
        }
      } catch (err) {
        this.logger.warn(`artist.gettoptracks ignoré pour ${artist.name} : ${(err as Error).message}`);
      }
    }
    return candidates;
  }

  private async userPlaycount(user: string, method: "track.getinfo" | "artist.getinfo", params: Record<string, string>): Promise<number> {
    try {
      const data = await this.call<{ track?: { userplaycount?: string }; artist?: { stats?: { userplaycount?: string } } }>(method, {
        ...params,
        username: user,
      });
      return Number(data.track?.userplaycount ?? data.artist?.stats?.userplaycount ?? 0);
    } catch {
      return 0;
    }
  }

  /** Titres jamais écoutés : une part de nouveaux artistes, le reste proche de tes titres, avec un plafond par artiste. */
  async pickCandidates(options: PickOptions): Promise<Candidate[]> {
    const { user, count } = options;
    const seedMap = await this.seeds(user);
    if (seedMap.size === 0) throw new Error(`Aucune écoute Last.fm pour ${user} : le scrobbling est-il actif ?`);
    const seeds = [...seedMap.values()].sort((a, b) => b.weight - a.weight).slice(0, 40);
    this.logger.log(`[${user}] ${seedMap.size} graines, ${seeds.length} utilisées`);

    const knownArtists = new Set(seeds.map((s) => artistKey(s.artist)));
    const similar = await this.similarTracks(seeds);
    const fresh = options.newArtistRatio > 0 ? await this.newArtistTracks(user, knownArtists) : [];
    this.logger.log(`[${user}] ${similar.length} titres similaires, ${fresh.length} de nouveaux artistes`);

    const picked: Candidate[] = [];
    const perArtist = new Map<string, number>();
    const take = async (pool: Candidate[], quota: number) => {
      let taken = 0;
      for (const c of pool) {
        if (taken >= quota || picked.length >= count) break;
        const key = artistKey(c.artist);
        if ((perArtist.get(key) ?? 0) >= options.maxPerArtist) continue;
        if (seedMap.has(c.key) || picked.some((p) => p.key === c.key)) continue;
        if (!normalize(c.title)) continue;
        if (await options.exclude(c)) continue;
        if ((await this.userPlaycount(user, "track.getinfo", { artist: c.artist, track: c.title })) > 0) continue;
        picked.push(c);
        perArtist.set(key, (perArtist.get(key) ?? 0) + 1);
        taken++;
      }
    };

    await take(fresh, Math.round(count * options.newArtistRatio));
    await take(similar, count - picked.length);
    if (picked.length < count) await take(fresh, count - picked.length);
    return picked.sort(() => Math.random() - 0.5);
  }
}
