import "reflect-metadata";
import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger, NotFoundException } from "@nestjs/common";
import { BaseExceptionFilter, HttpAdapterHost, NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { FastifyReply, FastifyRequest } from "fastify";
import { existsSync } from "node:fs";
import { AppModule } from "./app.module";
import { BufferedLogger } from "./common/log-buffer.logger";
import { env } from "./env";

/** Vue app (client-side routing): any unknown page outside /api returns index.html. */
@Catch(NotFoundException)
class SpaFallbackFilter extends BaseExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const req = host.switchToHttp().getRequest<FastifyRequest>();
    const res = host.switchToHttp().getResponse<FastifyReply>();
    if (req.method === "GET" && !req.url.startsWith("/api/") && existsSync(env.webDir)) {
      return res.type("text/html").sendFile("index.html");
    }
    return super.catch(exception, host);
  }
}

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ trustProxy: true }), {
    logger: new BufferedLogger(),
  });
  await app.register(fastifyCookie);
  if (existsSync(env.webDir)) {
    await app.register(fastifyStatic, { root: env.webDir, prefix: "/", wildcard: false, index: ["index.html"] });
  } else {
    new Logger("Bootstrap").warn(`Front introuvable (${env.webDir}) : seule l'API est servie`);
  }
  app.setGlobalPrefix("api");
  app.useGlobalFilters(new SpaFallbackFilter(app.get(HttpAdapterHost).httpAdapter));
  app.enableShutdownHooks();
  await app.listen(env.port, "0.0.0.0");
  new Logger("Bootstrap").log(`discoverr prêt sur :${env.port}`);
}

void bootstrap();
