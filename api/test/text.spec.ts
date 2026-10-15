import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isMixCut, shuffle, trackKey } from "../src/common/text";

describe("text", () => {
  test("une clé par morceau, toutes versions confondues", () => {
    const key = trackKey("Sub Focus", "Higher");
    assert.equal(trackKey("Sub Focus", "Higher (MPC Jungle VIP)"), key);
    assert.equal(trackKey("Sub Focus", "Higher - Apex Remix"), key);
    assert.equal(trackKey("Sub Focus feat. Kele", "Higher"), key);
    assert.equal(trackKey("SUB FOCUS", "Higher (Remastered 2020)"), key);
    assert.notEqual(trackKey("Sub Focus", "Lower"), key);
  });

  test("les extraits de mix DJ sont reconnus", () => {
    assert.ok(isMixCut("Low Down (Mixed)"));
    assert.ok(isMixCut("Low Down - Mix Cut"));
    assert.ok(!isMixCut("Low Down (Extended Mix)"));
  });

  test("shuffle garde tous les éléments sans modifier l'original", () => {
    const items = [1, 2, 3, 4, 5];
    const result = shuffle(items);
    assert.deepEqual(items, [1, 2, 3, 4, 5]);
    assert.deepEqual([...result].sort(), items);
  });
});
