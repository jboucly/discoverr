<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { api, type Profile, type Settings } from "../api";
import ProfileForm from "../components/ProfileForm.vue";
import { attempt, currentProfile, loadProfiles, refreshStatus, store } from "../store";

const settings = ref<Settings | null>(null);
const saved = ref<Settings | null>(null);
const editing = ref<Profile | "new" | null>(null);
const blocked = ref<string[]>([]);
const newBlocked = ref("");

void attempt(async () => {
  settings.value = await api.settings();
  saved.value = { ...settings.value };
});

const dirty = computed(() => JSON.stringify(settings.value) !== JSON.stringify(saved.value));

const presets = [
  { label: "Lundi 3 h", cron: "0 3 * * 1" },
  { label: "Vendredi 18 h", cron: "0 18 * * 5" },
  { label: "Dimanche 22 h", cron: "0 22 * * 0" },
];

async function saveSettings() {
  const result = await attempt(() => api.saveSettings(settings.value!), "Réglages enregistrés");
  if (result) {
    settings.value = result;
    saved.value = { ...result };
    await refreshStatus();
  }
}

async function testDiscord() {
  await attempt(() => api.testDiscord(settings.value!.discordWebhookUrl), "Message de test envoyé");
}

async function onSaved() {
  editing.value = null;
  await loadProfiles();
}

async function remove(p: Profile) {
  if (!confirm(`Supprimer le profil « ${p.name} » et son historique ? Les fichiers déjà gardés restent en place.`)) return;
  if (await attempt(() => api.deleteProfile(p.id).then(() => true), "Profil supprimé")) await loadProfiles();
}

watch(
  () => currentProfile.value?.id,
  (id) => id && void attempt(async () => (blocked.value = await api.blocked(id))),
  { immediate: true },
);

async function block() {
  const name = newBlocked.value.trim();
  if (!name || !currentProfile.value) return;
  const list = await attempt(() => api.block(currentProfile.value!.id, name));
  if (list) {
    blocked.value = list;
    newBlocked.value = "";
  }
}

async function unblock(artist: string) {
  const list = await attempt(() => api.unblock(currentProfile.value!.id, artist));
  if (list) blocked.value = list;
}
</script>

<template>
  <div class="stack">
    <section class="card">
      <div class="row spread">
        <h2 style="margin: 0">Profils</h2>
        <button v-if="editing === null" class="primary" @click="editing = 'new'">Nouveau profil</button>
      </div>
      <p class="muted small" style="margin-top: 6px">Un profil = un compte Last.fm et une playlist dans Plex.</p>
      <ProfileForm v-if="editing === 'new'" @saved="onSaved" @cancel="editing = null" />
      <div v-for="p in store.profiles" :key="p.id" class="profile">
        <ProfileForm v-if="editing !== null && editing !== 'new' && editing.id === p.id" :profile="p" @saved="onSaved" @cancel="editing = null" />
        <div v-else class="row spread">
          <div>
            <b>{{ p.name }}</b>
            <span v-if="!p.enabled" class="pill" style="margin-left: 6px">désactivé</span>
            <span v-if="p.reviewMode" class="pill info" style="margin-left: 6px">validation</span>
            <div class="muted small">
              Last.fm {{ p.lastfmUser }} · « {{ p.playlistTitle }} » · {{ p.tracks }} titres · aimés → Musiques/{{ p.likedSubdir }}
              · {{ p.hasPlexToken ? "compte Plex dédié" : "compte administrateur" }}
            </div>
          </div>
          <div class="row">
            <button class="sm" @click="editing = p">Modifier</button>
            <button class="sm danger" @click="remove(p)">Supprimer</button>
          </div>
        </div>
      </div>
    </section>

    <section v-if="settings" class="card">
      <h2>Planification et sélection</h2>
      <div class="stack">
        <label class="check">
          <input v-model="settings.scheduleEnabled" type="checkbox" />
          <span><b>Lancement automatique</b><br /><span class="muted small">Pour tous les profils actifs.</span></span>
        </label>
        <div class="form-grid">
          <label class="field">
            <span>Quand (expression cron)</span>
            <input v-model="settings.cron" type="text" :disabled="!settings.scheduleEnabled" />
            <small>
              <template v-for="(p, i) in presets" :key="p.cron">
                <a href="#" @click.prevent="settings.cron = p.cron">{{ p.label }}</a><template v-if="i < presets.length - 1"> · </template>
              </template>
            </small>
          </label>
          <label class="field">
            <span>Part de nouveaux artistes : {{ Math.round(settings.newArtistRatio * 100) }} %</span>
            <input v-model.number="settings.newArtistRatio" type="range" min="0" max="1" step="0.05" />
            <small>Le reste : titres proches de ce que tu écoutes déjà.</small>
          </label>
          <label class="field">
            <span>Titres max par artiste</span>
            <input v-model.number="settings.maxPerArtist" type="number" min="1" max="10" />
          </label>
          <label class="field">
            <span>Validation d'office après (heures)</span>
            <input v-model.number="settings.reviewAutoApproveHours" type="number" min="0" max="168" />
            <small>Profils avec validation. 0 = attendre indéfiniment.</small>
          </label>
          <label class="field">
            <span>Attente max des téléchargements (heures)</span>
            <input v-model.number="settings.pickarrTimeoutHours" type="number" min="1" max="48" />
          </label>
        </div>
      </div>

      <h2 style="margin-top: 24px">Ménage</h2>
      <div class="form-grid">
        <label class="field">
          <span>Note Plex minimale pour garder</span>
          <select v-model.number="settings.likedMinRating">
            <option v-for="n in 10" :key="n" :value="n">{{ n }}/10{{ n === 10 ? " (❤️ Plexamp)" : n % 2 === 0 ? ` (${n / 2} ★)` : "" }}</option>
          </select>
        </label>
      </div>
      <div class="stack" style="margin-top: 16px">
        <label class="check">
          <input v-model="settings.keepIfInOtherPlaylist" type="checkbox" />
          <span><b>Garder les titres ajoutés à une autre playlist</b><br /><span class="muted small">Même sans ❤️.</span></span>
        </label>
        <label class="check">
          <input v-model="settings.dryRun" type="checkbox" />
          <span><b>Mode simulation</b><br /><span class="muted small">Propose des titres sans rien télécharger, déplacer ni supprimer. Idéal pour un premier essai.</span></span>
        </label>
      </div>

      <h2 style="margin-top: 24px">Notifications Discord</h2>
      <div class="form-grid">
        <label class="field">
          <span>Webhook</span>
          <div class="row" style="flex-wrap: nowrap">
            <input v-model="settings.discordWebhookUrl" type="url" placeholder="https://discord.com/api/webhooks/…" />
            <button type="button" :disabled="!settings.discordWebhookUrl" @click="testDiscord">Tester</button>
          </div>
          <small>Les échecs sont toujours notifiés.</small>
        </label>
      </div>
      <label class="check" style="margin-top: 12px">
        <input v-model="settings.notifySuccess" type="checkbox" />
        <span>Envoyer aussi le résumé hebdomadaire</span>
      </label>

      <div class="row savebar">
        <span v-if="dirty" class="muted small">Modifications non enregistrées</span>
        <button class="primary" :disabled="!dirty" @click="saveSettings">Enregistrer</button>
      </div>
    </section>

    <section v-if="currentProfile" class="card">
      <h2>Artistes bloqués <span class="muted small">· {{ currentProfile.name }}</span></h2>
      <p class="muted small">Jamais proposés dans les découvertes de ce profil.</p>
      <form class="row" style="flex-wrap: nowrap" @submit.prevent="block">
        <input v-model="newBlocked" type="text" placeholder="Nom de l'artiste" />
        <button type="submit" :disabled="!newBlocked.trim()">Bloquer</button>
      </form>
      <div class="chips">
        <span v-if="blocked.length === 0" class="muted small">Aucun.</span>
        <span v-for="a in blocked" :key="a" class="pill">
          {{ a }}
          <button class="ghost sm" style="padding: 0 2px" :aria-label="`Débloquer ${a}`" @click="unblock(a)">✕</button>
        </span>
      </div>
    </section>
  </div>
</template>

<style scoped>
.profile { border-top: 1px solid var(--border); padding: 12px 0; }
.profile:first-of-type { margin-top: 8px; }
.profile-form { margin-top: 12px; }
.savebar { justify-content: flex-end; margin-top: 20px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
input[type="range"] { width: 100%; accent-color: var(--accent); }
</style>
