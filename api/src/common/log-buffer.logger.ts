import { ConsoleLogger } from "@nestjs/common";
import type { LogLine } from "../contracts";

/** Les dernières lignes de log, gardées en mémoire pour la page « Journal ». */
export const logBuffer: LogLine[] = [];

/** Bruit du démarrage de Nest (une ligne par route) : utile en console, pas dans le Journal. */
const NOISY = new Set(["RouterExplorer", "RoutesResolver", "InstanceLoader"]);

export class BufferedLogger extends ConsoleLogger {
  private keep(level: string, message: unknown, context?: string) {
    if (context && NOISY.has(context)) return;
    logBuffer.push({ at: new Date().toISOString(), level, context, message: String(message instanceof Error ? message.message : message) });
    if (logBuffer.length > 1000) logBuffer.splice(0, logBuffer.length - 1000);
  }

  log(message: unknown, context?: string) {
    this.keep("log", message, context);
    context === undefined ? super.log(message) : super.log(message, context);
  }

  warn(message: unknown, context?: string) {
    this.keep("warn", message, context);
    context === undefined ? super.warn(message) : super.warn(message, context);
  }

  error(message: unknown, stackOrContext?: string, context?: string) {
    this.keep("error", message, context ?? stackOrContext);
    super.error(message, ...([stackOrContext, context].filter((v) => v !== undefined) as string[]));
  }
}
