# Contexte et points en suspens

Ce fichier sert à reprendre le projet dans une nouvelle session : d'où il vient, ce qui a été décidé et pourquoi, ce qui est vérifié ou non, et ce qui reste à faire. Le fonctionnement est décrit dans [README.md](README.md) (anglais) et [README_fr.md](README_fr.md), l'architecture et les règles dans [CLAUDE.md](CLAUDE.md).

*Rédigé le 14/10/2026, à la fin de la session de création (v2), puis complété le même soir après le premier test local contre les vrais services.*

---

## D'où vient le projet

discoverr est né dans le repo **media-server** de Julien (`/Users/jboucly/Projets/Perso/media-server`). C'est la stack Docker qui le déploie.

**L'environnement de production :**
- Docker tourne dans un **container LXC Proxmox**, avec l'IP locale `192.168.1.33`. La stack est gérée par **Portainer** via l'éditeur web : il ne lit pas de `.env`, les variables sont saisies dans l'interface de Portainer.
- `/mnt/media` est un montage du PVE, visible en `65534:65534` et en 777 dans le LXC. On ne peut pas changer ses propriétaires depuis le LXC. L'écriture en UID 1000 fonctionne.
- Musique : `/mnt/media/Musiques`, vu par Plex sous `/media/Musiques`. Il contient :
  - `Lossless/`, avec un L majuscule ;
  - `Standard/` ;
  - des sous-dossiers par genre, importés dans Plex pour faire des playlists ;
  - `pickarr/`, le dossier du pickarr principal, qui reçoit aussi par défaut les titres aimés ;
  - `Decouvertes/`, réservé à discoverr.
- Données des containers : `/opt/appdata/<service>` (bind mounts en 1000:1000).
- **Plex** est en `network_mode: host`. Les containers le joignent via `host.docker.internal:32400` (`extra_hosts: host-gateway`).
- Les services de la stack sont décrits dans le [CLAUDE.md de media-server](../media-server/CLAUDE.md) :
  - gluetun (Mullvad WireGuard) ;
  - qBittorrent et **slskd**, qui passent tous les deux par le VPN, slskd étant joignable à `http://gluetun:5030` ;
  - cloudflared, avec un seul tunnel et plusieurs routes ;
  - Plex, l'*arr stack, **pickarr** et **pickarr-discovery**.
- Accès extérieur par **Cloudflare Tunnel + Cloudflare Access** (One-time PIN), déjà en place pour pickarr (demander le lien à ton admin).

**pickarr** est l'application d'un ami, dhmetha : <https://gitlab.com/dhmetha/pickarr>. Un clone local existe dans `../pickarr`. Image : `registry.gitlab.com/dhmetha/pickarr:unetha`.

**Ce qu'on a appris de pickarr :**
- Son cookie de session est `Secure` en production. Son interface ne marche donc qu'en HTTPS : la connexion échoue en `http://IP:8090`.
- C'est ce qui a motivé le cookie `Secure` conditionnel de discoverr.

---

## Décisions et pourquoi

| Décision | Raison |
|---|---|
| **Instance pickarr dédiée** (`pickarr-discovery`, qui n'écrit que dans `Musiques/Decouvertes`) | pickarr n'a qu'un seul dossier de sortie. Isoler les découvertes garantit que le ménage ne peut rien supprimer d'autre. |
| Lien **YouTube Music** envoyé à pickarr | pickarr n'accepte que des liens Spotify, YouTube ou SoundCloud. Il retrouve ensuite les tags Deezer et essaie Soulseek en premier. |
| **Last.fm** comme source de goûts | Choix de Julien, qui scrobble déjà. Le scrobbling Plexamp → Last.fm reste à confirmer. |
| ❤️ = note Plex **10** (configurable) | Plexamp range les ❤️ dans la playlist intelligente « ❤️ Tracks ». La valeur exacte de la note est à confirmer. |
| Les titres aimés sont **déplacés** dans un dossier choisi par profil, puis la note est remise | Demande de Julien. Plex peut voir un fichier déplacé comme un nouvel élément et perdre la note. |
| 30 titres par semaine, suppression après **1 semaine** | Demande de Julien, comme Spotify. |
| Le ménage se fait **après** la mise à jour de la nouvelle playlist | Demande de Julien. |
| **NestJS 11 + Fastify** et **Vue 3 + Vite** | Julien maîtrise les deux. La v1 était un script Node avec une page HTML. |
| SQLite via **`node:sqlite`** (intégré à Node 22) | Aucune dépendance native à compiler sous Alpine. Contrepartie : l'avertissement « expérimental » est masqué au démarrage. |
| Versions **figées** (Nest 11.2.7, vue-router 4, Vite 7, TypeScript 5.9.3…) | Nest 12, vue-router 5, pinia 4 et TypeScript 7 venaient de sortir : leurs API ne sont pas maîtrisées. |
| Seuls les secrets, URLs et chemins sont dans l'environnement ; le reste est en base | Tout se règle dans l'interface. `LASTFM_USER` et `DRY_RUN` ne servent qu'au premier démarrage. |
| Cookie `Secure` **seulement en HTTPS** | Pour éviter le problème de pickarr en HTTP sur le réseau local. |
| Notifications d'échec sur **Discord** | Demande de Julien : être prévenu si Plex est injoignable ou si quelque chose échoue. |
| Image publique sur **GHCR** | Demande de Julien. |

---

## Ce qui a été vérifié, et ce qui ne l'a pas été

**Vérifié :**
- Types : `tsc --noEmit` dans l'API, `vue-tsc` dans le front.
- Image Docker : elle se construit, est marquée *healthy*, sert le front et l'API, et demande le mot de passe.
- Authentification : mauvais mot de passe, limite de 5 essais, cookie, clé d'API, en-tête anti-CSRF.
- Validations : cron, dossier des aimés placé dans `Decouvertes`, suppression d'un profil qui a encore des semaines ouvertes, actions refusées selon l'état de la semaine.
- **Cycle complet contre un faux Plex et un faux pickarr, sur de vrais fichiers :**
  - validation, téléchargement, playlist ;
  - ménage : le titre ❤️ est déplacé et sa note remise, le titre « Garder » est déplacé, le titre non aimé est supprimé avec sa pochette et ses dossiers vides ;
  - les fichiers hors `Decouvertes` ne sont pas touchés ;
  - après un redémarrage en plein téléchargement, la reprise se fait automatiquement sans renvoyer les titres à pickarr.
- La recherche YouTube Music fonctionne en vrai.
- Captures de toutes les pages, en bureau et en mobile.

**Vérifié en local contre les vrais services (14/10/2026 au soir) :**
- Lancement depuis le Mac avec `api/.env` (voir [api/.env.example](api/.env.example)) : `npm run build && npm start` dans `api/`, base et dossier de musique factice sous `appdata/local/`.
- **Last.fm réel** (compte `jboucly`, 1 548 écoutes) : environ 97 graines, 55 titres similaires, 35 à 39 de nouveaux artistes. La sélection colle aux goûts (drum & bass, phonk). Durée d'une simulation : environ 2 min, surtout la recherche YouTube Music.
- **Plex réel** (`192.168.1.33:32400`) : joignable, détection des titres déjà présents en bibliothèque.
- **pickarr réel** : un lancement réel accidentel a envoyé 38 picks au pickarr **principal** (`:8090`), annulés à la main ; 1 titre a été importé dans `Musiques/pickarr` avant l'annulation. Une annulation compte comme un pick terminé, donc l'attente s'arrête normalement. Le lancement a ensuite échoué à l'étape playlist, car `Decouvertes` n'est pas dans une bibliothèque Plex. **Ne pas pointer `PICKARR_URL` vers le pickarr principal hors simulation.**
- **Doublons de versions corrigés :** la clé d'un titre ignore désormais la version (« (VIP) », « - Remix », « (Mixed) »…), y compris face à la bibliothèque Plex, et les extraits de mix DJ « (Mixed) » sont écartés (`common/text.ts`). Les clés stockées avant ce changement gardaient la version : sans effet tant qu'aucune base de production n'existe.

**Non vérifié :**
- [ ] **Last.fm réel** : limites de débit sur plusieurs profils.
- [ ] **Plex réel**, en particulier :
  - `DELETE /playlists/{id}/items` puis `PUT` pour vider et remplir la playlist. Si ça ne marche pas, l'étape échoue avec une alerte Discord ;
  - la note des ❤️ Plexamp, supposée à 10 ;
  - le comportement réel après un déplacement : la note est-elle perdue ?
  - `emptyTrash` après suppression.
- [ ] **Extraits Deezer** : l'API répond toujours « Access Denied » depuis le Mac (Akamai), même lors du test du 14/10 au soir. Le code continue sans extrait, mais il faut tester depuis le serveur.
- [ ] **pickarr réel** : forme des réponses (`libraryFile` relatif au dossier de bibliothèque), comportement avec `autoImport` et en cas de conflit.
- [ ] **Profils avec un jeton Plex d'utilisateur géré** : playlists et notes sur un autre compte.
- [ ] La CI GitHub Actions n'a jamais tourné.

---

## Points en suspens

### Avant le premier déploiement
- [ ] **Push** sur `github.com/jboucly/discoverr` (les commits sont locaux). Laisser la CI publier l'image, puis passer le package `discoverr` en **Public** dans les réglages du package GitHub.
- [ ] **Licence :** il n'y a pas encore de fichier `LICENSE`. `ytmusic-api` est sous GPL-3.0 : à prendre en compte dans le choix.
- [ ] **Dans media-server**, le dossier `discoverr/` a été déplacé ici. Le compose de media-server référence seulement l'image. Il reste à commiter ce retrait dans media-server, et à mettre à jour son `CLAUDE.md`, qui pointe encore vers `discoverr/README.md` et `discoverr/CLAUDE.md`.
- [ ] **Sur le LXC :**
  ```bash
  mkdir -p /mnt/media/Musiques/Decouvertes /opt/appdata/pickarr-discovery /opt/appdata/discoverr
  chown 1000:1000 /opt/appdata/pickarr-discovery /opt/appdata/discoverr
  ```
  Ajouter ensuite `Musiques/Decouvertes` à la bibliothèque Musique de Plex.
- [ ] **Variables Portainer :** `DISCOVERR_PASSWORD`, `DISCOVERR_API_KEY` (facultative), `DISCOVERY_PICKARR_API_KEY` (une clé différente de celle du pickarr principal), `LASTFM_USER`, `LASTFM_API_KEY`, `PLEX_TOKEN`.
- [ ] **Scrobbling :** vérifier que les écoutes Plexamp arrivent bien sur Last.fm. Sinon, passer par la liaison Last.fm du compte Plex ou par `multi-scrobbler`.
- [ ] **Premier lancement en simulation** (actif par défaut au premier démarrage), page **État** au vert, puis désactiver la simulation dans Réglages.

### À demander à dhmetha (pickarr)
- [ ] Ajouter un champ « dossier » à `POST /api/picks`, par exemple `{ "url", "autoImport", "subfolder": "Decouvertes" }`. Côté discoverr, tout est prêt :
  1. pointer `PICKARR_URL` vers le pickarr principal ;
  2. renseigner `PICKARR_SUBFOLDER` ;
  3. ajuster `PICKARR_LIBRARY_SUBDIR` ;
  4. supprimer `pickarr-discovery` du compose.
- [ ] Éventuellement : une option pour un cookie non `Secure` en HTTP local.

### Idées d'évolution proposées, non choisies
- **Webhooks Plex** (Plex Pass) : détecter un ❤️ tout de suite et déplacer le titre sans attendre le ménage.
- Bouton **« Ajouter à ma bibliothèque »** pour garder un titre immédiatement.
- **ListenBrainz** en plus ou à la place de Last.fm.
- **Filtres de goûts** : exclure des genres (tags Last.fm), limiter la durée, écarter les lives et remixes.
- **Métriques Prometheus** (`/api/metrics`) pour Grafana.
- Playlist **« Radar »** : nouvelles sorties des artistes gardés.
- **Sauvegarde automatique** de la base SQLite avant chaque lancement.

### Petites dettes connues
- Le compose de media-server déclare encore `version: "3.8"` (obsolète, ignoré par Docker).
- Le choix entre « titres similaires » et « nouveaux artistes » se fait par quota simple, et l'ordre final est mélangé au hasard (`sort(() => Math.random() - 0.5)`). C'est suffisant, mais ce n'est pas un vrai mélange uniforme.
- Pas de suite de tests. Le faux Plex et le faux pickarr écrits pour le test du cycle complet (un `mock.js` d'environ 120 lignes) n'ont pas été gardés dans le repo. Ils pourraient servir de base à des tests d'intégration.
