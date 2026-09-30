import { defineConfig } from 'astro/config';

// Phase 1 : Astro génère le blog et trois pages depuis le Markdown.
// Le reste du site (Accueil, Contact, etc.) reste le HTML statique de public/,
// copié tel quel dans dist/ au build. Pas de déploiement dans cette phase.
//
// En dev, `trailingSlash: 'always'` répond 404 sur /admin (pas d’extension)
// et ne sert pas public/admin/index.html pour /admin/. Après build, les
// assets Cloudflare font déjà la redirection /admin → /admin/ et servent
// l’index. Ce plugin aligne uniquement le serveur de dev.
function decapAdminDev() {
  return {
    name: 'decap-admin-dev',
    configureServer(server) {
      return () => {
        server.middlewares.stack.unshift({
          route: '',
          handle(req, res, next) {
            if (!req.url) return next();
            const q = req.url.indexOf('?');
            const path = q === -1 ? req.url : req.url.slice(0, q);
            const search = q === -1 ? '' : req.url.slice(q);
            if (path === '/admin') {
              res.statusCode = 302;
              res.setHeader('Location', `/admin/${search}`);
              res.end();
              return;
            }
            if (path === '/admin/') {
              req.url = `/admin/index.html${search}`;
            }
            next();
          },
        });
      };
    },
  };
}

export default defineConfig({
  site: 'https://gem-casa-preview.infoserv2a.workers.dev',
  trailingSlash: 'always',
  build: {
    format: 'directory',
  },
  vite: {
    plugins: [decapAdminDev()],
  },
});
