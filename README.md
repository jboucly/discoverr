# discoverr

**Les « Découvertes de la semaine » de Spotify, mais dans ta bibliothèque Plex.**

Chaque semaine, discoverr choisit des titres que tu n'as jamais écoutés à partir de ton historique **Last.fm**, les télécharge avec [pickarr](https://gitlab.com/dhmetha/pickarr) (FLAC via Soulseek quand il existe, sinon YouTube), et remplace une playlist dans **Plex**. La semaine suivante, ce que tu as aimé (❤️ dans Plexamp) rejoint ta bibliothèque, le reste est supprimé : aucun fichier inutile ne s'accumule.

- Interface web : semaine en cours, validation avec extraits audio, historique, statistiques, état des services, réglages.
- Plusieurs profils : chaque utilisateur Plex a son compte Last.fm, ses ❤️ et sa playlist.
- Prudent par conception : rien n'est jamais supprimé hors du dossier des découvertes, et au moindre doute le fichier est gardé.
- Notifications Discord, mot de passe, clé d'API pour les scripts.

---

## Sommaire

- [Comment ça marche](#comment-ça-marche)
- [Prérequis](#prérequis)
- [Installation](#installation)
- [Premiers pas](#premiers-pas)
- [L'interface](#linterface)
- [Profils et comptes Plex](#profils-et-comptes-plex)
- [Le ménage, et ce qui le rend sûr](#le-ménage-et-ce-qui-le-rend-sûr)
- [Configuration](#configuration)
- [API](#api)
- [Accès depuis l'extérieur](#accès-depuis-lextérieur)
- [Développement](#développement)
- [Limites connues](#limites-connues)
- [Crédits et licences](#crédits-et-licences)

---

## Comment ça marche

```
          Last.fm                 YouTube Music + Deezer            pickarr-discovery              Plex
   (tes écoutes, titres    ──►   (lien du titre, extrait    ──►   (Soulseek, sinon YouTube,  ──►  playlist
    et artistes similaires)        de 30 s, pochette)               tags Deezer, rangement)         « Découvertes »
```

Chaque semaine (lundi 3 h par défaut), pour chaque profil actif :

1. **Sélection.** discoverr part de tes titres favoris, tes titres aimés et tes écoutes récentes sur Last.fm, puis cherche :
   - des **titres similaires** (`track.getSimilar`) ;
   - des **artistes que tu n'as jamais écoutés**, proches de tes favoris (30 % par défaut).

   Il écarte ce que tu as déjà écouté, ce qui est déjà dans Plex, ce qui t'a déjà été proposé et les artistes bloqués. Il garde au plus 2 titres par artiste.
2. **Validation** (facultative). Si le profil est en mode validation, la sélection attend dans l'interface. Tu écoutes les extraits et écartes ce qui ne te tente pas, puis tu valides. Sans action de ta part, elle est validée d'office au bout de 48 h.
3. **Téléchargement.** Chaque titre est envoyé à une instance pickarr dédiée, qui l'importe dans `Musiques/Decouvertes`.
4. **Playlist.** La playlist Plex du profil est vidée puis remplie avec les nouveaux titres. C'est la même playlist chaque semaine, donc elle reste épinglée dans Plexamp.
5. **Ménage de la semaine précédente**, une fois la nouvelle playlist en place :
   - **gardés** : les titres ❤️ (note ≥ 10), ceux marqués « Garder » dans l'interface et ceux ajoutés à une autre de tes playlists. Ils sont déplacés dans ton dossier (`Musiques/pickarr` par défaut) et leur note est conservée ;
   - **supprimés** : tous les autres, fichier et dossiers vides compris.

### Pourquoi une instance pickarr dédiée ?

pickarr n'écrit que dans un seul dossier. En lui consacrant une instance qui écrit dans `Musiques/Decouvertes`, tout ce que discoverr télécharge est isolé. discoverr peut alors refuser toute suppression ailleurs : ta bibliothèque principale est hors d'atteinte.

Quand pickarr saura écrire dans un sous-dossier par lien, la variable `PICKARR_SUBFOLDER` permettra de n'utiliser qu'une seule instance, sans changer le code.

---

## Prérequis

| Quoi | Pourquoi |
|---|---|
| **Plex** avec une bibliothèque Musique | Playlist, ❤️, lecture via Plexamp |
| **Un compte Last.fm qui reçoit tes écoutes** (scrobbling) | Sans historique, pas de recommandations. Active le scrobbling depuis Plex/Plexamp ou un outil comme [multi-scrobbler](https://github.com/FoxxMD/multi-scrobbler). |
| **Une clé d'API Last.fm** | Gratuite : <https://www.last.fm/api/account/create> |
| **pickarr** | Téléchargement et taggage. L'exemple de compose en démarre une instance. |
| **slskd** (facultatif) | Pour récupérer du FLAC via Soulseek. Sans lui, pickarr se rabat sur YouTube / SoundCloud. |
| **Docker** | amd64 ou arm64 |

---

## Installation

### 1. Les dossiers

discoverr a besoin de ton dossier de musique monté **tel quel**, avec au moins :

```
Musiques/
├── Decouvertes/   ← créé pour discoverr : uniquement les titres en cours d'essai
└── pickarr/       ← (ou n'importe quel autre) où atterrissent les titres aimés
```

```bash
mkdir -p /mnt/media/Musiques/Decouvertes ./appdata/discoverr ./appdata/pickarr-discovery
chown -R 1000:1000 ./appdata /mnt/media/Musiques/Decouvertes
```

Les containers tournent avec l'UID/GID 1000.

### 2. Plex

Dans ta bibliothèque Musique (**Modifier → Ajouter des dossiers**), ajoute :
- `Musiques/Decouvertes` ;
- le dossier des titres aimés, s'il n'y est pas déjà.

### 3. Les variables

```bash
cp .env.example .env
```

Remplis au minimum :
- `MUSIC_DIR`
- `PLEX_MUSIC_ROOT` : le même dossier, vu depuis Plex
- `DISCOVERR_PASSWORD`
- `LASTFM_USER`
- `LASTFM_API_KEY`
- `PLEX_TOKEN`
- `PICKARR_PASSWORD`
- `DISCOVERY_PICKARR_API_KEY` : générer avec `openssl rand -hex 24`

Le détail de chaque variable est dans [Configuration](#configuration).

> **Trouver ton jeton Plex :**
> ```bash
> docker exec plex grep -o 'PlexOnlineToken="[^"]*"' "/config/Library/Application Support/Plex Media Server/Preferences.xml"
> ```
> Autre méthode : dans Plex Web, ouvre un média, puis **⋯ → Obtenir les infos → Afficher le XML**, et récupère la valeur de `X-Plex-Token` dans l'URL.

### 4. Lancer

```bash
docker compose -f docker-compose.example.yml up -d
```

L'interface est sur **http://&lt;ton-serveur&gt;:8091**.

> L'exemple suppose que Plex tourne sur le même hôte en `network_mode: host`, joignable à `host.docker.internal:32400`. Adapte `PLEX_URL` et `Pickarr__Plex__Url` sinon.

---

## Premiers pas

1. **Connecte-toi** avec `DISCOVERR_PASSWORD`.
2. Ouvre **État** : tout doit être au vert (Plex, pickarr, Last.fm, dossiers, bibliothèques Plex, espace disque). Chaque erreur dit quoi corriger.
3. Le premier démarrage se fait en **mode simulation**. Dans **Semaine**, clique sur **Lancer maintenant** : tu vois ce qui aurait été proposé, mais rien n'est téléchargé ni supprimé.
4. Si la sélection te plaît, va dans **Réglages**, décoche **Mode simulation** et relance.
5. Écoute ta playlist dans Plexamp et mets un ❤️ à ce que tu veux garder. Le reste disparaîtra au prochain lancement.

---

## L'interface

| Page | Contenu |
|---|---|
| **Semaine** | Avancement du lancement en cours. Sélection à valider, avec extraits de 30 s, boutons « Écarter » et « Bloquer l'artiste ». Playlist en cours, avec l'état ❤️ lu en direct dans Plex et un bouton « Garder ». Reprise d'un téléchargement interrompu. |
| **Historique** | Chaque semaine (titres gardés et supprimés) et chaque lancement, avec durée et erreur éventuelle. |
| **Statistiques** | Taux de ❤️ global, par semaine, et par origine (titres proches de tes écoutes ou nouveaux artistes). Réussite des téléchargements, part de FLAC, sources audio, artistes les plus gardés. |
| **État** | Vérification en direct de tout ce dont un lancement a besoin, et journal en temps réel. |
| **Réglages** | Profils, planification, sélection, ménage, simulation, notifications Discord, artistes bloqués. |

---

## Profils et comptes Plex

Un **profil** associe :
- un compte Last.fm ;
- une playlist Plex ;
- un nombre de titres ;
- un dossier pour les titres aimés ;
- éventuellement le mode validation.

Sur Plex, les ❤️ et les playlists sont **propres à chaque compte**. Pour un autre membre du foyer, crée un profil et renseigne **son** jeton Plex :
- sa playlist sera créée sur son compte ;
- seuls **ses** ❤️ comptent pour son ménage.

Sans jeton, le profil utilise le compte administrateur (`PLEX_TOKEN`).

**Un même titre proposé à deux profils** n'est téléchargé qu'une fois. Il n'est supprimé que lorsque plus aucun profil ne l'a en cours.

---

## Le ménage, et ce qui le rend sûr

Le ménage supprime des fichiers : il est conçu pour pécher par excès de prudence.

- **Périmètre :** rien n'est jamais supprimé en dehors du dossier des découvertes. Le chemin réel est vérifié, liens symboliques résolus. Le dossier des titres aimés ne peut pas être placé dans les découvertes.
- **En cas de doute, on garde :** si Plex ne répond pas, le ménage n'est pas lancé. Si un titre est introuvable dans Plex, il est mis de côté (« ménage reporté ») et retraité au lancement suivant. Chaque fois, tu reçois une notification Discord.
- **La note survit au déplacement :** Plex voit parfois un fichier déplacé comme un nouvel élément. discoverr remet donc la note, et le titre reste dans ❤️ Tracks.
- **Simulation :** en mode simulation, tout est journalisé et rien n'est touché.
- **Reprise après interruption :** un téléchargement arrêté par un redémarrage ou une panne de pickarr reprend au démarrage, ou via « Reprendre ». Les titres déjà envoyés ne sont pas renvoyés.

---

## Configuration

### Variables d'environnement

Seuls les secrets, les URLs et les chemins sont dans l'environnement. Tout le reste se règle dans l'interface, sans redémarrage.

| Variable | Défaut | Rôle |
|---|---|---|
| `DISCOVERR_PASSWORD` | *(vide)* | Mot de passe de l'interface. Vide : interface ouverte (un avertissement est journalisé). Le changer ferme toutes les sessions. |
| `DISCOVERR_API_KEY` | *(vide)* | Clé pour les scripts, envoyée dans l'en-tête `X-Api-Key`. Vide : désactivée. |
| `LASTFM_API_KEY` | — | Clé d'API Last.fm. **Obligatoire.** |
| `PLEX_URL` | `http://host.docker.internal:32400` | Adresse de Plex. |
| `PLEX_TOKEN` | — | Jeton administrateur (scans, corbeille, profils sans jeton). **Obligatoire.** |
| `PICKARR_URL` | `http://pickarr-discovery:8080` | Instance pickarr des découvertes. |
| `PICKARR_API_KEY` | — | Sa clé d'API (`Pickarr__ApiKey`). **Obligatoire.** |
| `PICKARR_LIBRARY_SUBDIR` | `Decouvertes` | Dossier, sous `MUSIC_ROOT`, qui correspond au dossier de bibliothèque de cette instance pickarr. |
| `PICKARR_SUBFOLDER` | *(vide)* | Pour une future version de pickarr qui écrirait dans un sous-dossier : envoyé avec chaque lien. |
| `MUSIC_ROOT` | `/music` | Le dossier de musique, vu par discoverr. |
| `PLEX_MUSIC_ROOT` | `/media/Musiques` | Le même dossier, vu par Plex. |
| `DISCOVERY_SUBDIR` | `Decouvertes` | Dossier des découvertes, sous `MUSIC_ROOT`. |
| `TZ` | `Europe/Paris` | Fuseau de la planification. |
| `LASTFM_USER` | — | *Premier démarrage :* crée le profil « Moi » avec ce compte. |
| `DRY_RUN` | — | *Premier démarrage :* active le mode simulation. |
| `DATA_DIR` | `/data` | Base SQLite et clé de session. |

### Réglages (dans l'interface)

| Réglage | Défaut | Rôle |
|---|---|---|
| Lancement automatique | oui | Pour tous les profils actifs. |
| Quand | `0 3 * * 1` | Expression cron (lundi 3 h). |
| Part de nouveaux artistes | 30 % | Le reste : titres proches de tes écoutes. |
| Titres max par artiste | 2 | Par semaine. |
| Validation d'office après | 48 h | Profils en mode validation ; 0 = attendre indéfiniment. |
| Attente max des téléchargements | 6 h | Au-delà, les titres non terminés comptent comme échecs. |
| Note minimale pour garder | 10 | ❤️ Plexamp = 10 ; une note en étoiles va de 2 à 10. |
| Garder les titres ajoutés à une autre playlist | oui | Même sans ❤️. |
| Mode simulation | — | Rien n'est téléchargé, déplacé ni supprimé. |
| Webhook Discord | — | Échecs, avertissements et résumé hebdomadaire (désactivable). |

---

## API

Toute l'interface repose sur une API JSON sous `/api`. Les scripts s'authentifient avec l'en-tête `X-Api-Key: <DISCOVERR_API_KEY>`.

| Méthode | Route | |
|---|---|---|
| GET | `/api/health` | Sonde de vie (publique) |
| GET | `/api/health/details` | État de chaque service |
| GET | `/api/status` | Lancements en cours, prochain lancement, dernier lancement par profil |
| POST | `/api/profiles/:id/run` | Lancer un profil maintenant |
| POST | `/api/profiles/:id/cleanup` | Relancer seulement le ménage |
| GET | `/api/profiles/:id/weeks` | Semaines et titres (état ❤️ en direct pour la semaine en cours) |
| POST | `/api/weeks/:id/approve` | Valider une sélection |
| POST | `/api/weeks/:id/resume` | Reprendre un téléchargement interrompu |
| DELETE | `/api/weeks/:id` | Supprimer une sélection non téléchargée |
| PATCH | `/api/tracks/:id` | `{ "keep": true }` ou `{ "rejected": true }` |
| GET | `/api/profiles/:id/stats` | Statistiques |
| GET / PUT | `/api/settings` | Réglages |
| GET / POST / PUT / DELETE | `/api/profiles[/:id]` | Profils (le jeton Plex n'est jamais renvoyé) |
| GET / POST / DELETE | `/api/profiles/:id/blocked` | Artistes bloqués (`{ "artist": "…" }`) |
| GET | `/api/runs?profileId=` | Historique des lancements |
| GET | `/api/logs?after=` | Journal |

Exemple : lancer le profil 1 depuis un script.

```bash
curl -X POST -H "X-Api-Key: $DISCOVERR_API_KEY" http://localhost:8091/api/profiles/1/run
```

Avec une session (navigateur), les requêtes qui modifient quelque chose doivent porter l'en-tête `X-Requested-With: discoverr` (protection CSRF).

---

## Accès depuis l'extérieur

L'interface fonctionne en HTTP sur le réseau local. Pour y accéder depuis l'extérieur, passe par un reverse proxy en HTTPS (Traefik, Caddy, tunnel Cloudflare…) :
- le cookie de session passe automatiquement en `Secure` quand la requête arrive en HTTPS ;
- l'en-tête `X-Forwarded-Proto` est pris en compte.

Si tu l'exposes sur Internet, choisis un mot de passe solide. Ajoute idéalement une couche d'authentification devant (Cloudflare Access, Authelia…). La connexion est limitée à 5 essais ratés par IP toutes les 15 minutes.

---

## Développement

```
discoverr/
├── api/        NestJS 11 + Fastify, SQLite (node:sqlite intégré à Node 22)
│   └── src/
│       ├── discovery/     cycle, ménage, planification, semaines et lancements
│       ├── integrations/  Last.fm, YouTube Music, Deezer, pickarr, Plex, Discord
│       ├── profiles/  settings/  stats/  health/  auth/
│       └── db/            connexion et migrations
├── web/        Vue 3 + Vite + vue-router
└── Dockerfile  construit le front et l'API dans une seule image
```

```bash
# API (port 3000)
cd api && npm ci
cp ../.env.example .env   # puis exporte les variables, avec DATA_DIR et MUSIC_ROOT en chemins locaux
npm run build && npm start

# Front (port 5175, /api relayé vers localhost:3000)
cd web && npm ci && npm run dev

# Vérifications
cd api && npm run typecheck
cd web && npm run typecheck

# Image
docker build -t discoverr .
```

**Base de données :** les migrations sont dans `api/src/db/migrations.ts` et s'appliquent au démarrage. On n'en modifie jamais une publiée : on en ajoute une.

**CI :** la CI (`.github/workflows/docker.yml`) vérifie les types et construit les deux parties à chaque push et pull request, puis publie l'image sur GHCR :
- `latest` sur `main` ;
- `X.Y.Z` et `X.Y` sur les tags `vX.Y.Z` ;
- `sha-…` sur chaque commit.

---

## Limites connues

- **Recommandations :** elles ne valent que ce que vaut ton historique Last.fm. Quelques semaines de scrobbling sont nécessaires.
- **Liens YouTube Music :** la recherche passe par une bibliothèque non officielle (`ytmusic-api`). Un titre introuvable est simplement ignoré.
- **Extraits Deezer :** ils viennent de l'API publique de Deezer. S'ils sont indisponibles, le titre n'a pas d'extrait, mais tout le reste fonctionne.
- **pickarr :** une instance dédiée est nécessaire tant que pickarr ne sait pas écrire dans un sous-dossier par lien.
- **Une seule instance de discoverr à la fois :** l'état est dans une base SQLite locale.

---

## Crédits et licences

- [pickarr](https://gitlab.com/dhmetha/pickarr) par dhmetha : téléchargement, taggage et import dans Plex.
- [Last.fm API](https://www.last.fm/api), [Deezer API](https://developers.deezer.com/api), [ytmusic-api](https://github.com/zS1L3NT/ts-npm-ytmusic-api) (licence GPL-3.0).

discoverr ne fait que trouver des titres et les confier à pickarr : c'est à toi de t'assurer que ce que tu télécharges respecte le droit applicable dans ton pays.
