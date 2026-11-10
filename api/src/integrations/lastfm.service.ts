import { Injectable, Logger } from "@nestjs/common";
import { fetchJson } from "../common/http";
import { artistKey, isMixCut, normalize, now, shuffle, sleep, trackKey } from "../common/text";
import { DatabaseService } from "../db/database.service";
import { env } from "../env";
import { allocate, balancedTake, canonicalGenre, describeGenres, groupByGenre, isExcluded, mainGenre, UNKNOWN_GENRE } from "./genres";

export interface Candidate {
  artist: string;
  title: string;
  key: string;
  score: number;
  kind: "similar" | "new-artist";
  /**
   * @description Main genre of the artist (canonical Last.fm tag), `UNKNOWN_GENRE` when it has none.
   */
  genre: string;
}

export interface PickOptions {
  user: string;
  count: number;
  newArtistRatio: number;
  maxPerArtist: number;
  /**
   * @description 0: genres weighted like the listening; 1: every genre of the user gets the same share.
   */
  genreDiversity: number;
  /**
   * @description Genres (Last.fm tags) never suggested.
   */
  excludedGenres: string[];
  /** Extra filter: already suggested, blocked artist, already in Plex… */
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
  genre: string;
}

/**
 * @description What a run needs to balance genres: the listening weight of each genre, the diversity, the exclusions.
 */
interface GenreContext {
  weights: Map<string, number>;
  diversity: number;
  excluded: Set<string>;
}

/**
 * @description Seeds kept from the listening history, then tagged (one cached Last.fm call per artist).
 */
const SEED_POOL = 150;

/**
 * @description Seeds sent to track.getsimilar, split between genres.
 */
const SEED_COUNT = 40;

/**
 * @description Artist tags are refreshed after 90 days.
 */
const TAG_TTL_MS = 90 * 24 * 3600 * 1000;

const artistName = (t: LfTrack) => t.artist.name ?? t.artist["#text"] ?? "";
const asArray = <T>(value: T | T[] | undefined): T[] => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

/**
 * @description Adds `score` to the share of `genre` in the score of the item `key`.
 */
function addScore(byGenre: Map<string, Map<string, number>>, key: string, genre: string, score: number) {
  const shares = byGenre.get(key) ?? new Map<string, number>();
  shares.set(genre, (shares.get(genre) ?? 0) + score);
  byGenre.set(key, shares);
}

/**
 * @description Number of items per genre, for the logs.
 */
function countByGenre(items: { genre: string }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.genre, (counts.get(item.genre) ?? 0) + 1);
  return counts;
}

/**
 * @description Genre with the largest share, `UNKNOWN_GENRE` when there is none.
 */
function topGenre(shares: Map<string, number> | undefined): string {
  let best = UNKNOWN_GENRE;
  let max = -1;
  for (const [genre, score] of shares ?? []) {
    if (score > max) [best, max] = [genre, score];
  }
  return best;
}

@Injectable()
export class LastfmService {
  private readonly logger = new Logger(LastfmService.name);
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly db: DatabaseService) {}

  /** Queued calls, ~4 requests/s (Last.fm allows 5/s). */
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

  /** Checks that the account exists and has scrobbles. */
  async checkUser(user: string): Promise<{ playcount: number; registered: string | null }> {
    const data = await this.call<{ user: { playcount: string; registered?: { "#text"?: number } } }>("user.getinfo", { user });
    const ts = data.user.registered?.["#text"];
    return { playcount: Number(data.user.playcount ?? 0), registered: ts ? new Date(ts * 1000).toISOString() : null };
  }

  /**
   * @description Top tags of an artist, most used first, cached in the database for 90 days.
   * On a Last.fm error, the stale cache if any, else no tag (and nothing cached, so it is retried next time).
   * @param artist Artist name as Last.fm writes it.
   */
  private async artistTags(artist: string): Promise<string[]> {
    const key = artistKey(artist);
    const row = this.db.get<{ tags: string; fetched_at: string }>("SELECT tags, fetched_at FROM artist_tags WHERE artist_key = ?", [key]);
    if (row && Date.now() - Date.parse(row.fetched_at) < TAG_TTL_MS) return JSON.parse(row.tags) as string[];
    try {
      const data = await this.call<{ toptags: { tag: { name: string }[] } }>("artist.gettoptags", { artist });
      const tags = asArray(data.toptags?.tag)
        .slice(0, 5)
        .map((t) => t.name);
      this.db.run(
        "INSERT INTO artist_tags (artist_key, tags, fetched_at) VALUES (?, ?, ?) ON CONFLICT(artist_key) DO UPDATE SET tags = excluded.tags, fetched_at = excluded.fetched_at",
        [key, JSON.stringify(tags), now()],
      );
      return tags;
    } catch (err) {
      this.logger.warn(`artist.gettoptags ignoré pour ${artist} : ${(err as Error).message}`);
      return row ? (JSON.parse(row.tags) as string[]) : [];
    }
  }

  /**
   * @description Quotas for a pool of candidates: genres weighted like the seeds; a genre unknown to the seeds gets
   * the weight of the lightest one.
   */
  private quotas(pools: Map<string, unknown[]>, total: number, genres: GenreContext): Map<string, number> {
    const lightest = Math.min(...genres.weights.values(), 1);
    const weights = new Map([...pools.keys()].map((genre) => [genre, genres.weights.get(genre) ?? lightest]));
    return allocate(weights, total, genres.diversity);
  }

  private async seeds(user: string): Promise<Map<string, Seed>> {
    const [month, quarter, year, loved, recent] = await Promise.all([
      this.call<{ toptracks: { track: LfTrack[] } }>("user.gettoptracks", { user, period: "1month", limit: 30 }),
      this.call<{ toptracks: { track: LfTrack[] } }>("user.gettoptracks", { user, period: "3month", limit: 30 }),
      // Longer history: the genres listened to less lately are still the user's.
      this.call<{ toptracks: { track: LfTrack[] } }>("user.gettoptracks", { user, period: "12month", limit: 50 }),
      this.call<{ lovedtracks: { track: LfTrack[] } }>("user.getlovedtracks", { user, limit: 100 }),
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
        else result.set(key, { artist, title: t.name, weight, genre: UNKNOWN_GENRE });
      }
    };
    add(asArray(loved.lovedtracks?.track), 2);
    add(asArray(month.toptracks?.track), 1.5);
    add(asArray(quarter.toptracks?.track), 1);
    add(asArray(year.toptracks?.track), 0.75);
    add(asArray(recent.recenttracks?.track), 0.5);
    return result;
  }

  /**
   * @description Tracks close to the seeds; each one takes the genre of the seeds that brought it the most score.
   */
  private async similarTracks(seeds: Seed[]): Promise<Candidate[]> {
    const scores = new Map<string, Candidate>();
    const byGenre = new Map<string, Map<string, number>>();
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
          else scores.set(key, { artist, title: t.name, key, score, kind: "similar", genre: UNKNOWN_GENRE });
          addScore(byGenre, key, seed.genre, score);
        }
      } catch (err) {
        this.logger.warn(`track.getsimilar ignoré pour ${seed.artist} - ${seed.title} : ${(err as Error).message}`);
      }
    }
    for (const c of scores.values()) c.genre = topGenre(byGenre.get(c.key));
    return [...scores.values()].sort((a, b) => b.score - a.score);
  }

  /**
   * @description Top tracks of never-played artists close to the user's favourites. The favourites (top artists over
   * 3 and 12 months) and the new artists are both split between genres, so that one genre does not take them all.
   */
  private async newArtistTracks(user: string, knownArtists: Set<string>, genres: GenreContext): Promise<Candidate[]> {
    const [quarter, year] = await Promise.all([
      this.call<{ topartists: { artist: { name: string }[] } }>("user.gettopartists", { user, period: "3month", limit: 20 }),
      this.call<{ topartists: { artist: { name: string }[] } }>("user.gettopartists", { user, period: "12month", limit: 30 }),
    ]);
    // Rank weight from each period, summed: an artist in both lists comes first.
    const ranked = new Map<string, { name: string; weight: number; genre: string }>();
    for (const list of [asArray(quarter.topartists?.artist), asArray(year.topartists?.artist)]) {
      for (const [index, artist] of list.entries()) {
        const key = artistKey(artist.name);
        knownArtists.add(key);
        const entry = ranked.get(key) ?? { name: artist.name, weight: 0, genre: UNKNOWN_GENRE };
        entry.weight += 1 - index / (list.length * 2);
        ranked.set(key, entry);
      }
    }
    const candidates = [...ranked.values()].sort((a, b) => b.weight - a.weight);
    for (const favourite of candidates) {
      const tags = await this.artistTags(favourite.name);
      if (isExcluded(tags, genres.excluded)) favourite.weight = 0;
      else favourite.genre = mainGenre(tags);
    }
    const kept = candidates.filter((f) => f.weight > 0);
    const favouritePools = groupByGenre(kept, (f) => f.genre);
    const favourites = await balancedTake(favouritePools, this.quotas(favouritePools, 20, genres), 20, () => true);

    const scores = new Map<string, { name: string; score: number }>();
    const byGenre = new Map<string, Map<string, number>>();
    for (const favourite of favourites) {
      try {
        const data = await this.call<{ similarartists: { artist: { name: string; match: string }[] } }>("artist.getsimilar", {
          artist: favourite.name,
          limit: 15,
        });
        for (const a of asArray(data.similarartists?.artist)) {
          const key = artistKey(a.name);
          if (knownArtists.has(key)) continue;
          const score = favourite.weight * Number(a.match ?? 0);
          const entry = scores.get(key) ?? { name: a.name, score: 0 };
          entry.score += score;
          scores.set(key, entry);
          addScore(byGenre, key, favourite.genre, score);
        }
      } catch (err) {
        this.logger.warn(`artist.getsimilar ignoré pour ${favourite.name} : ${(err as Error).message}`);
      }
    }

    const artists = [...scores.entries()]
      .map(([key, a]) => ({ ...a, genre: topGenre(byGenre.get(key)) }))
      .sort((a, b) => b.score - a.score);
    const artistPools = groupByGenre(artists, (a) => a.genre);
    const fresh = await balancedTake(
      artistPools,
      this.quotas(artistPools, 25, genres),
      25,
      async (artist) => (await this.userPlaycount(user, "artist.getinfo", { artist: artist.name })) === 0,
    );

    const result: Candidate[] = [];
    for (const artist of fresh) {
      try {
        const data = await this.call<{ toptracks: { track: LfTrack[] } }>("artist.gettoptracks", { artist: artist.name, limit: 3 });
        for (const t of asArray(data.toptracks?.track)) {
          const name = artistName(t) || artist.name;
          result.push({ artist: name, title: t.name, key: trackKey(name, t.name), score: artist.score, kind: "new-artist", genre: artist.genre });
        }
      } catch (err) {
        this.logger.warn(`artist.gettoptracks ignoré pour ${artist.name} : ${(err as Error).message}`);
      }
    }
    return result;
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

  /**
   * @description Never-played tracks: a share from new artists, the rest close to the user's tracks, with a cap per
   * artist. Seeds and picks are split between the user's genres according to `genreDiversity`, and the excluded
   * genres are left out.
   */
  async pickCandidates(options: PickOptions): Promise<Candidate[]> {
    const { user, count } = options;
    const seedMap = await this.seeds(user);
    if (seedMap.size === 0) throw new Error(`Aucune écoute Last.fm pour ${user} : le scrobbling est-il actif ?`);

    const excluded = new Set(options.excludedGenres.map(canonicalGenre).filter(Boolean));
    const tagged: Seed[] = [];
    for (const seed of [...seedMap.values()].sort((a, b) => b.weight - a.weight).slice(0, SEED_POOL)) {
      const tags = await this.artistTags(seed.artist);
      if (isExcluded(tags, excluded)) continue;
      seed.genre = mainGenre(tags);
      tagged.push(seed);
    }
    const weights = new Map<string, number>();
    for (const seed of tagged) weights.set(seed.genre, (weights.get(seed.genre) ?? 0) + seed.weight);
    const genres: GenreContext = { weights, diversity: options.genreDiversity, excluded };

    const seedPools = groupByGenre(tagged, (seed) => seed.genre);
    const seeds = await balancedTake(seedPools, allocate(weights, SEED_COUNT, genres.diversity), SEED_COUNT, () => true);
    this.logger.log(`[${user}] ${seedMap.size} graines, ${seeds.length} utilisées`);
    this.logger.log(`[${user}] genres écoutés : ${describeGenres(weights)}`);
    this.logger.log(`[${user}] genres des graines : ${describeGenres(countByGenre(seeds))}`);

    const knownArtists = new Set(seeds.map((s) => artistKey(s.artist)));
    const similar = await this.similarTracks(seeds);
    const fresh = options.newArtistRatio > 0 ? await this.newArtistTracks(user, knownArtists, genres) : [];
    this.logger.log(`[${user}] ${similar.length} titres similaires, ${fresh.length} de nouveaux artistes`);

    const picked: Candidate[] = [];
    const perArtist = new Map<string, number>();
    const accept = async (c: Candidate) => {
      if (picked.length >= count) return false;
      const key = artistKey(c.artist);
      if ((perArtist.get(key) ?? 0) >= options.maxPerArtist) return false;
      if (seedMap.has(c.key) || picked.some((p) => p.key === c.key)) return false;
      if (!normalize(c.title) || isMixCut(c.title)) return false;
      if (await options.exclude(c)) return false;
      // The pool genre comes from the seeds; the artist's own tags decide the exclusion and the genre shown.
      const tags = await this.artistTags(c.artist);
      if (isExcluded(tags, excluded)) return false;
      if ((await this.userPlaycount(user, "track.getinfo", { artist: c.artist, track: c.title })) > 0) return false;
      c.genre = mainGenre(tags) || c.genre;
      picked.push(c);
      perArtist.set(key, (perArtist.get(key) ?? 0) + 1);
      return true;
    };
    const take = async (pool: Candidate[], quota: number) => {
      const total = Math.min(quota, count - picked.length);
      if (total <= 0) return;
      const pools = groupByGenre(pool, (c) => c.genre);
      await balancedTake(pools, this.quotas(pools, total, genres), total, accept);
    };

    await take(fresh, Math.round(count * options.newArtistRatio));
    await take(similar, count - picked.length);
    if (picked.length < count) await take(fresh, count - picked.length);
    this.logger.log(`[${user}] genres choisis : ${describeGenres(countByGenre(picked))}`);
    return shuffle(picked);
  }
}
