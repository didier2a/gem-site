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
src/index.js            Worker : assets, contact Resend, porte /admin/, proxy Decap
docs/admin-auth.md      comptes animatrices et jeton GitHub (preview seulement)
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

`/admin/` charge Decap CMS ^3 depuis unpkg (`public/admin/index.html`). Le script est en `defer` : Decap 3 attache l’interface à `document.body`, et un script bloquant dans le `head` plante avant que `<body>` existe. Les collections `blog` et `pages` reprennent le frontmatter déjà en place (`content/blog`, `content/pages`, `src/content.config.ts`). Le corps Markdown est le champ `body`. Le booléen `draft` coché signifie « non listé » (même convention que les pages blog).

`public/admin/config.yml` utilise le backend Decap `proxy` (`proxy_url: /api/decap-proxy`, branche `main`). Sur la preview, le Worker n’envoie ce fichier qu’après le mot de passe de la maison. Les enregistrements partent vers GitHub avec le secret `GITHUB_CONTENT_PAT`, jamais vers le navigateur. Le détail est dans [docs/admin-auth.md](docs/admin-auth.md).

En local, `local_backend: true` est ignoré dès que le site n’est pas servi sur `localhost` ou `127.0.0.1`. Sur localhost, Decap interroge `decap-server` (`http://localhost:8081/api/v1`). S’il répond, l’éditeur écrit les fichiers Markdown sur le disque, sans login GitHub et sans commit. `decap-server` (mode fichiers) ne supporte pas un workflow de pull requests : Decap reste en publication simple pour cette session. Hors localhost, la preview exige le mot de passe puis le proxy du Worker. Les routes `/api/oauth` existent toujours pour une connexion GitHub nominative, mais ce n’est pas le chemin des animatrices.

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

Puis ouvrir [http://localhost:4321/admin/](http://localhost:4321/admin/). `/admin` (sans barre oblique) redirige vers `/admin/`. En dev, Astro ne sert pas tout seul l’index d’un dossier de `public/` : `astro.config.mjs` réécrit uniquement ces deux chemins. Après `npm run build`, le Worker local fait la même redirection via les assets, sans ce plugin. `npm run cms` lance `decap-server` (proxy local non authentifié, à garder sur la machine de dev uniquement).

Après un build, le Worker local sert les mêmes fichiers statiques :

```sh
npm run build
npm run cms
npm run worker
```

`/admin/` est alors dans `dist/admin/` (Astro copie `public/`). `npm run worker` ne déploie pas. Sans les secrets `ADMIN_SESSION_SECRET` et `ADMIN_USERS` (par exemple dans `.dev.vars`, jamais commité), le Worker affiche la page de configuration à la place de Decap.

`decap-server` modifie les fichiers sur le disque. Vérifier `git status` avant de committer : un essai d’article ne doit pas partir dans le dépôt par accident.

## Accès animatrices (preview)

Sur `gem-casa-preview` seulement : mot de passe devant `/admin/`, puis enregistrement par le Worker avec un jeton GitHub serveur (Contents, dépôt `didier2a/gem-site` uniquement). Une animatrice n’a pas de compte GitHub à créer. Procédure : [docs/admin-auth.md](docs/admin-auth.md). Ce dépôt ne pose pas les secrets et ne déploie pas.

## Suite

- Déploiement de la preview — seulement après validation de Didier, et seulement vers `gem-casa-preview`
- Le workflow par pull request reste hors de ce jeton (droit Contents seul, commits directs sur `main`)

L’ancien workflow GitHub Pages a été retiré : il ne doit pas publier au merge.
