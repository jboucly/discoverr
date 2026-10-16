<script setup lang="ts">
import { reactive, ref } from "vue";
import { api, type Profile, type ProfileInput } from "../api";
import { attempt } from "../store";

const props = defineProps<{ profile?: Profile }>();
const emit = defineEmits<{ saved: [Profile]; cancel: [] }>();

const form = reactive<ProfileInput>({
  name: props.profile?.name ?? "",
  lastfmUser: props.profile?.lastfmUser ?? "",
  playlistTitle: props.profile?.playlistTitle ?? "Découvertes de la semaine",
  tracks: props.profile?.tracks ?? 30,
  likedSubdir: props.profile?.likedSubdir ?? "pickarr",
  reviewMode: props.profile?.reviewMode ?? false,
  enabled: props.profile?.enabled ?? true,
});
/** Token: empty = unchanged (when editing); "useAdmin" clears the profile's token. */
const plexToken = ref("");
const useAdmin = ref(!props.profile?.hasPlexToken);
const lastfmCheck = ref<string | null>(null);
const busy = ref(false);

async function checkLastfm() {
  lastfmCheck.value = "Vérification…";
  try {
    const info = await api.checkLastfm(form.lastfmUser);
    lastfmCheck.value = info.playcount > 0 ? `✓ ${info.playcount.toLocaleString("fr-FR")} écoutes` : "⚠️ Aucune écoute : le scrobbling est-il actif ?";
  } catch (err) {
    lastfmCheck.value = `✗ ${(err as Error).message}`;
  }
}

async function save() {
  busy.value = true;
  const input: Partial<ProfileInput> = { ...form, tracks: Number(form.tracks) };
  if (useAdmin.value) input.plexToken = null;
  else if (plexToken.value) input.plexToken = plexToken.value;
  else if (!props.profile?.hasPlexToken) input.plexToken = null;
  const saved = await attempt(
    () => (props.profile ? api.updateProfile(props.profile.id, input) : api.createProfile(input as ProfileInput)),
    props.profile ? "Profil enregistré" : "Profil créé",
  );
  busy.value = false;
  if (saved) emit("saved", saved);
}
</script>

<template>
  <form class="profile-form" @submit.prevent="save">
    <div class="form-grid">
      <label class="field">
        <span>Nom</span>
        <input v-model="form.name" type="text" required placeholder="Moi" />
      </label>
      <label class="field">
        <span>Compte Last.fm</span>
        <div class="row" style="flex-wrap: nowrap">
          <input v-model="form.lastfmUser" type="text" required />
          <button type="button" :disabled="!form.lastfmUser" @click="checkLastfm">Vérifier</button>
        </div>
        <small>{{ lastfmCheck ?? "Les recommandations partent de ses écoutes." }}</small>
      </label>
      <label class="field">
        <span>Playlist Plex</span>
        <input v-model="form.playlistTitle" type="text" required />
        <small>Remplacée chaque semaine. Garde le même nom pour la retrouver dans Plexamp.</small>
      </label>
      <label class="field">
        <span>Titres par semaine</span>
        <input v-model.number="form.tracks" type="number" min="1" max="100" required />
      </label>
      <label class="field">
        <span>Dossier des titres aimés</span>
        <input v-model="form.likedSubdir" type="text" required />
        <small>Dans Musiques, par exemple « pickarr » ou « Standard/Découvertes ».</small>
      </label>
      <div class="field">
        <label class="field"><span>Compte Plex</span></label>
        <label class="check small"><input v-model="useAdmin" type="checkbox" /> <span>Compte administrateur (jeton du serveur)</span></label>
        <input
          v-if="!useAdmin"
          v-model="plexToken"
          type="password"
          autocomplete="off"
          :placeholder="profile?.hasPlexToken ? 'Inchangé' : 'Jeton Plex de cet utilisateur'"
          style="margin-top: 6px"
        />
        <small>Les ❤️ et la playlist sont propres à chaque compte Plex.</small>
      </div>
    </div>
    <div class="stack" style="margin-top: 16px">
      <label class="check">
        <input v-model="form.reviewMode" type="checkbox" />
        <span><b>Valider avant téléchargement</b><br /><span class="muted small">Tu écoutes les extraits et écartes ce qui ne te tente pas avant que rien ne soit téléchargé.</span></span>
      </label>
      <label class="check">
        <input v-model="form.enabled" type="checkbox" />
        <span><b>Actif</b><br /><span class="muted small">Inclus dans le lancement planifié.</span></span>
      </label>
    </div>
    <div class="row" style="margin-top: 16px; justify-content: flex-end">
      <button type="button" @click="emit('cancel')">Annuler</button>
      <button class="primary" type="submit" :disabled="busy">Enregistrer</button>
    </div>
  </form>
</template>
