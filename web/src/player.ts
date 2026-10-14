import { reactive } from "vue";

/** Un seul extrait à la fois, partagé par toute l'app. */
const audio = typeof Audio !== "undefined" ? new Audio() : null;
export const player = reactive({ url: null as string | null, playing: false });

audio?.addEventListener("ended", () => (player.playing = false));
audio?.addEventListener("pause", () => (player.playing = false));
audio?.addEventListener("play", () => (player.playing = true));

export function toggle(url: string) {
  if (!audio) return;
  if (player.url === url && player.playing) {
    audio.pause();
    return;
  }
  if (player.url !== url) {
    audio.src = url;
    player.url = url;
  }
  void audio.play().catch(() => (player.playing = false));
}
