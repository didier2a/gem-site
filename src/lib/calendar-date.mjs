/**
 * Dates du contenu Markdown.
 *
 * Avec guillemets (`date: "2026-04-24"`), YAML laisse une chaîne.
 * Sans guillemets (`date: 2026-04-24`), js-yaml — le parseur d’Astro —
 * construit un objet Date à minuit UTC. Decap retire souvent les guillemets
 * à l’enregistrement.
 *
 * Le résultat est toujours `AAAA-MM-JJ`, lu en UTC, pour que le jour
 * ne recule pas dans un fuseau à l’ouest de Greenwich.
 */

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME =
  /^(\d{4}-\d{2}-\d{2})[Tt\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatUtc(date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function isRealDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** @param {unknown} value @returns {string | undefined} */
export function toCalendarDate(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return undefined;
    return formatUtc(value);
  }
  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();
  const only = DATE_ONLY.exec(trimmed);
  if (only) {
    const year = Number(only[1]);
    const month = Number(only[2]);
    const day = Number(only[3]);
    if (!isRealDate(year, month, day)) return undefined;
    return `${only[1]}-${only[2]}-${only[3]}`;
  }

  const timed = DATE_TIME.exec(trimmed);
  if (!timed) return undefined;
  if (timed[2]) {
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) return undefined;
    return formatUtc(parsed);
  }
  const [year, month, day] = timed[1].split("-").map(Number);
  if (!isRealDate(year, month, day)) return undefined;
  return timed[1];
}

/**
 * Schéma Zod (l’instance fournie par Astro) : chaîne ou Date → AAAA-MM-JJ.
 * @param {typeof import("zod/v4").z} z
 */
export function calendarDateSchema(z) {
  return z.union([z.string(), z.date()]).transform((value, ctx) => {
    const iso = toCalendarDate(value);
    if (iso) return iso;
    ctx.addIssue({
      code: "custom",
      message: "Date attendue au format AAAA-MM-JJ.",
    });
    return z.NEVER;
  });
}
