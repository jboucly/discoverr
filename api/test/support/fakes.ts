import {
  mkdirSync,
  readdirSync,
  readFileSync,
  existsSync,
  writeFileSync,
} from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

type Handler = (
  req: IncomingMessage,
  url: URL,
  body: string,
) => { status?: number; json?: unknown } | undefined;

/** Petit serveur HTTP local ; renvoie son URL et de quoi l'arrêter. */
export async function serve(
  handler: Handler,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = "";

    req.on("data", (chunk) => (body += chunk));

    req.on("end", () => {
      try {
        const out =
          handler(req, new URL(req.url ?? "/", "http://fake"), body) ?? {};

        res.writeHead(out.status ?? 200, {
          "Content-Type": "application/json",
        });
        res.end(out.json === undefined ? "" : JSON.stringify(out.json));
      } catch (err) {
        res.writeHead(500);
        res.end((err as Error).message);
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** Les faux fichiers audio contiennent leurs tags en JSON : le faux Plex les lit au scan, même après un déplacement. */
export function writeAudio(file: string, artist: string, title: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ artist, title }));
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full) : e.name.endsWith(".m4a") ? [full] : [];
  });
}

export interface PlexItem {
  ratingKey: string;
  title: string;
  artist: string;
  /** Chemin vu par Plex. */
  file: string;
  userRating?: number;
}

/**
 * Faux Plex : une bibliothèque musicale sur `plexRoot`, indexée en scannant le vrai dossier `musicRoot`.
 * Comme le vrai, un fichier déplacé devient un nouvel élément (sans note) au scan de son nouveau dossier.
 */
export class FakePlex {
  readonly items = new Map<string, PlexItem>();
  readonly playlists = new Map<
    string,
    { title: string; smart: boolean; keys: string[] }
  >();
  readonly calls: string[] = [];
  down = false;
  private nextKey = 1;

  constructor(
    private readonly musicRoot: string,
    private readonly plexRoot: string,
  ) {}

  private toLocal(plexPath: string) {
    return path.join(this.musicRoot, path.relative(this.plexRoot, plexPath));
  }

  private toPlex(localPath: string) {
    return path.posix.join(
      this.plexRoot,
      ...path.relative(this.musicRoot, localPath).split(path.sep),
    );
  }

  scan(plexPath: string) {
    const local = this.toLocal(plexPath);
    const files = walk(local);

    for (const item of [...this.items.values()]) {
      if (
        item.file.startsWith(plexPath) &&
        !existsSync(this.toLocal(item.file))
      )
        this.items.delete(item.ratingKey);
    }

    for (const file of files) {
      const plexFile = this.toPlex(file);

      if ([...this.items.values()].some((i) => i.file === plexFile)) continue;

      const tags = JSON.parse(readFileSync(file, "utf8")) as {
        artist: string;
        title: string;
      };
      const ratingKey = String(this.nextKey++);

      this.items.set(ratingKey, { ratingKey, file: plexFile, ...tags });
    }
  }

  itemByLocalFile(localPath: string) {
    const plexFile = this.toPlex(localPath);
    return [...this.items.values()].find((i) => i.file === plexFile);
  }

  addPlaylist(title: string, keys: string[], smart = false) {
    this.playlists.set(String(1000 + this.playlists.size), {
      title,
      smart,
      keys,
    });
  }

  playlistKeys(title: string) {
    return [...this.playlists.values()].find((p) => p.title === title)?.keys;
  }

  private metadata(item: PlexItem) {
    return {
      ratingKey: item.ratingKey,
      title: item.title,
      grandparentTitle: item.artist,
      userRating: item.userRating,
      Media: [{ Part: [{ file: item.file }] }],
    };
  }

  handle: Handler = (req, url) => {
    if (this.down) return { status: 503 };

    const method = req.method ?? "GET";
    const p = url.pathname;
    const q = url.searchParams;

    this.calls.push(`${method} ${p}`);
    const container = (extra: object) => ({ json: { MediaContainer: extra } });

    if (p === "/identity")
      return container({ machineIdentifier: "fake-plex", version: "1.0" });

    if (p === "/library/sections")
      return container({
        Directory: [
          {
            key: "1",
            type: "artist",
            title: "Musique",
            Location: [{ path: this.plexRoot }],
          },
        ],
      });

    if (p === "/library/sections/1/all") {
      const title = (q.get("title") ?? "").toLowerCase();
      return container({
        Metadata: [...this.items.values()]
          .filter((i) => i.title.toLowerCase().includes(title))
          .map((i) => this.metadata(i)),
      });
    }

    if (p === "/library/sections/1/refresh") {
      this.scan(q.get("path") ?? this.plexRoot);
      return {};
    }

    if (p === "/library/sections/1/emptyTrash") return {};
    const meta = p.match(/^\/library\/metadata\/(\w+)$/);

    if (meta) {
      const item = this.items.get(meta[1]!);
      return item
        ? container({ Metadata: [this.metadata(item)] })
        : { status: 404 };
    }

    if (p === "/:/rate") {
      const item = this.items.get(q.get("key")!);
      if (!item) return { status: 404 };
      item.userRating = Number(q.get("rating"));
      return {};
    }

    const keysOf = (uri: string) => uri.split("/").at(-1)!.split(",");

    if (p === "/playlists" && method === "GET") {
      return container({
        Metadata: [...this.playlists.entries()].map(([ratingKey, pl]) => ({
          ratingKey,
          title: pl.title,
          smart: pl.smart,
        })),
      });
    }

    if (p === "/playlists" && method === "POST") {
      this.addPlaylist(q.get("title")!, keysOf(q.get("uri")!));
      return {};
    }

    const items = p.match(/^\/playlists\/(\w+)\/items$/);

    if (items) {
      const playlist = this.playlists.get(items[1]!);
      if (!playlist) return { status: 404 };
      if (method === "DELETE") playlist.keys = [];
      else if (method === "PUT") playlist.keys = keysOf(q.get("uri")!);
      else
        return container({
          Metadata: playlist.keys
            .map((k) => this.items.get(k))
            .filter((i) => !!i)
            .map((i) => this.metadata(i!)),
        });
      return {};
    }
    return { status: 404 };
  };
}

/** Lien YouTube Music factice qui porte le titre, pour que le faux pickarr sache quoi « télécharger ». */
export const ytLink = (artist: string, title: string) =>
  `https://music.youtube.com/watch?v=${encodeURIComponent(JSON.stringify({ artist, title }))}`;

/**
 * Faux pickarr : chaque lien est importé tout de suite dans `libraryRoot` (sous `subfolder` s'il est donné),
 * au même chemin pour un même titre, comme le vrai. Un titre contenant « FAIL » échoue.
 */
export class FakePickarr {
  readonly picks = new Map<number, object>();
  readonly posts: { url: string; subfolder?: string }[] = [];
  readonly deleted: number[] = [];
  /** Titre écrit dans les tags quand pickarr ne garde pas celui du lien (« A - B Remix » -> « A (B Remix) »). */
  readonly taggedTitles = new Map<string, string>();
  private nextId = 1;

  constructor(public libraryRoot: string) {}

  handle: Handler = (req, url, body) => {
    const method = req.method ?? "GET";
    if (url.pathname === "/api/status") return { json: { ok: true } };

    if (url.pathname === "/api/picks" && method === "POST") {
      const input = JSON.parse(body) as { url: string; subfolder?: string };
      this.posts.push(input);

      const { artist, title } = JSON.parse(
        new URL(input.url).searchParams.get("v")!,
      ) as { artist: string; title: string };

      const id = this.nextId++;
      const failed = title.includes("FAIL");
      const libraryFile = failed
        ? null
        : [input.subfolder, artist, `${artist} - Singles`, `${title}.m4a`]
            .filter(Boolean)
            .join("/");

      if (libraryFile) {
        const file = path.join(this.libraryRoot, libraryFile);
        writeAudio(file, artist, this.taggedTitles.get(title) ?? title);
        writeFileSync(path.join(path.dirname(file), "cover.jpg"), "");
      }

      const pick = {
        id,
        url: input.url,
        error: null,
        expanded: true,
        tracks: [
          {
            id,
            status: failed ? "Failed" : "Imported",
            error: failed ? "introuvable" : null,
            title,
            artist,
            quality: "FLAC",
            origin: "soulseek",
            lossless: true,
            libraryFile,
          },
        ],
      };

      this.picks.set(id, pick);
      return { json: { pick } };
    }

    const one = url.pathname.match(/^\/api\/picks\/(\d+)$/);

    if (one) {
      const id = Number(one[1]);

      if (!this.picks.has(id)) return { status: 404 };

      if (method === "DELETE") {
        this.picks.delete(id);
        this.deleted.push(id);
        return { status: 204 };
      }

      return { json: this.picks.get(id) };
    }

    return { status: 404 };
  };
}
