<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { RouterLink, RouterView, useRoute, useRouter } from "vue-router";
import { api } from "./api";
import { markAuthenticated } from "./auth";
import { activityFor, currentProfile, loadProfiles, refreshStatus, selectProfile, store } from "./store";

const route = useRoute();
const router = useRouter();
const isLogin = computed(() => route.name === "login");
const passwordRequired = ref(false);

let timer: ReturnType<typeof setInterval> | undefined;
async function start() {
  await Promise.all([loadProfiles(), refreshStatus()]).catch(() => {});
  passwordRequired.value = (await api.me().catch(() => ({ passwordRequired: false }))).passwordRequired;
  clearInterval(timer);
  timer = setInterval(() => refreshStatus().catch(() => {}), 5000);
}
watch(isLogin, (login) => (login ? clearInterval(timer) : void start()), { immediate: true });
onUnmounted(() => clearInterval(timer));

const activity = computed(() => activityFor(currentProfile.value?.id));

async function logout() {
  await api.logout();
  markAuthenticated(false);
  await router.push({ name: "login" });
}

const nav = [
  { to: "/", label: "Semaine" },
  { to: "/historique", label: "Historique" },
  { to: "/stats", label: "Statistiques" },
  { to: "/etat", label: "État" },
  { to: "/reglages", label: "Réglages" },
];
</script>

<template>
  <RouterView v-if="isLogin" />
  <template v-else>
    <header class="topbar">
      <div class="container row spread">
        <RouterLink to="/" class="brand">🎧 discoverr</RouterLink>
        <div class="row">
          <span v-if="activity" class="pill info pulse"><span class="dot" />{{ activity.step }}</span>
          <span v-if="store.status?.dryRun" class="pill warn" title="Rien n'est téléchargé, déplacé ni supprimé">Simulation</span>
          <select
            v-if="store.profiles.length > 1"
            class="profile-select"
            :value="currentProfile?.id"
            aria-label="Profil"
            @change="selectProfile(Number(($event.target as HTMLSelectElement).value))"
          >
            <option v-for="p in store.profiles" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
          <button v-if="passwordRequired" class="ghost sm" @click="logout">Déconnexion</button>
        </div>
      </div>
      <nav class="container tabs" aria-label="Navigation">
        <RouterLink v-for="item in nav" :key="item.to" :to="item.to" class="tab" exact-active-class="active">{{ item.label }}</RouterLink>
      </nav>
    </header>
    <main class="container page">
      <div v-if="store.profiles.length === 0 && route.name !== 'settings' && route.name !== 'health'" class="card">
        <h2>Bienvenue</h2>
        <p>Aucun profil pour l'instant. Crée-en un dans les réglages : un compte Last.fm et une playlist Plex.</p>
        <RouterLink to="/reglages" class="button primary">Créer un profil</RouterLink>
      </div>
      <RouterView v-else />
    </main>
  </template>
  <div v-if="store.toast" class="toast" :class="{ error: store.toast.error }" role="status">{{ store.toast.message }}</div>
</template>

<style scoped>
.topbar { background: var(--surface); border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 10; }
.topbar > .row { padding-top: 12px; padding-bottom: 8px; }
.brand { font-weight: 700; font-size: 18px; text-decoration: none; }
.profile-select { width: auto; padding: 4px 8px; }
.tabs { display: flex; gap: 4px; overflow-x: auto; scrollbar-width: none; }
.tab { padding: 8px 12px; text-decoration: none; color: var(--muted); border-bottom: 2px solid transparent; white-space: nowrap; }
.tab:hover { color: var(--text); }
.tab.active { color: var(--text); border-bottom-color: var(--accent); font-weight: 600; }
.toast {
  position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); max-width: calc(100vw - 32px);
  background: var(--text); color: var(--bg); padding: 10px 16px; border-radius: 10px; z-index: 100; box-shadow: 0 6px 24px rgb(0 0 0 / .2);
}
.toast.error { background: var(--danger); color: #fff; }
</style>
