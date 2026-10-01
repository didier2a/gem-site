/**
 * Proxy Decap (backend « proxy »).
 * Le navigateur parle à /api/decap-proxy. Le Worker parle à GitHub
 * avec GITHUB_CONTENT_PAT. Le jeton n’est jamais renvoyé au client.
 *
 * Seuls les dossiers de contenu du site peuvent être lus ou écrits,
 * et seulement sur la branche main.
 * Une session animatrice ne voit et n’écrit que le blog
 * (content/blog et les images public/uploads/blog).
 * Une session github_admin (ADMIN_GITHUB_LOGINS) garde les pages.
 */

import { currentUser, PAGES_DENIED_MESSAGE, ROLE_ANIMATRICE, ROLE_GITHUB_ADMIN } from "./admin-auth.js";

const REPO = "didier2a/gem-site";
const BRANCH = "main";
const ROOTS = ["content/blog", "content/pages", "public/uploads/blog"];
const BLOG_ROOTS = ["content/blog", "public/uploads/blog"];
const MAX_TEXT_BYTES = 500_000;
const MAX_MEDIA_BYTES = 1_500_000;

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

export function isBlogPath(path) {
  return BLOG_ROOTS.some((root) => path === root || path.startsWith(`${root}/`));
}

/** Le super-admin GitHub utilise tous les dossiers autorisés. L’animatrice, le blog seulement. */
export function roleMayUsePath(role, path) {
  if (role === ROLE_GITHUB_ADMIN) return true;
  return isBlogPath(path);
}

function encodeRepoPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function bytesToBase64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBytes(value) {
  const clean = String(value || "").replace(/\s/g, "");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function utf8ToBase64(text) {
  return bytesToBase64(new TextEncoder().encode(text));
}

function redact(message, env) {
  let out = String(message || "GitHub a refusé l’opération.");
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
    .replace(/\bghp_[A-Za-z0-9]+\b/g, "[secret]")
    .slice(0, 400);
}

async function gh(env, apiPath, { method = "GET", body } = {}) {
  const token = typeof env.GITHUB_CONTENT_PAT === "string" ? env.GITHUB_CONTENT_PAT.trim() : "";
  if (!token) {
    const error = new Error("PAT_MISSING");
    error.code = "PAT_MISSING";
    throw error;
  }
  const response = await globalThis.fetch(`https://api.github.com${apiPath}`, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "user-agent": "gem-casa-preview",
      "x-github-api-version": "2022-11-28",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
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
  if (!path || !isAllowedPath(path)) {
    refusePath("Ce chemin n’est pas modifiable depuis l’éditeur.");
  }
  if (!roleMayUsePath(role, path)) refusePath(PAGES_DENIED_MESSAGE);
  return path;
}

function requireDirPath(input, role) {
  const path = normalizeRepoPath(input);
  if (!path || !isAllowedPath(path, { asDirectory: true })) {
    refusePath("Ce dossier n’est pas accessible depuis l’éditeur.");
  }
  if (!roleMayUsePath(role, path)) refusePath(PAGES_DENIED_MESSAGE);
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

async function mediaFromPath(env, path, branch) {
  const file = await readGithubFile(env, path, branch);
  if (!file) {
    const error = new Error("Fichier introuvable.");
    error.status = 404;
    error.code = "PATH";
    throw error;
  }
  if (file.bytes.length > MAX_MEDIA_BYTES) {
    const error = new Error("Fichier trop lourd pour l’éditeur.");
    error.status = 413;
    error.code = "PATH";
    throw error;
  }
  return {
    id: file.sha,
    content: bytesToBase64(file.bytes),
    encoding: "base64",
    path,
    name: path.split("/").pop(),
  };
}

async function listMedia(env, params, branch, role) {
  const folder = requireDirPath(params.mediaFolder, role);
  const listing = await ghAllow404(
    env,
    `/repos/${REPO}/contents/${encodeRepoPath(folder)}?ref=${encodeURIComponent(branch)}`
  );
  if (!Array.isArray(listing)) return [];
  const files = [];
  for (const item of listing) {
    if (!item || item.type !== "file") continue;
    const path = normalizeRepoPath(item.path);
    if (!path || !isAllowedPath(path) || !roleMayUsePath(role, path)) continue;
    files.push(await mediaFromPath(env, path, branch));
  }
  return files;
}

async function createBlob(env, base64) {
  const blob = await gh(env, `/repos/${REPO}/git/blobs`, {
    method: "POST",
    body: { content: base64, encoding: "base64" },
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
  for (const file of files) {
    const sha = await createBlob(env, file.base64);
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
  return commit.sha;
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
    const path = requireFilePath(asset.path, role);
    const bytes = base64ToBytes(asset.content || "");
    if (bytes.length > MAX_MEDIA_BYTES) {
      const error = new Error("Image trop lourde pour l’éditeur.");
      error.status = 413;
      error.code = "PATH";
      throw error;
    }
    files.push({ path, base64: bytesToBase64(bytes) });
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
  const path = requireFilePath(asset.path, role);
  const bytes = base64ToBytes(asset.content || "");
  if (!bytes.length || bytes.length > MAX_MEDIA_BYTES) {
    const error = new Error("Image vide ou trop lourde.");
    error.status = 413;
    error.code = "PATH";
    throw error;
  }
  await commitChanges(env, {
    message: commitMessage(username, params.options?.commitMessage || "Ajout d’un média"),
    username,
    files: [{ path, base64: bytesToBase64(bytes) }],
    deletions: [],
  });
  return mediaFromPath(env, path, BRANCH);
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

function patMissingResponse() {
  return fail(
    "Le jeton GitHub du serveur (GITHUB_CONTENT_PAT) n’est pas configuré sur le Worker gem-casa-preview. L’éditeur ne peut pas lire ni enregistrer pour le moment. Didier doit créer un jeton fin (Contents, lecture et écriture, dépôt didier2a/gem-site seulement) puis lancer wrangler secret put GITHUB_CONTENT_PAT.",
    503
  );
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
        return json(await mediaFromPath(env, requireFilePath(params.path, role), branch));
      case "persistEntry":
        return json(await persistEntry(env, params, access.username, role));
      case "persistMedia":
        return json(await persistMedia(env, params, access.username, role));
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
    const status = error.status || 502;
    return fail(redact(error.message, env), status);
  }
}
