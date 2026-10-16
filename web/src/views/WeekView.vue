<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { api, type Track, type Week } from "../api";
import TrackRow from "../components/TrackRow.vue";
import { dateTime, day, relative } from "../format";
import { activityFor, attempt, currentProfile, refreshStatus, store } from "../store";

const weeks = ref<Week[]>([]);
const loading = ref(true);
const settings = ref<{ reviewAutoApproveHours: number } | null>(null);

const profile = currentProfile;
const activity = computed(() => activityFor(profile.value?.id));
const lastRun = computed(() => store.status?.lastRuns.find((r) => r.profileId === profile.value?.id)?.run ?? null);

/** The week to show first: selection to review or download in progress, otherwise the current playlist. */
const review = computed(() => weeks.value.find((w) => w.status === "review" || w.status === "dryrun") ?? null);
const downloading = computed(() => weeks.value.find((w) => w.status === "downloading") ?? null);
const active = computed(() => weeks.value.find((w) => w.status === "active") ?? null);
const olderActive = computed(() => weeks.value.filter((w) => w.status === "active" && w !== active.value));

async function load() {
  if (!profile.value) return;
  weeks.value = await api.weeks(profile.value.id, 6);
  loading.value = false;
}
watch(() => profile.value?.id, () => void attempt(load), { immediate: true });
void api.settings().then((s) => (settings.value = s)).catch(() => {});

// Refreshes the list when a run ends, and regularly while it runs.
let wasRunning = false;
watch(activity, (a) => {
  if (wasRunning && !a) void attempt(load);
  wasRunning = !!a;
});
const timer = setInterval(() => (activity.value || active.value) && void load().catch(() => {}), 30_000);
onUnmounted(() => clearInterval(timer));

async function run() {
  const p = profile.value!;
  const warning = store.status?.dryRun
    ? "Lancer une simulation ? Rien ne sera téléchargé ni supprimé."
    : p.reviewMode
      ? "Préparer une nouvelle sélection à valider ?"
      : "Lancer maintenant ? La nouvelle playlist sera téléchargée, puis les titres non aimés de la semaine précédente supprimés.";
  if (!confirm(warning)) return;
  await attempt(() => api.run(p.id), "Lancement démarré");
  await refreshStatus();
}

async function cleanup() {
  if (!confirm("Relancer le ménage des semaines précédentes ? Les titres non aimés seront supprimés.")) return;
  await attempt(() => api.cleanup(profile.value!.id), "Ménage démarré");
  await refreshStatus();
}

async function setTrack(track: Track, patch: { keep?: boolean; rejected?: boolean }) {
  const updated = await attempt(() => api.updateTrack(track.id, patch));
  if (updated) Object.assign(track, { keep: updated.keep, status: updated.status });
}

async function block(artist: string) {
  if (!confirm(`Ne plus jamais proposer « ${artist} » ?`)) return;
  await attempt(() => api.block(profile.value!.id, artist), `${artist} bloqué`);
}

const selected = computed(() => review.value?.tracks.filter((t) => t.status === "candidate").length ?? 0);
const deadline = computed(() => {
  const hours = settings.value?.reviewAutoApproveHours ?? 0;
  if (!review.value || review.value.status !== "review" || hours <= 0) return null;
  return new Date(Date.parse(review.value.createdAt) + hours * 3_600_000).toISOString();
});

async function approve() {
  const target = profile.value!.tracks;
  if (selected.value < target && !confirm(`Seulement ${selected.value} titres retenus pour ${target} visés. Valider quand même ?`)) return;
  await attempt(() => api.approve(review.value!.id), "Téléchargement lancé");
  await Promise.all([refreshStatus(), load()]);
}

async function resume() {
  await attempt(() => api.resume(downloading.value!.id), "Téléchargement repris");
  await Promise.all([refreshStatus(), load()]);
}

async function discard() {
  if (!confirm("Supprimer cette sélection ? Rien n'a encore été téléchargé.")) return;
  await attempt(() => api.discard(review.value!.id), "Sélection supprimée");
  await load();
}

const liveCounts = computed(() => {
  const tracks = active.value?.tracks.filter((t) => t.status === "imported") ?? [];
  const min = store.status?.likedMinRating ?? 10;
  const kept = tracks.filter((t) => t.keep || (t.rating ?? 0) >= min).length;
  return { kept, total: tracks.length };
});
const failed = (w: Week) => w.tracks.filter((t) => t.status === "failed").length;
</script>

<template>
  <div v-if="profile" class="stack">
    <section class="card">
      <div class="row spread">
        <div>
          <h1>{{ profile.playlistTitle }}</h1>
          <div class="muted small">
            {{ profile.name }} · Last.fm {{ profile.lastfmUser }} · {{ profile.tracks }} titres
            <template v-if="profile.reviewMode"> · avec validation</template>
            <template v-if="!profile.enabled"> · <b>désactivé</b></template>
          </div>
        </div>
        <div class="row">
          <button v-if="olderActive.length" :disabled="!!activity" @click="cleanup">Relancer le ménage</button>
          <button class="primary" :disabled="!!activity" @click="run">Lancer maintenant</button>
        </div>
      </div>

      <div v-if="activity" class="activity">
        <div class="row spread small">
          <span><b>{{ activity.step }}</b></span>
          <span v-if="activity.total" class="muted">{{ activity.done }}/{{ activity.total }}</span>
        </div>
        <div class="progress"><div :style="{ width: activity.total ? `${((activity.done ?? 0) / activity.total) * 100}%` : '100%' }" /></div>
      </div>

      <div class="grid meta">
        <div class="stat">
          <div class="label">Prochain lancement</div>
          <div class="sub-value">{{ store.status?.scheduleEnabled ? dateTime(store.status?.nextRun) : "Désactivé" }}</div>
          <div v-if="store.status?.scheduleEnabled" class="sub">{{ relative(store.status?.nextRun) }}</div>
        </div>
        <div class="stat">
          <div class="label">Dernier lancement</div>
          <div class="sub-value">{{ lastRun ? dateTime(lastRun.startedAt) : "Jamais" }}</div>
          <div v-if="lastRun" class="sub">
            <span v-if="lastRun.ok === true" style="color: var(--good)">✓ Réussi</span>
            <span v-else-if="lastRun.ok === false" class="error-text">✗ Échec : {{ lastRun.step }}</span>
            <span v-else>En cours</span>
          </div>
        </div>
        <div v-if="active" class="stat">
          <div class="label">Gardés cette semaine</div>
          <div class="sub-value">{{ liveCounts.kept }} / {{ liveCounts.total }}</div>
          <div class="sub">le reste partira au prochain ménage</div>
        </div>
      </div>
      <p v-if="lastRun?.ok === false" class="error-text small" style="margin-top: 12px">{{ lastRun.error }}</p>
    </section>

    <!-- Selection to review (or dry run) -->
    <section v-if="review" class="card">
      <div class="row spread">
        <div>
          <h2 style="margin: 0">{{ review.status === "dryrun" ? "Simulation" : "Sélection à valider" }}</h2>
          <div class="muted small">
            <template v-if="review.status === 'dryrun'">Mode simulation : voici ce qui aurait été téléchargé le {{ dateTime(review.createdAt) }}.</template>
            <template v-else>
              {{ selected }} retenus · objectif {{ profile.tracks }}. Écoute les extraits et écarte ce qui ne te tente pas.
              <template v-if="deadline"> Validée d'office {{ relative(deadline) }}.</template>
            </template>
          </div>
        </div>
        <div v-if="review.status === 'review'" class="row">
          <button class="danger" @click="discard">Supprimer</button>
          <button class="primary" :disabled="!!activity || selected === 0" @click="approve">Valider et télécharger</button>
        </div>
        <button v-else class="sm" @click="discard">Effacer</button>
      </div>
      <ul class="tracks">
        <TrackRow v-for="t in review.tracks" :key="t.id" :track="t">
          <template v-if="review.status === 'review'">
            <button v-if="t.status === 'candidate'" class="sm" @click="setTrack(t, { rejected: true })">Écarter</button>
            <button v-else class="sm" @click="setTrack(t, { rejected: false })">Reprendre</button>
            <button class="sm ghost" title="Ne plus jamais proposer cet artiste" @click="block(t.artist)">Bloquer</button>
          </template>
        </TrackRow>
      </ul>
    </section>

    <section v-if="downloading" class="card">
      <div class="row spread">
        <h2 style="margin: 0">Téléchargement{{ activity ? " en cours" : " interrompu" }}</h2>
        <button v-if="!activity" class="primary" @click="resume">Reprendre le téléchargement</button>
      </div>
      <p v-if="!activity" class="muted small" style="margin-top: 6px">Le téléchargement s'est arrêté avant la fin (voir le dernier lancement). Les titres déjà envoyés à pickarr ne sont pas renvoyés.</p>
      <ul class="tracks">
        <TrackRow v-for="t in downloading.tracks.filter((t) => t.status !== 'rejected')" :key="t.id" :track="t" />
      </ul>
    </section>

    <section class="card">
      <div class="row spread">
        <h2 style="margin: 0">{{ active ? `Semaine du ${day(active.activatedAt ?? active.createdAt)}` : "Playlist en place" }}</h2>
        <span v-if="active && failed(active)" class="muted small">{{ failed(active) }} téléchargement(s) en échec</span>
      </div>
      <p class="muted small" style="margin-top: 6px">
        ❤️ dans Plexamp = gardé et rangé dans <b>Musiques/{{ profile.likedSubdir }}</b>. « Garder » le conserve sans ❤️. Le reste est supprimé au prochain lancement.
      </p>
      <div v-if="loading" class="empty">Chargement…</div>
      <div v-else-if="!active" class="empty">Pas encore de playlist. Lance un premier passage{{ store.status?.dryRun ? " (simulation active)" : "" }}.</div>
      <ul v-else class="tracks">
        <TrackRow v-for="t in active.tracks.filter((t) => t.status !== 'rejected' && t.status !== 'failed')" :key="t.id" :track="t" live>
          <template v-if="t.status === 'imported'">
            <button class="sm" @click="setTrack(t, { keep: !t.keep })">{{ t.keep ? "Ne plus garder" : "Garder" }}</button>
            <button class="sm ghost" title="Ne plus jamais proposer cet artiste" @click="block(t.artist)">Bloquer</button>
          </template>
        </TrackRow>
      </ul>
    </section>

    <section v-for="w in olderActive" :key="w.id" class="card">
      <h2>Ménage en attente · semaine du {{ day(w.createdAt) }}</h2>
      <p class="muted small">Certains titres n'ont pas pu être traités (Plex injoignable ou introuvable). Ils seront repris au prochain lancement.</p>
      <ul class="tracks">
        <TrackRow v-for="t in w.tracks.filter((t) => ['imported', 'pending'].includes(t.status))" :key="t.id" :track="t" />
      </ul>
    </section>
  </div>
</template>

<style scoped>
h1 { font-size: 20px; }
.tracks { list-style: none; margin: 12px 0 0; padding: 0; }
.activity { margin-top: 16px; display: grid; gap: 6px; }
.meta { margin-top: 16px; }
.sub-value { font-weight: 600; }
</style>
