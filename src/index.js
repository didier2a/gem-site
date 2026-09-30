/**
 * GEM Casa preview Worker :
 * assets, POST /api/contact (Resend), porte /admin/, proxy Decap, OAuth GitHub.
 */
import {
  currentUser,
  handleBootstrap,
  handleLogin,
  handleLogout,
  injectAdminShell,
  isAdminPath,
  loginPage,
  setupPage,
} from "./admin-auth.js";
import { handleDecapProxy } from "./decap-proxy.js";
import { handleGithubOauth } from "./github-oauth.js";
const DEFAULT_TO = "infoserv2a@gmail.com";
const FINAL_TO = "gempv@laposte.net"; // destination asso — activer via RESEND_TO
const MAX_LEN = 5000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "cache-control": "no-store",
    },
  });
}

function clean(v, max = 500) {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}

function isEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

async function handleContact(request, env) {
  if (!env.RESEND_API_KEY) {
    return json(
      {
        ok: false,
        error:
          "Formulaire pas encore configuré (clé Resend manquante). Écrivez à infoserv2a@gmail.com.",
      },
      503
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Requête invalide." }, 400);
  }

  // Honeypot
  if (clean(body.website) || clean(body.company)) {
    return json({ ok: true });
  }

  const nom = clean(body.nom, 120);
  const prenom = clean(body.prenom, 120);
  const email = clean(body.email, 200).toLowerCase();
  const tel = clean(body.tel, 40);
  const sujet = clean(body.sujet, 200) || "Message depuis le site GEM";
  const message = clean(body.message, MAX_LEN);
  const consent = Boolean(body.consent);

  if (!nom || !prenom || !email || !message) {
    return json({ ok: false, error: "Merci de remplir les champs obligatoires." }, 400);
  }
  if (!isEmail(email)) {
    return json({ ok: false, error: "Adresse email invalide." }, 400);
  }
  if (!consent) {
    return json({ ok: false, error: "Veuillez accepter d’être recontacté." }, 400);
  }

  const from =
    clean(env.RESEND_FROM, 200) || "GEM Casa di l’Isula <onboarding@resend.dev>";
  const toAddr = clean(env.RESEND_TO, 200) || DEFAULT_TO;

  const text = [
    `Nouveau message via le site GEM Casa di l’Isula`,
    ``,
    `Nom : ${nom}`,
    `Prénom : ${prenom}`,
    `Email : ${email}`,
    `Téléphone : ${tel || "—"}`,
    `Sujet : ${sujet}`,
    ``,
    message,
  ].join("\n");

  const payload = {
    from,
    to: [toAddr],
    reply_to: email,
    subject: `[GEM site] ${sujet}`,
    text,
  };

  const upstream = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  let result = {};
  try {
    result = await upstream.json();
  } catch {
    result = {};
  }

  if (!upstream.ok) {
    // If CC fails on some plans, retry without CC once
    const msg = String(result?.message || result?.error || "");
    if (upstream.status === 403 || /cc|domain|verified|only send/i.test(msg)) {
      const retry = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [toAddr],
          reply_to: email,
          subject: `[GEM site] ${sujet}`,
          text,
        }),
      });
      let retryBody = {};
      try {
        retryBody = await retry.json();
      } catch {}
      if (retry.ok) return json({ ok: true, id: retryBody.id || null });
    }

    return json(
      {
        ok: false,
        error:
          "Envoi impossible pour le moment. Réessayez ou écrivez à infoserv2a@gmail.com.",
      },
      502
    );
  }

  return json({ ok: true, id: result.id || null });
}

function isAdminIndex(pathname) {
  return pathname === "/admin/" || pathname === "/admin/index.html";
}

async function serveAsset(request, env, username) {
  const url = new URL(request.url);
  if (username && (url.pathname === "/admin" || url.pathname === "/admin/index.html")) {
    return Response.redirect(new URL("/admin/", url).toString(), 302);
  }
  const res = await env.ASSETS.fetch(request);
  const headers = new Headers(res.headers);
  const ct = headers.get("content-type") || "";
  if (ct.includes("text/html") || isAdminIndex(url.pathname) || url.pathname === "/admin/config.yml") {
    headers.set("cache-control", "no-store, max-age=0");
  }
  if (username && isAdminIndex(url.pathname) && ct.includes("text/html")) {
    const html = injectAdminShell(await res.text(), username);
    headers.delete("content-length");
    headers.set("content-type", "text/html; charset=utf-8");
    return new Response(html, { status: res.status, headers });
  }
  if (ct.includes("text/html")) {
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

async function route(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;

  if (pathname === "/api/contact") {
    if (request.method === "OPTIONS") return json({ ok: true });
    if (request.method === "POST") return handleContact(request, env);
    return json({ ok: false, error: "Méthode non autorisée." }, 405);
  }

  if (pathname === "/api/admin-login" || pathname === "/admin/login") return handleLogin(request, env);
  if (pathname === "/api/admin-logout" || pathname === "/admin/logout") return handleLogout(request);
  if (pathname === "/api/admin-bootstrap") return handleBootstrap(request, env);
  if (pathname === "/api/oauth" || pathname.startsWith("/api/oauth/")) {
    return handleGithubOauth(request, env);
  }
  if (pathname === "/api/decap-proxy") return handleDecapProxy(request, env);

  if (isAdminPath(pathname)) {
    const access = await currentUser(request, env);
    if (!access.ready) return setupPage();
    if (!access.username) return loginPage();
    return serveAsset(request, env, access.username);
  }

  return serveAsset(request, env, null);
}

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch {
      return new Response("Une erreur interne est survenue.", {
        status: 500,
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
      });
    }
  },
};
