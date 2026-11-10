import { normalize } from "../common/text";

/**
 * @description Bucket of the artists whose Last.fm tags hold no usable genre.
 */
export const UNKNOWN_GENRE = "";

/**
 * @description Most genres the selection balances at once (each one costs Last.fm calls); the others only fill in.
 */
export const MAX_GENRES = 12;

/**
 * @description Popular Last.fm tags that describe a listener, a place or a mood rather than a genre.
 */
const NOT_GENRES = new Set(
  [
    "seen live",
    "favorites",
    "favourites",
    "favorite",
    "favourite",
    "favorite songs",
    "love",
    "loved",
    "awesome",
    "beautiful",
    "cool",
    "amazing",
    "good",
    "best",
    "chill",
    "chillout",
    "party",
    "sexy",
    "melancholy",
    "melancholic",
    "sad",
    "happy",
    "female vocalists",
    "male vocalists",
    "female vocalist",
    "male vocalist",
    "female vocals",
    "male vocals",
    "singer songwriter",
    "instrumental",
    "cover",
    "covers",
    "soundtrack",
    "under 2000 listeners",
    "all",
    "music",
    "spotify",
    "youtube",
    "albums i own",
    "my music",
    "american",
    "british",
    "uk",
    "usa",
    "english",
    "french",
    "france",
    "german",
    "germany",
    "canadian",
    "australian",
    "belgian",
    "dutch",
    "swedish",
    "norwegian",
    "russian",
    "japanese",
    "korean",
    "brazilian",
    "spanish",
    "italian",
    "polish",
    "irish",
    "scottish",
    "london",
    "bristol",
    "manchester",
    "paris",
  ].map((tag) => normalize(tag)),
);

/**
 * @description Spellings of the same genre (and close subgenres), merged so that "dnb", "drum & bass" and "neurofunk"
 * land in one bucket.
 */
const ALIASES: Record<string, string> = {
  dnb: "drum and bass",
  "d and b": "drum and bass",
  "drum n bass": "drum and bass",
  "drum and base": "drum and bass",
  drumandbass: "drum and bass",
  "drum bass": "drum and bass",
  dandb: "drum and bass",
  // Subgenres folded into their family: otherwise one dominant genre would still fill several buckets.
  "liquid dnb": "drum and bass",
  "liquid drum and bass": "drum and bass",
  "liquid funk": "drum and bass",
  neurofunk: "drum and bass",
  "jump up": "drum and bass",
  "dancefloor dnb": "drum and bass",
  "minimal dnb": "drum and bass",
  techstep: "drum and bass",
  hiphop: "hip hop",
  randb: "rnb",
  "rhythm and blues": "rnb",
  edm: "electronic dance music",
  electronica: "electronic",
  ukg: "uk garage",
  triphop: "trip hop",
  "lo fi": "lofi",
  "lo fi hip hop": "lofi",
  "french rap": "rap francais",
  "french hip hop": "rap francais",
};

/**
 * @description Canonical form of a tag or of a genre typed by the user: lower case, no accents or punctuation, aliases merged.
 * @param tag A Last.fm tag or a genre typed in the UI.
 * @returns The canonical genre, or an empty string when nothing is left.
 */
export function canonicalGenre(tag: string): string {
  const name = normalize(tag);
  return ALIASES[name] ?? name;
}

/**
 * @description Whether a Last.fm tag names a genre (not a decade, a country, a mood or "seen live").
 * @param tag A tag already in canonical form.
 */
function isGenre(tag: string): boolean {
  if (!tag || NOT_GENRES.has(tag)) return false;
  // Decades and years ("90s", "2010s", "2023") say when, not what.
  return !/^(\d{2}|\d{4})s?$/.test(tag);
}

/**
 * @description Main genre of an artist: its first Last.fm tag (tags come by popularity) that is an actual genre.
 * @param tags The artist's top tags, most used first.
 * @returns The canonical genre, or `UNKNOWN_GENRE` when none of the tags is a genre.
 */
export function mainGenre(tags: string[]): string {
  for (const tag of tags) {
    const genre = canonicalGenre(tag);
    if (isGenre(genre)) return genre;
  }
  return UNKNOWN_GENRE;
}

/**
 * @description Whether one of the artist's first genre tags is excluded by the profile.
 * @param tags The artist's top tags, most used first.
 * @param excluded Excluded genres, in canonical form.
 * @param depth How many genre tags are compared: the first few describe the artist, the rest are noise.
 */
export function isExcluded(tags: string[], excluded: Set<string>, depth = 3): boolean {
  if (excluded.size === 0) return false;
  return tags
    .map(canonicalGenre)
    .filter(isGenre)
    .slice(0, depth)
    .some((genre) => excluded.has(genre));
}

/**
 * @description Splits `total` slots between genres. Each genre's share is proportional to `weight^(1 - diversity)`:
 * at 0 it follows the listening, at 1 every genre gets the same share. Rounded with the largest remainder method,
 * so the quotas always add up to `total`. Only the `maxGenres` heaviest genres get a quota.
 * @param weights Listening weight of each genre.
 * @param total Slots to split.
 * @param diversity Between 0 and 1.
 * @param maxGenres Most genres that get a quota.
 * @returns Quota of each genre, heaviest genre first.
 */
export function allocate(weights: Map<string, number>, total: number, diversity: number, maxGenres = MAX_GENRES): Map<string, number> {
  const genres = [...weights.entries()]
    .filter(([, weight]) => weight > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxGenres);
  const quotas = new Map<string, number>();
  if (genres.length === 0 || total <= 0) return quotas;

  const exponent = 1 - Math.min(1, Math.max(0, diversity));
  const shares = genres.map(([genre, weight]) => ({ genre, share: weight ** exponent }));
  const sum = shares.reduce((acc, s) => acc + s.share, 0);
  const exact = shares.map((s) => ({ genre: s.genre, value: (total * s.share) / sum }));
  exact.forEach((e) => quotas.set(e.genre, Math.floor(e.value)));

  let left = total - [...quotas.values()].reduce((acc, q) => acc + q, 0);
  // Largest remainder first; on a tie, the heavier genre (earlier in the list) wins.
  const byRemainder = [...exact].sort((a, b) => b.value - Math.floor(b.value) - (a.value - Math.floor(a.value)));
  for (const e of byRemainder) {
    if (left <= 0) break;
    quotas.set(e.genre, quotas.get(e.genre)! + 1);
    left--;
  }
  return quotas;
}

/**
 * @description Takes up to `total` items from per-genre pools: first each genre up to its quota, one item per genre in
 * turn, then, if some genres ran short, any remaining item (still in turn) so that the total is reached whenever possible.
 * @param pools Items of each genre, best first.
 * @param quotas Quota of each genre (see `allocate`); genres without a quota only fill in.
 * @param total Most items to take.
 * @param accept Called on each item in order; false skips it (filtered out, already taken…). It may have side effects.
 * @returns The accepted items, in the order they were taken.
 */
export async function balancedTake<T>(
  pools: Map<string, T[]>,
  quotas: Map<string, number>,
  total: number,
  accept: (item: T, genre: string) => Promise<boolean> | boolean,
): Promise<T[]> {
  const taken: T[] = [];
  const cursors = new Map<string, number>([...pools.keys()].map((genre) => [genre, 0]));
  const counts = new Map<string, number>();

  // Next accepted item of a genre, or undefined once its pool is exhausted.
  const next = async (genre: string): Promise<T | undefined> => {
    const pool = pools.get(genre) ?? [];
    let cursor = cursors.get(genre) ?? 0;
    while (cursor < pool.length) {
      const item = pool[cursor++]!;
      if (await accept(item, genre)) {
        cursors.set(genre, cursor);
        return item;
      }
    }
    cursors.set(genre, cursor);
    return undefined;
  };

  const round = async (genres: string[], limit: (genre: string) => number) => {
    let active = genres.filter((genre) => (counts.get(genre) ?? 0) < limit(genre));
    while (active.length > 0 && taken.length < total) {
      for (const genre of active) {
        if (taken.length >= total) break;
        const item = await next(genre);
        if (item === undefined) {
          counts.set(genre, Infinity);
          continue;
        }
        taken.push(item);
        counts.set(genre, (counts.get(genre) ?? 0) + 1);
      }
      active = active.filter((genre) => (counts.get(genre) ?? 0) < limit(genre));
    }
  };

  await round([...quotas.keys()].filter((genre) => pools.has(genre)), (genre) => quotas.get(genre) ?? 0);
  // Fill-in: the genres not exhausted yet, quota or not, heaviest first.
  const exhausted = (genre: string) => counts.get(genre) === Infinity;
  const fill = [...new Set([...quotas.keys(), ...pools.keys()])].filter((genre) => pools.has(genre) && !exhausted(genre));
  await round(fill, () => Number.POSITIVE_INFINITY);
  return taken;
}

/**
 * @description Groups items by genre, keeping their order inside each genre.
 * @param items Items, best first.
 * @param genreOf Genre of an item.
 */
export function groupByGenre<T>(items: T[], genreOf: (item: T) => string): Map<string, T[]> {
  const pools = new Map<string, T[]>();
  for (const item of items) {
    const genre = genreOf(item);
    const pool = pools.get(genre);
    if (pool) pool.push(item);
    else pools.set(genre, [item]);
  }
  return pools;
}

/**
 * @description Short summary for the logs: "drum and bass 35 %, house 20 %, …".
 * @param counts Number (or weight) per genre.
 */
export function describeGenres(counts: Map<string, number>): string {
  const sum = [...counts.values()].reduce((acc, n) => acc + n, 0);
  if (sum === 0) return "aucun";
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([genre, n]) => `${genre || "inconnu"} ${Math.round((n / sum) * 100)} %`)
    .join(", ");
}
