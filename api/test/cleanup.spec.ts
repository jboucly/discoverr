import "./support/env";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, renameSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, test } from "node:test";
import { env } from "../src/env";
import { writeAudio } from "./support/fakes";
import { PLEX_ROOT, candidate, createWorld, type World } from "./support/world";

const byTitle = (w: World, weekId: number, title: string) => w.weeks.tracks(weekId).find((t) => t.title === title)!;

describe("ménage", () => {
  let w: World;
  afterEach(() => w.close());

  test("❤️, « Garder » et autre playlist sont déplacés, le reste supprimé, rien hors des découvertes", async () => {
    w = await createWorld();
    writeAudio(w.local("Lossless", "Other", "Mine.m4a"), "Other", "Mine");
    w.plex.scan(PLEX_ROOT);
    const profile = w.addProfile({ tracks: 4, likedSubdir: "pickarr" });
    const pool1 = ["Hearted", "Kept", "Listed", "Unloved", "Spare"].map((t) => candidate(t, t));
    assert.equal((await w.run(profile.id, pool1)).ok, true);
    const [week1] = w.weeks.weeks(profile.id);

    const hearted = byTitle(w, week1!.id, "Hearted");
    w.plex.items.get(hearted.ratingKey!)!.userRating = 10;
    w.weeks.updateTrack(byTitle(w, week1!.id, "Kept").id, { keep: true });
    w.plex.addPlaylist("Mes favoris", [byTitle(w, week1!.id, "Listed").ratingKey!]);
    const unloved = byTitle(w, week1!.id, "Unloved");

    const run = await w.run(profile.id, ["E", "F", "G", "H", "I"].map((t) => candidate(t, t)));
    assert.equal(run.ok, true, run.error ?? "");

    assert.equal(w.weeks.week(week1!.id).status, "cleaned");
    for (const title of ["Hearted", "Kept", "Listed"]) {
      const t = byTitle(w, week1!.id, title);
      assert.equal(t.status, "liked", title);
      assert.equal(t.file, w.local("pickarr", title, `${title} - Singles`, `${title}.m4a`));
      assert.ok(existsSync(t.file!), `${title} non déplacé`);
      assert.ok(existsSync(w.local("pickarr", title, `${title} - Singles`, "cover.jpg")), `${title} : pochette non copiée`);
    }
    // The moved file is a new Plex item: the rating must have been set on it again.
    const moved = w.plex.itemByLocalFile(byTitle(w, week1!.id, "Hearted").file!)!;
    assert.notEqual(moved.ratingKey, hearted.ratingKey);
    assert.equal(moved.userRating, 10);

    assert.equal(byTitle(w, week1!.id, "Unloved").status, "deleted");
    assert.ok(!existsSync(unloved.file!), "titre non aimé non supprimé");
    assert.ok(!existsSync(w.local("Decouvertes", "Unloved")), "dossier vide non supprimé");
    assert.ok(existsSync(w.local("Decouvertes")), "le dossier des découvertes lui-même a été supprimé");
    assert.ok(existsSync(w.local("Lossless", "Other", "Mine.m4a")), "fichier hors découvertes touché");
    assert.ok(w.pickarr.deleted.includes(unloved.pickId!), "pick non retiré de pickarr");
    assert.ok(w.plex.calls.includes("PUT /library/sections/1/emptyTrash"));

    // The playlist only contains the new week.
    const [week2] = w.weeks.weeks(profile.id);
    assert.deepEqual(
      w.plex.playlistKeys("Découvertes de la semaine"),
      w.weeks.tracks(week2!.id).slice(0, 4).map((t) => t.ratingKey),
    );
  });

  test("pochette impossible à copier : le titre est quand même déplacé et suivi", async () => {
    w = await createWorld();
    const profile = w.addProfile({ tracks: 2, likedSubdir: "pickarr" });
    await w.run(profile.id, [candidate("A", "1"), candidate("B", "2"), candidate("C", "3")]);
    const [week] = w.weeks.weeks(profile.id);
    const hearted = byTitle(w, week!.id, "1");
    w.plex.items.get(hearted.ratingKey!)!.userRating = 10;
    // An unreadable cover stands in for the EPERM seen on the NAS share.
    chmodSync(path.join(path.dirname(hearted.file!), "cover.jpg"), 0);

    const result = await w.cleanup.cleanWeek(week!, profile);

    const t = byTitle(w, week!.id, "1");
    assert.equal(t.status, "liked");
    assert.equal(t.file, w.local("pickarr", "A", "A - Singles", "1.m4a"));
    assert.ok(existsSync(t.file!));
    assert.equal(w.plex.itemByLocalFile(t.file!)!.userRating, 10);
    assert.ok(result.warnings.some((m) => m.startsWith("A - 1 : pochette non copiée")));
    assert.deepEqual(result.pending, []);
    assert.equal(w.weeks.week(week!.id).status, "cleaned");
  });

  test("déplacement interrompu par un ancien ménage : repris au ménage suivant", async () => {
    w = await createWorld();
    const profile = w.addProfile({ tracks: 2, likedSubdir: "pickarr" });
    await w.run(profile.id, [candidate("A", "1"), candidate("B", "2"), candidate("C", "3")]);
    const [week] = w.weeks.weeks(profile.id);
    const hearted = byTitle(w, week!.id, "1");
    w.plex.items.get(hearted.ratingKey!)!.userRating = 10;
    // State left by the old code: file renamed, then the cover copy threw before the database was updated.
    const dest = w.local("pickarr", "A", "A - Singles", "1.m4a");
    mkdirSync(path.dirname(dest), { recursive: true });
    renameSync(hearted.file!, dest);
    w.weeks.updateTrack(hearted.id, { status: "pending", error: "EPERM: operation not permitted, copyfile" });

    const result = await w.cleanup.cleanWeek(week!, profile);

    const t = byTitle(w, week!.id, "1");
    assert.equal(t.status, "liked");
    assert.equal(t.file, dest);
    assert.equal(t.error, null);
    assert.equal(w.plex.itemByLocalFile(dest)!.userRating, 10);
    assert.ok(existsSync(w.local("pickarr", "A", "A - Singles", "cover.jpg")), "pochette non copiée");
    assert.ok(!existsSync(w.local("Decouvertes", "A")), "dossier vide non supprimé");
    assert.equal(w.weeks.week(week!.id).status, "cleaned");
  });

  test("un fichier encore proposé à un autre profil n'est supprimé qu'au dernier ménage", async () => {
    w = await createWorld();
    const p1 = w.addProfile({ name: "Un", tracks: 1, reviewMode: true, playlistTitle: "Un" });
    const p2 = w.addProfile({ name: "Deux", tracks: 1, reviewMode: true, playlistTitle: "Deux" });
    const shared = [candidate("Shared", "Song"), candidate("Shared", "Other")];
    // Both selections are made before any download: the same track is suggested to both profiles.
    await w.run(p1.id, shared);
    await w.run(p2.id, shared);
    const [w1] = w.weeks.weeks(p1.id);
    const [w2] = w.weeks.weeks(p2.id);
    assert.equal((await w.approve(w1!.id)).ok, true);
    assert.equal((await w.approve(w2!.id)).ok, true);
    const file = byTitle(w, w1!.id, "Song").file!;
    assert.equal(byTitle(w, w2!.id, "Song").file, file);

    await w.run(p1.id, [candidate("P1", "Next"), candidate("P1", "Next2")]);
    assert.equal((await w.approve(w.weeks.weeks(p1.id)[0]!.id)).ok, true);
    assert.equal(byTitle(w, w1!.id, "Song").status, "deleted");
    assert.ok(existsSync(file), "fichier supprimé alors que l'autre profil l'utilise encore");

    await w.run(p2.id, [candidate("P2", "Next"), candidate("P2", "Next2")]);
    assert.equal((await w.approve(w.weeks.weeks(p2.id)[0]!.id)).ok, true);
    assert.ok(!existsSync(file), "fichier plus utilisé non supprimé");
  });

  test("Plex injoignable : rien n'est touché", async () => {
    w = await createWorld();
    const profile = w.addProfile({ tracks: 2 });
    await w.run(profile.id, [candidate("A", "1"), candidate("B", "2"), candidate("C", "3")]);
    const [week] = w.weeks.weeks(profile.id);
    const files = w.weeks.tracks(week!.id).map((t) => t.file!);

    w.plex.down = true;
    await assert.rejects(w.cleanup.cleanWeek(week!, profile));

    assert.ok(files.every((f) => existsSync(f)));
    assert.equal(w.weeks.week(week!.id).status, "active");
    assert.ok(w.weeks.tracks(week!.id).every((t) => t.status === "imported"));
  });

  test("titre introuvable dans Plex : gardé en attente, semaine non close", async () => {
    w = await createWorld();
    const profile = w.addProfile({ tracks: 2 });
    await w.run(profile.id, [candidate("A", "1"), candidate("B", "2"), candidate("C", "3")]);
    const [week] = w.weeks.weeks(profile.id);
    const lost = byTitle(w, week!.id, "1");
    w.plex.items.delete(lost.ratingKey!);

    const result = await w.cleanup.cleanWeek(week!, profile);

    assert.deepEqual(result.pending, ["A - 1"]);
    assert.equal(byTitle(w, week!.id, "1").status, "pending");
    assert.ok(existsSync(lost.file!));
    assert.equal(byTitle(w, week!.id, "2").status, "deleted");
    assert.equal(w.weeks.week(week!.id).status, "active");
  });

  test("bibliothèque pickarr partagée : aucune suppression sans ALLOW_DELETE_IN_PICKARR_LIBRARY", async () => {
    w = await createWorld({ shared: true });
    writeAudio(w.local("pickarr", "Old", "Old - Singles", "Old.m4a"), "Old", "Old");
    w.plex.scan(PLEX_ROOT);
    const profile = w.addProfile({ tracks: 2, likedSubdir: "pickarr" });
    assert.equal((await w.run(profile.id, [candidate("A", "1"), candidate("B", "2"), candidate("C", "3")])).ok, true);
    assert.ok(w.pickarr.posts.every((p) => p.subfolder === "Decouvertes"));
    const [week] = w.weeks.weeks(profile.id);
    const files = w.weeks.tracks(week!.id).map((t) => t.file!);
    assert.ok(files.every((f) => f.startsWith(w.local("pickarr", "Decouvertes") + "/")));

    const refused = await w.cleanup.cleanWeek(week!, profile);
    assert.equal(refused.deleted.length, 0);
    assert.equal(refused.pending.length, 3);
    assert.ok(refused.warnings.every((m) => m.includes("ALLOW_DELETE_IN_PICKARR_LIBRARY")));
    assert.ok(files.every((f) => existsSync(f)));

    env.pickarr.allowDeleteInLibrary = true;
    const allowed = await w.cleanup.cleanWeek(week!, profile);
    assert.equal(allowed.deleted.length, 3);
    assert.ok(files.every((f) => !existsSync(f)));
    assert.equal(w.weeks.week(week!.id).status, "cleaned");
    assert.ok(existsSync(w.local("pickarr", "Old", "Old - Singles", "Old.m4a")), "fichier du pickarr principal touché");
    assert.ok(existsSync(w.local("pickarr", "Decouvertes")));
  });
});
