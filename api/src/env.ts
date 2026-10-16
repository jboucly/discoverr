import path from "node:path";

/**
 * What stays in environment variables: secrets, service URLs and paths (tied to the compose file).
 * Everything else (schedule, number of tracks, profiles…) is set in the UI and lives in the database.
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
  /** Empty: open UI (not recommended once it is reachable outside the LAN). */
  password: read("DISCOVERR_PASSWORD", ""),
  /** For scripts: X-Api-Key header. */
  apiKey: read("DISCOVERR_API_KEY", ""),
  /** Folder of the built front end, served by the API. */
  webDir: read("WEB_DIR", path.join(__dirname, "..", "..", "web", "dist")),

  lastfmApiKey: read("LASTFM_API_KEY"),

  pickarr: {
    url: read("PICKARR_URL", "http://pickarr-discovery:8080").replace(/\/+$/, ""),
    apiKey: read("PICKARR_API_KEY"),
    /** Sent to pickarr as the pick's subfolder; empty = not sent. */
    subfolder: read("PICKARR_SUBFOLDER", ""),
    /** Folder (under MUSIC_ROOT) matching the LibraryPath of the pickarr instance being called. */
    librarySubdir: subdir(read("PICKARR_LIBRARY_SUBDIR", "Decouvertes")),
    /** Explicit consent to delete inside a shared pickarr's library (see sharedPickarrLibrary). */
    allowDeleteInLibrary: read("ALLOW_DELETE_IN_PICKARR_LIBRARY", "false").toLowerCase() === "true",
  },

  plex: {
    url: read("PLEX_URL", "http://host.docker.internal:32400").replace(/\/+$/, ""),
    /** Admin token: scans, trash, and profiles without their own token. */
    token: read("PLEX_TOKEN"),
  },

  paths: {
    /** The Musiques folder as discoverr sees it. */
    musicRoot: read("MUSIC_ROOT", "/music"),
    /** The same folder as Plex sees it. */
    plexMusicRoot: read("PLEX_MUSIC_ROOT", "/media/Musiques"),
    discoverySubdir: subdir(read("DISCOVERY_SUBDIR", "Decouvertes")),
  },
};

export const discoveryDir = () => path.join(env.paths.musicRoot, env.paths.discoverySubdir);
/**
 * Discoveries live in the library of a pickarr also used for other things (the main one, via PICKARR_SUBFOLDER)
 * instead of a dedicated instance: the cleanup deletes nothing there without ALLOW_DELETE_IN_PICKARR_LIBRARY=true.
 */
export const sharedPickarrLibrary = () => env.paths.discoverySubdir !== env.pickarr.librarySubdir;

export const musicDir = (sub: string) => path.join(env.paths.musicRoot, subdir(sub));

/** Path seen by discoverr -> path seen by Plex. */
export function toPlexPath(localPath: string): string {
  const relative = path.relative(env.paths.musicRoot, localPath);
  return path.posix.join(env.paths.plexMusicRoot, ...relative.split(path.sep));
}
