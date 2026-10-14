<script setup lang="ts">
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../api";
import { markAuthenticated } from "../auth";

const route = useRoute();
const router = useRouter();
const password = ref("");
const error = ref("");
const busy = ref(false);

async function submit() {
  busy.value = true;
  error.value = "";
  try {
    await api.login(password.value);
    markAuthenticated(true);
    await router.replace(typeof route.query.next === "string" ? route.query.next : "/");
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="login">
    <form class="card" @submit.prevent="submit">
      <div class="logo">🎧</div>
      <h1>discoverr</h1>
      <p class="muted">Tes découvertes de la semaine, dans Plex.</p>
      <input v-model="password" type="password" placeholder="Mot de passe" autocomplete="current-password" autofocus required />
      <p v-if="error" class="error-text small">{{ error }}</p>
      <button class="primary" type="submit" :disabled="busy || !password">Entrer</button>
    </form>
  </div>
</template>

<style scoped>
.login { min-height: 100vh; display: grid; place-items: center; padding: 16px; }
form { width: min(340px, 100%); text-align: center; display: grid; gap: 12px; padding: 32px 24px; }
.logo { font-size: 40px; }
h1 { margin: 0; }
button { justify-content: center; }
</style>
