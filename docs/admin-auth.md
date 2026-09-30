# Accès à l’éditeur — preview GEM Casa

Ce document concerne **uniquement** le Worker Cloudflare `gem-casa-preview`. Il ne déploie rien, ne touche pas au DNS, et ne concerne pas le site Wix [www.legem-portovecchio.org](https://www.legem-portovecchio.org).

## Ce que le mot de passe ouvre

Le nom et le mot de passe ouvrent la coquille Decap sur `/admin/`. Une animatrice **n’a pas besoin d’un compte GitHub** pour lire et enregistrer le blog ou les pages, une fois que Didier a déposé le jeton décrit plus bas.

L’enregistrement part du Worker vers GitHub avec le secret `GITHUB_CONTENT_PAT`. Ce jeton reste sur le serveur : il n’apparaît ni dans la page, ni dans le JavaScript, ni dans les réponses de l’éditeur.

Les commits arrivent sur la branche `main` du dépôt `didier2a/gem-site`, signés dans le message par l’identifiant de la personne connectée (`[muriel] …`). Le mode « pull request » n’est pas activé : un jeton limité au droit **Contents** ne peut pas ouvrir de demande de fusion. Didier revoit l’historique Git s’il veut contrôler ce qui a été écrit.

Les routes `/api/oauth` et `/api/oauth/callback` restent en place, avec les secrets `GITHUB_OAUTH_CLIENT_ID` et `GITHUB_OAUTH_CLIENT_SECRET`. Elles servent si l’on revient plus tard à une connexion GitHub nominative dans Decap. Ce n’est pas le chemin des animatrices.

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
[{"username":"muriel","hash":"pbkdf2$100000$…$…"}]
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

Quand le secret est en place, Decap charge les articles et les pages, et un enregistrement crée un commit sur `main` via le Worker. L’animatrice ne voit pas d’écran « Login with GitHub ».

## 4. Route d’aide optionnelle

`POST /api/admin-bootstrap` avec l’en-tête `X-Bootstrap-Token` égal au secret `ADMIN_BOOTSTRAP_TOKEN` renvoie une empreinte à coller dans `ADMIN_USERS`. Le Worker ne réécrit pas le secret tout seul. Si `ADMIN_BOOTSTRAP_TOKEN` n’est pas défini, la route répond qu’elle n’est pas configurée. Le script du dépôt suffit pour créer les comptes.

## À ne pas faire

- Ne pas commiter de mot de passe, d’empreinte réelle, ni de jeton.
- Ne pas déployer ce Worker vers le domaine de production, ni modifier Wix ou le DNS.
- Ne pas élargir le jeton GitHub au-delà de Contents sur `didier2a/gem-site`.
