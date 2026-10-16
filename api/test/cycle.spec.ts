import "./support/env";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { afterEach, beforeEach, describe, test } from "node:test";
import { trackKey } from "../src/common/text";
import { writeAudio, ytLink } from "./support/fakes";
import { PLEX_ROOT, candidate, createWorld, type World } from "./support/world";

describe("cycle", () => {
  let w: World;
  beforeEach(async () => (w = await createWorld()));
  afterEach(() => w.close());

  test("sélection, téléchargement et playlist, sans reproposer ce qui est déjà dans Plex", async () => {
    // Already in the library, in another version: must not be suggested.
    writeAudio(w.local("Lossless", "Known", "Hit.m4a"), "Known", "Hit (Original Mix)");
    w.plex.scan(PLEX_ROOT);
    const profile = w.addProfile({ tracks: 3 });

    const run = await w.run(profile.id, [
      candidate("Known", "Hit - VIP"),
      candidate("Alpha", "One"),
      candidate("Bravo", "Two"),
      candidate("Charlie", "Three", "new-artist"),
      candidate("Delta", "Broken FAIL"),
    ]);

    assert.equal(run.ok, true, run.error ?? "");
    const [week] = w.weeks.weeks(profile.id);
    assert.equal(week!.status, "active");
    const tracks = w.weeks.tracks(week!.id);
    assert.ok(!tracks.some((t) => t.key === trackKey("Known", "Hit")), "titre déjà dans Plex proposé");
    assert.deepEqual(
      tracks.map((t) => [t.title, t.status]),
      [
        ["One", "imported"],
        ["Two", "imported"],
        ["Three", "imported"],
        ["Broken FAIL", "failed"],
      ],
    );
    for (const t of tracks.filter((t) => t.status === "imported")) assert.ok(existsSync(t.file!), `${t.file} absent`);
    assert.ok(w.pickarr.posts.every((p) => p.subfolder === undefined), "sous-dossier envoyé à un pickarr dédié");

    const playlist = w.plex.playlistKeys("Découvertes de la semaine");
    assert.deepEqual(playlist, tracks.filter((t) => t.status === "imported").map((t) => t.ratingKey));
    assert.ok(w.discord.messages.some((m) => m.level === "summary" && m.text.includes("**3** titres")));
  });

  test("titre tagué autrement que sur Last.fm : retrouvé dans Plex par son fichier", async () => {
    const profile = w.addProfile({ tracks: 1 });
    w.pickarr.taggedTitles.set("Machete - A.M.C Remix", "Machete (A.M.C Remix)");
    const run = await w.run(profile.id, [candidate("Sota", "Machete - A.M.C Remix")]);

    assert.equal(run.ok, true, run.error ?? "");
    const [track] = w.weeks.tracks(w.weeks.weeks(profile.id)[0]!.id);
    assert.ok(track!.ratingKey, "titre introuvable dans Plex");
    assert.deepEqual(w.plex.playlistKeys("Découvertes de la semaine"), [track!.ratingKey]);
  });

  test("mode validation : rien n'est téléchargé avant l'approbation, les titres écartés ne le sont jamais", async () => {
    const profile = w.addProfile({ tracks: 2, reviewMode: true });
    const run = await w.run(profile.id, [candidate("A", "1"), candidate("B", "2"), candidate("C", "3"), candidate("D", "4")]);
    assert.equal(run.ok, true, run.error ?? "");
    const [week] = w.weeks.weeks(profile.id);
    assert.equal(week!.status, "review");
    assert.equal(w.pickarr.posts.length, 0);

    const rejected = w.weeks.tracks(week!.id)[0]!;
    w.weeks.updateTrack(rejected.id, { status: "rejected" });
    const approved = await w.approve(week!.id);

    assert.equal(approved.ok, true, approved.error ?? "");
    assert.equal(w.weeks.week(week!.id).status, "active");
    assert.equal(w.pickarr.posts.length, 3);
    assert.ok(!w.pickarr.posts.some((p) => p.url === rejected.link));
    assert.equal(w.plex.playlistKeys("Découvertes de la semaine")!.length, 2);
  });

  test("reprise après redémarrage : les picks déjà envoyés ne sont pas renvoyés", async () => {
    const profile = w.addProfile({ tracks: 2 });
    const week = w.weeks.createWeek(profile.id, "downloading");
    w.weeks.addTracks(
      week.id,
      ["Sent", "NotSent"].map((title, position) => ({
        ...candidate("Resume", title),
        status: "queued" as const,
        link: ytLink("Resume", title),
        previewUrl: null,
        coverUrl: null,
        position,
      })),
    );
    // Sent to pickarr just before the shutdown.
    const [sent] = w.weeks.tracks(week.id);
    const pick = await w.pickarrService.addPick(sent!.link!);
    w.weeks.updateTrack(sent!.id, { pickId: pick.id });

    const restarted = w.newDiscovery();
    restarted.onModuleInit();
    const run = await w.settle(profile.id, restarted);

    assert.equal(run.ok, true, run.error ?? "");
    assert.equal(w.pickarr.posts.length, 2, "un pick a été renvoyé");
    assert.equal(w.weeks.week(week.id).status, "active");
    assert.ok(w.weeks.tracks(week.id).every((t) => t.status === "imported"));
  });
});
