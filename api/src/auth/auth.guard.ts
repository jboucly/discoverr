import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { AuthService, SESSION_COOKIE } from "./auth.service";

export const IS_PUBLIC = "isPublic";
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Header sent by the front end: a page from another site cannot set it (CSRF protection on top of SameSite). */
export const CSRF_HEADER = "x-requested-with";
export const CSRF_VALUE = "discoverr";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) return true;
    const req = context.switchToHttp().getRequest<FastifyRequest>();

    if (this.auth.verifyApiKey(req.headers["x-api-key"] as string | undefined)) return true;
    if (this.auth.passwordRequired && !this.auth.verifySession(req.cookies?.[SESSION_COOKIE])) {
      throw new UnauthorizedException("Connexion requise");
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.headers[CSRF_HEADER] !== CSRF_VALUE) {
      throw new ForbiddenException("En-tête X-Requested-With manquant");
    }
    return true;
  }
}
