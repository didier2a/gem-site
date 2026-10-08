import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { calendarDateSchema } from './lib/calendar-date.mjs';

/** Chaîne "AAAA-MM-JJ" ou Date YAML (Decap retire parfois les guillemets). */
const calendarDate = calendarDateSchema(z);

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

const buttonStyle = z.enum(['primary', 'outline', 'ghost', 'sun']);

const infoLine = z.object({
  icon: z.string(),
  text: z.string(),
  href: z.string().nullish(),
  strong_first: z.boolean().nullish(),
});

const activityCard = z.object({
  title: z.string(),
  text: z.string(),
  image: z.string().nullish(),
  alt: z.string().nullish(),
  link_label: z.string().nullish(),
  link_href: z.string().nullish(),
});

const teamMember = z.object({
  group: z.string(),
  name: z.string(),
  role: z.string(),
  text: z.string(),
  photo: z.string(),
  alt: z.string().nullish(),
});

/** Liste « Équipe » de Qui sommes-nous. Le groupe et le texte sont sur la carte, et repris sur l’accueil. */
const pageTeamMember = z.object({
  name: z.string(),
  role: z.string(),
  photo: z.string().nullish(),
  photo_alt: z.string().nullish(),
  group: z.string(),
  text: z.string(),
});

/** Liste « Activités » de Nos activités. */
const pageActivity = z.object({
  title: z.string(),
  text: z.string(),
  image: z.string().nullish(),
  image_alt: z.string().nullish(),
});

/** Liste « Cartes de soutien » : icône et titre. Le texte des cartes reste dans la page. */
const supportListCard = z.object({
  icon: z.string().nullish(),
  icon_alt: z.string().nullish(),
  title: z.string(),
});

const blogCard = z.object({
  title: z.string(),
  text: z.string(),
  image: z.string().nullish(),
  alt: z.string().nullish(),
  date: calendarDate,
  date_label: z.string(),
  link_label: z.string(),
  link_href: z.string(),
});

const supportCard = z.object({
  title: z.string(),
  text: z.string(),
  icon: z.string().nullish(),
  alt: z.string().nullish(),
  button_label: z.string().nullish(),
  button_href: z.string().nullish(),
  button_style: buttonStyle.nullish(),
  helloasso: z.boolean().nullish(),
});

const simpleCard = z.object({
  title: z.string(),
  text: z.string(),
});

const faqItem = z.object({
  question: z.string(),
  answer: z.string(),
});

const mapFields = z.object({
  street_url: z.string().nullish(),
  map_url: z.string().nullish(),
  external_url: z.string().nullish(),
  external_label: z.string().nullish(),
  iframe_title: z.string().nullish(),
  caption_strong: z.string().nullish(),
  caption_rest: z.string().nullish(),
});

const pages = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './content/pages' }),
  schema: z.object({
    title: z.string(),
    intro: z.string().optional(),
    helloasso_url: z.string().optional(),
    description: z.string().nullish(),
    hero_image: z.string().nullish(),
    hero_image_alt: z.string().nullish(),
    welcome_image: z.string().nullish(),
    welcome_image_alt: z.string().nullish(),
    abri_image: z.string().nullish(),
    abri_image_alt: z.string().nullish(),
    hero: z
      .object({
        eyebrow: z.string(),
        title_line1: z.string().nullish(),
        title_line2: z.string().nullish(),
        title_em: z.string().nullish(),
        title_before: z.string().nullish(),
        script: z.string().nullish(),
        lead: z.string().nullish(),
        primary_label: z.string().nullish(),
        primary_href: z.string().nullish(),
        secondary_label: z.string().nullish(),
        secondary_href: z.string().nullish(),
      })
      .optional(),
    welcome: z
      .object({
        kicker: z.string(),
        title: z.string(),
        text: z.string(),
      })
      .optional(),
    abri: z
      .object({
        kicker: z.string(),
        title: z.string(),
        text: z.string(),
      })
      .optional(),
    activities: z
      .union([
        z.array(pageActivity),
        z.object({
          kicker: z.string(),
          title: z.string(),
          text: z.string(),
          link_label: z.string(),
          link_href: z.string(),
          cards: z.array(activityCard),
        }),
      ])
      .optional(),
    team: z
      .union([
        z.array(pageTeamMember),
        z.object({
          kicker: z.string(),
          title: z.string(),
          lead: z.string(),
          button_label: z.string(),
          button_href: z.string(),
          members: z.array(teamMember).optional(),
        }),
      ])
      .optional(),
    blog_teaser: z
      .object({
        kicker: z.string(),
        title: z.string(),
        link_label: z.string(),
        link_href: z.string(),
        cards: z.array(blogCard),
      })
      .optional(),
    support: z
      .object({
        kicker: z.string(),
        title: z.string(),
        cards: z.array(supportCard),
      })
      .optional(),
    support_cards: z.array(supportListCard).optional(),
    visit: z
      .object({
        kicker: z.string(),
        title: z.string(),
        button_label: z.string(),
        button_href: z.string(),
        lines: z.array(infoLine),
      })
      .optional(),
    map: mapFields.optional(),
    form: z
      .object({
        title: z.string(),
        intro: z.string(),
        label_nom: z.string(),
        label_prenom: z.string(),
        label_email: z.string(),
        label_tel: z.string(),
        label_sujet: z.string(),
        label_message: z.string(),
        consent: z.string(),
        submit: z.string(),
        hint_before: z.string(),
        hint_email: z.string(),
      })
      .optional(),
    practical: z
      .object({
        title: z.string(),
        lines: z.array(infoLine),
      })
      .optional(),
    location: z
      .object({
        kicker: z.string(),
        title: z.string(),
        lead: z.string(),
        cards: z.array(simpleCard),
      })
      .optional(),
    faq: z
      .object({
        kicker: z.string(),
        title: z.string(),
        items: z.array(faqItem),
      })
      .optional(),
    cta: z
      .object({
        title: z.string(),
        lead: z.string(),
        primary_label: z.string(),
        primary_href: z.string(),
        primary_style: buttonStyle.nullish(),
        secondary_label: z.string(),
        secondary_href: z.string(),
        secondary_style: buttonStyle.nullish(),
      })
      .optional(),
  }),
});

export const collections = { blog, pages };
