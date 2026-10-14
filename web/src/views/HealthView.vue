<script setup lang="ts">
import { nextTick, onUnmounted, ref } from "vue";
import { api, type Check, type LogLine } from "../api";
import { attempt } from "../store";

const checks = ref<Check[] | null>(null);
const checking = ref(false);
const logs = ref<LogLine[]>([]);
const logBox = ref<HTMLElement | null>(null);
const follow = ref(true);

async function runChecks() {
  checking.value = true;
  await attempt(async () => (checks.value = (await api.health()).checks));
  checking.value = false;
}

async function loadLogs() {
  const after = logs.value.at(-1)?.at;
  const fresh = await api.logs(after);
  if (fresh.length === 0) return;
  logs.value = [...logs.value, ...fresh].slice(-1000);
  if (follow.value) {
    await nextTick();
    logBox.value?.scrollTo({ top: logBox.value.scrollHeight });
  }
}

void runChecks();
void loadLogs().catch(() => {});
const timer = setInterval(() => void loadLogs().catch(() => {}), 4000);
onUnmounted(() => clearInterval(timer));

const time = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR");
</script>

<template>
  <div class="stack">
    <section class="card">
      <div class="row spread">
        <div>
          <h2 style="margin: 0">État des services</h2>
          <div class="muted small">Tout doit être au vert pour qu'un lancement réussisse.</div>
        </div>
        <button :disabled="checking" @click="runChecks">{{ checking ? "Vérification…" : "Revérifier" }}</button>
      </div>
      <div v-if="!checks" class="empty">Vérification…</div>
      <ul v-else class="checks">
        <li v-for="c in checks" :key="c.name">
          <span class="pill" :class="c.ok ? 'good' : 'danger'">{{ c.ok ? "✓ OK" : "✗ Erreur" }}</span>
          <div>
            <b>{{ c.name }}</b>
            <div class="small" :class="c.ok ? 'muted' : 'error-text'">{{ c.detail }}</div>
          </div>
        </li>
      </ul>
    </section>

    <section class="card">
      <div class="row spread">
        <h2 style="margin: 0">Journal</h2>
        <label class="row small"><input v-model="follow" type="checkbox" /> Suivre</label>
      </div>
      <div ref="logBox" class="logs" role="log" aria-live="polite">
        <div v-if="logs.length === 0" class="muted">Aucun log.</div>
        <div v-for="(l, i) in logs" :key="i" class="line" :class="l.level">
          <span class="muted">{{ time(l.at) }}</span>
          <span v-if="l.context" class="ctx">{{ l.context }}</span>
          {{ l.message }}
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.checks { list-style: none; padding: 0; margin: 12px 0 0; }
.checks li { display: flex; gap: 12px; align-items: flex-start; padding: 10px 0; border-top: 1px solid var(--border); }
.checks li:first-child { border-top: 0; }
.checks .pill { min-width: 76px; justify-content: center; }
.logs {
  margin-top: 12px; font: 12px/1.6 var(--mono); background: var(--surface-2); border-radius: 8px; padding: 12px;
  height: 420px; overflow: auto; overflow-wrap: anywhere;
}
.line.warn { color: var(--warn); }
.line.error { color: var(--danger); }
.ctx { color: var(--info); margin: 0 4px; }
</style>
