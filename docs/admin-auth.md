# Accès à l’éditeur — preview GEM Casa

Ce document concerne **uniquement** le Worker Cloudflare `gem-casa-preview`. Il ne déploie rien, ne touche pas au DNS, et ne concerne pas le site Wix [www.legem-portovecchio.org](https://www.legem-portovecchio.org).

## Ce que le mot de passe ouvre

Le nom et le mot de passe ouvrent la coquille Decap sur `/admin/`. Une animatrice **n’a pas besoin d’un compte GitHub** pour lire et enregistrer **le blog et les pages** (collections Decap `blog` et `pages`, fichiers `content/blog`, `content/pages`, images `public/uploads/blog`). Le Worker lui sert la config Decap complète. Les enregistrements passent par le proxy et le secret `GITHUB_CONTENT_PAT`, comme pour le super-admin. Le bouton « Se connecter avec GitHub » (`ADMIN_GITHUB_LOGINS`) est une **autre entrée** vers le même éditeur : il ne donne pas plus de collections ni plus de chemins.

L’enregistrement part du Worker vers GitHub avec le secret `GITHUB_CONTENT_PAT`. Ce jeton reste sur le serveur : il n’apparaît ni dans la page, ni dans le JavaScript, ni dans les réponses de l’éditeur.

Les commits arrivent sur la branche `main` du dépôt `didier2a/gem-site`, signés dans le message par l’identifiant de la personne connectée (`[muriel] …`). Le mode « pull request » n’est pas activé : un jeton limité au droit **Contents** ne peut pas ouvrir de demande de fusion. Didier revoit l’historique Git s’il veut contrôler ce qui a été écrit.

Les routes `/api/oauth` et `/api/oauth/callback` restent en place, avec les secrets `GITHUB_OAUTH_CLIENT_ID` et `GITHUB_OAUTH_CLIENT_SECRET`. Sans paramètre, elles servent encore le dialogue Decap (fenêtre et `postMessage`) si le backend redevient `github`. Ce n’est pas le chemin des animatrices.

Sur la même page de connexion, le bouton **Se connecter avec GitHub** appelle `/api/oauth?intent=admin`. GitHub ne renvoie que le login (`read:user`). S’il est listé dans le secret `ADMIN_GITHUB_LOGINS` (logins séparés par des virgules, par exemple `didier2a`), le Worker pose le cookie `gem_admin_session` avec le rôle `github_admin`. Le formulaire identifiant / mot de passe pose le même cookie avec le rôle `animatrice`. Les deux rôles ouvrent le même Decap (blog et pages) et les mêmes chemins du proxy. Le rôle reste utile pour l’affichage (libellé de session), pas comme plafond de droits. Le jeton GitHub de la personne n’est pas conservé : les enregistrements passent toujours par `GITHUB_CONTENT_PAT`. Un compte GitHub absent de la liste est refusé, sans cookie. Un identifiant absent de `ADMIN_USERS` est refusé de la même façon. Les visiteurs anonymes continuent de lire le site public (`/`, `/blog`, `/qui-sommes-nous`, etc.) sans connexion.

```sh
npx wrangler secret put ADMIN_GITHUB_LOGINS
```

Le formulaire public `POST /api/contact` (Resend) n’est pas modifié.

## 1. Secret de session

Générer une longue chaîne aléatoire, par exemple :

```sh
openssl rand -base64 32
```

Puis, dans ce dépôt, **sans** coller la valeur dans un fichier :

```sh
npx wrangler secret put ADMIN_SESSION_SECRET
```

Wrangler demande le nom du Worker : choisir `gem-casa-preview`. Ne pas viser un autre Worker, et ne pas commiter le secret.

Tant que `ADMIN_SESSION_SECRET` ou `ADMIN_USERS` manque, `/admin/` affiche une page d’explication. Decap n’est pas servi, et il n’y a pas de trace d’erreur technique.

## 2. Premier compte animatrice

Depuis la racine du dépôt, sur la machine de Didier :

```sh
node scripts/hash-admin-password.mjs muriel
```

Le script demande le mot de passe sans l’écrire dans la commande (ou le lit dans la variable `ADMIN_PASSWORD`, utile une fois, sans la laisser dans l’historique). Il affiche **une ligne JSON**, par exemple la forme suivante — l’empreinte réelle n’est pas dans le dépôt :

```json
[{"username":"muriel","hash":"pbkdf2$100000$…$…","email":"animatrice@example.org"}]
```

L’adresse est facultative. Sans `email`, la connexion fonctionne comme avant. Avec une adresse illisible, tout le JSON est refusé et `/admin/` reste sur la page de mise en place. Pour joindre une adresse au moment du hachage :

```sh
node scripts/hash-admin-password.mjs muriel animatrice@example.org
```

Déposer cette ligne dans le secret :

```sh
npx wrangler secret put ADMIN_USERS
```

Toujours sur `gem-casa-preview`. Le secret est un tableau JSON. Pour un deuxième compte, relancer le script, puis **fusionner** les objets dans un seul tableau avant de remplacer `ADMIN_USERS` (un `secret put` écrase toute la valeur).

Le mot de passe n’est pas stocké. Seule l’empreinte PBKDF2-SHA256 (100 000 itérations) part dans le secret. Ne commitez pas la ligne affichée par le script.

Connexion : ouvrir `/admin/`, saisir l’identifiant et le mot de passe. Le Worker pose un cookie `gem_admin_session` (HttpOnly, Secure, SameSite=Lax, 12 heures) puis affiche Decap.

Déconnexion : bouton « Se déconnecter » dans l’éditeur, ou `POST /api/admin-logout` (la route `POST /admin/logout` fait la même chose).

## 3. Jeton GitHub pour les enregistrements

Didier crée un **jeton d’accès personnel fin** (fine-grained PAT) sur GitHub :

1. GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.
2. Resource owner : le compte qui peut écrire dans `didier2a/gem-site`.
3. Repository access : **Only select repositories** → `didier2a/gem-site` seulement.
4. Permissions → Repository → **Contents : Read and write**. Ne pas ajouter d’autres droits (pas d’Actions, pas d’administration, pas de secrets).
5. Générer le jeton et le copier une seule fois. Ne pas le coller dans le dépôt, dans une issue, ni dans un message.

Puis :

```sh
npx wrangler secret put GITHUB_CONTENT_PAT
```

Worker : `gem-casa-preview` uniquement. Ne pas lancer cette commande vers un autre nom.

Sans ce secret, une personne déjà connectée voit Decap, mais chaque lecture ou enregistrement répond par un message en français : le jeton du serveur n’est pas configuré. Le jeton lui-même n’est pas affiché.

Quand le secret est en place, une animatrice charge et enregistre les articles du blog (images dans `public/uploads/blog`) et les pages du site (`content/pages`). Un login GitHub autorisé fait la même chose : les droits Decap sont identiques. L’animatrice ne voit pas d’écran « Login with GitHub » dans Decap : ce bouton est sur la page de connexion, à côté du formulaire, et reste une entrée distincte. Un chemin hors de ces dossiers (`content/blog`, `content/pages`, `public/uploads/blog`) est refusé. `/admin/` reste fermé aux personnes qui ne sont ni dans `ADMIN_USERS`, ni dans `ADMIN_GITHUB_LOGINS`.

## 4. Route d’aide optionnelle

`POST /api/admin-bootstrap` avec l’en-tête `X-Bootstrap-Token` égal au secret `ADMIN_BOOTSTRAP_TOKEN` renvoie une empreinte à coller dans `ADMIN_USERS`. Le Worker ne réécrit pas le secret tout seul. Si `ADMIN_BOOTSTRAP_TOKEN` n’est pas défini, la route répond qu’elle n’est pas configurée. Le script du dépôt suffit pour créer les comptes.

## 5. Mot de passe oublié

La page de connexion propose le lien **Mot de passe oublié** vers `/admin/mot-de-passe-oublie`. Le formulaire a un seul champ, « Identifiant ou adresse », et appelle `POST /api/admin-mot-de-passe-oublie`. La réponse affichée est **toujours la même** : on ne dit pas si le compte existe.

Le courriel part par Resend avec `RESEND_API_KEY` et `RESEND_FROM` (la variable déjà posée pour le formulaire de contact — aucune adresse d’expéditeur n’est écrite dans le code). Destinataires :

- l’adresse `email` du compte dans `ADMIN_USERS`, si elle est présente ;
- en copie (bcc) les secrets `ADMIN_SUPERADMIN_EMAIL` et `ADMIN_NOTIFY_EMAIL`.

Si ces deux secrets sont identiques, un seul envoi. S’ils sont identiques à l’adresse du compte, ils ne sont pas répétés. Si le compte n’a pas d’adresse, le lien part quand même vers ces secrets, avec la mention « copie de récupération ». S’il n’y a aucune adresse utilisable, rien n’est envoyé et la page reste le message générique.

Le lien est absolu et ouvre **la porte `/admin/`** :

`https://gem-casa-preview.infoserv2a.workers.dev/admin/?reset=…`

Il n’existe pas de page `/admin/reset-password`. Le jeton dure **une heure** et ne sert **qu’une fois**. Tant que `?reset=` est présent, le Worker affiche « Nouveau mot de passe » (mot de passe et confirmation, 8 caractères minimum). Decap ne se charge pas, même si un cookie de session est déjà là. Un jeton invalide, expiré ou déjà utilisé affiche « Ce lien n’est plus valable », toujours sans Decap.

### Réserver les jetons (KV)

L’usage unique a besoin d’une réserve partagée. Le code lit le binding **`ADMIN_RESET_KV`**. Sans lui, le Worker n’émet pas de lien (la page affiche quand même le message générique, pour ne pas inventer un jeton réutilisable d’un isolement à l’autre).

Sur le compte qui porte `gem-casa-preview` :

```sh
npx wrangler kv namespace create ADMIN_RESET_KV
```

La commande affiche un `id`. Le coller dans `wrangler.jsonc` (l’id n’est pas un secret, il est propre au compte), puis déployer **ce** Worker seulement :

```jsonc
"kv_namespaces": [
  { "binding": "ADMIN_RESET_KV", "id": "<id retourné par la commande>" }
]
```

KV est à cohérence à terme : une suppression peut mettre quelques secondes à être vue partout. Le jeton est aussi lié à l’empreinte actuelle. Dès que `ADMIN_USERS` change, un ancien lien est refusé même si la clé KV traîne encore.

Plafond, par adresse IP, sur 15 minutes : 5 demandes de lien, 8 enregistrements de nouveau mot de passe. Au-delà, la page répond « Trop de tentatives ».

### Appliquer le nouveau mot de passe

Deux voies. La page et le courriel disent laquelle a tourné. Le navigateur ne reçoit jamais l’empreinte ni le mot de passe.

1. **Mise à jour automatique** si `CF_API_TOKEN` et `CF_ACCOUNT_ID` sont posés (équivalents acceptés : `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`). Le Worker appelle `PUT /accounts/{compte}/workers/scripts/gem-casa-preview/secrets` pour remplacer `ADMIN_USERS` (nouveau hash du compte, les autres comptes et les adresses conservés). Le jeton API doit avoir le droit **Workers Scripts Write** sur ce compte, pas une clé globale. La prise en compte peut demander quelques secondes.
2. **Courriel du secret**, si ces deux valeurs manquent ou si l’API échoue. La ligne JSON part **seulement** vers `ADMIN_NOTIFY_EMAIL` et `ADMIN_SUPERADMIN_EMAIL`. Quelqu’un la colle avec `npx wrangler secret put ADMIN_USERS` sur `gem-casa-preview`. Tant que ce n’est pas fait, l’ancien mot de passe reste le bon.

Les sessions déjà ouvertes ne sont pas coupées : le cookie dure 12 heures et ne contient pas le mot de passe. Le navigateur qui vient de changer le mot de passe reçoit un cookie effacé. Les autres restent connectés jusqu’à expiration ou « Se déconnecter ».

Secrets à poser (valeurs jamais dans le dépôt) :

```sh
npx wrangler secret put ADMIN_SUPERADMIN_EMAIL
npx wrangler secret put ADMIN_NOTIFY_EMAIL
npx wrangler secret put CF_API_TOKEN
npx wrangler secret put CF_ACCOUNT_ID
```

`RESEND_API_KEY` est déjà celui du formulaire de contact. `RESEND_FROM` est la variable du `wrangler.jsonc`.

### Essai manuel sur la preview

Après le déploiement de cette branche sur `gem-casa-preview` (pas depuis l’agent qui ouvre la demande de fusion), et après le binding KV :

1. Ouvrir `/admin/`, suivre « Mot de passe oublié », envoyer un identifiant inconnu puis le vrai : le même texte s’affiche.
2. Vérifier le courriel (boîte du compte et copies). Le lien doit commencer par `https://gem-casa-preview.infoserv2a.workers.dev/admin/?reset=`.
3. L’ouvrir : la barre d’adresse reste sur `/admin/`, le titre est « Nouveau mot de passe », Decap n’apparaît pas.
4. Enregistrer un mot de passe d’au moins 8 caractères, deux fois pareil. Lire la voie indiquée (automatique ou courriel).
5. Se connecter avec le nouveau mot de passe. Rouvrir le lien : il est refusé.
6. Renvoyer le formulaire très vite : le message de plafond apparaît.

## À ne pas faire

- Ne pas commiter de mot de passe, d’empreinte réelle, ni de jeton.
- Ne pas déployer ce Worker vers le domaine de production, ni modifier Wix ou le DNS.
- Ne pas élargir le jeton GitHub au-delà de Contents sur `didier2a/gem-site`.
