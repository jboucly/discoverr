<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { api, type Stats } from "../api";
import { percent, shortDay } from "../format";
import { attempt, currentProfile } from "../store";

const stats = ref<Stats | null>(null);
const showTable = ref(false);
const hover = ref<number | null>(null);

watch(
  () => currentProfile.value?.id,
  (id) => id && void attempt(async () => (stats.value = await api.stats(id))),
  { immediate: true },
);

/** 12 dernières semaines décidées (ménage fait) : le taux de ❤️ n'a de sens qu'une fois le tri terminé. */
const weekly = computed(() => (stats.value?.weeks ?? []).filter((w) => w.likeRate !== null).slice(-12));
const kindLabel: Record<string, string> = { similar: "Proches de tes écoutes", "new-artist": "Nouveaux artistes" };
const maxSource = computed(() => Math.max(1, ...(stats.value?.sources.map((s) => s.count) ?? [])));
const maxArtist = computed(() => Math.max(1, ...(stats.value?.topArtists.map((a) => a.liked) ?? [])));
</script>

<template>
  <div v-if="stats" class="stack">
    <section class="grid">
      <div class="card stat">
        <div class="label">Taux de ❤️</div>
        <div class="value">{{ percent(stats.totals.likeRate) }}</div>
        <div class="sub">{{ stats.totals.liked }} gardés sur {{ stats.totals.proposed }} proposés</div>
      </div>
      <div class="card stat">
        <div class="label">Semaines</div>
        <div class="value">{{ stats.totals.weeks }}</div>
        <div class="sub">{{ stats.totals.rejected }} titre(s) écarté(s) à la validation</div>
      </div>
      <div class="card stat">
        <div class="label">Téléchargements réussis</div>
        <div class="value">{{ percent(stats.totals.downloadSuccess) }}</div>
        <div class="sub">via pickarr</div>
      </div>
      <div class="card stat">
        <div class="label">Qualité sans perte</div>
        <div class="value">{{ percent(stats.totals.losslessRate) }}</div>
        <div class="sub">FLAC (Soulseek)</div>
      </div>
    </section>

    <section class="card">
      <div class="row spread">
        <div>
          <h2 style="margin: 0">Taux de ❤️ par semaine</h2>
          <div class="muted small">Part des titres gardés, une fois le ménage de la semaine fait.</div>
        </div>
        <button class="sm" :aria-pressed="showTable" @click="showTable = !showTable">{{ showTable ? "Graphique" : "Tableau" }}</button>
      </div>
      <div v-if="weekly.length === 0" class="empty">Pas encore de semaine terminée.</div>
      <div v-else-if="showTable" class="table-wrap" style="margin-top: 12px">
        <table>
          <thead><tr><th>Semaine</th><th>Proposés</th><th>Gardés</th><th>Supprimés</th><th>Taux</th></tr></thead>
          <tbody>
            <tr v-for="w in weekly" :key="w.weekId">
              <td>{{ shortDay(w.date) }}</td><td>{{ w.proposed }}</td><td>{{ w.liked }}</td><td>{{ w.deleted }}</td><td>{{ percent(w.likeRate) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="chart" role="img" :aria-label="`Taux de titres gardés sur ${weekly.length} semaines`">
        <div class="axis">
          <span>100 %</span><span>50 %</span><span>0 %</span>
        </div>
        <div class="plot">
          <div class="gridline" style="bottom: 100%" />
          <div class="gridline" style="bottom: 50%" />
          <div class="gridline base" style="bottom: 0" />
          <div
            v-for="(w, i) in weekly"
            :key="w.weekId"
            class="col"
            tabindex="0"
            @mouseenter="hover = i"
            @mouseleave="hover = null"
            @focus="hover = i"
            @blur="hover = null"
          >
            <div class="bar" :class="{ active: hover === i }" :style="{ height: `${Math.max((w.likeRate ?? 0) * 100, 1)}%` }" />
            <div v-if="hover === i" class="tooltip" :class="{ left: i > weekly.length / 2 }">
              <b>Semaine du {{ shortDay(w.date) }}</b><br />
              {{ percent(w.likeRate) }} gardés<br />
              <span class="muted">{{ w.liked }} ❤️ · {{ w.deleted }} supprimés · {{ w.failed }} échecs</span>
            </div>
          </div>
        </div>
        <div />
        <div class="labels">
          <span v-for="w in weekly" :key="w.weekId">{{ shortDay(w.date) }}</span>
        </div>
      </div>
    </section>

    <div class="two">
      <section class="card">
        <h2>Ce qui marche le mieux</h2>
        <div v-if="stats.byKind.every((k) => !k.decided)" class="empty">Pas encore assez de données.</div>
        <div v-for="k in stats.byKind.filter((k) => k.decided)" :key="k.kind" class="hbar">
          <div class="row spread small"><span>{{ kindLabel[k.kind] ?? k.kind }}</span><b>{{ percent(k.likeRate) }}</b></div>
          <div class="track-bar"><div :style="{ width: `${(k.likeRate ?? 0) * 100}%` }" /></div>
          <div class="muted small">{{ k.liked }} gardés sur {{ k.decided }}</div>
        </div>
      </section>

      <section class="card">
        <h2>Source audio</h2>
        <div v-if="stats.sources.length === 0" class="empty">Aucun téléchargement.</div>
        <div v-for="s in stats.sources" :key="s.origin" class="hbar">
          <div class="row spread small"><span>{{ s.origin }}</span><b>{{ s.count }}</b></div>
          <div class="track-bar"><div :style="{ width: `${(s.count / maxSource) * 100}%` }" /></div>
        </div>
      </section>
    </div>

    <section class="card">
      <h2>Artistes les plus gardés</h2>
      <div v-if="stats.topArtists.length === 0" class="empty">Aucun ❤️ pour l'instant.</div>
      <div v-for="a in stats.topArtists" :key="a.artist" class="hbar">
        <div class="row spread small"><span>{{ a.artist }}</span><b>{{ a.liked }}</b></div>
        <div class="track-bar"><div :style="{ width: `${(a.liked / maxArtist) * 100}%` }" /></div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.chart { display: grid; grid-template-columns: 44px 1fr; grid-template-rows: 200px auto; gap: 6px 8px; margin-top: 16px; }
.axis { display: flex; flex-direction: column; justify-content: space-between; font-size: 11px; color: var(--muted); text-align: right; margin: -6px 0; }
.plot { position: relative; display: flex; align-items: flex-end; gap: 6px; }
.gridline { position: absolute; left: 0; right: 0; border-top: 1px solid var(--grid); }
.gridline.base { border-top-color: var(--border); }
.col { flex: 1; height: 100%; display: flex; align-items: flex-end; justify-content: center; position: relative; outline: none; cursor: default; }
.bar { width: min(28px, 70%); background: var(--bar); border-radius: 4px 4px 0 0; transition: opacity .15s; opacity: .85; position: relative; }
.bar.active, .col:focus-visible .bar { opacity: 1; }
.tooltip {
  position: absolute; top: 0; left: 50%; transform: translateX(-20%); z-index: 2; width: max-content; max-width: 220px;
  background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; font-size: 12.5px; box-shadow: 0 6px 20px rgb(0 0 0 / .15);
}
.tooltip.left { transform: translateX(-80%); }
.labels { display: flex; gap: 6px; font-size: 11px; color: var(--muted); }
.labels span { flex: 1; text-align: center; overflow: hidden; white-space: nowrap; }
.two { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
.two .card + .card { margin-top: 0; }
.hbar { margin-top: 12px; display: grid; gap: 4px; }
.track-bar { height: 8px; background: var(--surface-2); border-radius: 4px; overflow: hidden; }
.track-bar > div { height: 100%; background: var(--bar); border-radius: 4px; min-width: 2px; }
@media (max-width: 560px) { .labels span:nth-child(even) { visibility: hidden; } }
</style>
