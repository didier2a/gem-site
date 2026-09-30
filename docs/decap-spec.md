# Spécification technique — Decap CMS pour GEM Casa di l’Isula

**Version :** 1.0  
**Date :** 30 septembre 2026  
**Statut :** Spec seule — aucun code, aucun déploiement, aucun changement DNS  
**Demandeur :** Didier Aouizerate (Infoserv2A / trésorier GEM)  
**Objectif :** Solution intermédiaire **la plus simple et la moins chère possible (idéalement gratuite)** pour que le blog (et certaines pages) soient administrables **sans Didier seul**, via une interface web.

---

## 0. Contexte et contraintes (non négociables)

| Élément | État actuel |
|--------|-------------|
| Preview publique | https://gem-casa-preview.infoserv2a.workers.dev/ (Worker Cloudflare `gem-casa-preview`) |
| Contenu live de la preview | Site **HTML statique** servi par le Worker (`/workspace/gem-pages-deploy/public/`) : Accueil, Qui sommes-nous, Nos activités, Blog (4 articles HTML), Contact (API Resend), etc. |
| Repo GitHub | https://github.com/didier2a/gem-site — projet **Astro** (starter « Basics »), **en retard** par rapport à la preview Workers (pas encore le site éditorial cinéma multi-pages actuel) |
| Domaine final | www.legem-portovecchio.org — **reste sur Wix** tant que Didier n’a pas validé le cutover |
| Live Wix | **Ne pas toucher** |
| DNS | **Aucune migration** pour cette phase |

**Conséquence pour Decap :** Decap écrit dans **Git** (fichiers Markdown/MDX + médias). Il faut donc un **repo Astro à jour** qui génère le site, puis un déploiement automatique vers le Worker preview. Aujourd’hui, la preview et `gem-site` ne sont pas synchronisés : la **phase 0** de la spec rattrape cet écart avant l’UI admin.

---

## 1. Architecture cible

```
[ Animatrice / Didier ]
         │
         ▼
  /admin (Decap CMS)  ←── auth GitHub OAuth (gratuit)
         │
         │  commits ou Pull Requests
         ▼
  GitHub didier2a/gem-site
    ├── content/blog/*.md        (articles)
    ├── content/pages/*.md       (textes de pages)
    ├── public/uploads/…         (médias Decap)
    ├── public/admin/            (UI Decap)
    └── src/… Astro (layouts, charte)
         │
         │  CI (GitHub Actions) : npm run build
         ▼
  Artifact dist/  ──deploy──►  Cloudflare Worker gem-casa-preview
         │
         ▼
  https://gem-casa-preview.infoserv2a.workers.dev/
  (plus tard, après validation : www.legem-portovecchio.org)
```

### Principes

1. **Decap CMS** (ex-Netlify CMS) : open source, **gratuit**, UI dans le navigateur.
2. **Backend GitHub** : chaque sauvegarde = commit (ou PR en mode éditorial).
3. **Astro Content Collections** : le build lit les Markdown et produit le HTML.
4. **Cloudflare Workers** : hébergement preview **gratuit** (plan free), **sans** toucher au DNS Wix.
5. **Auth** : comptes **GitHub** (gratuits). Pas de Wix, pas d’abonnement CMS payant.

### Auth recommandée (gratuit, sans Netlify Identity)

| Option | Verdict |
|--------|---------|
| **A — GitHub OAuth + petit proxy OAuth** (Worker dédié ou endpoint sur le même Worker) | **Recommandée** : 100 % gratuit, pas de dépendance Netlify, Didier contrôle l’OAuth App GitHub |
| B — Netlify Identity + Git Gateway | Possible et « plus packagé », mais ajoute un site Netlify (même factice) : plus de pièces, moins « simple » pour une preview déjà sur Cloudflare |
| C — Cloudflare Access | Peut coûter / complexifier selon le plan ; pas le plus gratuit pour des comptes e-mail GEM |

**Choix spec :** option **A**. Les animatrices créent (ou utilisent) un compte GitHub gratuit ; Didier les invite en collaboratrices sur `didier2a/gem-site` (rôle limité) et active le **workflow éditorial** (PR) pour garder le contrôle.

---

## 2. Configuration Decap dans le repo

### 2.1 Fichiers à créer (lors du codage — pas maintenant)

```
public/admin/index.html          # charge Decap
public/admin/config.yml          # collections + backend
# éventuellement :
# src/pages/admin.astro → redirige ou sert /admin (selon structure Astro assets)
```

`public/admin/index.html` (principe) :

```html
<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <title>Admin GEM — Casa di l’Isula</title>
    <script src="https://unpkg.com/decap-cms@^3.0.0/dist/decap-cms.js"></script>
  </head>
  <body></body>
</html>
```

### 2.2 `config.yml` — squelette cible

```yaml
backend:
  name: github
  repo: didier2a/gem-site
  branch: main
  base_url: https://gem-casa-preview.infoserv2a.workers.dev
  auth_endpoint: /api/oauth   # proxy OAuth Worker (à implémenter)
  open_authoring: false

# Didier valide via PR avant publication sur main
publish_mode: editorial_workflow

media_folder: public/uploads/blog
public_folder: /uploads/blog

locale: fr

collections:
  - name: blog
    label: Articles du blog
    label_singular: Article
    folder: content/blog
    create: true
    slug: "{{slug}}"
    extension: md
    format: frontmatter
    fields:
      - { label: Titre, name: title, widget: string }
      - { label: Date, name: date, widget: datetime }
      - { label: Catégorie, name: category, widget: string, required: false }
      - { label: Extrait, name: excerpt, widget: text }
      - { label: Image de couverture, name: cover, widget: image, required: false }
      - { label: Corps, name: body, widget: markdown }
      - { label: Publié, name: draft, widget: boolean, default: false }
        # convention Astro : draft true = non listé en public (ou inverse selon implémentation)

  - name: pages
    label: Pages du site
    label_singular: Page
    files:
      - name: qui-sommes-nous
        label: Qui sommes-nous ?
        file: content/pages/qui-sommes-nous.md
        fields:
          - { label: Titre, name: title, widget: string }
          - { label: Introduction, name: intro, widget: markdown }
          - { label: Corps / blocs texte, name: body, widget: markdown }
          # Les portraits (photos, noms, rôles) : phase 2 — champs structurés ou collection « équipe »
      - name: nos-activites
        label: Nos activités
        file: content/pages/nos-activites.md
        fields:
          - { label: Titre, name: title, widget: string }
          - { label: Introduction, name: intro, widget: markdown }
          - { label: Corps, name: body, widget: markdown }
      - name: nous-soutenir
        label: Nous soutenir
        file: content/pages/nous-soutenir.md
        fields:
          - { label: Titre, name: title, widget: string }
          - { label: Corps, name: body, widget: markdown }
          - { label: URL HelloAsso, name: helloasso_url, widget: string, required: false }

  - name: medias_info
    label: Aide médias
    files: []   # les médias passent par media_folder ; collection informative optionnelle
```

### 2.3 Côté Astro (à brancher au codage)

- `src/content/config.ts` : collections `blog` et éventuellement `pages`.
- Pages dynamiques : `src/pages/blog/index.astro`, `src/pages/blog/[slug].astro`.
- Pages existantes (Qui sommes-nous, etc.) : lire le Markdown de `content/pages/` au lieu du HTML figé.
- Conserver la charte actuelle (Oregano/Barlow, `#2A7C6F`, CSS éditorial) dans `src/styles` / layouts — **hors Decap**.

### 2.4 Médias

- Upload Decap → `public/uploads/blog/`.
- Limite pratique : images raisonnables (WebP/JPG) ; pas de vidéo lourde via Decap (garder assets vidéo actuels hors CMS).

---

## 3. Interface admin sur la preview

| Point | Spec |
|-------|------|
| URL | https://gem-casa-preview.infoserv2a.workers.dev/admin/ |
| Contenu | Fichiers statiques Decap sous `public/admin/` (servis par le Worker / assets Astro) |
| Auth | Bouton « Login with GitHub » → OAuth → retour à `/admin/` |
| Langue | `locale: fr` dans config |
| Hors scope preview | Pas d’admin sur legem-portovecchio.org tant que Wix reste |

Le Worker actuel doit **servir** `/admin/*` comme assets (déjà le cas avec `ASSETS`) et exposer **`/api/oauth`** (callback + échange code) pour l’auth GitHub — petit ajout au Worker, sans D1 obligatoire.

---

## 4. Workflow utilisateurs

### 4.1 Didier — admin / éditeur principal

1. Propriétaire (ou admin) du repo `didier2a/gem-site`.
2. Propriétaire de l’**OAuth App** GitHub (Client ID / Secret → secrets Cloudflare Worker).
3. Dans Decap : crée / édite articles et pages.
4. En **`editorial_workflow`** : les changements partent en **Pull Request** (brouillon → en revue → prêt à publier).
5. Didier **merge** la PR sur `main` → CI rebuild → preview mise à jour.
6. Il peut aussi merger rapidement ses propres PR, ou assouplir plus tard (`publish_mode` simple) une fois la confiance établie.

### 4.2 Animatrices — plus tard, chacune son compte

1. Compte **GitHub gratuit** (une adresse e-mail chacune).
2. Didier les **invite** au repo (rôle *Write* ou *Triage* + possibilité d’ouvrir des PR ; idéalement Write limité + branch protection).
3. Connexion à `/admin/` avec **leur** GitHub.
4. Elles rédigent / modifient → Decap ouvre une **PR** → Didier valide → publication preview.
5. **Pas de compte Wix**, pas de mot de passe partagé : révocation = retirer l’accès GitHub au repo.

### 4.3 Protection GitHub recommandée

- Branch protection sur `main` : require PR + 1 review (Didier).
- Optionnel : CODEOWNERS pour Didier.
- Secrets CI Cloudflare déjà dans GitHub Actions (le repo a un `.github/workflows/deploy.yml` — à aligner sur le Worker `gem-casa-preview`).

---

## 5. Validation via Pull Requests

| Étape Decap | Effet GitHub |
|-------------|--------------|
| Brouillon | Fichiers / branche de workflow éditorial |
| En revue | PR ouverte ou mise à jour |
| Prêt à publier | PR marquable mergeable |
| Didier merge | `main` mis à jour |
| CI | `astro build` + deploy Worker preview |
| Public | Visible sur workers.dev uniquement |

**Contrôle Didier :** rien n’apparaît sur la preview « officielle » (branche main déployée) sans son merge. Le live Wix reste inchangé.

---

## 6. Ce qui reste **non** éditable via Decap

| Zone | Raison |
|------|--------|
| Charte graphique (couleurs, polices Oregano/Barlow, CSS `editorial`) | Code / design system |
| Structure Astro (layouts, composants header/footer, menu) | Dev |
| Formulaire contact + Worker Resend | Backend / secrets |
| Carte Street View / Maps, HelloAsso (sauf champ URL si exposé) | Intégrations |
| Mentions légales (sauf si on les ajoute volontairement en collection) | Juridique — à valider avant d’ouvrir |
| Questionnaire bureau, pages techniques | Hors éditorial asso |
| Vidéo header / assets lourds | Fichiers binaires gérés en repo/dev |
| DNS, domaine www, bascule Wix | Décision métier + validation explicite |
| Comptes OAuth / secrets Cloudflare | Didier / Infoserv2A uniquement |

**Phase 1 Decap :** blog + textes clés des pages.  
**Phase 2 (optionnelle) :** collection « Équipe » (portraits, bios, rôles) — plus de champs structurés, à spécifier après validation phase 1.

---

## 7. Étapes d’installation concrètes (pour coder ensuite, une par une)

> Ordre imposé. **Aucune** de ces étapes n’est exécutée dans ce livrable.

### Phase 0 — Aligner le repo sur la preview (prérequis Decap)

1. Décider : `gem-site` devient la **source de vérité** Astro du site actuel (contenu editorial + assets de `gem-pages-deploy/public`).
2. Porter (ou régénérer) les pages multi-routes Astro + CSS + assets depuis la preview Workers.
3. Brancher le build Astro → déploiement automatique vers Worker `gem-casa-preview` (Actions + token Cloudflare).
4. Vérifier que https://gem-casa-preview.infoserv2a.workers.dev/ reflète le build GitHub (sans changer le DNS Wix).
5. Migrer les **4 articles** HTML → `content/blog/*.md` (frontmatter + corps).

### Phase 1 — Contenu structuré

6. Créer `src/content/config.ts` + dossiers `content/blog`, `content/pages`.
7. Remplacer le listing blog HTML par des pages Astro basées sur la collection.
8. Brancher Qui sommes-nous / Nos activités / Nous soutenir sur Markdown (textes éditables uniquement).

### Phase 2 — Decap UI

9. Ajouter `public/admin/index.html` + `public/admin/config.yml` (collections ci-dessus).
10. Tester Decap en local (`astro dev`) avec backend `git-gateway` local **ou** proxy OAuth de dev.

### Phase 3 — Auth GitHub OAuth (gratuit)

11. Créer une **GitHub OAuth App** (callback : `https://gem-casa-preview.infoserv2a.workers.dev/api/oauth/callback`).
12. Implémenter sur le Worker les routes `/api/oauth` (authorize + callback) ; stocker `GITHUB_OAUTH_CLIENT_ID` / `CLIENT_SECRET` en secrets Wrangler.
13. Pointer `backend.base_url` + `auth_endpoint` dans `config.yml`.
14. Tester login Didier sur `/admin/`.

### Phase 4 — Workflow & droits

15. Activer `publish_mode: editorial_workflow`.
16. Protéger `main` (PR obligatoire).
17. Inviter 1 animatrice test (compte GitHub) ; vérifier création d’article → PR → merge Didier → rebuild preview.
18. Rédiger un **mode d’emploi 1 page** (FR) pour les animatrices (néophytes) : se connecter, écrire, enregistrer, attendre la validation Didier.

### Phase 5 — Hors scope immédiat (rappel)

19. **Ne pas** pointer legem-portovecchio.org vers Cloudflare tant que Didier n’a pas validé.
20. Après cutover (autre chantier) : même Decap, même repo ; seul le domaine change.

---

## 8. Coûts estimés

| Poste | Coût |
|-------|------|
| Decap CMS | 0 € (open source) |
| GitHub (repo + comptes animatrices) | 0 € (public ou privé free) |
| Cloudflare Workers + preview | 0 € (quota free) |
| OAuth App GitHub | 0 € |
| Netlify Identity | Non retenu dans la reco (évite un 2ᵉ hébergeur) |

---

## 9. Risques et limites (à connaître avant de coder)

1. **Écart repo / preview** : sans phase 0, Decap administre un Astro starter vide, pas le vrai site.
2. **Animatrices + GitHub** : besoin d’un compte GitHub (friction pour néophytes) — compensée par un tuto court et le fait qu’elles n’utilisent que `/admin/`, pas git en ligne de commande.
3. **Délai de publication** : PR + build CI (quelques minutes) ≠ « publier instantané » type Wix.
4. **Images** : pas de CDN média avancé au départ ; uploads dans le repo (attention à la taille du repo).
5. **Pas d’édition fine de la mise en page** : Decap = contenu, pas Figma.

---

## 10. Critères de succès (definition of done, quand on codera)

- [ ] `/admin/` accessible sur la preview, login GitHub OK pour Didier  
- [ ] Création d’un article → PR → merge → article visible sur `/blog/` preview  
- [ ] Au moins une page (ex. intro Qui sommes-nous) éditable via Decap  
- [ ] Wix + DNS inchangés  
- [ ] Une animatrice test peut se connecter avec **son** GitHub et ouvrir une PR  
- [ ] Mode d’emploi FR livré  

---

## 11. Décisions à confirmer par Didier avant le premier commit

1. OK pour **phase 0** (synchroniser `gem-site` avec la preview actuelle) ?  
2. Auth **GitHub OAuth** (pas Netlify Identity) ?  
3. **PR obligatoires** (Didier valide) dès le jour 1 ?  
4. Périmètre phase 1 : **blog seul** ou blog + pages textes ?

---

*Document prêt à servir de base au codage. Aucune modification n’a été faite sur le site, le Worker, le DNS ni le repo dans le cadre de cette rédaction.*
