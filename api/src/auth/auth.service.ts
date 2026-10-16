import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { env } from "../env";

export const SESSION_COOKIE = "discoverr_session";
export const SESSION_DAYS = 180;

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * A password (DISCOVERR_PASSWORD) opens a signed session; scripts send X-Api-Key.
 * The signing key depends on the password: changing it closes every session.
 */
@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  private key!: Buffer;
  private readonly attempts = new Map<string, { count: number; until: number }>();

  onModuleInit() {
    const file = path.join(env.dataDir, "secret.key");
    if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString("hex"), { mode: 0o600 });
    this.key = createHmac("sha256", readFileSync(file, "utf8").trim()).update(env.password).digest();
    if (!env.password) this.logger.warn("DISCOVERR_PASSWORD vide : l'interface est ouverte à quiconque y accède");
  }

  get passwordRequired() {
    return env.password.length > 0;
  }

  private sign(payload: string) {
    return createHmac("sha256", this.key).update(payload).digest("base64url");
  }

  createSession(): string {
    const payload = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_DAYS * 86_400_000 })).toString("base64url");
    return `${payload}.${this.sign(payload)}`;
  }

  verifySession(token: string | undefined): boolean {
    if (!token) return false;
    const [payload, signature] = token.split(".");
    if (!payload || !signature || !safeEqual(signature, this.sign(payload))) return false;
    try {
      return (JSON.parse(Buffer.from(payload, "base64url").toString()) as { exp: number }).exp > Date.now();
    } catch {
      return false;
    }
  }

  verifyApiKey(key: string | undefined): boolean {
    return !!env.apiKey && !!key && safeEqual(key, env.apiKey);
  }

  /** Limit: 5 failed attempts per IP, then a 15-minute wait. */
  checkPassword(password: string, ip: string): { ok: boolean; retryAfter?: number } {
    const entry = this.attempts.get(ip);
    if (entry && entry.count >= 5 && entry.until > Date.now()) return { ok: false, retryAfter: Math.ceil((entry.until - Date.now()) / 1000) };
    if (safeEqual(password, env.password)) {
      this.attempts.delete(ip);
      return { ok: true };
    }
    const count = entry && entry.until > Date.now() ? entry.count + 1 : 1;
    this.attempts.set(ip, { count, until: Date.now() + 15 * 60_000 });
    this.logger.warn(`Mot de passe incorrect depuis ${ip} (${count}/5)`);
    return { ok: false };
  }
}
