import type { Check, LogLine, ProfileDto, ProfileInput as ApiProfileInput, Run, Settings, Stats, Status, TrackDto, WeekDto } from "discoverr-api/contracts";

// Types des réponses, définis par l'API (api/src/contracts.ts) : un changement côté API casse la vérification du front.
export type { Activity, Check, LogLine, Run, Settings, Stats, Status, TrackStatus, WeekStatus } from "discoverr-api/contracts";
export type Profile = ProfileDto;
export type Track = TrackDto;
export type Week = WeekDto;
/** Le jeton Plex est facultatif à l'envoi : absent = inchangé. */
export type ProfileInput = Omit<ApiProfileInput, "plexToken"> & { plexToken?: string | null };

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
