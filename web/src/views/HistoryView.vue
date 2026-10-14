<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { api, type Run, type Week } from "../api";
import TrackRow from "../components/TrackRow.vue";
import { dateTime, day, triggerLabel, weekLabel } from "../format";
import { attempt, currentProfile } from "../store";

const weeks = ref<Week[]>([]);
const runs = ref<Run[]>([]);
const profile = currentProfile;

watch(
  () => profile.value?.id,
  (id) =>
    id &&
    void attempt(async () => {
      [weeks.value, runs.value] = await Promise.all([api.weeks(id, 52), api.runs(id)]);
    }),
  { immediate: true },
);

const past = computed(() => weeks.value.filter((w) => w.status === "cleaned" || w.status === "active"));

function counts(w: Week) {
  const c = { liked: 0, deleted: 0, failed: 0, total: 0 };
  for (const t of w.tracks) {
    if (t.status === "liked") c.liked++;
    if (t.status === "deleted") c.deleted++;
    if (t.status === "failed") c.failed++;
    if (["imported", "pending", "liked", "deleted"].includes(t.status)) c.total++;
  }
  return c;
}

function duration(r: Run) {
  if (!r.finishedAt) return "en cours";
  const s = Math.round((Date.parse(r.finishedAt) - Date.parse(r.startedAt)) / 1000);
  return s < 60 ? `${s} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`;
}
</script>

<template>
  <div class="stack">
    <section class="card">
      <h2>Semaines</h2>
      <div v-if="past.length === 0" class="empty">Aucune semaine terminée pour l'instant.</div>
      <details v-for="w in past" :key="w.id" class="week">
        <summary>
          <span class="row spread">
            <span><b>Semaine du {{ day(w.activatedAt ?? w.createdAt) }}</b> <span class="pill">{{ weekLabel[w.status] }}</span></span>
            <span class="small muted">
              <span style="color: var(--liked)">❤️ {{ counts(w).liked }}</span> gardés · {{ counts(w).deleted }} supprimés / {{ counts(w).total }}
              <template v-if="counts(w).failed"> · {{ counts(w).failed }} échecs</template>
            </span>
          </span>
        </summary>
        <ul class="tracks">
          <TrackRow v-for="t in w.tracks.filter((t) => t.status !== 'rejected')" :key="t.id" :track="t" />
        </ul>
      </details>
    </section>

    <section class="card">
      <h2>Lancements</h2>
      <div v-if="runs.length === 0" class="empty">Aucun lancement.</div>
      <div v-else class="table-wrap">
        <table>
          <thead>
            <tr><th>Date</th><th>Déclencheur</th><th>Durée</th><th>Résultat</th></tr>
          </thead>
          <tbody>
            <tr v-for="r in runs" :key="r.id">
              <td>{{ dateTime(r.startedAt) }}</td>
              <td>{{ triggerLabel[r.trigger] ?? r.trigger }}<span v-if="r.dryRun" class="pill warn" style="margin-left: 6px">simulation</span></td>
              <td>{{ duration(r) }}</td>
              <td>
                <span v-if="r.ok === true" style="color: var(--good)">✓ Réussi</span>
                <span v-else-if="r.ok === false" class="error-text">✗ {{ r.step }} : {{ r.error }}</span>
                <span v-else class="muted">En cours</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.week { border-top: 1px solid var(--border); padding: 8px 0; }
.week:first-of-type { border-top: 0; }
summary { cursor: pointer; list-style: none; }
summary::-webkit-details-marker { display: none; }
summary > .row { gap: 4px 12px; }
.tracks { list-style: none; margin: 8px 0 0; padding: 0; }
</style>
