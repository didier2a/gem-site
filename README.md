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
public/admin/           UI Decap (`index.html`, `config.yml`) — servie sur `/admin/`
content/blog/*.md       articles (collection Astro)
content/pages/*.md      textes Qui sommes-nous, Nos activités, Nous soutenir
public/uploads/blog/    images de couverture (media_folder Decap)
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

## Admin Decap (phase 2)

`/admin/` charge Decap CMS ^3 depuis unpkg (`public/admin/index.html`). Les collections `blog` et `pages` reprennent le frontmatter déjà en place (`content/blog`, `content/pages`, `src/content.config.ts`). Le corps Markdown est le champ `body`. Le booléen `draft` coché signifie « non listé » (même convention que les pages blog).

`public/admin/config.yml` garde le backend GitHub de production (`repo: didier2a/gem-site`, `branch: main`, `base_url` de la preview, `auth_endpoint: /api/oauth`, `publish_mode: editorial_workflow`). Ces pointeurs ne font pas encore d’OAuth : le Worker `/api/oauth` arrive en phase 3.

En local, `local_backend: true` est ignoré dès que le site n’est pas servi sur `localhost` ou `127.0.0.1`. Sur localhost, Decap interroge `decap-server` (`http://localhost:8081/api/v1`). S’il répond, l’éditeur écrit les fichiers Markdown sur le disque, sans login GitHub et sans commit. `decap-server` (mode fichiers) ne supporte pas `editorial_workflow` : Decap bascule cette session locale en publication simple. Hors localhost, ou si `decap-server` n’est pas lancé, l’écran affiche « Login with GitHub » — le bouton ne peut pas aboutir tant que la phase 3 n’est pas faite.

La collection informative `medias_info` (`files: []`) n’est pas dans la config. Les images passent par `public/uploads/blog/` (`media_folder` / `public_folder`).

### Lancer l’éditeur en local

Deux terminaux, depuis la racine du dépôt :

```sh
npm install
npm run cms
```

```sh
npm run dev
```

Puis ouvrir [http://localhost:4321/admin/](http://localhost:4321/admin/). `npm run cms` lance `decap-server` (proxy local non authentifié, à garder sur la machine de dev uniquement).

Après un build, le Worker local sert les mêmes fichiers statiques :

```sh
npm run build
npm run cms
npm run worker
```

`/admin/` est alors dans `dist/admin/` (Astro copie `public/`). `npm run worker` ne déploie pas.

`decap-server` modifie les fichiers sur le disque. Vérifier `git status` avant de committer : un essai d’article ne doit pas partir dans le dépôt par accident.

## Suite

Dans l’ordre de `docs/decap-spec.md` :

- Phase 3 — OAuth GitHub : app OAuth, routes Worker `/api/oauth`, secrets Wrangler, login sur la preview
- Phase 4 — workflow éditorial réel (protection de `main`, invitation d’une animatrice, mode d’emploi)
- Déploiement de la preview — seulement après validation de Didier

L’ancien workflow GitHub Pages a été retiré : il ne doit pas publier au merge.
