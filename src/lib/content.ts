export function formatDate(date: Date | null | undefined): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

export function isoDate(date: Date | null | undefined): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

/** Italique éditorial sur le dernier mot (ou la partie après le dernier tiret). */
export function splitDisplayTitle(title: string | null | undefined): { before: string; em: string; after: string } {
  const safe = typeof title === 'string' ? title : '';
  const after = safe.match(/\s*\?$/)?.[0] ?? '';
  const core = safe.slice(0, safe.length - after.length).trimEnd();
  const cut = Math.max(core.lastIndexOf('-'), core.lastIndexOf(' '));
  if (cut <= 0) return { before: '', em: core, after };
  return {
    before: core.slice(0, cut + 1),
    em: core.slice(cut + 1),
    after,
  };
}

export function safeHttpUrl(value: string | null | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
  } catch {
    return undefined;
  }
  return undefined;
}

/** Première paragraphe Markdown, puis le reste. Sert au chapô de Nous soutenir (pas de champ intro). */
export function splitLead(markdown: string): { lead: string; rest: string } {
  const normalized = markdown.replace(/\r\n/g, '\n').trim();
  const gap = normalized.search(/\n\s*\n/);
  if (gap === -1) return { lead: normalized, rest: '' };
  return {
    lead: normalized.slice(0, gap).trim(),
    rest: normalized.slice(gap).trim(),
  };
}
