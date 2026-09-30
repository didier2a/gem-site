# GEM Casa di l’Isula

Site de l’association **GEM Casa di l’Isula** (Porto-Vecchio). Ce dépôt reflète la preview publique actuelle : pages HTML statiques et un Worker Cloudflare qui sert ces pages et le formulaire de contact.

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
public/            site statique (HTML, CSS, JS, images, vidéos)
src/index.js       Worker : assets + POST /api/contact (Resend)
wrangler.jsonc     config Worker (assets = ./public, run_worker_first)
docs/decap-spec.md spec Decap CMS (document seul, phase suivante)
```

`wrangler.jsonc` pointe le Worker sur `src/index.js`. Le code du Worker est celui de la preview (envoi Resend, destinataire par défaut `infoserv2a@gmail.com`, bascule asso via la variable `RESEND_TO`).

HelloAsso est une ébauche : bouton et iframe masquée, `HELLOASSO_DON_URL` vide dans `public/js/site-config.js`. Le lien asso n’est pas branché.

## Développement local

Prérequis : Node.js 22.

```sh
npm install
npm run dev
```

`npm run dev` lance `wrangler dev` en local. Cela ne publie pas le Worker.

Le formulaire de contact a besoin d’un secret Resend, hors git :

```sh
# .dev.vars (ignoré par git)
RESEND_API_KEY=re_...
```

`RESEND_FROM` est déjà défini dans `wrangler.jsonc`. Sans clé, `POST /api/contact` répond 503.

## Ce qui n’est pas dans cette phase

L’admin Decap et la conversion du HTML en collections Markdown sont la phase suivante. La spec est conservée dans `docs/decap-spec.md` ; elle n’est pas implémentée ici.

L’ancien workflow GitHub Pages (build Astro du starter) a été retiré : il ne correspond plus au site et ne doit pas publier au merge.
