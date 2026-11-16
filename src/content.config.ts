import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { blogDataSchema, pageDataSchema } from './lib/content-schema.mjs';

/**
 * Astro 7 n’accepte plus src/content/config.ts (collections legacy).
 * Équivalent actuel : ce fichier, avec un loader glob.
 * Le champ Decap `body` (widget markdown) est le corps du fichier, pas une clé de frontmatter.
 * Seul le titre est obligatoire. Les photos, textes et listes peuvent manquer.
 */
const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './content/blog' }),
  schema: blogDataSchema(z),
});

const pages = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './content/pages' }),
  schema: pageDataSchema(z),
});

export const collections = { blog, pages };
