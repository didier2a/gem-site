import { safeHttpUrl } from './content';

/** Photos d’origine si le champ Decap est vide. */
export const HOME_IMAGE_FALLBACK = {
  hero: '/assets/home/home-hero-poster.jpg',
  welcome: '/assets/home/illu-bienvenue.png',
  abri: '/assets/home/abri-solitudes-poster.jpg',
} as const;

export const MAP_DEFAULTS = {
  street:
    'https://www.google.com/maps/embed?pb=!4v1789720122894!6m8!1m7!1sFN_OZ7eonECJthnChQIxzw!2m2!1d41.60239401343021!2d9.2765341409839!3f289.31085!4f0!5f0.7820865974627469',
  map:
    "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d5966.930561275364!2d9.267305877709955!3d41.60244929999999!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x12d981d9be384e37%3A0xa6da7866982dbf99!2sAssociation%20GEM%2C%20CASA%20DI%20L'ISULA!5e0!3m2!1sfr!2sus!4v1789720082836!5m2!1sfr!2sus",
  external:
    'https://www.google.com/maps/place/Association+GEM,+CASA+DI+L%27ISULA/@41.6024493,9.2763181,17z',
  iframeTitle: 'Street View et carte — Association GEM Casa di l’Isula, Porto-Vecchio',
  captionStrong: 'Association GEM, Casa di l’Isula',
  captionRest: 'Immeuble Saint-Jean, Quartier Poretta, Av. de Bastia, 20137 Porto-Vecchio',
  externalLabel: 'Ouvrir dans Google Maps',
} as const;

export function mediaSrc(value: string | null | undefined, fallback: string): string {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v) return fallback;
  if (v.startsWith('/') && !v.startsWith('//')) return v;
  return safeHttpUrl(v) || fallback;
}

export function safeHref(value: string | null | undefined, fallback: string): string {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v) return fallback;
  if (v.startsWith('/') && !v.startsWith('//')) return v;
  if (v.startsWith('#') || v.startsWith('mailto:') || v.startsWith('tel:')) return v;
  return safeHttpUrl(v) || fallback;
}

export function mapUrl(value: string | null | undefined, fallback: string): string {
  return safeHttpUrl(typeof value === 'string' ? value : '') || fallback;
}

export function metaText(value: string | null | undefined, fallback: string): string {
  const v = (value ?? '').replace(/\s+/g, ' ').trim();
  return v || fallback;
}

/** Portraits d’origine si le champ Photo est vide. */
export const TEAM_PHOTO_FALLBACK: Record<string, string> = {
  'Michèle Mereu': '/assets/team/michele-mereu.png',
  'Didier Aouizerate': '/assets/team/didier-aouizerate.png',
  'Nathalie Maxant': '/assets/team/nathalie-maxant.png',
  'Muriel Truphème': '/assets/team/muriel-trupheme.png',
};

/** Photos d’activités d’origine si le champ Image est vide. */
export const ACTIVITY_IMAGE_FALLBACK: Record<string, { image: string; alt: string }> = {
  Peindre: { image: '/assets/home/activity-peindre-v2.jpg', alt: 'Atelier peinture' },
  Cuisiner: { image: '/assets/home/activity-cuisiner-v2.jpg', alt: 'Atelier cuisine' },
  Marcher: { image: '/assets/home/activity-marcher-v2.jpg', alt: 'Marche en extérieur' },
  Sorties: { image: '/assets/home/activity-sorties-v2.jpg', alt: 'Repas partagé en terrasse' },
  'Temps conviviaux': { image: '/assets/home/activity-temps-v2.jpg', alt: 'Discussion autour d’une table' },
  'Ateliers créatifs': { image: '/assets/home/activity-ateliers-v2.jpg', alt: 'Atelier de peinture en groupe' },
};

/** Icônes d’origine, dans l’ordre don, bénévole, partenaires. */
export const SUPPORT_ICON_FALLBACK = [
  '/assets/home/icon-don.png',
  '/assets/home/icon-benevole.png',
  '/assets/home/icon-partenaire.png',
] as const;

type ActivitySource = {
  title: string;
  image?: string | null;
  image_alt?: string | null;
};

type SupportSource = {
  icon?: string | null;
  icon_alt?: string | null;
};

export function teamPhotoSrc(photo: string | null | undefined, name: string): string {
  return mediaSrc(photo, TEAM_PHOTO_FALLBACK[name.trim()] ?? '');
}

/** Photo et texte alternatif de Nos activités, pour l’aperçu de l’accueil au même titre. */
export function activityMedia(
  list: readonly ActivitySource[],
  title: string,
  cardImage?: string | null,
  cardAlt?: string | null,
): { image: string; alt: string } {
  const key = title.trim().toLocaleLowerCase('fr');
  const found = list.find((item) => item.title.trim().toLocaleLowerCase('fr') === key);
  const fallback = ACTIVITY_IMAGE_FALLBACK[title.trim()];
  const image = mediaSrc(found?.image ?? cardImage, fallback?.image ?? '');
  const alt = found ? (found.image_alt ?? '') : (cardAlt ?? fallback?.alt ?? '');
  return { image, alt };
}

/** Icône de Nous soutenir, même ordre que les cartes de l’accueil. */
export function supportIcon(
  list: readonly SupportSource[],
  index: number,
  cardIcon?: string | null,
  cardAlt?: string | null,
): { icon: string; alt: string } {
  const found = list[index];
  const fallback = SUPPORT_ICON_FALLBACK[index] ?? '';
  return {
    icon: mediaSrc(found?.icon ?? cardIcon, fallback),
    alt: found ? (found.icon_alt ?? '') : (cardAlt ?? ''),
  };
}

export function revealClass(index: number, cycle = 4): string {
  const delay = index % cycle;
  return delay === 0 ? 'reveal' : `reveal reveal-delay-${delay}`;
}

export function buttonClass(style: string | null | undefined): string {
  switch (style) {
    case 'outline':
      return 'btn btn-outline';
    case 'ghost':
      return 'btn btn-ghost';
    case 'sun':
      return 'btn btn-sun';
    default:
      return 'btn btn-primary';
  }
}

export function textLines(value: string | null | undefined): string[] {
  return (value ?? '').replace(/\r\n/g, '\n').trim().split('\n');
}
