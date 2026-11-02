/**
 * GEM Casa preview Worker :
 * assets, POST /api/contact (Resend), porte /admin/, mot de passe oublié, proxy Decap, historique Git, OAuth GitHub.
 */
import {
  configYamlForRole,
  currentUser,
  handleBootstrap,
  handleLogin,
  handleLogout,
  injectAdminShell,
  isAdminPath,
  loginPage,
  setupPage,
} from "./admin-auth.js";
import { handleForgot, handleForgotPage, handleReset, handleResetPage } from "./admin-reset.js";
import { handleAdminHistory } from "./admin-history.js";
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

/**
 * Un seul intervalle `bytes=start-end`. null = en-tête ignoré (réponse complète).
 * `{ unsatisfiable: true }` = 416.
 */
function parseSingleByteRange(header, size) {
  const spec = header.trim();
  if (!/^bytes=/i.test(spec) || spec.includes(",")) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(spec);
  if (!match) return null;
  const startRaw = match[1];
  const endRaw = match[2];
  if (startRaw === "" && endRaw === "") return null;
  if (size === 0) return { unsatisfiable: true };

  if (startRaw === "") {
    const suffix = Number(endRaw);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    const start = suffix >= size ? 0 : size - suffix;
    return { start, end: size - 1 };
  }

  const start = Number(startRaw);
  if (!Number.isSafeInteger(start) || start < 0) return null;
  if (start >= size) return { unsatisfiable: true };
  let end = endRaw === "" ? size - 1 : Number(endRaw);
  if (!Number.isSafeInteger(end) || end < start) return { unsatisfiable: true };
  if (end >= size) end = size - 1;
  return { start, end };
}

async function readByteRange(body, start, end) {
  const reader = body.getReader();
  const chunks = [];
  let pos = 0;
  try {
    while (pos <= end) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const chunkStart = pos;
      const chunkEnd = pos + value.byteLength;
      pos = chunkEnd;
      if (chunkEnd <= start) continue;
      const from = Math.max(0, start - chunkStart);
      const to = Math.min(value.byteLength, end + 1 - chunkStart);
      chunks.push(value.subarray(from, to));
      if (chunkEnd > end) break;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* le flux est déjà fermé */
    }
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Taille des assets servis sans Content-Length (clé = chemin + etag). */
const assetByteLengths = new Map();

function assetSizeKey(request, res) {
  return `${new URL(request.url).pathname}\n${res.headers.get("etag") || ""}`;
}

async function readWholeBody(body) {
  const reader = body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(value);
      size += value.byteLength;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* le flux est déjà fermé */
    }
  }
  return { size, chunks };
}

function sliceChunks(chunks, start, end) {
  const out = new Uint8Array(end - start + 1);
  let pos = 0;
  let offset = 0;
  for (const chunk of chunks) {
    const chunkEnd = pos + chunk.byteLength;
    if (chunkEnd > start && pos <= end) {
      const from = Math.max(0, start - pos);
      const to = Math.min(chunk.byteLength, end + 1 - pos);
      out.set(chunk.subarray(from, to), offset);
      offset += to - from;
    }
    pos = chunkEnd;
    if (pos > end) break;
  }
  return out;
}

function byteRangeHeaders(res, extra) {
  const headers = new Headers();
  const type = res.headers.get("content-type");
  if (type) headers.set("content-type", type);
  const etag = res.headers.get("etag");
  if (etag) headers.set("etag", etag);
  const cache = res.headers.get("cache-control");
  if (cache) headers.set("cache-control", cache);
  headers.set("accept-ranges", "bytes");
  for (const [name, value] of extra) headers.set(name, value);
  return headers;
}

/**
 * Le Worker est devant les assets. Sans ce découpage, un Range repart en 200
 * avec le fichier entier et le lecteur ne peut pas chercher dans la vidéo.
 * Les assets n’exposent pas toujours Content-Length : on mesure alors le corps.
 */
async function applyByteRange(request, res) {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  if (res.status !== 200 || !res.body) return null;
  const header = request.headers.get("range");
  if (!header) return null;
  const ifRange = request.headers.get("if-range");
  if (ifRange) {
    const etag = res.headers.get("etag");
    if (!etag || ifRange !== etag) return null;
  }

  const rawSize = res.headers.get("content-length");
  let size = rawSize != null && /^\d+$/.test(rawSize) ? Number(rawSize) : undefined;
  let chunks = null;
  if (size === undefined) {
    const key = assetSizeKey(request, res);
    size = assetByteLengths.get(key);
    if (size === undefined) {
      const measured = await readWholeBody(res.body);
      size = measured.size;
      chunks = measured.chunks;
      assetByteLengths.set(key, size);
    }
  }

  const parsed = parseSingleByteRange(header, size);
  if (!parsed) {
    if (chunks) {
      return new Response(await new Blob(chunks).arrayBuffer(), {
        status: 200,
        headers: byteRangeHeaders(res, [["content-length", String(size)]]),
      });
    }
    return null;
  }

  if (parsed.unsatisfiable) {
    if (!chunks) {
      try {
        res.body.cancel();
      } catch {
        /* ignore */
      }
    }
    return new Response(null, {
      status: 416,
      headers: byteRangeHeaders(res, [["content-range", `bytes */${size}`]]),
    });
  }

  const { start, end } = parsed;
  const headers = byteRangeHeaders(res, [
    ["content-range", `bytes ${start}-${end}/${size}`],
    ["content-length", String(end - start + 1)],
  ]);
  if (request.method === "HEAD") {
    if (!chunks) {
      try {
        res.body.cancel();
      } catch {
        /* ignore */
      }
    }
    return new Response(null, { status: 206, headers });
  }
  if (chunks) return new Response(sliceChunks(chunks, start, end), { status: 206, headers });
  if (start === 0 && end === size - 1) return new Response(res.body, { status: 206, headers });
  return new Response(await readByteRange(res.body, start, end), { status: 206, headers });
}

async function serveAsset(request, env, access) {
  const username = access?.username || null;
  const role = access?.role || null;
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
  if (username && url.pathname === "/admin/config.yml") {
    if (!res.ok) {
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    }
    // Les deux rôles reçoivent la config complète (blog et pages).
    const yaml = configYamlForRole(await res.text(), role);
    headers.delete("content-length");
    if (!ct.includes("yaml") && !ct.includes("text/plain")) {
      headers.set("content-type", "text/yaml; charset=utf-8");
    }
    headers.set("cache-control", "no-store, max-age=0");
    return new Response(yaml, { status: res.status, headers });
  }
  if (username && isAdminIndex(url.pathname) && ct.includes("text/html")) {
    const html = injectAdminShell(await res.text(), username, role);
    headers.delete("content-length");
    headers.set("content-type", "text/html; charset=utf-8");
    return new Response(html, { status: res.status, headers });
  }
  if (ct.includes("text/html")) {
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }
  const ranged = await applyByteRange(request, res);
  if (ranged) return ranged;
  headers.set("accept-ranges", "bytes");
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
  if (pathname === "/api/admin-mot-de-passe-oublie") return handleForgot(request, env);
  if (pathname === "/api/admin-nouveau-mot-de-passe") return handleReset(request, env);
  if (pathname === "/admin/mot-de-passe-oublie" || pathname === "/admin/mot-de-passe-oublie/") {
    return request.method === "POST" ? handleForgot(request, env) : handleForgotPage(request, env);
  }
  if (pathname === "/api/oauth" || pathname.startsWith("/api/oauth/")) {
    return handleGithubOauth(request, env);
  }
  if (pathname === "/api/decap-proxy") return handleDecapProxy(request, env);
  if (pathname === "/api/admin-history") return handleAdminHistory(request, env);

  if (isAdminPath(pathname)) {
    const onAdminEntry = pathname === "/admin" || pathname === "/admin/" || pathname === "/admin/index.html";
    const resetToken = onAdminEntry ? (url.searchParams.get("reset") || "").trim() : "";
    // Un jeton de réinitialisation reste sur /admin/ : pas Decap, pas la page de connexion.
    if (resetToken) return handleResetPage(request, env, resetToken);
    const access = await currentUser(request, env);
    if (!access.ready) return setupPage();
    if (!access.username) return loginPage();
    return serveAsset(request, env, access);
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
