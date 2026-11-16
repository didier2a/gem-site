import { calendarDateSchema } from './calendar-date.mjs';

/**
 * Champs de contenu souples : seul le titre est exigé.
 * Une date vide est acceptée ; une date remplie doit rester AAAA-MM-JJ
 * (cartes) ou une date lisible (article).
 */

function softString(z) {
  return z.string().nullish();
}

function emptyToUndefined(value) {
  if (value == null) return undefined;
  if (typeof value === 'string' && value.trim() === '') return undefined;
  return value;
}

export function optionalCalendarDate(z) {
  return z.preprocess(emptyToUndefined, calendarDateSchema(z).optional());
}

export function optionalBlogDate(z) {
  return z.preprocess(emptyToUndefined, z.coerce.date().optional());
}

function softButtonStyle(z) {
  return z.union([z.enum(['primary', 'outline', 'ghost', 'sun']), z.literal('')]).nullish();
}

function softBool(z) {
  return z.boolean().nullish();
}

export function blogDataSchema(z) {
  return z.object({
    title: z.string().min(1),
    date: optionalBlogDate(z),
    category: softString(z),
    excerpt: softString(z),
    cover: softString(z),
    draft: z.preprocess((value) => (value == null || value === '' ? false : value), z.boolean()),
  });
}

export function pageDataSchema(z) {
  const infoLine = z.object({
    icon: softString(z),
    text: softString(z),
    href: softString(z),
    strong_first: softBool(z),
  });

  const activityCard = z.object({
    title: softString(z),
    text: softString(z),
    image: softString(z),
    alt: softString(z),
    link_label: softString(z),
    link_href: softString(z),
  });

  const legacyMember = z.object({
    group: softString(z),
    name: softString(z),
    role: softString(z),
    text: softString(z),
    photo: softString(z),
    alt: softString(z),
  });

  const pageTeamMember = z.object({
    name: softString(z),
    role: softString(z),
    photo: softString(z),
    photo_alt: softString(z),
    group: softString(z),
    text: softString(z),
  });

  const pageActivity = z.object({
    title: softString(z),
    text: softString(z),
    image: softString(z),
    image_alt: softString(z),
  });

  const supportListCard = z.object({
    icon: softString(z),
    icon_alt: softString(z),
    title: softString(z),
  });

  const blogCard = z.object({
    title: softString(z),
    text: softString(z),
    image: softString(z),
    alt: softString(z),
    date: optionalCalendarDate(z),
    date_label: softString(z),
    link_label: softString(z),
    link_href: softString(z),
  });

  const supportCard = z.object({
    title: softString(z),
    text: softString(z),
    icon: softString(z),
    alt: softString(z),
    button_label: softString(z),
    button_href: softString(z),
    button_style: softButtonStyle(z),
    helloasso: softBool(z),
  });

  const simpleCard = z.object({
    title: softString(z),
    text: softString(z),
  });

  const faqItem = z.object({
    question: softString(z),
    answer: softString(z),
  });

  const mapFields = z.object({
    street_url: softString(z),
    map_url: softString(z),
    external_url: softString(z),
    external_label: softString(z),
    iframe_title: softString(z),
    caption_strong: softString(z),
    caption_rest: softString(z),
  });

  const homeActivities = z.object({
    kicker: softString(z),
    title: softString(z),
    text: softString(z),
    link_label: softString(z),
    link_href: softString(z),
    cards: z.array(activityCard).nullish(),
  });

  const homeTeam = z.object({
    kicker: softString(z),
    title: softString(z),
    lead: softString(z),
    button_label: softString(z),
    button_href: softString(z),
    members: z.array(legacyMember).nullish(),
  });

  return z.object({
    title: z.string().min(1),
    intro: softString(z),
    helloasso_url: softString(z),
    description: softString(z),
    hero_image: softString(z),
    hero_image_alt: softString(z),
    welcome_image: softString(z),
    welcome_image_alt: softString(z),
    abri_image: softString(z),
    abri_image_alt: softString(z),
    hero: z
      .object({
        eyebrow: softString(z),
        title_line1: softString(z),
        title_line2: softString(z),
        title_em: softString(z),
        title_before: softString(z),
        script: softString(z),
        lead: softString(z),
        primary_label: softString(z),
        primary_href: softString(z),
        secondary_label: softString(z),
        secondary_href: softString(z),
      })
      .nullish(),
    welcome: z
      .object({
        kicker: softString(z),
        title: softString(z),
        text: softString(z),
      })
      .nullish(),
    abri: z
      .object({
        kicker: softString(z),
        title: softString(z),
        text: softString(z),
      })
      .nullish(),
    activities: z.union([z.array(pageActivity), homeActivities]).nullish(),
    team: z.union([z.array(pageTeamMember), homeTeam]).nullish(),
    blog_teaser: z
      .object({
        kicker: softString(z),
        title: softString(z),
        link_label: softString(z),
        link_href: softString(z),
        cards: z.array(blogCard).nullish(),
      })
      .nullish(),
    support: z
      .object({
        kicker: softString(z),
        title: softString(z),
        cards: z.array(supportCard).nullish(),
      })
      .nullish(),
    support_cards: z.array(supportListCard).nullish(),
    visit: z
      .object({
        kicker: softString(z),
        title: softString(z),
        button_label: softString(z),
        button_href: softString(z),
        lines: z.array(infoLine).nullish(),
      })
      .nullish(),
    map: mapFields.nullish(),
    form: z
      .object({
        title: softString(z),
        intro: softString(z),
        label_nom: softString(z),
        label_prenom: softString(z),
        label_email: softString(z),
        label_tel: softString(z),
        label_sujet: softString(z),
        label_message: softString(z),
        consent: softString(z),
        submit: softString(z),
        hint_before: softString(z),
        hint_email: softString(z),
      })
      .nullish(),
    practical: z
      .object({
        title: softString(z),
        lines: z.array(infoLine).nullish(),
      })
      .nullish(),
    location: z
      .object({
        kicker: softString(z),
        title: softString(z),
        lead: softString(z),
        cards: z.array(simpleCard).nullish(),
      })
      .nullish(),
    faq: z
      .object({
        kicker: softString(z),
        title: softString(z),
        items: z.array(faqItem).nullish(),
      })
      .nullish(),
    cta: z
      .object({
        title: softString(z),
        lead: softString(z),
        primary_label: softString(z),
        primary_href: softString(z),
        primary_style: softButtonStyle(z),
        secondary_label: softString(z),
        secondary_href: softString(z),
        secondary_style: softButtonStyle(z),
      })
      .nullish(),
  });
}
