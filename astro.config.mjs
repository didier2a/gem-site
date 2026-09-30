import { defineConfig } from 'astro/config';

// Phase 1 : Astro génère le blog et trois pages depuis le Markdown.
// Le reste du site (Accueil, Contact, etc.) reste le HTML statique de public/,
// copié tel quel dans dist/ au build. Pas de déploiement dans cette phase.
export default defineConfig({
  site: 'https://gem-casa-preview.infoserv2a.workers.dev',
  trailingSlash: 'always',
  build: {
    format: 'directory',
  },
});
