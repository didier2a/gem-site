/**
 * Mot de passe oublié — preview GEM Casa uniquement.
 *
 * Le lien reçu par courriel ouvre /admin/?reset=<jeton> (pas une autre route).
 * Tant que ce paramètre est présent, Decap n’est pas servi.
 *
 * Jeton : HMAC séparé du cookie de session, 1 heure, un seul usage.
 * Réserve : binding KV `ADMIN_RESET_KV` (voir docs/admin-auth.md).
 * Sans ce binding, aucun lien n’est émis : une réserve en mémoire ne tiendrait
 * pas l’usage unique d’un isolement à l’autre.
 *
 * Application du nouveau mot de passe :
 * - si CF_API_TOKEN et CF_ACCOUNT_ID sont posés, PUT du secret ADMIN_USERS
 *   (il n’existe pas de binding pour réécrire un secret Worker) ;
 * - sinon, le JSON de remplacement part seulement vers ADMIN_NOTIFY_EMAIL
 *   et ADMIN_SUPERADMIN_EMAIL. Le navigateur ne reçoit ni empreinte ni mot de passe.
 */

import {
  USERNAME_RE,
  adminPage,
  hashPassword,
  normalizeAccountEmail,
  secretsReady,
  sessionCookie,
  setupPage,
  timingSafeEqual,
} from "./admin-auth.js";

export const PREVIEW_ORIGIN = "https://gem-casa-preview.infoserv2a.workers.dev";
export const RESET_TTL_SEC = 60 * 60;
export const FORGOT_LIMIT = 5;
export const RESET_LIMIT = 8;
const WINDOW_SEC = 15 * 60;
const RESET_SCOPE = "gem-admin-reset.v1";
const RESET_PREFIX = "gem-reset:";
const WORKER_NAME = "gem-casa-preview";

export const FORGOT_SUCCESS =
  "Si un compte correspond, un message vient d’être envoyé avec la marche à suivre. Vérifiez aussi les courriers indésirables. Le lien reste valable une heure et ne sert qu’une fois.";

const RATE_LIMIT_TEXT = "Trop de tentatives. Merci de réessayer dans un quart d’heure.";
const INVALID_LINK_TEXT = "Ce lien n’est plus valable. Demandez-en un nouveau.";
const MISMATCH_TEXT = "Les deux saisies ne correspondent pas.";
const SHORT_TEXT = "Le mot de passe doit contenir au moins 8 caractères.";
const LONG_TEXT = "Le mot de passe est trop long.";
const APPLIED_TEXT =
  "Votre nouveau mot de passe est enregistré. Vous pouvez vous connecter : la prise en compte peut demander quelques secondes. Voie : mise à jour automatique du secret ADMIN_USERS (API Cloudflare). Les sessions déjà ouvertes ailleurs restent valables jusqu’à expiration ou déconnexion.";
const EMAILED_TEXT =
  "Votre nouveau mot de passe n’est pas encore actif. Voie : courriel — le secret ADMIN_USERS a été envoyé uniquement aux adresses de notification du Worker, qui doivent le coller à la main. Rien de ce secret n’est affiché ici.";
const FAILED_TEXT =
  "La mise à jour n’a pas abouti. Le lien reste valable : réessayez, ou demandez-en un nouveau. Aucun mot de passe n’a été affiché.";

function bytesToB64url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlToBytes(value) {
  const pad = value.length % 4 === 0 ? "" : "=".repeat(4 - (value.length % 4));
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return bytesToB64url(new Uint8Array(sig));
}

async function hashTag(passwordHash) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(passwordHash));
  return bytesToB64url(new Uint8Array(digest)).slice(0, 22);
}

export function kvBinding(env) {
  const kv = env?.ADMIN_RESET_KV;
  if (kv && typeof kv.get === "function" && typeof kv.put === "function" && typeof kv.delete === "function") {
    return kv;
  }
  return null;
}

function resetKey(jti) {
  return `${RESET_PREFIX}${jti}`;
}

export function resetPageUrl(token) {
  return `${PREVIEW_ORIGIN}/admin/?reset=${encodeURIComponent(token)}`;
}

function uniqueEmails(values) {
  const out = [];
  for (const value of values) {
    const email = normalizeAccountEmail(typeof value === "string" ? value : "");
    if (!email || out.includes(email)) continue;
    out.push(email);
  }
  return out;
}

/**
 * Destinataires du lien. La primaire est l’adresse du compte si elle existe.
 * ADMIN_SUPERADMIN_EMAIL et ADMIN_NOTIFY_EMAIL partent en copie (bcc), une seule fois,
 * et ne sont pas répétés s’ils valent la primaire.
 * Sans adresse de compte : envoi aux secrets de notification, marqué récupération.
 */
export function resetDeliveryPlan({ accountEmail, superadminEmail, notifyEmail }) {
  const primary = normalizeAccountEmail(accountEmail) || "";
  const copies = uniqueEmails([superadminEmail, notifyEmail]).filter((email) => email !== primary);
  if (primary) return { to: [primary], bcc: copies, recovery: false };
  if (!copies.length) return { to: [], bcc: [], recovery: true };
  return { to: [copies[0]], bcc: copies.slice(1), recovery: true };
}

/** JSON de remplacement : uniquement les deux secrets de notification, dédupliqués. */
export function notifyOnlyPlan(superadminEmail, notifyEmail) {
  const all = uniqueEmails([superadminEmail, notifyEmail]);
  if (!all.length) return { to: [], bcc: [] };
  return { to: [all[0]], bcc: all.slice(1) };
}

export async function issueResetToken(secret, kv, user, now = Date.now()) {
  const jti = bytesToB64url(crypto.getRandomValues(new Uint8Array(16)));
  const exp = Math.floor(now / 1000) + RESET_TTL_SEC;
  const hp = await hashTag(user.hash);
  const payload = bytesToB64url(
    new TextEncoder().encode(JSON.stringify({ typ: "reset", u: user.username, exp, jti, hp }))
  );
  const sig = await hmac(secret, `${RESET_SCOPE}.${payload}`);
  await kv.put(resetKey(jti), user.username, { expirationTtl: RESET_TTL_SEC });
  return `${payload}.${sig}`;
}

export async function readResetToken(token, secret, kv, users, now = Date.now()) {
  if (typeof token !== "string" || token.length < 20 || token.length > 1500) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = await hmac(secret, `${RESET_SCOPE}.${payload}`);
  if (!timingSafeEqual(sig, expected)) return null;
  let data;
  try {
    data = JSON.parse(new TextDecoder().decode(b64urlToBytes(payload)));
  } catch {
    return null;
  }
  if (!data || data.typ !== "reset") return null;
  if (typeof data.u !== "string" || !USERNAME_RE.test(data.u)) return null;
  if (typeof data.exp !== "number" || data.exp * 1000 <= now) return null;
  if (typeof data.jti !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(data.jti)) return null;
  if (typeof data.hp !== "string") return null;
  const user = users.find((entry) => entry.username === data.u);
  if (!user) return null;
  const hp = await hashTag(user.hash);
  if (!timingSafeEqual(hp, data.hp)) return null;
  const stored = await kv.get(resetKey(data.jti));
  if (typeof stored !== "string" || !timingSafeEqual(stored, data.u)) return null;
  return { username: data.u, jti: data.jti, exp: data.exp };
}

export async function consumeResetJti(kv, jti, username) {
  const key = resetKey(jti);
  const stored = await kv.get(key);
  if (typeof stored !== "string" || !timingSafeEqual(stored, username)) return false;
  await kv.delete(key);
  return true;
}

async function restoreResetJti(kv, jti, username, exp) {
  const ttl = Math.max(60, exp - Math.floor(Date.now() / 1000));
  await kv.put(resetKey(jti), username, { expirationTtl: ttl });
}

function clientIp(request) {
  const raw = request.headers.get("cf-connecting-ip") || "";
  if (/^[0-9a-fA-F:.]{1,64}$/.test(raw)) return raw;
  return "unknown";
}

async function tooMany(kv, action, ip) {
  const limit = action === "forgot" ? FORGOT_LIMIT : RESET_LIMIT;
  const key = `gem-rl:${action}:${ip}`;
  const raw = await kv.get(key);
  const count = raw == null || raw === "" ? 0 : Number(raw);
  if (!Number.isFinite(count) || count >= limit) return true;
  await kv.put(key, String(count + 1), { expirationTtl: WINDOW_SEC });
  return false;
}

function methodNotAllowed(allow) {
  return new Response("Méthode non autorisée.", {
    status: 405,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      allow,
      "cache-control": "no-store",
    },
  });
}

function forgotSuccessPage() {
  return adminPage({
    title: "Mot de passe oublié — Admin GEM Casa di l’Isula",
    heading: "Demande enregistrée",
    intro: "La réponse est la même, qu’un compte corresponde ou non.",
    body: `<p class="ok" role="status">${FORGOT_SUCCESS}</p>
    <p><a href="/admin/">Retour à l’espace d’édition</a></p>`,
  });
}

function forgotFormPage({ error = "", status = 200 } = {}) {
  const alert = error ? `<p class="error" role="alert">${error}</p>` : "";
  return adminPage({
    status,
    title: "Mot de passe oublié — Admin GEM Casa di l’Isula",
    heading: "Mot de passe oublié",
    intro: "Indiquez l’identifiant du compte ou son adresse. La réponse affichée ensuite est toujours la même.",
    body: `${alert}
    <form method="post" action="/api/admin-mot-de-passe-oublie">
      <label>Identifiant ou adresse
        <input name="identifiant" autocomplete="username" required autocapitalize="none" spellcheck="false" maxlength="200">
      </label>
      <button type="submit">Envoyer le lien</button>
    </form>
    <p><a href="/admin/">Retour à l’espace d’édition</a></p>`,
  });
}

function rateLimitPage() {
  return adminPage({
    status: 429,
    title: "Trop de tentatives — Admin GEM Casa di l’Isula",
    heading: "Trop de tentatives",
    intro: "La demande n’a pas été traitée.",
    extraHeaders: { "retry-after": String(WINDOW_SEC) },
    body: `<p class="error" role="alert">${RATE_LIMIT_TEXT}</p>
    <p><a href="/admin/">Retour à l’espace d’édition</a></p>`,
  });
}

function invalidLinkPage() {
  return adminPage({
    status: 400,
    title: "Lien inutilisable — Admin GEM Casa di l’Isula",
    heading: "Lien inutilisable",
    intro: "Ce lien ne permet pas de choisir un nouveau mot de passe.",
    body: `<p class="error" role="alert">${INVALID_LINK_TEXT}</p>
    <p><a href="/admin/mot-de-passe-oublie">Mot de passe oublié</a></p>
    <p class="note"><a href="/admin/">Retour à l’espace d’édition</a></p>`,
  });
}

function resetFormPage({ token, error = "", status = 200 }) {
  const alert = error ? `<p class="error" role="alert">${error}</p>` : "";
  return adminPage({
    status,
    title: "Nouveau mot de passe — Admin GEM Casa di l’Isula",
    heading: "Nouveau mot de passe",
    intro: "Choisissez un mot de passe d’au moins 8 caractères. Ce lien ne sert qu’une fois.",
    body: `${alert}
    <form method="post" action="/api/admin-nouveau-mot-de-passe">
      <input type="hidden" name="token" value="${escapeAttr(token)}">
      <label>Nouveau mot de passe
        <input name="password" type="password" autocomplete="new-password" required minlength="8" maxlength="200">
      </label>
      <label>Confirmation
        <input name="confirmation" type="password" autocomplete="new-password" required minlength="8" maxlength="200">
      </label>
      <button type="submit">Enregistrer le mot de passe</button>
    </form>
    <p class="note"><a href="/admin/mot-de-passe-oublie">Demander un autre lien</a></p>`,
  });
}

function escapeAttr(value) {
  return String(value).replace(/[&<>"']/g, (ch) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
  });
}

function resultPage(text, status, extraHeaders) {
  return adminPage({
    status,
    title: "Nouveau mot de passe — Admin GEM Casa di l’Isula",
    heading: "Nouveau mot de passe",
    intro: "Suite de votre demande.",
    extraHeaders,
    body: `<p class="${status === 200 ? "ok" : "error"}" role="status">${text}</p>
    <p><a href="/admin/">Retour à l’espace d’édition</a></p>`,
  });
}

async function readFields(request, names) {
  const type = request.headers.get("content-type") || "";
  let source;
  if (type.includes("application/json")) {
    source = await request.json();
    const out = {};
    for (const name of names) out[name] = typeof source?.[name] === "string" ? source[name] : "";
    return out;
  }
  const form = await request.formData();
  const out = {};
  for (const name of names) out[name] = String(form.get(name) || "");
  return out;
}

export function findAccount(users, raw) {
  const id = typeof raw === "string" ? raw.trim() : "";
  if (!id || id.length > 200) return null;
  if (id.includes("@")) {
    const email = normalizeAccountEmail(id);
    if (!email) return null;
    const matches = users.filter((user) => user.email === email);
    if (matches.length !== 1) return null;
    return matches[0];
  }
  if (!USERNAME_RE.test(id)) return null;
  return users.find((user) => user.username === id) || null;
}

function resendFrom(env) {
  const from = typeof env?.RESEND_FROM === "string" ? env.RESEND_FROM.trim() : "";
  if (!from || from.length > 300 || /[\r\n]/.test(from)) return "";
  return from;
}

function resendKey(env) {
  const key = typeof env?.RESEND_API_KEY === "string" ? env.RESEND_API_KEY.trim() : "";
  if (!key || /[\r\n]/.test(key)) return "";
  return key;
}

async function postResend(key, payload) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  await res.text();
  return res.ok;
}

async function deliverMail(env, { to, bcc, subject, text }) {
  const from = resendFrom(env);
  const key = resendKey(env);
  if (!from || !key || !to.length) return false;
  try {
    const payload = { from, to, subject, text };
    if (bcc.length) payload.bcc = bcc;
    if (await postResend(key, payload)) return true;
    if (!bcc.length) return false;
    let any = false;
    for (const addr of [...to, ...bcc]) {
      const copySubject = to.includes(addr) ? subject : `Copie — ${subject}`;
      if (await postResend(key, { from, to: [addr], subject: copySubject, text })) any = true;
    }
    return any;
  } catch {
    return false;
  }
}

function linkLetter({ username, url, recovery }) {
  return [
    recovery
      ? "Copie de récupération : ce compte n’a pas d’adresse enregistrée. Le lien est envoyé aux adresses de notification configurées sur le Worker."
      : "Une demande de nouveau mot de passe a été enregistrée pour l’éditeur du site.",
    "",
    `Compte : ${username}`,
    "",
    "Ouvrez ce lien dans le navigateur. Il reste sur /admin/ (valable 1 heure, un seul usage) :",
    url,
    "",
    "Si vous n’êtes pas à l’origine de cette demande, ignorez ce message. Le mot de passe actuel ne change pas.",
  ].join("\n");
}

async function sendResetLink(env, kv, user, secret) {
  const plan = resetDeliveryPlan({
    accountEmail: user.email || "",
    superadminEmail: env.ADMIN_SUPERADMIN_EMAIL,
    notifyEmail: env.ADMIN_NOTIFY_EMAIL,
  });
  if (!plan.to.length || !resendFrom(env) || !resendKey(env)) return;
  const token = await issueResetToken(secret, kv, user);
  const sent = await deliverMail(env, {
    to: plan.to,
    bcc: plan.bcc,
    subject: "Nouveau mot de passe — GEM Casa di l’Isula",
    text: linkLetter({ username: user.username, url: resetPageUrl(token), recovery: plan.recovery }),
  });
  if (!sent) {
    const seen = await readResetToken(token, secret, kv, [user]);
    if (seen) await kv.delete(resetKey(seen.jti));
  }
}

export function handleForgotPage(request, env) {
  if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed("GET, HEAD");
  if (!secretsReady(env)) return setupPage();
  return forgotFormPage();
}

export async function handleForgot(request, env) {
  if (request.method !== "POST") return methodNotAllowed("POST");
  const ready = secretsReady(env);
  if (!ready) return setupPage();
  const kv = kvBinding(env);
  if (kv && (await tooMany(kv, "forgot", clientIp(request)))) return rateLimitPage();
  let identifiant = "";
  try {
    const fields = await readFields(request, ["identifiant"]);
    identifiant = fields.identifiant.trim();
  } catch {
    return forgotFormPage({ error: "Requête invalide.", status: 400 });
  }
  if (!identifiant) {
    return forgotFormPage({ error: "Indiquez un identifiant ou une adresse.", status: 400 });
  }
  if (!kv) {
    console.error("admin-reset: binding ADMIN_RESET_KV absent, aucun jeton émis");
    return forgotSuccessPage();
  }
  if (identifiant.length > 200) return forgotSuccessPage();
  const user = findAccount(ready.users, identifiant);
  if (user) {
    try {
      await sendResetLink(env, kv, user, ready.secret);
    } catch {
      console.error("admin-reset: envoi du lien impossible");
    }
  }
  return forgotSuccessPage();
}

function usersJson(users) {
  return JSON.stringify(
    users.map((user) => {
      const entry = { username: user.username, hash: user.hash };
      if (user.email) entry.email = user.email;
      return entry;
    })
  );
}

function cloudflareTarget(env) {
  const token = firstFilled(env, ["CF_API_TOKEN", "CLOUDFLARE_API_TOKEN"]);
  const account = firstFilled(env, ["CF_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID"]);
  if (!token || !/^[a-f0-9]{32}$/i.test(account)) return null;
  const workerRaw = firstFilled(env, ["CF_WORKER_NAME"]) || WORKER_NAME;
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(workerRaw)) return null;
  return { token, account, worker: workerRaw };
}

function firstFilled(env, names) {
  for (const name of names) {
    const value = env?.[name];
    if (typeof value === "string" && value.trim() && !/[\r\n]/.test(value)) return value.trim();
  }
  return "";
}

async function putAdminUsers(target, json) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${target.account}/workers/scripts/${encodeURIComponent(target.worker)}/secrets`;
  try {
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${target.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "ADMIN_USERS", text: json, type: "secret_text" }),
    });
    const raw = (await res.text()).slice(0, 2000);
    let data = null;
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
    return { ok: res.ok && data?.success === true, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

function secretLetter({ username, json, status }) {
  const reason =
    status > 0
      ? `L’API Cloudflare n’a pas appliqué le secret (HTTP ${status}).`
      : "CF_API_TOKEN ou CF_ACCOUNT_ID n’est pas configuré sur le Worker.";
  return [
    "Voie : courriel — secret ADMIN_USERS à coller à la main.",
    reason,
    "",
    `Compte modifié : ${username}`,
    "Worker : gem-casa-preview",
    "",
    "Remplacez le secret ADMIN_USERS par la ligne suivante.",
    "Elle contient les empreintes de tous les comptes, pas les mots de passe en clair.",
    "Ne la commitez pas et ne la transférez pas au-delà des personnes qui gèrent le Worker.",
    "",
    json,
    "",
    "Commande : npx wrangler secret put ADMIN_USERS",
    "Choisir le Worker gem-casa-preview uniquement.",
  ].join("\n");
}

async function sendSecretMail(env, username, json, status) {
  const plan = notifyOnlyPlan(env.ADMIN_SUPERADMIN_EMAIL, env.ADMIN_NOTIFY_EMAIL);
  if (!plan.to.length) return false;
  return deliverMail(env, {
    to: plan.to,
    bcc: plan.bcc,
    subject: "Secret ADMIN_USERS à remplacer — GEM Casa di l’Isula",
    text: secretLetter({ username, json, status }),
  });
}

async function sendAppliedNotice(env, username, accountEmail) {
  const plan = notifyOnlyPlan(env.ADMIN_SUPERADMIN_EMAIL, env.ADMIN_NOTIFY_EMAIL);
  const account = normalizeAccountEmail(accountEmail) || "";
  const recipients = uniqueEmails([account, ...plan.to, ...plan.bcc]);
  if (!recipients.length) return;
  const to = [recipients[0]];
  const bcc = recipients.slice(1);
  await deliverMail(env, {
    to,
    bcc,
    subject: "Mot de passe admin mis à jour — GEM Casa di l’Isula",
    text: [
      "Voie : mise à jour automatique du secret ADMIN_USERS (API Cloudflare).",
      "",
      `Le mot de passe du compte « ${username} » a été remplacé sur le Worker gem-casa-preview.`,
      "Aucun mot de passe et aucune empreinte ne figurent dans ce message.",
      "Les sessions déjà ouvertes restent valables jusqu’à leur expiration (12 heures) ou une déconnexion.",
    ].join("\n"),
  });
}

async function applyNewPassword(env, users, username, password) {
  const nextHash = await hashPassword(password);
  if (nextHash.includes(password)) return { ok: false, via: "none" };
  const nextUsers = users.map((user) => (user.username === username ? { ...user, hash: nextHash } : { ...user }));
  const json = usersJson(nextUsers);
  const target = cloudflareTarget(env);
  if (target) {
    const result = await putAdminUsers(target, json);
    if (result.ok) {
      const account = users.find((user) => user.username === username);
      try {
        await sendAppliedNotice(env, username, account?.email || "");
      } catch {
        console.error("admin-reset: avis de mise à jour non envoyé");
      }
      return { ok: true, via: "api" };
    }
    const mailed = await sendSecretMail(env, username, json, result.status);
    return mailed ? { ok: true, via: "email" } : { ok: false, via: "none" };
  }
  const mailed = await sendSecretMail(env, username, json, 0);
  return mailed ? { ok: true, via: "email" } : { ok: false, via: "none" };
}

function passwordProblem(password, confirmation) {
  if (password.length < 8 || confirmation.length < 8) return SHORT_TEXT;
  if (password.length > 200 || confirmation.length > 200) return LONG_TEXT;
  if (password !== confirmation) return MISMATCH_TEXT;
  return "";
}

export async function handleResetPage(request, env, token) {
  if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed("GET, HEAD");
  const ready = secretsReady(env);
  if (!ready) return setupPage();
  const kv = kvBinding(env);
  if (!kv) return invalidLinkPage();
  const seen = await readResetToken(token, ready.secret, kv, ready.users);
  if (!seen) return invalidLinkPage();
  return resetFormPage({ token });
}

export async function handleReset(request, env) {
  if (request.method !== "POST") return methodNotAllowed("POST");
  const ready = secretsReady(env);
  if (!ready) return setupPage();
  const kv = kvBinding(env);
  if (kv && (await tooMany(kv, "reset", clientIp(request)))) return rateLimitPage();
  let fields;
  try {
    fields = await readFields(request, ["token", "password", "confirmation"]);
  } catch {
    return invalidLinkPage();
  }
  const token = fields.token.trim();
  const password = fields.password;
  const confirmation = fields.confirmation;
  if (!kv) return invalidLinkPage();
  const seen = await readResetToken(token, ready.secret, kv, ready.users);
  if (!seen) return invalidLinkPage();
  const problem = passwordProblem(password, confirmation);
  if (problem) return resetFormPage({ token, error: problem, status: 400 });
  const taken = await consumeResetJti(kv, seen.jti, seen.username);
  if (!taken) return invalidLinkPage();
  let applied;
  try {
    applied = await applyNewPassword(env, ready.users, seen.username, password);
  } catch {
    applied = { ok: false, via: "none" };
  }
  if (!applied.ok) {
    await restoreResetJti(kv, seen.jti, seen.username, seen.exp);
    return resultPage(FAILED_TEXT, 503);
  }
  const text = applied.via === "api" ? APPLIED_TEXT : EMAILED_TEXT;
  return resultPage(text, 200, { "set-cookie": sessionCookie("", 0) });
}
