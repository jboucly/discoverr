import path from "node:path";

/**
 * Ce qui reste dans les variables d'environnement : secrets, URLs des services et chemins (liés au compose).
 * Tout le reste (planification, nombre de titres, profils…) se règle dans l'interface et vit en base.
 */
function read(name: string, fallback?: string): string {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Variable d'environnement manquante : ${name}`);
}

const subdir = (value: string) => value.replace(/^\/+|\/+$/g, "");

export const env = {
  port: Number(read("PORT", "3000")),
  dataDir: read("DATA_DIR", "/data"),
  timezone: read("TZ", "Europe/Paris"),
  /** Vide : interface ouverte (déconseillé dès qu'elle sort du réseau local). */
  password: read("DISCOVERR_PASSWORD", ""),
  /** Pour les scripts : en-tête X-Api-Key. */
  apiKey: read("DISCOVERR_API_KEY", ""),
  /** Dossier du front compilé, servi par l'API. */
  webDir: read("WEB_DIR", path.join(__dirname, "..", "..", "web", "dist")),

  lastfmApiKey: read("LASTFM_API_KEY"),

  pickarr: {
    url: read("PICKARR_URL", "http://pickarr-discovery:8080").replace(/\/+$/, ""),
    apiKey: read("PICKARR_API_KEY"),
    /** Envoyé à pickarr quand il saura écrire dans un sous-dossier ; vide = non envoyé. */
    subfolder: read("PICKARR_SUBFOLDER", ""),
    /** Dossier (sous MUSIC_ROOT) qui correspond au LibraryPath de l'instance pickarr appelée. */
    librarySubdir: subdir(read("PICKARR_LIBRARY_SUBDIR", "Decouvertes")),
  },

  plex: {
    url: read("PLEX_URL", "http://host.docker.internal:32400").replace(/\/+$/, ""),
    /** Jeton administrateur : scans, corbeille, et profils sans jeton propre. */
    token: read("PLEX_TOKEN"),
  },

  paths: {
    /** Le dossier Musiques tel que discoverr le voit. */
    musicRoot: read("MUSIC_ROOT", "/music"),
    /** Le même dossier tel que Plex le voit. */
    plexMusicRoot: read("PLEX_MUSIC_ROOT", "/media/Musiques"),
    discoverySubdir: subdir(read("DISCOVERY_SUBDIR", "Decouvertes")),
  },
};

export const discoveryDir = () => path.join(env.paths.musicRoot, env.paths.discoverySubdir);
export const musicDir = (sub: string) => path.join(env.paths.musicRoot, subdir(sub));

/** Chemin vu par discoverr -> chemin vu par Plex. */
export function toPlexPath(localPath: string): string {
  const relative = path.relative(env.paths.musicRoot, localPath);
  return path.posix.join(env.paths.plexMusicRoot, ...relative.split(path.sep));
}
