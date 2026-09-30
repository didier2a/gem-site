# GEM Casa di l’Isula

Site de l’association **GEM Casa di l’Isula** (Porto-Vecchio). L’accueil, le contact et les pages hors éditorial restent du HTML statique. Le blog et trois pages (Qui sommes-nous, Nos activités, Nous soutenir) sont générés par Astro depuis des collections Markdown. Un Worker Cloudflare sert le résultat du build et le formulaire de contact.

Preview : [https://gem-casa-preview.infoserv2a.workers.dev/](https://gem-casa-preview.infoserv2a.workers.dev/)  
Worker : `gem-casa-preview`

Le domaine [www.legem-portovecchio.org](https://www.legem-portovecchio.org) reste sur Wix. Ce dépôt ne déploie rien et ne modifie ni le DNS, ni Wix, ni le Worker déjà en ligne.

## Pages

| Page | Chemin |
| --- | --- |
| Accueil | `/` |
| Qui sommes-nous | `/qui-sommes-nous/` |
| Nos activités | `/nos-activites/` |
| Blog | `/blog/` et quatre articles |
| Nous soutenir | `/nous-soutenir/` |
| Contact | `/contact/` |
| Mentions légales | `/mentions-legales/` |

La charte (vert `#2A7C6F`, polices Oregano et Barlow, boutons rectangulaires) est dans `public/css/editorial.css`.

Deux pages internes de la preview sont aussi dans `public/` : le questionnaire bureau et les directions de charte (`/questionnaire-bureau/`, `/charte-directions/`).

Qui sommes-nous présente le bureau : Michèle Mereu, Didier Aouizerate, Nathalie Maxant, Muriel Truphème. Nos activités s’appuie sur les photos peindre, cuisiner et marcher (et les autres visuels d’activité déjà en preview).

## Structure

```text
public/                 HTML statique (Accueil, Contact, mentions, assets), CSS, JS
content/blog/*.md       articles (collection Astro)
content/pages/*.md      textes Qui sommes-nous, Nos activités, Nous soutenir
public/uploads/blog/    images de couverture (media_folder de la spec)
src/content.config.ts   collections blog et pages (Astro 7)
src/pages/              rendu Astro du blog et des trois pages
src/index.js            Worker : assets + POST /api/contact (Resend)
wrangler.jsonc          assets = ./dist (après npm run build)
docs/decap-spec.md      spec Decap CMS
```

Accueil (`/`), Contact, Mentions légales, le questionnaire bureau et les directions de charte ne sont pas des collections. Astro les copie depuis `public/` vers `dist/` sans les réécrire. Le blog et les trois pages éditoriales ne sont plus le HTML figé de `public/` : leurs routes sont générées au build depuis le Markdown.

`wrangler.jsonc` pointe le Worker sur `src/index.js` et sur le dossier `dist/`. Le code du Worker est celui de la preview (envoi Resend, destinataire par défaut `infoserv2a@gmail.com`, bascule asso via la variable `RESEND_TO`). Cette phase ne déploie pas.

Sur Nous soutenir, le don est un lien optionnel `helloasso_url` dans le Markdown. Il n’y a pas d’iframe HelloAsso. L’accueil statique garde le script `public/js/helloasso.js` ; `HELLOASSO_DON_URL` reste vide dans `public/js/site-config.js`.

## Développement local

Prérequis : Node.js 22.

```sh
npm install
npm run dev
npm run build
```

`npm run dev` lance Astro en local (pages Markdown + fichiers de `public/`). `npm run build` produit `dist/`. `npm run worker` lance ensuite `wrangler dev` sur ce `dist/`. Cela ne publie pas le Worker.

Le formulaire de contact a besoin d’un secret Resend, hors git :

```sh
# .dev.vars (ignoré par git)
RESEND_API_KEY=re_...
```

`RESEND_FROM` est déjà défini dans `wrangler.jsonc`. Sans clé, `POST /api/contact` répond 503.

## Phase 1 — contenu structuré

Les collections et le rendu Markdown sont en place. Il n’y a pas d’interface `/admin`, pas d’OAuth, pas de workflow éditorial, et pas de déploiement.

La suite, dans l’ordre de `docs/decap-spec.md` :

- Phase 2 — UI Decap (`public/admin/`)
- Phase 3 — OAuth GitHub (`/api/oauth`)
- Phase 4 — workflow éditorial et droits
- Déploiement de la preview — seulement après validation de Didier

L’ancien workflow GitHub Pages a été retiré : il ne doit pas publier au merge.
