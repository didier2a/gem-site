/**
 * Proxy Decap (backend « proxy »).
 * Le navigateur parle à /api/decap-proxy. Le Worker parle à GitHub
 * avec GITHUB_CONTENT_PAT. Le jeton n’est jamais renvoyé au client.
 *
 * Seuls les dossiers de contenu du site peuvent être lus ou écrits,
 * et seulement sur la branche main.
 * Une session animatrice et une session github_admin (ADMIN_GITHUB_LOGINS)
 * ont le même périmètre : content/blog, content/pages, public/uploads/blog
 * et public/uploads/pages.
 * Le rôle ne réduit pas les chemins. La porte /admin/ reste limitée
 * aux comptes ADMIN_USERS et aux logins ADMIN_GITHUB_LOGINS.
 */

import { currentUser, ROLE_ANIMATRICE, ROLE_GITHUB_ADMIN } from "./admin-auth.js";

const REPO = "didier2a/gem-site";
const BRANCH = "main";
const ROOTS = ["content/blog", "content/pages", "public/uploads/blog", "public/uploads/pages"];
const MAX_TEXT_BYTES = 500_000;
/** 6 Mo de fichier image. Le base64 correspondant pèse 8 Mo : on mesure les octets décodés. */
export const MAX_MEDIA_BYTES = 6_000_000;
export const MAX_MEDIA_BASE64_CHARS = Math.ceil(MAX_MEDIA_BYTES / 3) * 4;
export const MEDIA_TOO_LARGE_ERROR = "Cette image dépasse 6 Mo. Réduisez-la avant de l’envoyer.";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/** Évite JSON.stringify sur plusieurs mégaoctets de base64 (alphabet sans échappement). */
function jsonMediaFile(file) {
  if (!file?.content || file.content.length < 262_144) return json(file);
  const body =
    `{"id":${JSON.stringify(file.id)},"content":"${file.content}","encoding":"base64",` +
    `"path":${JSON.stringify(file.path)},"name":${JSON.stringify(file.name)}}`;
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function fail(error, status) {
  return json({ error }, status);
}

export function normalizeRepoPath(input) {
  let path = String(input ?? "").replace(/\\/g, "/").trim();
  if (path.startsWith("/")) path = path.replace(/^\/+/, "");
  if (!path || path.includes("\0") || path.includes("//") || path.includes("%") || path.includes(":")) {
    return null;
  }
  const parts = path.split("/");
  if (parts.some((part) => part === "" || part === "." || part === ".." || part.startsWith("."))) {
    return null;
  }
  return parts.join("/");
}

export function isAllowedPath(path, { asDirectory = false } = {}) {
  const ok = ROOTS.some((root) => path === root || path.startsWith(`${root}/`));
  if (!ok) return false;
  if (!asDirectory && ROOTS.includes(path)) return false;
  return true;
}

/**
 * Même droit de chemin pour animatrice et super-admin GitHub :
 * tout dossier déjà listé dans ROOTS (fichier ou dossier).
 * Le rôle ne réduit plus au blog.
 */
export function roleMayUsePath(role, path) {
  if (role !== ROLE_ANIMATRICE && role !== ROLE_GITHUB_ADMIN) return false;
  return isAllowedPath(path) || isAllowedPath(path, { asDirectory: true });
}

function encodeRepoPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

/**
 * Réservé au texte (articles, pages) et à une restauration sans base64 déjà connu.
 * Le téléversement d’image ne passe pas par ici : le base64 Decap part tel quel.
 */
function bytesToBase64(bytes) {
  if (typeof bytes.toBase64 === "function") return bytes.toBase64();
  if (!bytes?.length) return "";
  const chunk = 8192;
  let bin = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(bin);
}

function base64ToBytes(value) {
  const clean = stripBase64Whitespace(value);
  if (typeof Uint8Array.fromBase64 === "function") return Uint8Array.fromBase64(clean);
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function stripBase64Whitespace(value) {
  const raw = String(value || "");
  if (!raw.includes("\n") && !raw.includes("\r") && !raw.includes(" ") && !raw.includes("\t")) return raw;
  return raw.replace(/\s/g, "");
}

function mediaTooLarge() {
  const error = new Error(MEDIA_TOO_LARGE_ERROR);
  error.status = 413;
  error.code = "PATH";
  return error;
}

/** Charge utile base64, sans préfixe data-URL ni blancs (retours à la ligne GitHub compris). */
export function mediaPayload(content) {
  let raw = String(content ?? "").trim();
  const prefix = raw.match(/^data:[^,]*,/i);
  if (prefix) raw = raw.slice(prefix[0].length);
  return stripBase64Whitespace(raw);
}

function mediaUnreadable() {
  const error = new Error("Image illisible. Choisissez un fichier image (JPG, PNG ou WebP).");
  error.status = 400;
  error.code = "PATH";
  return error;
}

/**
 * Poids décodé, à partir de la longueur et du padding, sans allouer les octets.
 * 6 Mo pile = 8 000 000 caractères base64 (6000000 est divisible par 3).
 */
export function decodedBase64Size(payload) {
  const clean = String(payload || "");
  if (!clean) return 0;
  if (clean.length % 4 !== 0) throw mediaUnreadable();
  let pad = 0;
  if (clean.charCodeAt(clean.length - 1) === 61) {
    pad = clean.charCodeAt(clean.length - 2) === 61 ? 2 : 1;
  }
  // Un scan complet de 8 Mo dépasse le budget CPU du plan gratuit.
  // Au-delà, la longueur et le padding suffisent ; GitHub refuse un alphabet invalide.
  if (clean.length <= 262_144 && !/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) throw mediaUnreadable();
  return (clean.length / 4) * 3 - pad;
}

/**
 * Base64 prêt pour l’API GitHub, ou chaîne vide si l’image est vide.
 * Ne décode pas le fichier.
 */
export function assertMediaBase64(content) {
  const payload = mediaPayload(content);
  if (!payload) return "";
  if (payload.length > MAX_MEDIA_BASE64_CHARS) throw mediaTooLarge();
  if (decodedBase64Size(payload) > MAX_MEDIA_BYTES) throw mediaTooLarge();
  return payload;
}

/**
 * Préfixe reconnu par /admin/ : Decap exige un content base64 dans getMedia,
 * mais la vignette doit être l’URL publique, pas le fichier téléchargé.
 */
export const MEDIA_URL_MARKER = "GEMMEDIA1";

export function publicUrlForRepoPath(path) {
  if (path.startsWith("public/uploads/blog/") || path.startsWith("public/uploads/pages/")) {
    return `/${path.slice("public/".length)}`;
  }
  return "";
}

export function encodeMediaPointer(url) {
  const text = MEDIA_URL_MARKER + url;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 255) return bytesToBase64(new TextEncoder().encode(text));
  }
  return btoa(text);
}

/**
 * Decap, pour une collection « files » ou un article, colle un media_folder
 * sans slash initial au dossier du fichier (`content/pages/` + `public/uploads/pages/`).
 * On ramène ce chemin vers public/uploads/blog ou public/uploads/pages.
 */
export function canonicalMediaRepoPath(input) {
  const path = normalizeRepoPath(input);
  if (!path) return null;
  const match = path.match(/^(?:content\/(?:blog|pages)\/)+public\/uploads\/(blog|pages)(?:\/(.*))?$/);
  if (!match) return path;
  return match[2] ? `public/uploads/${match[1]}/${match[2]}` : `public/uploads/${match[1]}`;
}

function utf8ToBase64(text) {
  return bytesToBase64(new TextEncoder().encode(text));
}

export function scrubSecrets(message, env) {
  let out = String(message ?? "");
  const secrets = [
    env?.GITHUB_CONTENT_PAT,
    env?.GITHUB_OAUTH_CLIENT_SECRET,
    env?.ADMIN_SESSION_SECRET,
    env?.ADMIN_BOOTSTRAP_TOKEN,
    env?.RESEND_API_KEY,
  ];
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length >= 6) out = out.split(secret).join("[secret]");
  }
  return out
    .replace(/github_pat_[A-Za-z0-9_]+/g, "[secret]")
    .replace(/\bghp_[A-Za-z0-9]+\b/g, "[secret]");
}

function redact(message, env) {
  return scrubSecrets(message || "GitHub a refusé l’opération.", env).slice(0, 400);
}

function blobRequestBody(base64) {
  return `{"content":"${base64}","encoding":"base64"}`;
}

async function gh(env, apiPath, { method = "GET", body, rawBody } = {}) {
  const token = typeof env.GITHUB_CONTENT_PAT === "string" ? env.GITHUB_CONTENT_PAT.trim() : "";
  if (!token) {
    const error = new Error("PAT_MISSING");
    error.code = "PAT_MISSING";
    throw error;
  }
  const payload = rawBody ?? (body ? JSON.stringify(body) : undefined);
  const response = await globalThis.fetch(`https://api.github.com${apiPath}`, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "user-agent": "gem-casa-preview",
      "x-github-api-version": "2022-11-28",
      ...(payload ? { "content-type": "application/json" } : {}),
    },
    body: payload,
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text.slice(0, 180) };
    }
  }
  if (!response.ok) {
    const error = new Error(redact(data?.message || `GitHub ${response.status}`, env));
    error.status = response.status;
    error.code = "GITHUB";
    throw error;
  }
  return data;
}

async function ghAllow404(env, apiPath) {
  try {
    return await gh(env, apiPath);
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

function logProxyError(action, error, env) {
  const message = redact(error?.message || "Erreur du proxy.", env).slice(0, 180);
  console.error(
    JSON.stringify({
      source: "decap-proxy",
      action: String(action || "").slice(0, 40),
      status: error?.status || 502,
      code: String(error?.code || "").slice(0, 20),
      error: message,
    })
  );
}

function requireBranch(body) {
  const branch = body?.params?.branch || body?.branch || BRANCH;
  if (branch !== BRANCH) {
    const error = new Error("Seule la branche main peut être modifiée depuis cet éditeur.");
    error.status = 422;
    error.code = "BRANCH";
    throw error;
  }
  return branch;
}

function refusePath(message) {
  const error = new Error(message);
  error.status = 403;
  error.code = "PATH";
  throw error;
}

function requireFilePath(input, role) {
  const path = normalizeRepoPath(input);
  if (!path || !isAllowedPath(path) || !roleMayUsePath(role, path)) {
    refusePath("Ce chemin n’est pas modifiable depuis l’éditeur.");
  }
  return path;
}

function requireDirPath(input, role) {
  const path = normalizeRepoPath(input);
  if (!path || !isAllowedPath(path, { asDirectory: true }) || !roleMayUsePath(role, path)) {
    refusePath("Ce dossier n’est pas accessible depuis l’éditeur.");
  }
  return path;
}

async function readGithubFile(env, path, branch) {
  const data = await ghAllow404(
    env,
    `/repos/${REPO}/contents/${encodeRepoPath(path)}?ref=${encodeURIComponent(branch)}`
  );
  if (!data || Array.isArray(data) || data.type !== "file" || !data.content) return null;
  const bytes = base64ToBytes(data.content);
  return { bytes, sha: data.sha, path };
}

async function entryFromPath(env, path, branch, label) {
  const file = await readGithubFile(env, path, branch);
  if (!file) {
    return { data: null, file: { path, label: label || null, id: null } };
  }
  return {
    data: new TextDecoder().decode(file.bytes),
    file: { path, label: label || null, id: file.sha },
  };
}

async function entriesByFolder(env, params, branch, role) {
  const folder = requireDirPath(params.folder, role);
  const extension = String(params.extension || "").replace(/^\./, "");
  const depth = Number(params.depth || 1);
  const listing = await ghAllow404(
    env,
    `/repos/${REPO}/contents/${encodeRepoPath(folder)}?ref=${encodeURIComponent(branch)}`
  );
  if (!listing) return [];
  const items = Array.isArray(listing) ? listing : [];
  const files = [];
  for (const item of items) {
    if (!item || item.type !== "file") continue;
    if (extension && !String(item.name).endsWith(`.${extension}`)) continue;
    const path = normalizeRepoPath(item.path);
    if (path && isAllowedPath(path) && roleMayUsePath(role, path)) files.push(path);
  }
  if (depth > 1) {
    const tree = await ghAllow404(
      env,
      `/repos/${REPO}/git/trees/${encodeURIComponent(`${branch}:${folder}`)}?recursive=1`
    );
    if (tree?.tree) {
      for (const item of tree.tree) {
        if (item.type !== "blob") continue;
        const path = normalizeRepoPath(`${folder}/${item.path}`);
        if (!path || !isAllowedPath(path) || !roleMayUsePath(role, path)) continue;
        const name = path.split("/").pop();
        if (extension && !name.endsWith(`.${extension}`)) continue;
        if (!files.includes(path)) files.push(path);
      }
    }
  }
  const entries = [];
  for (const path of files) entries.push(await entryFromPath(env, path, branch));
  return entries;
}

function mediaFileResponse(path, sha, base64) {
  return {
    id: sha,
    content: base64,
    encoding: "base64",
    path,
    name: path.split("/").pop(),
  };
}

function listingEntry(item) {
  const path = normalizeRepoPath(item.path);
  if (!path || !isAllowedPath(path)) return null;
  const url = publicUrlForRepoPath(path);
  if (!url) return null;
  return {
    id: String(item.sha || ""),
    name: String(item.name || path.split("/").pop()),
    path,
    size: Number(item.size) || 0,
    url,
    displayURL: url,
    encoding: "base64",
    content: encodeMediaPointer(url),
  };
}

async function loadGithubBase64(env, path, ref, maxBytes) {
  let data = null;
  let blocked = false;
  try {
    data = await gh(
      env,
      `/repos/${REPO}/contents/${encodeRepoPath(path)}?ref=${encodeURIComponent(ref)}`
    );
  } catch (error) {
    if (error.status === 404) return { status: "missing" };
    if (error.status !== 403) throw error;
    blocked = true;
  }
  if (data && (Array.isArray(data) || data.type !== "file")) return { status: "missing" };
  let sha = data?.sha || "";
  let size = Number(data?.size);
  let base64 = "";
  if (data?.content && data.encoding !== "none") base64 = stripBase64Whitespace(data.content);
  if (Number.isFinite(size) && size > maxBytes) {
    return { status: "ok", base64: "", sha, byteLength: size };
  }
  if (!base64) {
    if (!sha) {
      const dir = path.split("/").slice(0, -1).join("/");
      const name = path.split("/").pop();
      const listing = await ghAllow404(
        env,
        `/repos/${REPO}/contents/${encodeRepoPath(dir)}?ref=${encodeURIComponent(ref)}`
      );
      const item = Array.isArray(listing)
        ? listing.find((entry) => entry && entry.type === "file" && entry.name === name)
        : null;
      if (!item?.sha) return { status: blocked ? "unavailable" : "missing" };
      sha = item.sha;
      size = Number(item.size);
      if (Number.isFinite(size) && size > maxBytes) {
        return { status: "ok", base64: "", sha, byteLength: size };
      }
    }
    const blob = await ghAllow404(env, `/repos/${REPO}/git/blobs/${encodeURIComponent(sha)}`);
    base64 = blob?.content ? stripBase64Whitespace(blob.content) : "";
  }
  if (!base64) return { status: "unavailable", sha, byteLength: Number.isFinite(size) ? size : 0 };
  let byteLength;
  try {
    byteLength = decodedBase64Size(base64);
  } catch {
    return { status: "unavailable", sha, byteLength: 0 };
  }
  return { status: "ok", base64, sha, byteLength };
}

async function mediaFromPath(env, path, branch) {
  const file = await loadGithubBase64(env, path, branch, MAX_MEDIA_BYTES);
  if (file.status === "ok" && file.byteLength > MAX_MEDIA_BYTES) throw mediaTooLarge();
  if (file.status !== "ok" || !file.base64) {
    const error = new Error(file.status === "unavailable" ? "GitHub n’a pas renvoyé ce fichier." : "Fichier introuvable.");
    error.status = file.status === "unavailable" ? 422 : 404;
    error.code = "PATH";
    throw error;
  }
  return mediaFileResponse(path, file.sha, file.base64);
}

async function listMedia(env, params, branch, role) {
  const folder = requireDirPath(canonicalMediaRepoPath(params.mediaFolder), role);
  const listing = await ghAllow404(
    env,
    `/repos/${REPO}/contents/${encodeRepoPath(folder)}?ref=${encodeURIComponent(branch)}`
  );
  if (!Array.isArray(listing)) return [];
  const files = [];
  for (const item of listing) {
    if (!item || item.type !== "file") continue;
    const entry = listingEntry(item);
    if (!entry || !roleMayUsePath(role, entry.path)) continue;
    files.push(entry);
  }
  return files;
}

async function createBlob(env, base64) {
  const blob = await gh(env, `/repos/${REPO}/git/blobs`, {
    method: "POST",
    rawBody: blobRequestBody(base64),
  });
  if (!blob?.sha) {
    const error = new Error("GitHub n’a pas renvoyé l’empreinte du fichier.");
    error.status = 502;
    error.code = "GITHUB";
    throw error;
  }
  return blob.sha;
}

async function commitChanges(env, { message, username, files, deletions }) {
  const ref = await gh(env, `/repos/${REPO}/git/ref/heads/${BRANCH}`);
  const parentSha = ref?.object?.sha;
  if (!parentSha) {
    const error = new Error("Branche main introuvable sur le dépôt.");
    error.status = 422;
    error.code = "GITHUB";
    throw error;
  }
  const parent = await gh(env, `/repos/${REPO}/git/commits/${parentSha}`);
  const baseTree = parent?.tree?.sha;
  const tree = [];
  const blobs = [];
  for (const file of files) {
    const sha = await createBlob(env, file.base64);
    blobs.push({ path: file.path, sha });
    tree.push({ path: file.path, mode: "100644", type: "blob", sha });
  }
  for (const path of deletions) {
    tree.push({ path, mode: "100644", type: "blob", sha: null });
  }
  const nextTree = await gh(env, `/repos/${REPO}/git/trees`, {
    method: "POST",
    body: { base_tree: baseTree, tree },
  });
  const author = {
    name: username,
    email: `${username}@users.noreply.gem-casa.local`,
    date: new Date().toISOString(),
  };
  let commit;
  try {
    commit = await gh(env, `/repos/${REPO}/git/commits`, {
      method: "POST",
      body: { message, tree: nextTree.sha, parents: [parentSha], author, committer: author },
    });
  } catch {
    commit = await gh(env, `/repos/${REPO}/git/commits`, {
      method: "POST",
      body: { message, tree: nextTree.sha, parents: [parentSha] },
    });
  }
  try {
    await gh(env, `/repos/${REPO}/git/refs/heads/${BRANCH}`, {
      method: "PATCH",
      body: { sha: commit.sha, force: false },
    });
  } catch (error) {
    if (error.status === 422) {
      const refused = new Error(
        "La branche main a changé pendant l’enregistrement. Rechargez l’éditeur et réessayez."
      );
      refused.status = 409;
      refused.code = "GITHUB";
      throw refused;
    }
    throw error;
  }
  return { sha: commit.sha, blobs };
}

function commitMessage(username, raw) {
  const clean = String(raw || "Mise à jour depuis l’admin GEM")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 350);
  return `[${username}] ${clean || "Mise à jour depuis l’admin GEM"}`;
}

async function persistEntry(env, params, username, role) {
  if (params?.options?.useWorkflow) {
    const error = new Error(
      "L’enregistrement ouvre un commit direct sur main. Le mode brouillon avec pull request n’est pas activé pour ce jeton (droits Contents seulement)."
    );
    error.status = 422;
    error.code = "WORKFLOW";
    throw error;
  }
  const files = [];
  const deletions = [];
  const dataFiles = Array.isArray(params.dataFiles) ? params.dataFiles : [];
  for (const file of dataFiles) {
    const path = requireFilePath(file.newPath || file.path, role);
    const raw = typeof file.raw === "string" ? file.raw : typeof file.content === "string" ? file.content : "";
    const bytes = new TextEncoder().encode(raw);
    if (bytes.length > MAX_TEXT_BYTES) {
      const error = new Error("Texte trop long pour un enregistrement.");
      error.status = 413;
      error.code = "PATH";
      throw error;
    }
    files.push({ path, base64: bytesToBase64(bytes) });
    if (file.newPath && file.path && file.newPath !== file.path) {
      deletions.push(requireFilePath(file.path, role));
    }
  }
  const assets = Array.isArray(params.assets) ? params.assets : [];
  for (const asset of assets) {
    const path = requireFilePath(canonicalMediaRepoPath(asset.path), role);
    const base64 = assertMediaBase64(asset.content || "");
    if (!base64) {
      const error = new Error("Image vide.");
      error.status = 413;
      error.code = "PATH";
      throw error;
    }
    files.push({ path, base64 });
  }
  if (!files.length && !deletions.length) return { message: "Rien à enregistrer." };
  await commitChanges(env, {
    message: commitMessage(username, params.options?.commitMessage),
    username,
    files,
    deletions,
  });
  return { message: "Contenu enregistré." };
}

async function persistMedia(env, params, username, role) {
  const asset = params.asset || {};
  const path = requireFilePath(canonicalMediaRepoPath(asset.path), role);
  const base64 = assertMediaBase64(asset.content || "");
  if (!base64) {
    const error = new Error("Image vide.");
    error.status = 413;
    error.code = "PATH";
    throw error;
  }
  const committed = await commitChanges(env, {
    message: commitMessage(username, params.options?.commitMessage || "Ajout d’un média"),
    username,
    files: [{ path, base64 }],
    deletions: [],
  });
  const sha = committed.blobs.find((blob) => blob.path === path)?.sha || "";
  if (!sha) {
    const error = new Error("GitHub n’a pas renvoyé l’empreinte du fichier.");
    error.status = 502;
    error.code = "GITHUB";
    throw error;
  }
  return mediaFileResponse(path, sha, base64);
}

async function deleteFiles(env, params, username, role) {
  const paths = Array.isArray(params.paths) ? params.paths : [];
  const deletions = paths.map((path) => requireFilePath(path, role));
  if (!deletions.length) return { message: "Rien à supprimer." };
  await commitChanges(env, {
    message: commitMessage(username, params.options?.commitMessage || "Suppression"),
    username,
    files: [],
    deletions,
  });
  return { message: "Fichiers supprimés." };
}

export function patMissingResponse() {
  return fail(
    "Le jeton GitHub du serveur (GITHUB_CONTENT_PAT) n’est pas configuré sur le Worker gem-casa-preview. L’éditeur ne peut pas lire ni enregistrer pour le moment. Didier doit créer un jeton fin (Contents, lecture et écriture, dépôt didier2a/gem-site seulement) puis lancer wrangler secret put GITHUB_CONTENT_PAT.",
    503
  );
}

/** Même dossiers que le proxy. L’appelant doit déjà avoir vérifié le rôle github_admin. */
export function requireHistoryFilePath(input) {
  return requireFilePath(input, ROLE_GITHUB_ADMIN);
}

export function historyByteLimit(path) {
  return String(path).startsWith("public/uploads/") ? MAX_MEDIA_BYTES : MAX_TEXT_BYTES;
}

export function describeGithubError(error, env) {
  if (error?.code === "PAT_MISSING") return { patMissing: true, status: 503, message: "" };
  return {
    patMissing: false,
    status: error?.status || 502,
    message: redact(error?.message || "GitHub a refusé l’opération.", env),
  };
}

export async function listHistoryCommits(env, path) {
  const data = await gh(
    env,
    `/repos/${REPO}/commits?path=${encodeURIComponent(path)}&sha=${encodeURIComponent(BRANCH)}&per_page=30`
  );
  return Array.isArray(data) ? data : [];
}

export async function readHistoryFile(env, path, ref) {
  const max = historyByteLimit(path);
  const loaded = await loadGithubBase64(env, path, ref, max);
  if (loaded.status !== "ok") return { status: loaded.status, bytes: null, base64: "", byteLength: 0 };
  const media = String(path).startsWith("public/uploads/");
  if (media || !loaded.base64) {
    return { status: "ok", bytes: null, base64: loaded.base64, byteLength: loaded.byteLength };
  }
  return {
    status: "ok",
    bytes: base64ToBytes(loaded.base64),
    base64: loaded.base64,
    byteLength: loaded.byteLength,
  };
}

export async function readHistoryCommit(env, sha) {
  return gh(env, `/repos/${REPO}/commits/${sha}`);
}

export async function restoreHistoryFile(env, { path, bytes, base64, message, username }) {
  const max = historyByteLimit(path);
  let payload = typeof base64 === "string" ? stripBase64Whitespace(base64) : "";
  let size = -1;
  if (payload) {
    try {
      size = decodedBase64Size(payload);
    } catch {
      payload = "";
    }
  }
  if (!payload && bytes instanceof Uint8Array) {
    size = bytes.length;
    payload = bytesToBase64(bytes);
  }
  if (!payload || size < 0 || size > max) {
    const error = new Error("Fichier trop long pour une restauration.");
    error.status = 413;
    error.code = "PATH";
    throw error;
  }
  const committed = await commitChanges(env, {
    message: commitMessage(username, message),
    username,
    files: [{ path, base64: payload }],
    deletions: [],
  });
  return committed.sha;
}

export async function handleDecapProxy(request, env) {
  if (request.method !== "POST") {
    return fail("Méthode non autorisée.", 405);
  }
  const access = await currentUser(request, env);
  if (!access.ready) {
    return fail(
      "L’éditeur n’est pas ouvert : ADMIN_SESSION_SECRET ou ADMIN_USERS manque sur le Worker.",
      503
    );
  }
  if (!access.username) return fail("Connexion requise pour ouvrir l’éditeur.", 401);
  const role = access.role === ROLE_GITHUB_ADMIN ? ROLE_GITHUB_ADMIN : ROLE_ANIMATRICE;

  let body;
  try {
    body = await request.json();
  } catch {
    return fail("Requête invalide.", 400);
  }

  const pat = typeof env.GITHUB_CONTENT_PAT === "string" ? env.GITHUB_CONTENT_PAT.trim() : "";
  if (!pat) return patMissingResponse();

  try {
    const branch = requireBranch(body);
    const params = body.params || {};
    switch (body.action) {
      case "info":
        return json({ repo: REPO, publish_modes: ["simple"], type: "github_pat" });
      case "entriesByFolder":
        return json(await entriesByFolder(env, params, branch, role));
      case "entriesByFiles": {
        const files = Array.isArray(params.files) ? params.files : [];
        const normalized = files.map((file) => ({
          path: requireFilePath(file.path, role),
          label: file.label,
        }));
        const entries = [];
        for (const file of normalized) {
          entries.push(await entryFromPath(env, file.path, branch, file.label));
        }
        return json(entries);
      }
      case "getEntry":
        return json(await entryFromPath(env, requireFilePath(params.path, role), branch));
      case "getMedia":
        return json(await listMedia(env, params, branch, role));
      case "getMediaFile":
        return jsonMediaFile(await mediaFromPath(env, requireFilePath(canonicalMediaRepoPath(params.path), role), branch));
      case "persistEntry":
        return json(await persistEntry(env, params, access.username, role));
      case "persistMedia":
        return jsonMediaFile(await persistMedia(env, params, access.username, role));
      case "deleteFiles":
      case "deleteFile": {
        const paths = body.action === "deleteFile" ? [params.path] : params.paths;
        return json(await deleteFiles(env, { ...params, paths }, access.username, role));
      }
      case "unpublishedEntries":
        return json([]);
      case "getNotes":
        return json({ notes: [] });
      case "getDeployPreview":
        return json(null);
      case "unpublishedEntry":
        return fail("Pas de brouillon en attente : l’enregistrement va directement sur main.", 404);
      default:
        return fail("Action inconnue pour l’éditeur.", 422);
    }
  } catch (error) {
    if (error?.code === "PAT_MISSING") return patMissingResponse();
    logProxyError(body?.action, error, env);
    const status = error.status || 502;
    return fail(redact(error.message, env), status);
  }
}
