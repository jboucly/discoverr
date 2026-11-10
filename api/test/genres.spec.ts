import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { allocate, balancedTake, canonicalGenre, isExcluded, mainGenre, UNKNOWN_GENRE } from "../src/integrations/genres";

const sum = (quotas: Map<string, number>) => [...quotas.values()].reduce((acc, n) => acc + n, 0);

describe("genres", () => {
  test("genre principal : tags qui ne sont pas des genres ignorés, orthographes et sous-genres fusionnés", () => {
    assert.equal(mainGenre(["seen live", "90s", "British", "Drum n Bass", "jungle"]), "drum and bass");
    assert.equal(mainGenre(["Neurofunk", "dnb"]), "drum and bass");
    assert.equal(mainGenre(["Hip-Hop"]), "hip hop");
    assert.equal(mainGenre(["favorites", "2010s"]), UNKNOWN_GENRE);
    assert.equal(mainGenre([]), UNKNOWN_GENRE);
    assert.equal(canonicalGenre("Drum & Bass"), "drum and bass");
  });

  test("exclusion : sur les premiers tags de genre seulement", () => {
    const excluded = new Set(["phonk"]);
    assert.ok(isExcluded(["seen live", "Phonk", "trap"], excluded));
    assert.ok(!isExcluded(["house", "techno", "deep house", "phonk"], excluded));
    assert.ok(!isExcluded(["phonk"], new Set()));
  });

  test("répartition : à 0 elle suit les écoutes, à 1 chaque genre a la même part, toujours le total", () => {
    const weights = new Map([
      ["drum and bass", 80],
      ["house", 15],
      ["jazz", 5],
    ]);
    assert.deepEqual([...allocate(weights, 20, 0)], [
      ["drum and bass", 16],
      ["house", 3],
      ["jazz", 1],
    ]);
    const equal = allocate(weights, 21, 1);
    assert.deepEqual([...equal.values()], [7, 7, 7]);
    const half = allocate(weights, 20, 0.5);
    assert.equal(sum(half), 20);
    assert.ok(half.get("drum and bass")! < 16 && half.get("jazz")! > 1, "la diversité rééquilibre");
    assert.equal(allocate(weights, 7, 1, 2).size, 2);
    assert.equal(allocate(new Map(), 10, 0.5).size, 0);
  });

  test("prise équilibrée : chaque genre jusqu'à son quota, puis complément quand un genre manque", async () => {
    const pools = new Map([
      ["dnb", ["d1", "d2", "d3", "d4", "d5"]],
      ["house", ["h1"]],
      ["jazz", ["j1", "j2"]],
    ]);
    const quotas = new Map([
      ["dnb", 2],
      ["house", 2],
      ["jazz", 2],
    ]);
    const taken = await balancedTake(pools, quotas, 6, (item) => item !== "j1");
    assert.deepEqual(taken, ["d1", "h1", "j2", "d2", "d3", "d4"]);
    assert.deepEqual(await balancedTake(pools, quotas, 2, () => true), ["d1", "h1"]);
  });
});
