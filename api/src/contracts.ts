/**
 * Types partagés avec le front (importés par web/ via le workspace) : uniquement des types, sans aucun import,
 * pour que le front puisse les lire sans tirer Nest ni Node.
 * Les types internes (Profile, Track…) et ce que l'API renvoie (…Dto) sont distingués : le jeton Plex et les chemins
 * de fichiers ne sortent jamais vers le navigateur.
 */

export interface Settings {
  /** Planification du lancement hebdomadaire (expression cron, fuseau TZ). */
  cron: string;
  /** Lancement planifié actif. */
  scheduleEnabled: boolean;
  /** Ne télécharge, ne déplace et ne supprime rien : journalise seulement. */
  dryRun: boolean;
  /** Note Plex minimale pour qu'un titre compte comme aimé (❤️ = 10). */
  likedMinRating: number;
  /** Un titre ajouté à une autre playlist manuelle est gardé. */
  keepIfInOtherPlaylist: boolean;
  /** Part de titres d'artistes jamais écoutés (0 à 1). */
  newArtistRatio: number;
  maxPerArtist: number;
  /** Délai max d'attente des téléchargements pickarr. */
  pickarrTimeoutHours: number;
  /** En mode validation : délai après lequel les candidats sont validés d'office (0 = jamais). */
  reviewAutoApproveHours: number;
  discordWebhookUrl: string;
  notifySuccess: boolean;
}

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

/** Le jeton Plex n'est jamais renvoyé au navigateur. */
export type ProfileDto = Omit<Profile, "plexToken"> & { hasPlexToken: boolean };

export type WeekStatus = "dryrun" | "review" | "downloading" | "active" | "cleaned";

export type TrackStatus =
  | "candidate" // proposé, en attente de validation
  | "rejected" // écarté à la validation
  | "queued" // validé, envoyé (ou à envoyer) à pickarr
  | "imported" // dans la bibliothèque et la playlist
  | "failed" // téléchargement en échec
  | "pending" // ménage reporté (doute, Plex injoignable)
  | "liked" // gardé et déplacé
  | "deleted"; // supprimé au ménage

export interface Week {
  id: number;
  profileId: number;
  status: WeekStatus;
  createdAt: string;
  activatedAt: string | null;
  cleanedAt: string | null;
}

export interface Track {
  id: number;
  weekId: number;
  artist: string;
  title: string;
  key: string;
  kind: "similar" | "new-artist";
  score: number;
  status: TrackStatus;
  link: string | null;
  previewUrl: string | null;
  coverUrl: string | null;
  pickId: number | null;
  file: string | null;
  ratingKey: string | null;
  rating: number | null;
  keep: boolean;
  lossless: boolean | null;
  origin: string | null;
  quality: string | null;
  error: string | null;
  position: number;
  updatedAt: string;
}

/** Ce que le navigateur voit d'un titre (sans chemin de fichier). */
export type TrackDto = Omit<Track, "file"> & { hasFile: boolean };

export type WeekDto = Week & { tracks: TrackDto[] };

export type RunTrigger = "cron" | "manual" | "review" | "auto-approve";

export interface Run {
  id: number;
  profileId: number | null;
  trigger: RunTrigger;
  dryRun: boolean;
  startedAt: string;
  finishedAt: string | null;
  ok: boolean | null;
  step: string | null;
  error: string | null;
}

export interface Activity {
  profileId: number;
  trigger: RunTrigger;
  step: string;
  startedAt: string;
  done?: number;
  total?: number;
}

export interface Status {
  activity: Activity[];
  nextRun: string | null;
  scheduleEnabled: boolean;
  dryRun: boolean;
  likedMinRating: number;
  lastRuns: { profileId: number; run: Run | null }[];
}

export interface WeekStat {
  weekId: number;
  date: string;
  proposed: number;
  liked: number;
  deleted: number;
  failed: number;
}

export interface Stats {
  weeks: (WeekStat & { likeRate: number | null })[];
  totals: {
    weeks: number;
    proposed: number;
    liked: number;
    likeRate: number | null;
    downloadSuccess: number | null;
    losslessRate: number | null;
    rejected: number;
  };
  byKind: { kind: string; decided: number; liked: number; likeRate: number | null }[];
  sources: { origin: string; count: number }[];
  topArtists: { artist: string; liked: number }[];
}

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export interface LogLine {
  at: string;
  level: string;
  context?: string;
  message: string;
}
