/**
 * Types shared with the front end (imported by web/ through the workspace): types only, no imports at all,
 * so the front end can read them without pulling in Nest or Node.
 * Internal types (Profile, Track…) and what the API returns (…Dto) are kept apart: the Plex token and file paths
 * never reach the browser.
 */

export interface Settings {
  /** Weekly run schedule (cron expression, TZ time zone). */
  cron: string;
  /** Scheduled run enabled. */
  scheduleEnabled: boolean;
  /** Downloads, moves and deletes nothing: only logs. */
  dryRun: boolean;
  /** Minimum Plex rating for a track to count as liked (❤️ = 10). */
  likedMinRating: number;
  /** A track added to another manual playlist is kept. */
  keepIfInOtherPlaylist: boolean;
  /** Share of tracks from never-played artists (0 to 1). */
  newArtistRatio: number;
  maxPerArtist: number;
  /** Maximum wait for pickarr downloads. */
  pickarrTimeoutHours: number;
  /** In review mode: delay after which candidates are auto-approved (0 = never). */
  reviewAutoApproveHours: number;
  discordWebhookUrl: string;
  notifySuccess: boolean;
}

export interface Profile {
  id: number;
  name: string;
  lastfmUser: string;
  /** The user's Plex token (ratings and playlist under their account); null = admin token. */
  plexToken: string | null;
  playlistTitle: string;
  tracks: number;
  likedSubdir: string;
  /** Candidates wait for approval in the UI before downloading. */
  reviewMode: boolean;
  enabled: boolean;
  createdAt: string;
}

export type ProfileInput = Omit<Profile, "id" | "createdAt">;

/** The Plex token is never sent back to the browser. */
export type ProfileDto = Omit<Profile, "plexToken"> & { hasPlexToken: boolean };

export type WeekStatus = "dryrun" | "review" | "downloading" | "active" | "cleaned";

export type TrackStatus =
  | "candidate" // suggested, awaiting review
  | "rejected" // rejected during review
  | "queued" // approved, sent (or to be sent) to pickarr
  | "imported" // in the library and the playlist
  | "failed" // download failed
  | "pending" // cleanup postponed (doubt, Plex unreachable)
  | "liked" // kept and moved
  | "deleted"; // deleted by the cleanup

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

/** What the browser sees of a track (no file path). */
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
