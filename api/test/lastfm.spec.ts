import "./support/env";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, mock, test } from "node:test";
import * as text from "../src/common/text";
import { DatabaseService } from "../src/db/database.service";
import { env } from "../src/env";
import { LastfmService, type Candidate } from "../src/integrations/lastfm.service";

mock.method(text as { sleep: (ms: number) => Promise<unknown> }, "sleep", async () => undefined);

const GENRES: Record<string, string> = { D: "drum and bass", H: "house", J: "jazz" };
const track = (artist: string, name = "Song") => ({ name, artist: { name: artist } });
const artists = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);

/**
 * @description A user who mostly listens to drum and bass (20 artists, every period) and a bit of house and jazz (12 months).
 */
function fakeLastfm(method: string, params: Record<string, string | number>): unknown {
  const dnb = artists("D", 20).map((a) => track(a));
  switch (method) {
    case "user.gettoptracks":
      if (params.period === "12month") return { toptracks: { track: [...dnb, ...artists("H", 4).map((a) => track(a)), ...artists("J", 3).map((a) => track(a))] } };
      return { toptracks: { track: dnb } };
    case "user.getlovedtracks":
      return { lovedtracks: { track: [] } };
    case "user.getrecenttracks":
      return { recenttracks: { track: [] } };
    case "artist.gettoptags":
      return { toptags: { tag: [{ name: "seen live" }, { name: GENRES[String(params.artist)[0]!]! }] } };
    case "track.getsimilar": {
      const seed = String(params.artist);
      // Drum and bass seeds have strong matches: without balancing, they take everything.
      const match = seed.startsWith("D") ? "1" : "0.3";
      return { similartracks: { track: [1, 2, 3].map((i) => ({ ...track(`${seed}-S${i}`, `Similar ${i}`), match })) } };
    }
    case "track.getinfo":
    case "artist.getinfo":
      return { track: { userplaycount: "0" } };
    default:
      throw new Error(`Appel Last.fm inattendu : ${method}`);
  }
}

describe("sélection Last.fm", () => {
  let root: string;
  let database: DatabaseService;
  let lastfm: LastfmService;
  let calls: string[];

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "discoverr-lastfm-"));
    env.dataDir = root;
    database = new DatabaseService();
    lastfm = new LastfmService(database);
    calls = [];
    mock.method(lastfm as unknown as { call: (method: string, params: Record<string, string | number>) => Promise<unknown> }, "call", async (method: string, params: Record<string, string | number>) => {
      calls.push(`${method} ${params.artist ?? ""}`);
      return fakeLastfm(method, params);
    });
  });
  afterEach(() => {
    database.onModuleDestroy();
    rmSync(root, { recursive: true, force: true });
  });

  const pick = (genreDiversity: number, excludedGenres: string[] = []) =>
    lastfm.pickCandidates({
      user: "moi",
      count: 12,
      newArtistRatio: 0,
      maxPerArtist: 2,
      genreDiversity,
      excludedGenres,
      exclude: async () => false,
    });
  const count = (picked: Candidate[]) => {
    const counts: Record<string, number> = {};
    for (const c of picked) counts[c.genre] = (counts[c.genre] ?? 0) + 1;
    return counts;
  };

  test("diversité à 0 : le genre le plus écouté domine", async () => {
    const picked = await pick(0);
    assert.equal(picked.length, 12);
    assert.ok((count(picked)["drum and bass"] ?? 0) >= 10, JSON.stringify(count(picked)));
  });

  test("diversité à 100 % : autant de chaque genre écouté", async () => {
    const picked = await pick(1);
    assert.deepEqual(count(picked), { "drum and bass": 4, house: 4, jazz: 4 });
  });

  test("genre exclu : jamais proposé, ses artistes ne servent pas de graines", async () => {
    const picked = await pick(0.5, ["DnB"]);
    assert.equal(picked.length, 12);
    assert.ok(picked.every((c) => c.genre !== "drum and bass"), JSON.stringify(count(picked)));
    assert.ok(!calls.some((c) => c.startsWith("track.getsimilar D")));
  });

  test("tags en cache : pas de nouvel appel au lancement suivant", async () => {
    await pick(0.5);
    const first = calls.filter((c) => c.startsWith("artist.gettoptags")).length;
    calls = [];
    await pick(0.5);
    assert.ok(first > 0);
    assert.equal(calls.filter((c) => c.startsWith("artist.gettoptags")).length, 0);
  });
});
