import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { matchSong, type ItunesSong } from "../src/integrations/itunes.service";

const song = (artistName: string, trackName: string, previewUrl = "https://audio/preview.m4a"): ItunesSong => ({ artistName, trackName, previewUrl });

describe("iTunes", () => {
  test("retient le bon artiste et le même titre, toutes versions confondues", () => {
    const results = [song("Sub Focus", "Move Higher (feat. Culture Shock)"), song("Sub Focus & Dimension", "Desire (VIP)")];
    assert.equal(matchSong(results, "Dimension", "Desire")?.trackName, "Desire (VIP)");
    assert.equal(matchSong(results, "Sub Focus", "Higher"), null, "un titre qui contient seulement le mot ne compte pas");
  });

  test("écarte un homonyme d'un autre artiste et un résultat sans extrait", () => {
    assert.equal(matchSong([song("Tems", "Higher")], "Sub Focus", "Higher"), null);
    assert.equal(matchSong([{ artistName: "Pendulum", trackName: "Watercolour" }], "Pendulum", "Watercolour"), null);
  });

  test("l'artiste principal suffit quand le candidat a des invités", () => {
    assert.ok(matchSong([song("Chase & Status & Bou", "Baddadan (feat. IRah)")], "Chase & Status feat. Bou", "Baddadan"));
  });
});
