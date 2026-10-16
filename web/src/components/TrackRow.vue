<script setup lang="ts">
import { computed } from "vue";
import type { Track } from "../api";
import { trackLabel } from "../format";
import { player, toggle } from "../player";
import { store } from "../store";

const props = defineProps<{ track: Track; live?: boolean }>();

const playing = computed(() => player.playing && player.url === props.track.previewUrl);

/** During the current week: ❤️ read from Plex, "Gardé" forced, otherwise deleted by the next cleanup. */
const badge = computed(() => {
  const t = props.track;
  const liked = t.rating !== null && t.rating >= (store.status?.likedMinRating ?? 10);
  if (props.live && t.status === "imported") {
    if (liked) return { text: "❤️ Aimé", cls: "liked" };
    if (t.keep) return { text: "Gardé", cls: "good" };
    if (t.rating === null) return { text: "Plex ?", cls: "warn", title: "Note illisible : Plex ne répond pas" };
    return { text: "À supprimer", cls: "" };
  }
  const cls: Record<string, string> = { liked: "liked", failed: "danger", pending: "warn", rejected: "", deleted: "", queued: "info" };
  return { text: t.status === "liked" ? "❤️ Gardé" : trackLabel[t.status], cls: cls[t.status] ?? "", title: t.error ?? undefined };
});
</script>

<template>
  <li class="track" :class="{ dim: track.status === 'rejected' || track.status === 'deleted' }">
    <button
      class="cover"
      :style="track.coverUrl ? { backgroundImage: `url(${track.coverUrl})` } : undefined"
      :disabled="!track.previewUrl"
      :aria-label="playing ? 'Pause' : `Écouter un extrait de ${track.title}`"
      :title="track.previewUrl ? 'Extrait de 30 s (iTunes)' : 'Pas d\'extrait disponible'"
      @click="track.previewUrl && toggle(track.previewUrl)"
    >
      <span class="play">{{ playing ? "❚❚" : track.previewUrl ? "▶" : "♪" }}</span>
    </button>
    <div class="info">
      <div class="title">
        {{ track.title }}
        <span v-if="track.kind === 'new-artist'" class="new" title="Artiste que tu n'as jamais écouté">nouvel artiste</span>
      </div>
      <div class="artist">
        {{ track.artist }}
        <template v-if="track.quality"> · {{ track.quality }}</template>
      </div>
    </div>
    <div class="side">
      <span class="pill" :class="badge.cls" :title="badge.title">{{ badge.text }}</span>
      <slot />
    </div>
  </li>
</template>

<style scoped>
.track { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-top: 1px solid var(--border); }
.track:first-child { border-top: 0; }
.track.dim .info { opacity: .5; }
.track.dim .title { text-decoration: line-through; }
.cover {
  width: 48px; height: 48px; flex-shrink: 0; border-radius: 6px; padding: 0; justify-content: center;
  background: var(--surface-2) center / cover; position: relative; overflow: hidden;
}
.cover:disabled { opacity: 1; cursor: default; }
.play { color: #fff; font-size: 14px; text-shadow: 0 1px 4px rgb(0 0 0 / .6); }
.info { flex: 1; min-width: 0; }
.title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.artist { color: var(--muted); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.new { font-size: 11px; font-weight: 500; color: var(--info); margin-left: 6px; }
.side { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
@media (max-width: 600px) {
  .track { flex-wrap: wrap; }
  .side { width: 100%; justify-content: flex-start; padding-left: 60px; }
}
</style>
