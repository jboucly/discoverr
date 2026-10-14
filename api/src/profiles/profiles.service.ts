import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from "@nestjs/common";
import { artistKey, now } from "../common/text";
import { DatabaseService } from "../db/database.service";
import { env } from "../env";

export interface Profile {
  id: number;
  name: string;
  lastfmUser: string;
  /** Jeton Plex de l'utilisateur (notes et playlist à son nom) ; null = jeton administrateur. */
  plexToken: string | null;
  playlistTitle: string;
  tracks: number;
  likedSubdir: string;
  /** Les candidats attendent une validation dans l'interface avant téléchargement. */
  reviewMode: boolean;
  enabled: boolean;
  createdAt: string;
}

export type ProfileInput = Omit<Profile, "id" | "createdAt">;

interface Row {
  id: number;
  name: string;
  lastfm_user: string;
  plex_token: string | null;
  playlist_title: string;
  tracks: number;
  liked_subdir: string;
  review_mode: number;
  enabled: number;
  created_at: string;
}

const toProfile = (r: Row): Profile => ({
  id: r.id,
  name: r.name,
  lastfmUser: r.lastfm_user,
  plexToken: r.plex_token,
  playlistTitle: r.playlist_title,
  tracks: r.tracks,
  likedSubdir: r.liked_subdir,
  reviewMode: r.review_mode === 1,
  enabled: r.enabled === 1,
  createdAt: r.created_at,
});

@Injectable()
export class ProfilesService implements OnModuleInit {
  private readonly logger = new Logger(ProfilesService.name);

  constructor(private readonly db: DatabaseService) {}

  /** Premier démarrage : un profil créé depuis LASTFM_USER, pour que tout marche sans passer par l'interface. */
  onModuleInit() {
    const user = process.env.LASTFM_USER?.trim();
    if (!user || this.list().length > 0) return;
    this.create({
      name: "Moi",
      lastfmUser: user,
      plexToken: null,
      playlistTitle: process.env.PLAYLIST_TITLE?.trim() || "Découvertes de la semaine",
      tracks: Number(process.env.DISCOVERR_TRACKS) || 30,
      likedSubdir: process.env.LIKED_SUBDIR?.trim() || "pickarr",
      reviewMode: false,
      enabled: true,
    });
    this.logger.log(`Profil « Moi » créé pour ${user}`);
  }

  list(): Profile[] {
    return this.db.all<Row>("SELECT * FROM profiles ORDER BY id").map(toProfile);
  }

  get(id: number): Profile {
    const row = this.db.get<Row>("SELECT * FROM profiles WHERE id = ?", [id]);
    if (!row) throw new NotFoundException("Profil introuvable");
    return toProfile(row);
  }

  private validate(input: ProfileInput, id?: number) {
    if (!input.name?.trim()) throw new BadRequestException("Nom manquant");
    if (!input.lastfmUser?.trim()) throw new BadRequestException("Compte Last.fm manquant");
    if (!input.playlistTitle?.trim()) throw new BadRequestException("Titre de playlist manquant");
    if (!Number.isInteger(input.tracks) || input.tracks < 1 || input.tracks > 100) throw new BadRequestException("Entre 1 et 100 titres");
    const liked = input.likedSubdir?.trim() ?? "";
    const discovery = env.paths.discoverySubdir.toLowerCase();
    if (!liked || liked.startsWith("/") || liked.startsWith(".") || liked.split("/").includes("..")) {
      throw new BadRequestException("Dossier des titres aimés invalide (chemin relatif dans Musiques)");
    }
    // Les titres aimés rangés dans le dossier des découvertes seraient supprimés au ménage suivant.
    if (liked.toLowerCase() === discovery || liked.toLowerCase().startsWith(`${discovery}/`)) {
      throw new BadRequestException(`Le dossier des titres aimés ne peut pas être dans ${env.paths.discoverySubdir}`);
    }
    const sameToken = (p: Profile) => (p.plexToken ?? "") === (input.plexToken?.trim() || "");
    if (this.list().some((p) => p.id !== id && p.playlistTitle === input.playlistTitle.trim() && sameToken(p))) {
      throw new BadRequestException("Un autre profil utilise déjà cette playlist pour ce compte Plex");
    }
  }

  create(input: ProfileInput): Profile {
    this.validate(input);
    const { lastInsertRowid } = this.db.run(
      `INSERT INTO profiles (name, lastfm_user, plex_token, playlist_title, tracks, liked_subdir, review_mode, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.name.trim(),
        input.lastfmUser.trim(),
        input.plexToken?.trim() || null,
        input.playlistTitle.trim(),
        input.tracks,
        input.likedSubdir.trim(),
        input.reviewMode ? 1 : 0,
        input.enabled ? 1 : 0,
        now(),
      ],
    );
    return this.get(lastInsertRowid);
  }

  update(id: number, patch: Partial<ProfileInput>): Profile {
    const current = this.get(id);
    // Jeton non renvoyé par l'interface (masqué) : on garde l'actuel.
    const next: ProfileInput = { ...current, ...patch, plexToken: patch.plexToken === undefined ? current.plexToken : patch.plexToken };
    this.validate(next, id);
    this.db.run(
      `UPDATE profiles SET name = ?, lastfm_user = ?, plex_token = ?, playlist_title = ?, tracks = ?, liked_subdir = ?,
       review_mode = ?, enabled = ? WHERE id = ?`,
      [
        next.name.trim(),
        next.lastfmUser.trim(),
        next.plexToken?.trim() || null,
        next.playlistTitle.trim(),
        next.tracks,
        next.likedSubdir.trim(),
        next.reviewMode ? 1 : 0,
        next.enabled ? 1 : 0,
        id,
      ],
    );
    return this.get(id);
  }

  remove(id: number) {
    const open = this.db.get<{ n: number }>("SELECT COUNT(*) n FROM weeks WHERE profile_id = ? AND status != 'cleaned'", [id]);
    if (open && open.n > 0) {
      throw new BadRequestException("Ce profil a encore des semaines non nettoyées : désactive-le et attends le prochain ménage");
    }
    this.db.run("DELETE FROM profiles WHERE id = ?", [id]);
  }

  blocked(profileId: number): string[] {
    return this.db
      .all<{ name: string }>("SELECT name FROM blocked_artists WHERE profile_id = ? ORDER BY name COLLATE NOCASE", [profileId])
      .map((r) => r.name);
  }

  block(profileId: number, artist: string) {
    const name = artist.trim();
    if (!name) throw new BadRequestException("Artiste manquant");
    this.get(profileId);
    this.db.run("INSERT OR IGNORE INTO blocked_artists (profile_id, name, normalized) VALUES (?, ?, ?)", [profileId, name, artistKey(name)]);
  }

  unblock(profileId: number, artist: string) {
    this.db.run("DELETE FROM blocked_artists WHERE profile_id = ? AND normalized = ?", [profileId, artistKey(artist)]);
  }

  blockedKeys(profileId: number): Set<string> {
    return new Set(
      this.db.all<{ normalized: string }>("SELECT normalized FROM blocked_artists WHERE profile_id = ?", [profileId]).map((r) => r.normalized),
    );
  }
}
