import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * Astro 7 n’accepte plus src/content/config.ts (collections legacy).
 * Équivalent actuel : ce fichier, avec un loader glob.
 * Le champ Decap `body` (widget markdown) est le corps du fichier, pas une clé de frontmatter.
 */
const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './content/blog' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    category: z.string().optional(),
    excerpt: z.string(),
    cover: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

const pages = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './content/pages' }),
  schema: z.object({
    title: z.string(),
    intro: z.string().optional(),
    helloasso_url: z.string().optional(),
  }),
});

export const collections = { blog, pages };
