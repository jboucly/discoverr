import { computed, reactive } from "vue";
import { api, type Profile, type Status } from "./api";

const PROFILE_KEY = "discoverr.profile";

function readStoredProfile(): number | null {
  try {
    return Number(localStorage.getItem(PROFILE_KEY)) || null;
  } catch {
    return null;
  }
}

/** Shared state: profiles, selected profile (remembered in the browser) and live status. */
export const store = reactive({
  profiles: [] as Profile[],
  profileId: readStoredProfile(),
  status: null as Status | null,
  toast: null as { message: string; error: boolean } | null,
});

export const currentProfile = computed(() => store.profiles.find((p) => p.id === store.profileId) ?? store.profiles[0] ?? null);

export function selectProfile(id: number) {
  store.profileId = id;
  try {
    localStorage.setItem(PROFILE_KEY, String(id));
  } catch {
    /* private browsing: the choice is simply not remembered */
  }
}

export async function loadProfiles() {
  store.profiles = await api.profiles();
  if (!store.profiles.some((p) => p.id === store.profileId) && store.profiles[0]) selectProfile(store.profiles[0].id);
}

export async function refreshStatus() {
  store.status = await api.status();
}

export const activityFor = (profileId: number | undefined) => store.status?.activity.find((a) => a.profileId === profileId) ?? null;

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(message: string, error = false) {
  store.toast = { message, error };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (store.toast = null), error ? 6000 : 3000);
}

/** Runs an action and shows its error, if any, instead of losing it. */
export async function attempt<T>(fn: () => Promise<T>, success?: string): Promise<T | undefined> {
  try {
    const result = await fn();
    if (success) toast(success);
    return result;
  } catch (err) {
    toast((err as Error).message, true);
    return undefined;
  }
}
