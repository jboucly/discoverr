import { sleep } from "./text";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** fetch + JSON, avec des essais sur les erreurs réseau, 5xx et 429. */
export async function fetchJson<T>(url: string, init: RequestInit = {}, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
      if (res.status === 429 || res.status >= 500) throw new HttpError(res.status, `${res.status} ${res.statusText}`);
      if (!res.ok) throw new HttpError(res.status, `${res.status} ${res.statusText}: ${(await res.text()).slice(0, 300)}`);
      const text = await res.text();
      return (text ? JSON.parse(text) : undefined) as T;
    } catch (err) {
      lastError = err;
      if (err instanceof HttpError && err.status < 500 && err.status !== 429) break;
      if (i < attempts - 1) await sleep(2_000 * (i + 1));
    }
  }
  // « fetch failed » ne dit pas qui : on nomme l'hôte (jamais l'URL complète, qui peut porter un jeton).
  if (lastError instanceof TypeError) throw new Error(`${new URL(url).host} injoignable (${(lastError.cause as Error)?.message ?? lastError.message})`);
  throw lastError;
}
