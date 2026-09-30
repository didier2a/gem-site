/**
 * OAuth GitHub.
 * - /api/oauth sans intent : dialogue Decap (fenêtre + postMessage). Le jeton
 *   utilisateur n’est pas un cookie de session.
 * - /api/oauth?intent=admin : bouton « Se connecter avec GitHub » de la porte.
 *   Si le login est dans ADMIN_GITHUB_LOGINS, le Worker pose gem_admin_session
 *   et redirige vers /admin/. Le jeton GitHub n’est pas écrit dans la page.
 * Le secret client ne sort jamais dans le HTML.
 */
import {
  adminPage,
  allowedGithubLogins,
  createSession,
  secretsReady,
  sessionCookie,
  setupPage,
  timingSafeEqual,
  USERNAME_RE,
} from "./admin-auth.js";

const STATE_COOKIE = "gem_oauth_state";

function stateCookie(value, maxAge) {
  return [
    `${STATE_COOKIE}=${value}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${maxAge}`,
  ].join("; ");
}

function readCookie(request, name) {
  const raw = request.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1);
  }
  return "";
}

function html(body, status = 200, extraHeaders = {}) {
  return new Response(body, {
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

function setupHtml() {
  return html(
    `<!doctype html><html lang="fr"><meta charset="utf-8"><title>OAuth GitHub</title><body><p>La connexion GitHub n’est pas configurée sur cette preview. Il manque <code>GITHUB_OAUTH_CLIENT_ID</code> ou <code>GITHUB_OAUTH_CLIENT_SECRET</code> sur le Worker gem-casa-preview.</p></body></html>`,
    503
  );
}

function oauthReady(env) {
  const id = typeof env?.GITHUB_OAUTH_CLIENT_ID === "string" ? env.GITHUB_OAUTH_CLIENT_ID.trim() : "";
  const secret =
    typeof env?.GITHUB_OAUTH_CLIENT_SECRET === "string" ? env.GITHUB_OAUTH_CLIENT_SECRET.trim() : "";
  if (!id || !secret) return null;
  return { id, secret };
}

function randomState() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function handshakePage(message) {
  const embedded = JSON.stringify(message).replace(/</g, "\\u003c");
  return html(`<!doctype html>
<html lang="fr">
<head><meta charset="utf-8"><title>Connexion GitHub</title></head>
<body>
<p>Retour à l’éditeur…</p>
<script>
(function () {
  var msg = ${embedded};
  function receive(event) {
    if (!window.opener) return;
    window.opener.postMessage(msg, event.origin);
    window.removeEventListener("message", receive);
  }
  window.addEventListener("message", receive);
  if (window.opener) window.opener.postMessage("authorizing:github", "*");
})();
</script>
</body>
</html>`);
}

function adminOauthPage(status, heading, intro) {
  return adminPage({
    status,
    title: "GitHub — Admin GEM Casa di l’Isula",
    heading,
    intro,
    extraHeaders: { "set-cookie": stateCookie("", 0) },
    body: `<p><a href="/admin/">Retour à l’espace d’édition</a></p>`,
  });
}

async function githubLogin(accessToken) {
  const res = await globalThis.fetch("https://api.github.com/user", {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${accessToken}`,
      "user-agent": "gem-casa-preview",
      "x-github-api-version": "2022-11-28",
    },
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok || typeof data.login !== "string" || !USERNAME_RE.test(data.login)) return "";
  return data.login;
}

async function finishAdminGithubLogin(env, accessToken) {
  const ready = secretsReady(env);
  if (!ready) {
    const page = setupPage();
    page.headers.set("set-cookie", stateCookie("", 0));
    return page;
  }
  let login = "";
  try {
    login = await githubLogin(accessToken);
  } catch {
    login = "";
  }
  if (!login) {
    return adminOauthPage(
      502,
      "Connexion GitHub interrompue",
      "Le compte GitHub n’a pas pu être lu. Recommencez depuis la page de connexion."
    );
  }
  const allowed = allowedGithubLogins(env).some((name) => name.toLowerCase() === login.toLowerCase());
  if (!allowed) {
    return adminOauthPage(403, "Connexion GitHub refusée", "Ce compte GitHub n’est pas autorisé pour l’éditeur.");
  }
  const session = await createSession(ready.secret, login);
  const headers = new Headers();
  headers.set("location", "/admin/");
  headers.set("cache-control", "no-store");
  headers.append("set-cookie", stateCookie("", 0));
  headers.append("set-cookie", sessionCookie(session));
  return new Response(null, { status: 303, headers });
}

export async function handleGithubOauth(request, env) {
  const url = new URL(request.url);
  const ready = oauthReady(env);

  if (url.pathname === "/api/oauth" || url.pathname === "/api/oauth/") {
    if (!ready) return setupHtml();
    const adminIntent = url.searchParams.get("intent") === "admin";
    const state = `${adminIntent ? "a." : ""}${randomState()}`;
    const redirectUri = `${url.origin}/api/oauth/callback`;
    const authorize = new URL("https://github.com/login/oauth/authorize");
    authorize.searchParams.set("client_id", ready.id);
    authorize.searchParams.set("redirect_uri", redirectUri);
    authorize.searchParams.set("scope", adminIntent ? "read:user" : "repo user");
    authorize.searchParams.set("state", state);
    return new Response(null, {
      status: 302,
      headers: {
        location: authorize.toString(),
        "set-cookie": stateCookie(state, 600),
        "cache-control": "no-store",
      },
    });
  }

  if (url.pathname === "/api/oauth/callback") {
    if (!ready) return setupHtml();
    const code = url.searchParams.get("code") || "";
    const state = url.searchParams.get("state") || "";
    const expected = readCookie(request, STATE_COOKIE);
    const clear = { "set-cookie": stateCookie("", 0) };
    if (!code || !state || !expected || !timingSafeEqual(state, expected)) {
      if (expected.startsWith("a.")) return adminOauthPage(400, "Connexion GitHub interrompue", "Recommencez depuis la page de connexion.");
      return html(
        `<!doctype html><html lang="fr"><meta charset="utf-8"><title>OAuth</title><body><p>La connexion GitHub a été interrompue. Fermez cette fenêtre et recommencez depuis l’éditeur.</p></body></html>`,
        400,
        clear
      );
    }

    const upstream = await globalThis.fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "user-agent": "gem-casa-preview",
      },
      body: JSON.stringify({
        client_id: ready.id,
        client_secret: ready.secret,
        code,
        redirect_uri: `${url.origin}/api/oauth/callback`,
      }),
    });
    let result = {};
    try {
      result = await upstream.json();
    } catch {
      result = {};
    }
    if (!upstream.ok || typeof result.access_token !== "string" || !result.access_token) {
      if (state.startsWith("a.")) {
        return adminOauthPage(502, "Connexion GitHub interrompue", "L’échange avec GitHub a échoué. Recommencez depuis la page de connexion.");
      }
      const description =
        typeof result.error_description === "string" ? result.error_description : "échange refusé";
      return handshakePage(`authorization:github:error:${description}`);
    }
    if (state.startsWith("a.")) return finishAdminGithubLogin(env, result.access_token);
    const payload = JSON.stringify({ token: result.access_token, provider: "github" });
    const page = handshakePage(`authorization:github:success:${payload}`);
    page.headers.set("set-cookie", stateCookie("", 0));
    return page;
  }

  return new Response("Introuvable.", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
