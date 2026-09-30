/**
 * Proxy OAuth GitHub pour Decap (backend github).
 * Les animatrices n’empruntent pas ce chemin : elles passent par le
 * mot de passe de la maison puis par /api/decap-proxy.
 * Le secret client ne sort jamais dans le HTML.
 */

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

export async function handleGithubOauth(request, env) {
  const url = new URL(request.url);
  const ready = oauthReady(env);

  if (url.pathname === "/api/oauth" || url.pathname === "/api/oauth/") {
    if (!ready) return setupHtml();
    const state = randomState();
    const redirectUri = `${url.origin}/api/oauth/callback`;
    const authorize = new URL("https://github.com/login/oauth/authorize");
    authorize.searchParams.set("client_id", ready.id);
    authorize.searchParams.set("redirect_uri", redirectUri);
    authorize.searchParams.set("scope", "repo user");
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
    if (!code || !state || !expected || state !== expected) {
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
    if (!upstream.ok || !result.access_token) {
      const description =
        typeof result.error_description === "string" ? result.error_description : "échange refusé";
      return handshakePage(`authorization:github:error:${description}`);
    }
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
