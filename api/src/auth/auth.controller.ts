import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Post, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { Public } from "./auth.guard";
import { AuthService, SESSION_COOKIE, SESSION_DAYS } from "./auth.service";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Get("me")
  me(@Req() req: FastifyRequest) {
    return {
      passwordRequired: this.auth.passwordRequired,
      authenticated: !this.auth.passwordRequired || this.auth.verifySession(req.cookies?.[SESSION_COOKIE]),
    };
  }

  @Public()
  @Post("login")
  @HttpCode(204)
  login(@Body() body: { password?: unknown }, @Req() req: FastifyRequest, @Res({ passthrough: true }) res: FastifyReply) {
    if (!this.auth.passwordRequired) return;
    const result = this.auth.checkPassword(typeof body?.password === "string" ? body.password : "", req.ip);
    if (result.retryAfter) {
      throw new HttpException(`Trop d'essais : réessaie dans ${Math.ceil(result.retryAfter / 60)} min`, HttpStatus.TOO_MANY_REQUESTS);
    }
    if (!result.ok) throw new HttpException("Mot de passe incorrect", HttpStatus.UNAUTHORIZED);
    res.setCookie(SESSION_COOKIE, this.auth.createSession(), {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      // Secure only over HTTPS (Cloudflare tunnel): over plain HTTP on the LAN, the browser would reject the cookie.
      secure: req.protocol === "https",
      maxAge: SESSION_DAYS * 86_400,
    });
  }

  @Public()
  @Post("logout")
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: FastifyReply) {
    res.clearCookie(SESSION_COOKIE, { path: "/" });
  }
}
