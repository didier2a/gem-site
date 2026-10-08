/**
 * Historique Git d’un fichier de contenu, réservé au super-admin.
 *
 * Decap en mode simple n’expose pas les commits. La sauvegarde locale du
 * navigateur ne couvre que le brouillon non publié. Ici, la source est
 * l’historique du fichier sur main. Restaurer réécrit ce fichier par un
 * nouveau commit (pas de force-push, pas de pull request).
 */

import { currentUser, ROLE_GITHUB_ADMIN } from "./admin-auth.js";
import {
  describeGithubError,
  historyByteLimit,
  listHistoryCommits,
  patMissingResponse,
  readHistoryCommit,
  readHistoryFile,
  requireHistoryFilePath,
  restoreHistoryFile,
  scrubSecrets,
} from "./decap-proxy.js";

const SHA_RE = /^[0-9a-f]{40}$/;
const HISTORY_LIMIT = 30;
const PREVIEW_CHARS = 80_000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function fail(error, status) {
  return json({ error }, status);
}

function sameBytes(a, b) {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function publicAuthor(item) {
  const name = String(item?.commit?.author?.name || "").trim();
  const login = String(item?.author?.login || item?.committer?.login || "").trim();
  const safeName = name && !name.includes("@") ? name : "";
  const safeLogin = login && !login.includes("@") ? login : "";
  if (safeName && safeLogin && safeName !== safeLogin) return `${safeName} (${safeLogin})`;
  return (safeName || safeLogin || "Auteur inconnu").slice(0, 80);
}

function publicMessage(item) {
  const line = String(item?.commit?.message || "").split(/\r?\n/, 1)[0];
  const clean = line.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  return clean.slice(0, 240) || "(sans message)";
}

export function summarizeHistoryCommits(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    const sha = String(item?.sha || "").toLowerCase();
    if (!SHA_RE.test(sha)) continue;
    const iso = String(item?.commit?.author?.date || item?.commit?.committer?.date || "");
    const parsed = Date.parse(iso);
    out.push({
      sha,
      message: publicMessage(item),
      author: publicAuthor(item),
      date: Number.isNaN(parsed) ? null : new Date(parsed).toISOString(),
    });
  }
  // L’API GitHub renvoie déjà les commits du plus récent au plus ancien sur main.
  // On ne retrie pas par date d’auteur : un auteur antidaté ne doit pas passer devant la version actuelle.
  return out.slice(0, HISTORY_LIMIT);
}

export function previewHistoryText(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.includes(0)) {
    return { binary: true, content: "", truncated: false };
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { binary: true, content: "", truncated: false };
  }
  if (text.length > PREVIEW_CHARS) {
    return { binary: false, content: text.slice(0, PREVIEW_CHARS), truncated: true };
  }
  return { binary: false, content: text, truncated: false };
}

export function buildRestoreCommitMessage(path, sha, dateIso) {
  const short = String(sha || "").slice(0, 7);
  let when = "";
  const parsed = Date.parse(dateIso || "");
  if (dateIso && !Number.isNaN(parsed)) when = ` du ${new Date(parsed).toISOString().slice(0, 10)}`;
  return `Restauration de ${path} — retour à la version ${short}${when}`;
}

function requireSha(value) {
  const sha = String(value ?? "").trim().toLowerCase();
  if (!SHA_RE.test(sha)) {
    const error = new Error("Identifiant de version illisible.");
    error.status = 400;
    throw error;
  }
  return sha;
}

function sanitizeCommits(raw, env) {
  return summarizeHistoryCommits(raw).map((item) => ({
    sha: item.sha,
    date: item.date,
    author: scrubSecrets(item.author, env).slice(0, 120),
    message: scrubSecrets(item.message, env).slice(0, 240),
  }));
}

function sameHistoryFile(a, b) {
  if (typeof a?.base64 === "string" && a.base64 && typeof b?.base64 === "string" && b.base64) {
    return a.base64 === b.base64;
  }
  return sameBytes(a?.bytes, b?.bytes);
}

async function readVersion(env, path, sha, restoring = false) {
  const untouched = restoring ? " Rien n’a été modifié sur main." : "";
  const file = await readHistoryFile(env, path, sha);
  if (file.status === "missing") {
    const error = new Error(`Cette version ne contient pas ce fichier.${untouched}`);
    error.status = 404;
    throw error;
  }
  const size = Number.isFinite(file.byteLength) ? file.byteLength : file.bytes?.length;
  if (file.status !== "ok" || !Number.isFinite(size)) {
    const error = new Error(`GitHub n’a pas renvoyé le contenu de cette version.${untouched}`);
    error.status = 422;
    throw error;
  }
  if (size > historyByteLimit(path)) {
    const error = new Error(
      restoring
        ? "Fichier trop long pour une restauration. Rien n’a été modifié sur main."
        : "Fichier trop long pour un aperçu."
    );
    error.status = 413;
    throw error;
  }
  if (!file.base64 && !(file.bytes instanceof Uint8Array)) {
    const error = new Error(`GitHub n’a pas renvoyé le contenu de cette version.${untouched}`);
    error.status = 422;
    throw error;
  }
  return file;
}

async function restoreAction(env, path, sha, username) {
  const file = await readVersion(env, path, sha, true);
  const current = await readHistoryFile(env, path, "main");
  if (current.status === "ok" && sameHistoryFile(current, file)) {
    return {
      restored: false,
      unchanged: true,
      path,
      sha,
      message: "Cette version est déjà celle de main. Aucun commit n’a été créé.",
    };
  }
  let dateIso = "";
  try {
    const commit = await readHistoryCommit(env, sha);
    dateIso = commit?.commit?.author?.date || commit?.commit?.committer?.date || "";
  } catch (error) {
    if (error?.status === 404) {
      const missing = new Error("Version introuvable. Rien n’a été modifié sur main.");
      missing.status = 404;
      throw missing;
    }
    throw error;
  }
  const commitSha = await restoreHistoryFile(env, {
    path,
    bytes: file.bytes instanceof Uint8Array ? file.bytes : undefined,
    base64: file.base64 || "",
    message: buildRestoreCommitMessage(path, sha, dateIso),
    username,
  });
  return {
    restored: true,
    unchanged: false,
    path,
    sha,
    commit: commitSha,
    message: "Version restaurée sur main.",
  };
}

export async function handleAdminHistory(request, env) {
  if (request.method !== "POST") return fail("Méthode non autorisée.", 405);
  const access = await currentUser(request, env);
  if (!access.ready) {
    return fail(
      "L’éditeur n’est pas ouvert : ADMIN_SESSION_SECRET ou ADMIN_USERS manque sur le Worker.",
      503
    );
  }
  if (!access.username) return fail("Connexion requise pour ouvrir l’historique.", 401);
  if (access.role !== ROLE_GITHUB_ADMIN) {
    return fail("L’historique des versions est réservé au super-admin GitHub.", 403);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return fail("Requête invalide.", 400);
  }

  const pat = typeof env.GITHUB_CONTENT_PAT === "string" ? env.GITHUB_CONTENT_PAT.trim() : "";
  if (!pat) return patMissingResponse();

  try {
    const path = requireHistoryFilePath(body?.path);
    if (body?.action === "list") {
      const commits = sanitizeCommits(await listHistoryCommits(env, path), env);
      return json({ path, commits });
    }
    if (body?.action === "read") {
      const sha = requireSha(body?.sha);
      const file = await readVersion(env, path, sha);
      if (!(file.bytes instanceof Uint8Array)) {
        return json({ path, sha, binary: true, truncated: false, content: "" });
      }
      const preview = previewHistoryText(file.bytes);
      return json({
        path,
        sha,
        binary: preview.binary,
        truncated: preview.truncated,
        content: preview.binary ? "" : scrubSecrets(preview.content, env),
      });
    }
    if (body?.action === "restore") {
      return json(await restoreAction(env, path, requireSha(body?.sha), access.username));
    }
    return fail("Action inconnue pour l’historique.", 422);
  } catch (error) {
    const described = describeGithubError(error, env);
    if (described.patMissing) return patMissingResponse();
    return fail(described.message, error?.status || described.status || 502);
  }
}
