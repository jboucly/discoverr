import type { TrackStatus, WeekStatus } from "./api";

export const dateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" }) : "—";

export const day = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

export const shortDay = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });

export const percent = (value: number | null | undefined) => (value === null || value === undefined ? "—" : `${Math.round(value * 100)} %`);

export function relative(iso: string | null | undefined) {
  if (!iso) return "—";
  const diff = Date.parse(iso) - Date.now();
  const rtf = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });
  const abs = Math.abs(diff);
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), "hour");
  return rtf.format(Math.round(diff / 86_400_000), "day");
}

export const weekLabel: Record<WeekStatus, string> = {
  dryrun: "Simulation",
  review: "À valider",
  downloading: "Téléchargement",
  active: "En cours",
  cleaned: "Terminée",
};

export const trackLabel: Record<TrackStatus, string> = {
  candidate: "Proposé",
  rejected: "Écarté",
  queued: "En file",
  imported: "Dans la playlist",
  failed: "Échec",
  pending: "Ménage reporté",
  liked: "Gardé",
  deleted: "Supprimé",
};

export const triggerLabel: Record<string, string> = {
  cron: "Planifié",
  manual: "Manuel",
  review: "Validation",
  "auto-approve": "Validation d'office",
};
