import { satteri } from '@astrojs/markdown-satteri';
import type { MarkdownRenderer } from '@astrojs/internal-helpers/markdown';

let renderer: Promise<MarkdownRenderer> | undefined;

/** Rend un champ Markdown de frontmatter (intro) avec le même moteur que le corps. */
export async function renderMarkdown(source: string | undefined): Promise<string> {
  const text = source?.trim();
  if (!text) return '';
  renderer ??= satteri().createRenderer({});
  const { code } = await (await renderer).render(text);
  return code;
}
