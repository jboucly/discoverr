export interface Profile {
  id: number;
  name: string;
  lastfmUser: string;
  hasPlexToken: boolean;
  playlistTitle: string;
  tracks: number;
  likedSubdir: string;
  reviewMode: boolean;
  enabled: boolean;
  createdAt: string;
}

export type ProfileInput = Omit<Profile, "id" | "createdAt" | "hasPlexToken"> & { plexToken?: string | null };

export interface Settings {
  cron: string;
  scheduleEnabled: boolean;
  dryRun: boolean;
  likedMinRating: number;
  keepIfInOtherPlaylist: boolean;
  newArtistRatio: number;
  maxPerArtist: number;
  pickarrTimeoutHours: number;
  reviewAutoApproveHours: number;
  discordWebhookUrl: string;
  notifySuccess: boolean;
}

export type TrackStatus = "candidate" | "rejected" | "queued" | "imported" | "failed" | "pending" | "liked" | "deleted";
export type WeekStatus = "dryrun" | "review" | "downloading" | "active" | "cleaned";

export interface Track {
  id: number;
  weekId: number;
  artist: string;
  title: string;
  kind: "similar" | "new-artist";
  score: number;
  status: TrackStatus;
  link: string | null;
  previewUrl: string | null;
  coverUrl: string | null;
  rating: number | null;
  keep: boolean;
  lossless: boolean | null;
  origin: string | null;
  quality: string | null;
  error: string | null;
  hasFile: boolean;
}

export interface Week {
  id: number;
  profileId: number;
  status: WeekStatus;
  createdAt: string;
  activatedAt: string | null;
  cleanedAt: string | null;
  tracks: Track[];
}

export interface Run {
  id: number;
  profileId: number | null;
  trigger: string;
  dryRun: boolean;
  startedAt: string;
  finishedAt: string | null;
  ok: boolean | null;
  step: string | null;
  error: string | null;
}

export interface Activity {
  profileId: number;
  trigger: string;
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

export interface Stats {
  weeks: { weekId: number; date: string; proposed: number; liked: number; deleted: number; failed: number; likeRate: number | null }[];
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

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Appelé quand l'API répond 401 : l'app renvoie vers la page de connexion. */
let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: {
      "X-Requested-With": "discoverr",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !path.startsWith("/auth/")) onUnauthorized();
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const message = Array.isArray(data.message) ? data.message.join(", ") : data.message;
    throw new ApiError(res.status, message || res.statusText);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const api = {
  me: () => request<{ passwordRequired: boolean; authenticated: boolean }>("GET", "/auth/me"),
  login: (password: string) => request<void>("POST", "/auth/login", { password }),
  logout: () => request<void>("POST", "/auth/logout"),

  status: () => request<Status>("GET", "/status"),
  settings: () => request<Settings>("GET", "/settings"),
  saveSettings: (patch: Partial<Settings>) => request<Settings>("PUT", "/settings", patch),
  testDiscord: (url: string) => request<void>("POST", "/settings/test-discord", { url }),

  profiles: () => request<Profile[]>("GET", "/profiles"),
  createProfile: (input: ProfileInput) => request<Profile>("POST", "/profiles", input),
  updateProfile: (id: number, input: Partial<ProfileInput>) => request<Profile>("PUT", `/profiles/${id}`, input),
  deleteProfile: (id: number) => request<void>("DELETE", `/profiles/${id}`),
  checkLastfm: (user: string) => request<{ playcount: number; registered: string | null }>("POST", "/profiles/check-lastfm", { user }),
  blocked: (id: number) => request<string[]>("GET", `/profiles/${id}/blocked`),
  block: (id: number, artist: string) => request<string[]>("POST", `/profiles/${id}/blocked`, { artist }),
  unblock: (id: number, artist: string) => request<string[]>("DELETE", `/profiles/${id}/blocked`, { artist }),

  run: (id: number) => request<void>("POST", `/profiles/${id}/run`),
  cleanup: (id: number) => request<void>("POST", `/profiles/${id}/cleanup`),
  weeks: (id: number, limit = 20) => request<Week[]>("GET", `/profiles/${id}/weeks?limit=${limit}`),
  approve: (weekId: number) => request<void>("POST", `/weeks/${weekId}/approve`),
  resume: (weekId: number) => request<void>("POST", `/weeks/${weekId}/resume`),
  discard: (weekId: number) => request<void>("DELETE", `/weeks/${weekId}`),
  updateTrack: (id: number, patch: { keep?: boolean; rejected?: boolean }) => request<Track>("PATCH", `/tracks/${id}`, patch),
  runs: (profileId?: number) => request<Run[]>("GET", `/runs${profileId ? `?profileId=${profileId}` : ""}`),
  stats: (id: number) => request<Stats>("GET", `/profiles/${id}/stats`),
  health: () => request<{ ok: boolean; checks: Check[] }>("GET", "/health/details"),
  logs: (after?: string) => request<LogLine[]>("GET", `/logs${after ? `?after=${encodeURIComponent(after)}` : ""}`),
};
