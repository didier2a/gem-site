/**
 * Porte d’entrée de /admin/ pour la preview GEM Casa.
 * Le cookie de session est signé (HMAC). Le mot de passe est vérifié
 * en PBKDF2-SHA256. Aucun secret n’est écrit dans le HTML.
 */

export const COOKIE_NAME = "gem_admin_session";
export const SESSION_TTL_SEC = 60 * 60 * 12;
export const PBKDF2_ITERATIONS = 100_000;
export const ROLE_ANIMATRICE = "animatrice";
export const ROLE_GITHUB_ADMIN = "github_admin";
export const PAGES_DENIED_MESSAGE =
  "Les pages du site sont réservées au super-admin GitHub. Ce compte peut modifier les articles du blog.";
export const PUBLISH_DELAY_HINT =
  "Après une publication, comptez au moins 2 minutes avant de la voir en ligne sur le site.";
export const PUBLISH_TOAST_MESSAGE =
  "Publié ! Comptez au moins 2 minutes avant de le voir en ligne.";
const PBKDF2_MIN = 10_000;
const PBKDF2_MAX = 600_000;
const HASH_BITS = 256;
const SALT_BYTES = 16;

export const USERNAME_RE = /^[a-zA-Z0-9._-]{1,64}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Chaîne vide si l’adresse est absente. `null` si elle est illisible. */
export function normalizeAccountEmail(value) {
  if (value == null || value === "") return "";
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!email) return "";
  if (email.length > 200 || !EMAIL_RE.test(email)) return null;
  return email;
}

export function parseUsers(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(data) || data.length === 0) return null;
  const users = [];
  for (const entry of data) {
    if (!entry || typeof entry !== "object") return null;
    const username = entry.username;
    const hash = entry.hash;
    if (typeof username !== "string" || !USERNAME_RE.test(username)) return null;
    if (typeof hash !== "string" || !hash.startsWith("pbkdf2$")) return null;
    const user = { username, hash };
    if (entry.email != null && entry.email !== "") {
      const email = normalizeAccountEmail(entry.email);
      if (!email) return null;
      user.email = email;
    }
    users.push(user);
  }
  return users;
}

export function secretsReady(env) {
  const secret = typeof env?.ADMIN_SESSION_SECRET === "string" ? env.ADMIN_SESSION_SECRET.trim() : "";
  const users = parseUsers(env?.ADMIN_USERS);
  if (!secret || !users) return null;
  return { secret, users };
}

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

export function timingSafeEqual(a, b) {
  const aa = typeof a === "string" ? new TextEncoder().encode(a) : a;
  const bb = typeof b === "string" ? new TextEncoder().encode(b) : b;
  const len = Math.max(aa.length, bb.length);
  let diff = aa.length === bb.length ? 0 : 1;
  for (let i = 0; i < len; i++) {
    diff |= (aa[i] || 0) ^ (bb[i] || 0);
  }
  return diff === 0;
}

async function pbkdf2Bits(password, salt, iterations) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    HASH_BITS
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password, options = {}) {
  const iterations = options.iterations || PBKDF2_ITERATIONS;
  if (iterations < PBKDF2_MIN || iterations > PBKDF2_MAX) {
    throw new Error("Nombre d’itérations PBKDF2 hors plage.");
  }
  const salt = options.salt || crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await pbkdf2Bits(password, salt, iterations);
  return `pbkdf2$${iterations}$${bytesToB64url(salt)}$${bytesToB64url(hash)}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < PBKDF2_MIN || iterations > PBKDF2_MAX) {
    return false;
  }
  let salt;
  let expected;
  try {
    salt = b64urlToBytes(parts[2]);
    expected = b64urlToBytes(parts[3]);
  } catch {
    return false;
  }
  if (salt.length < 8 || expected.length !== HASH_BITS / 8) return false;
  const actual = await pbkdf2Bits(String(password), salt, iterations);
  return timingSafeEqual(actual, expected);
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

export async function createSession(secret, username, role = ROLE_ANIMATRICE) {
  const body = {
    u: username,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SEC,
  };
  if (role) {
    if (role !== ROLE_ANIMATRICE && role !== ROLE_GITHUB_ADMIN) {
      throw new Error("Rôle de session inconnu.");
    }
    body.role = role;
  }
  const payload = bytesToB64url(new TextEncoder().encode(JSON.stringify(body)));
  const sig = await hmac(secret, payload);
  return `${payload}.${sig}`;
}

export async function readSession(token, secret) {
  if (!token || !secret || !token.includes(".")) return null;
  const dot = token.lastIndexOf(".");
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = await hmac(secret, payload);
  if (!timingSafeEqual(sig, expected)) return null;
  let data;
  try {
    data = JSON.parse(new TextDecoder().decode(b64urlToBytes(payload)));
  } catch {
    return null;
  }
  if (!data || typeof data.u !== "string" || typeof data.exp !== "number") return null;
  // Un jeton de réinitialisation partage le secret HMAC mais pas ce format.
  if (data.typ || data.jti) return null;
  if (data.role != null && data.role !== ROLE_ANIMATRICE && data.role !== ROLE_GITHUB_ADMIN) return null;
  if (!USERNAME_RE.test(data.u)) return null;
  if (data.exp * 1000 <= Date.now()) return null;
  return { username: data.u, exp: data.exp, role: data.role || null };
}

export function readCookie(request, name) {
  const raw = request.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) === name) {
      try {
        return decodeURIComponent(trimmed.slice(eq + 1));
      } catch {
        return trimmed.slice(eq + 1);
      }
    }
  }
  return "";
}

export function sessionCookie(value, maxAge = SESSION_TTL_SEC) {
  return [
    `${COOKIE_NAME}=${value}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${maxAge}`,
  ].join("; ");
}

/** Logins GitHub autorisés à recevoir le cookie de session (secret ADMIN_GITHUB_LOGINS). */
export function allowedGithubLogins(env) {
  const raw = typeof env?.ADMIN_GITHUB_LOGINS === "string" ? env.ADMIN_GITHUB_LOGINS : "";
  const seen = new Set();
  const out = [];
  for (const part of raw.split(/[,\s]+/)) {
    const login = part.trim();
    if (!USERNAME_RE.test(login)) continue;
    const key = login.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(login);
  }
  return out;
}

function isGithubLogin(env, username) {
  return allowedGithubLogins(env).some((login) => login.toLowerCase() === username.toLowerCase());
}

export async function currentUser(request, env) {
  const ready = secretsReady(env);
  if (!ready) return { ready: false, username: null, role: null };
  const session = await readSession(readCookie(request, COOKIE_NAME), ready.secret);
  if (!session) return { ready: true, username: null, role: null };
  const house = ready.users.some((user) => user.username === session.username);
  const github = isGithubLogin(env, session.username);
  if (session.role === ROLE_GITHUB_ADMIN) {
    if (!github) return { ready: true, username: null, role: null };
    return { ready: true, username: session.username, role: ROLE_GITHUB_ADMIN };
  }
  if (session.role === ROLE_ANIMATRICE) {
    if (!house) return { ready: true, username: null, role: null };
    return { ready: true, username: session.username, role: ROLE_ANIMATRICE };
  }
  // Cookie émis avant le rôle : le compte maison reste animatrice,
  // un login seulement présent dans ADMIN_GITHUB_LOGINS reste super-admin.
  if (house) return { ready: true, username: session.username, role: ROLE_ANIMATRICE };
  if (github) return { ready: true, username: session.username, role: ROLE_GITHUB_ADMIN };
  return { ready: true, username: null, role: null };
}

/**
 * Config Decap servie à la session. Le fichier du dépôt garde toutes
 * les collections. Une animatrice n’en reçoit que « blog ».
 */
export function configYamlForRole(yaml, role) {
  const source = String(yaml ?? "");
  if (role === ROLE_GITHUB_ADMIN) return source;
  return stripNonBlogCollections(source);
}

export function stripNonBlogCollections(yaml) {
  const lines = String(yaml).split(/\r?\n/);
  const out = [];
  let inCollections = false;
  let skipping = false;
  for (const line of lines) {
    if (!inCollections && /^collections:\s*(#.*)?$/.test(line)) {
      inCollections = true;
      skipping = false;
      out.push(line);
      continue;
    }
    if (inCollections && /^[A-Za-z_][\w-]*\s*:/.test(line)) {
      inCollections = false;
      skipping = false;
      out.push(line);
      continue;
    }
    if (inCollections && /^ {2}- name:\s*/.test(line)) {
      const match = line.match(/^ {2}- name:\s*['"]?([A-Za-z0-9_-]+)['"]?\s*(?:#.*)?$/);
      skipping = !match || match[1] !== "blog";
      if (!skipping) out.push(line);
      continue;
    }
    if (!skipping) out.push(line);
  }
  return out.join("\n");
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, (ch) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
  });
}

function page({ title, heading, intro, body, status = 200, extraHeaders = {} }) {
  const html = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>${esc(title)}</title>
  <link rel="icon" href="/favicon.svg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Oregano&family=Barlow:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: Barlow, "Segoe UI", sans-serif;
      color: #2b4b42;
      background: #fffefc;
    }
    main {
      width: min(100% - 2rem, 28rem);
      margin: 8vh auto 3rem;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      text-decoration: none;
      color: inherit;
    }
    .brand img { width: 48px; height: 48px; }
    .brand strong { display: block; font-size: 1.05rem; }
    .brand small { color: #396c64; }
    h1 {
      font-family: Oregano, cursive;
      font-weight: 400;
      font-size: 2.4rem;
      line-height: 1.1;
      margin: 1.5rem 0 0.5rem;
      color: #0e2925;
    }
    p { line-height: 1.55; }
    form { display: grid; gap: 0.9rem; margin-top: 1.25rem; }
    label { font-weight: 600; }
    input {
      width: 100%;
      margin-top: 0.35rem;
      padding: 0.75rem 0.85rem;
      border: 1px solid rgba(42, 124, 111, 0.35);
      border-radius: 0.35rem;
      font: inherit;
      background: #fff;
    }
    input:focus-visible, button:focus-visible, a:focus-visible {
      outline: 3px solid #7dd3c6;
      outline-offset: 3px;
    }
    button {
      font: inherit;
      font-weight: 700;
      color: #fffefc;
      background: #2a7c6f;
      border: 0;
      border-radius: 0.35rem;
      padding: 0.85rem 1rem;
      cursor: pointer;
    }
    button:hover { background: #1c534a; }
    .error {
      background: #fff4f0;
      color: #8c3a2a;
      border: 1px solid rgba(196, 120, 90, 0.45);
      padding: 0.75rem 0.9rem;
      border-radius: 0.35rem;
    }
    a { color: #1c534a; font-weight: 700; }
    a.github {
      display: block;
      text-align: center;
      text-decoration: none;
      font-weight: 700;
      color: #fffefc;
      background: #24292f;
      border-radius: 0.35rem;
      padding: 0.85rem 1rem;
      margin-top: 0.35rem;
    }
    a.github:hover { background: #0e2925; }
    .or { text-align: center; color: #396c64; margin: 1rem 0 0.35rem; }
    .note { color: #396c64; font-size: 0.95rem; }
    .ok {
      background: #f3faf7;
      color: #1c534a;
      border: 1px solid rgba(42, 124, 111, 0.35);
      padding: 0.75rem 0.9rem;
      border-radius: 0.35rem;
    }
  </style>
</head>
<body>
  <main>
    <a class="brand" href="/">
      <img src="/assets/logo/logo-casa-gem.png" alt="" width="48" height="48">
      <span><strong>GEM Casa di l’Isula</strong><small>Porto-Vecchio</small></span>
    </a>
    <h1>${esc(heading)}</h1>
    <p>${intro}</p>
    ${body}
  </main>
  <script>
    try {
      localStorage.removeItem("decap-cms-user");
      localStorage.removeItem("gotrue.user");
    } catch (e) {}
  </script>
</body>
</html>`;
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      ...extraHeaders,
    },
  });
}

export function adminPage(options) {
  return page(options);
}

export function loginPage({ error = "", status = 200 } = {}) {
  const alert = error ? `<p class="error" role="alert">${esc(error)}</p>` : "";
  return page({
    status,
    title: "Connexion — Admin GEM Casa di l’Isula",
    heading: "Espace d’édition",
    intro:
      "L’identifiant ouvre l’éditeur sans compte GitHub. Le bouton GitHub est une autre entrée, pour le super-admin.",
    body: `${alert}
    <form method="post" action="/api/admin-login">
      <label>Identifiant
        <input name="username" autocomplete="username" required autocapitalize="none" spellcheck="false">
      </label>
      <label>Mot de passe
        <input name="password" type="password" autocomplete="current-password" required>
      </label>
      <button type="submit">Entrer</button>
    </form>
    <p><a href="/admin/mot-de-passe-oublie">Mot de passe oublié</a></p>
    <p class="or">ou</p>
    <a class="github" href="/api/oauth?intent=admin">Se connecter avec GitHub</a>
    <p class="note">L’identifiant est celui des animatrices. GitHub n’est pas demandé pour ce formulaire.</p>`,
  });
}

export function setupPage() {
  return page({
    title: "Admin à configurer — GEM Casa di l’Isula",
    heading: "Éditeur pas encore ouvert",
    intro:
      "L’éditeur ne s’affiche pas tant que les secrets du Worker de preview ne sont pas en place. Rien n’a été publié, et le site public reste disponible.",
    status: 503,
    body: `<p>Sur le Worker <strong>gem-casa-preview</strong> uniquement, il manque <code>ADMIN_SESSION_SECRET</code> ou <code>ADMIN_USERS</code> (ou le JSON des comptes est illisible).</p>
    <p>La procédure est dans <code>docs/admin-auth.md</code> du dépôt gem-site : secret de session, puis un compte créé avec <code>scripts/hash-admin-password.mjs</code>.</p>
    <p class="note">Aucun mot de passe n’est inscrit dans le site. Le domaine Wix n’est pas concerné.</p>`,
  });
}

async function readLoginBody(request) {
  const type = request.headers.get("content-type") || "";
  if (type.includes("application/json")) {
    const body = await request.json();
    return {
      username: typeof body.username === "string" ? body.username.trim() : "",
      password: typeof body.password === "string" ? body.password : "",
    };
  }
  const form = await request.formData();
  return {
    username: String(form.get("username") || "").trim(),
    password: String(form.get("password") || ""),
  };
}

export async function handleLogin(request, env) {
  if (request.method !== "POST") {
    return new Response("Méthode non autorisée.", {
      status: 405,
      headers: { "content-type": "text/plain; charset=utf-8", allow: "POST" },
    });
  }
  const ready = secretsReady(env);
  if (!ready) return setupPage();

  let fields;
  try {
    fields = await readLoginBody(request);
  } catch {
    return loginPage({ error: "Requête invalide." });
  }

  const username = fields.username;
  const password = fields.password;
  const generic = "Identifiant ou mot de passe incorrect.";
  if (!USERNAME_RE.test(username) || !password || password.length > 200) {
    const sample = ready.users[0].hash;
    await verifyPassword(password || " ", sample);
    return loginPage({ error: generic, status: 401 });
  }

  const user = ready.users.find((entry) => entry.username === username);
  const ok = await verifyPassword(password, user ? user.hash : ready.users[0].hash);
  if (!user || !ok) return loginPage({ error: generic, status: 401 });

  const token = await createSession(ready.secret, user.username, ROLE_ANIMATRICE);
  return new Response(null, {
    status: 303,
    headers: {
      location: "/admin/",
      "set-cookie": sessionCookie(token),
      "cache-control": "no-store",
    },
  });
}

export function handleLogout(request) {
  if (request.method !== "POST") {
    return new Response("Méthode non autorisée.", {
      status: 405,
      headers: { "content-type": "text/plain; charset=utf-8", allow: "POST" },
    });
  }
  return new Response(null, {
    status: 303,
    headers: {
      location: "/admin/",
      "set-cookie": sessionCookie("", 0),
      "cache-control": "no-store",
    },
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function handleBootstrap(request, env) {
  if (request.method !== "POST") {
    return json({ ok: false, error: "Méthode non autorisée." }, 405);
  }
  const expected = typeof env?.ADMIN_BOOTSTRAP_TOKEN === "string" ? env.ADMIN_BOOTSTRAP_TOKEN : "";
  if (!expected.trim()) {
    return json({ ok: false, error: "Route non configurée." }, 404);
  }
  const got = request.headers.get("x-bootstrap-token") || "";
  if (!timingSafeEqual(got, expected)) {
    return json({ ok: false, error: "Jeton refusé." }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Requête invalide." }, 400);
  }
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!USERNAME_RE.test(username) || password.length < 8 || password.length > 200) {
    return json(
      {
        ok: false,
        error: "Identifiant ou mot de passe refusé. L’identifiant est simple (lettres, chiffres, . _ -) et le mot de passe fait au moins 8 caractères.",
      },
      400
    );
  }
  const hash = await hashPassword(password);
  return json({
    ok: true,
    message:
      "Le Worker ne modifie pas ADMIN_USERS tout seul. Remplacez le secret ADMIN_USERS de gem-casa-preview par un tableau JSON qui contient cette entrée (et les comptes déjà en place). Ne commitez pas cette ligne.",
    entry: { username, hash },
  });
}

export function isAdminPath(pathname) {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

function animatriceGuardHtml() {
  const note = JSON.stringify(PAGES_DENIED_MESSAGE).replace(/</g, "\\u003c");
  return `<p id="gem-role-note" role="status" data-gem-role="${ROLE_ANIMATRICE}" style="position:fixed;top:12px;left:12px;z-index:10000;max-width:min(36rem,calc(100% - 11rem));margin:0;background:#f3faf7;color:#1c534a;border:1px solid rgba(42,124,111,.35);border-radius:.35rem;padding:.7rem .85rem;font-family:Barlow,sans-serif;font-size:.95rem;transition:opacity .4s ease,transform .4s ease">${esc(PAGES_DENIED_MESSAGE)}<br><span style="display:inline-block;margin-top:.4rem;font-size:.82rem;line-height:1.35;opacity:.82;font-weight:500">${esc(PUBLISH_DELAY_HINT)}</span></p>
<script>
(function () {
  var note = ${note};
  function blocked(hash) {
    return /collections\\/pages(?:\\/|$|\\?)/.test(hash || "");
  }
  function guard() {
    if (!blocked(location.hash)) return;
    var box = document.getElementById("gem-pages-deny");
    if (!box) {
      box = document.createElement("div");
      box.id = "gem-pages-deny";
      box.setAttribute("role", "alert");
      box.textContent = note;
      box.style.cssText = "position:fixed;top:4.5rem;left:12px;z-index:10001;max-width:min(36rem,calc(100% - 2rem));background:#fff4f0;color:#8c3a2a;border:1px solid rgba(196,120,90,.45);padding:.9rem 1rem;border-radius:.35rem;font-family:Barlow,sans-serif";
      document.body.appendChild(box);
    }
    if (location.hash !== "#/collections/blog") location.replace("#/collections/blog");
  }
  window.addEventListener("hashchange", guard);
  guard();

  function hideNote(el) {
    el.style.display = "none";
    el.style.pointerEvents = "none";
  }
  function dismissNote(el) {
    if (!el || el.getAttribute("data-gem-dismissed") === "1") return;
    el.setAttribute("data-gem-dismissed", "1");
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      hideNote(el);
      return;
    }
    el.style.opacity = "0";
    el.style.transform = "translateY(-6px)";
    el.style.pointerEvents = "none";
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      hideNote(el);
    }
    el.addEventListener("transitionend", finish);
    setTimeout(finish, 500);
  }
  function armNote(el) {
    if (!el || el.getAttribute("data-gem-dismiss-armed") === "1") return;
    el.setAttribute("data-gem-dismiss-armed", "1");
    setTimeout(function () { dismissNote(el); }, 5000);
  }
  function scan() {
    armNote(document.getElementById("gem-role-note"));
  }
  scan();
  if (typeof MutationObserver === "function") {
    new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
  }
})();
</script>
`;
}

/** Toast après « Publier » (animatrice + github_admin). Indépendant de #gem-role-note. */
function publishToastHtml() {
  const msg = JSON.stringify(PUBLISH_TOAST_MESSAGE).replace(/</g, "\\u003c");
  // Script defer placé après Decap : CMS est disponible dans la file defer.
  return `<script defer>
(function () {
  var MSG = ${msg};
  var TOAST_ID = "gem-publish-toast";
  var hideTimer = null;
  var removeTimer = null;
  function clearTimers() {
    if (hideTimer) clearTimeout(hideTimer);
    if (removeTimer) clearTimeout(removeTimer);
    hideTimer = removeTimer = null;
  }
  function removeToast(el) {
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }
  function showToast() {
    clearTimers();
    var prev = document.getElementById(TOAST_ID);
    if (prev) removeToast(prev);
    var el = document.createElement("div");
    el.id = TOAST_ID;
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.textContent = MSG;
    el.style.cssText = "position:fixed;bottom:1.25rem;left:50%;transform:translateX(-50%);z-index:10002;max-width:min(28rem,calc(100% - 2rem));margin:0;background:#f3faf7;color:#1c534a;border:1px solid rgba(42,124,111,.35);border-radius:.35rem;padding:.75rem 1rem;font-family:Barlow,sans-serif;font-size:.95rem;font-weight:600;box-shadow:0 8px 24px rgba(28,83,74,.12);transition:opacity .4s ease,transform .4s ease;opacity:1;pointer-events:none;text-align:center";
    document.body.appendChild(el);
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    hideTimer = setTimeout(function () {
      if (reduce) {
        removeToast(el);
        return;
      }
      el.style.opacity = "0";
      el.style.transform = "translateX(-50%) translateY(8px)";
      removeTimer = setTimeout(function () { removeToast(el); }, 450);
    }, 8000);
  }
  function arm(tries) {
    tries = tries || 0;
    if (!window.CMS || typeof CMS.registerEventListener !== "function") {
      if (tries < 200) setTimeout(function () { arm(tries + 1); }, 40);
      return;
    }
    // postPublish : en mode simple (notre config), Decap l'émet après persistEntry
    // (backend.ts : invokePostPublishEvent si !useWorkflow). postSave se déclenche aussi,
    // mais postPublish correspond à « Publier » / publication réelle.
    try {
      CMS.registerEventListener({ name: "postPublish", handler: function () { showToast(); } });
    } catch (e) {}
  }
  arm(0);
})();
</script>
`;
}

export function injectAdminShell(html, username, role) {
  const userJson = JSON.stringify({
    backendName: "proxy",
    login: username,
    name: username,
  });
  const githubAdmin = role === ROLE_GITHUB_ADMIN;
  const guard = githubAdmin ? "" : animatriceGuardHtml();
  const toast = publishToastHtml();
  const bootstrap = `<script>
try {
  localStorage.setItem("decap-cms-user", ${JSON.stringify(userJson)});
} catch (e) {}
</script>
${guard}<form method="post" action="/api/admin-logout" data-gem-role="${githubAdmin ? ROLE_GITHUB_ADMIN : ROLE_ANIMATRICE}" style="position:fixed;top:12px;right:12px;z-index:10000;margin:0;font-family:Barlow,sans-serif">
  <button type="submit" style="font:inherit;font-weight:700;color:#fffefc;background:#2a7c6f;border:0;border-radius:0.35rem;padding:0.55rem 0.8rem;cursor:pointer">Se déconnecter <span style="font-weight:500">(${esc(username)})</span></button>
</form>
`;
  // Insérer bootstrap AVANT le <script Decap>, toast APRÈS la balise complète.
  // Ne jamais concaténer juste après le préfixe src=… (ça cassait l’URL Decap).
  const decapScriptRe = /<script\s+src="https:\/\/unpkg\.com\/decap-cms[^"]*"[^>]*><\/script>/i;
  if (decapScriptRe.test(html)) {
    return html.replace(decapScriptRe, (full) => `${bootstrap}${full}${toast}`);
  }
  return html.replace("</head>", `${bootstrap}${toast}</head>`);
}
