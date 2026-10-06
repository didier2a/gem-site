import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { createSession, hashPassword, ROLE_ANIMATRICE, ROLE_GITHUB_ADMIN } from "../src/admin-auth.js";
import {
  buildRestoreCommitMessage,
  handleAdminHistory,
  previewHistoryText,
  summarizeHistoryCommits,
} from "../src/admin-history.js";
import { entryFileFromAdminHash, historyPanelHtml } from "../src/admin-history-ui.js";
import worker from "../src/index.js";

const PAT = "github_pat_TESTONLY_do_not_leak_ABCDEF";
const SESSION_SECRET = "session-secret-test-do-not-leak";
const ORIGIN = "https://gem-casa-preview.infoserv2a.workers.dev";
const OLD = "a".repeat(40);
const NEW = "b".repeat(40);
const DECAP_HTML = `<!doctype html><html><head>
<script src="https://unpkg.com/decap-cms@^3.0.0/dist/decap-cms.js" defer></script>
</head><body></body></html>`;

function env(extra = {}) {
  return {
    ADMIN_SESSION_SECRET: extra.secret === undefined ? SESSION_SECRET : extra.secret,
    ADMIN_USERS: extra.users === undefined ? extra.usersFallback : extra.users,
    ADMIN_GITHUB_LOGINS: extra.githubLogins ?? "didier2a",
    GITHUB_CONTENT_PAT: extra.pat === undefined ? PAT : extra.pat,
    ASSETS: {
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/admin/" || url.pathname === "/admin/index.html") {
          return new Response(DECAP_HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
        }
        return new Response("page publique", { headers: { "content-type": "text/html; charset=utf-8" } });
      },
    },
  };
}

async function usersJson() {
  const hash = await hashPassword("mot-de-passe-test", { iterations: 10000 });
  return JSON.stringify([{ username: "muriel", hash }]);
}

async function sessionCookie(username, role) {
  const token = await createSession(SESSION_SECRET, username, role);
  return `gem_admin_session=${token}`;
}

function installGithub(mode = "diff") {
  const calls = [];
  const commits = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    calls.push({
      href,
      method: init.method || "GET",
      body: init.body,
      authorization: init.headers?.authorization,
    });
    if (href.includes("/commits?path=")) {
      return Response.json([
        {
          sha: NEW,
          commit: {
            message: "Version actuelle\nligne ignoree",
            author: { name: "didier2a", email: "secret@example.com", date: "2026-02-02T12:00:00Z" },
          },
        },
        {
          sha: "abc",
          commit: { message: "sha trop court", author: { name: "x", date: "2026-03-01T00:00:00Z" } },
        },
        {
          sha: OLD,
          html_url: `https://github.com/didier2a/gem-site/commit/${OLD}`,
          commit: {
            message: "[muriel] Ancienne version\n\ncorps à ignorer",
            author: {
              name: "muriel",
              email: "muriel@users.noreply.gem-casa.local",
              date: "2026-01-15T10:00:00Z",
            },
          },
          author: { login: "didier2a" },
        },
      ]);
    }
    if (href.includes("/contents/")) {
      if (mode === "missing" || href.includes("introuvable.md")) {
        return new Response(JSON.stringify({ message: "Not Found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      }
      const ref = new URL(href).searchParams.get("ref");
      let text = "actuel\n";
      if (mode === "diff" && ref === OLD) text = "ancien\n";
      if (href.includes("secret.md")) text = `jeton ${PAT}\n`;
      return Response.json({
        type: "file",
        encoding: "base64",
        content: Buffer.from(text, "utf8").toString("base64"),
        sha: "blobfile",
      });
    }
    if (href.endsWith(`/commits/${OLD}`)) {
      return Response.json({
        sha: OLD,
        commit: { message: "meta", author: { date: "2026-01-15T10:00:00Z", email: "hidden@example.com" } },
      });
    }
    if (href.endsWith("/git/ref/heads/main")) return Response.json({ object: { sha: "commit1" } });
    if (href.endsWith("/git/commits/commit1")) return Response.json({ tree: { sha: "tree1" } });
    if (href.endsWith("/git/blobs") && init.method === "POST") return Response.json({ sha: "blob1" });
    if (href.endsWith("/git/trees") && init.method === "POST") return Response.json({ sha: "tree2" });
    if (href.endsWith("/git/commits") && init.method === "POST") {
      commits.push(JSON.parse(init.body));
      return Response.json({ sha: "commit2" });
    }
    if (href.endsWith("/git/refs/heads/main") && init.method === "PATCH") {
      return Response.json({ ref: "refs/heads/main" });
    }
    return Response.json({ message: "unexpected " + href }, { status: 500 });
  };
  return {
    calls,
    commits,
    restore() {
      globalThis.fetch = original;
    },
  };
}

async function history(cookie, body, house = {}) {
  const users = house.users ?? (await usersJson());
  return worker.fetch(
    new Request(`${ORIGIN}/api/admin-history`, {
      method: house.method || "POST",
      headers: {
        ...(cookie ? { cookie } : {}),
        "content-type": "application/json",
      },
      body: house.method === "GET" ? undefined : JSON.stringify(body),
    }),
    env({ users, pat: house.pat, secret: house.secret, githubLogins: house.githubLogins })
  );
}

test("le hash Decap désigne le fichier Git, ou un brouillon jamais publié", () => {
  assert.deepEqual(entryFileFromAdminHash("#/collections/blog/entries/vie-du-gem"), {
    kind: "entry",
    collection: "blog",
    slug: "vie-du-gem",
    path: "content/blog/vie-du-gem.md",
  });
  assert.equal(
    entryFileFromAdminHash("#/collections/pages/entries/qui-sommes-nous?x=1").path,
    "content/pages/qui-sommes-nous.md"
  );
  assert.equal(entryFileFromAdminHash("#/collections/blog/entries/atelier%2Dpeinture").slug, "atelier-peinture");
  assert.equal(entryFileFromAdminHash("#/collections/blog/new").kind, "unpublished");
  assert.equal(entryFileFromAdminHash("#/collections/blog").kind, "none");
  assert.equal(entryFileFromAdminHash("#/collections/equipe/entries/a").kind, "none");
  assert.equal(entryFileFromAdminHash("#/collections/blog/entries/../secret").kind, "invalid");
  assert.equal(entryFileFromAdminHash("#/collections/blog/entries/%E0%A4%A").kind, "invalid");
});

test("le résumé des commits retire les e-mails et ne garde que des SHA complets", () => {
  const commits = summarizeHistoryCommits([
    {
      sha: NEW,
      commit: {
        message: "actuel",
        author: { name: "a@b.c", email: "a@b.c", date: "2020-01-01T00:00:00Z" },
      },
      author: { login: "didier2a" },
    },
    {
      sha: "court",
      commit: { message: "ignore", author: { name: "x", date: "2026-04-01T00:00:00Z" } },
    },
    {
      sha: OLD,
      html_url: "https://example.test/secret",
      commit: {
        message: "ancien\ncorps",
        author: { name: "muriel", email: "muriel@example.test", date: "2026-01-15T10:00:00Z" },
      },
      author: { login: "didier2a" },
    },
  ]);
  assert.deepEqual(
    commits.map((item) => item.sha),
    [NEW, OLD]
  );
  assert.equal(commits[1].author, "muriel (didier2a)");
  assert.equal(commits[1].message, "ancien");
  assert.equal(commits[0].author, "didier2a");
  assert.equal(JSON.stringify(commits).includes("@"), false);
  assert.equal(JSON.stringify(commits).includes("html_url"), false);
  assert.equal(
    buildRestoreCommitMessage("content/blog/vie-du-gem.md", OLD, "2026-01-15T10:00:00Z"),
    "Restauration de content/blog/vie-du-gem.md — retour à la version aaaaaaa du 2026-01-15"
  );
  assert.equal(previewHistoryText(new Uint8Array([0xff])).binary, true);
  assert.equal(previewHistoryText(new Uint8Array([0, 65])).binary, true);
  const text = previewHistoryText(new TextEncoder().encode("bonjour"));
  assert.equal(text.content, "bonjour");
  assert.equal(text.truncated, false);
  const long = previewHistoryText(new TextEncoder().encode("x".repeat(80_001)));
  assert.equal(long.truncated, true);
  assert.equal(long.content.length, 80_000);
});

test("le script du panneau est du JavaScript valide et réservé au libellé de restauration", () => {
  const html = historyPanelHtml();
  const script = html.replace(/^<script defer>\n/, "").replace(/\n<\/script>$/, "");
  new Function(script);
  assert.match(script, /function entryFileFromAdminHash/);
  assert.match(script, /\/api\/admin-history/);
  assert.match(script, /Restaurer cette version/);
  assert.match(script, /Cet article n’a pas encore été publié/);
  assert.doesNotMatch(script, new RegExp(PAT));
  assert.doesNotMatch(readFileSync(new URL("../public/admin/config.yml", import.meta.url), "utf8"), /editorial_workflow/);
});

test("dans l’éditeur, le bouton Historique liste, prévisualise et demande confirmation", async () => {
  const html = historyPanelHtml();
  const script = html.replace(/^<script defer>\n/, "").replace(/\n<\/script>$/, "");
  const elements = new Map();

  class El {
    constructor(tag) {
      this.tagName = tag;
      this.hidden = false;
      this.disabled = false;
      this.id = "";
      this.title = "";
      this._text = "";
      this.style = {};
      this.children = [];
      this.parentNode = null;
      this.listeners = {};
      this.attributes = {};
    }
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    }
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
    }
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      if (child.id) elements.set(child.id, child);
      return child;
    }
    removeChild(child) {
      this.children = this.children.filter((item) => item !== child);
      child.parentNode = null;
    }
    addEventListener(type, fn) {
      (this.listeners[type] ||= []).push(fn);
    }
    querySelectorAll(selector) {
      const out = [];
      const walk = (node) => {
        if (selector === "button" && node.tagName === "button") out.push(node);
        for (const child of node.children || []) walk(child);
      };
      walk(this);
      return out;
    }
    get textContent() {
      if (this.children.length) return this.children.map((child) => child.textContent).join("");
      return this._text;
    }
    set textContent(value) {
      this._text = value == null ? "" : String(value);
      this.children = [];
    }
    focus() {
      this.focused = true;
    }
    click() {
      for (const fn of this.listeners.click || []) fn({ target: this });
    }
  }

  const body = new El("body");
  const open = new El("button");
  open.id = "gem-history-open";
  open.hidden = true;
  body.appendChild(open);
  const documentListeners = {};
  const documentMock = {
    readyState: "complete",
    body,
    createElement(tag) {
      return new El(tag);
    },
    getElementById(id) {
      return elements.get(id) || null;
    },
    addEventListener(type, fn) {
      (documentListeners[type] ||= []).push(fn);
    },
  };
  const location = { hash: "#/collections/blog", reloaded: false, reload() { this.reloaded = true; } };
  const stored = new Map();
  const sessionStorage = {
    getItem(key) {
      return stored.has(key) ? stored.get(key) : null;
    },
    setItem(key, value) {
      stored.set(key, String(value));
    },
    removeItem(key) {
      stored.delete(key);
    },
  };
  const calls = [];
  let confirmResult = false;
  const confirms = [];
  const sandbox = {
    document: documentMock,
    location,
    sessionStorage,
    localStorage: { removeItem() {} },
    indexedDB: undefined,
    Intl,
    Date,
    Promise,
    JSON,
    Object,
    String,
    Number,
    Array,
    setTimeout,
    clearTimeout,
    isNaN,
    fetch(url, init) {
      const bodyJson = JSON.parse(init.body);
      calls.push(bodyJson);
      if (bodyJson.action === "list") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            commits: [
              { sha: NEW, date: "2026-02-02T12:00:00Z", author: "didier2a", message: "Version actuelle" },
              { sha: OLD, date: "2026-01-15T10:00:00Z", author: "muriel (didier2a)", message: "Ancienne version" },
            ],
          }),
        });
      }
      if (bodyJson.action === "read") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ content: "# Ancien texte\n", binary: false, truncated: false }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ restored: true, unchanged: false, message: "Version restaurée sur main." }),
      });
    },
    confirm(message) {
      confirms.push(message);
      return confirmResult;
    },
  };
  const windowListeners = {};
  sandbox.addEventListener = (type, fn) => {
    (windowListeners[type] ||= []).push(fn);
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox);

  async function flush() {
    for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  assert.equal(open.hidden, true);

  location.hash = "#/collections/blog/new";
  for (const fn of windowListeners.hashchange || []) fn();
  assert.equal(open.hidden, false);
  open.click();
  await flush();
  assert.match(documentMock.getElementById("gem-history-status").textContent, /n’a pas encore été publié/);
  assert.equal(calls.length, 0);

  location.hash = "#/collections/blog/entries/vie-du-gem";
  for (const fn of windowListeners.hashchange || []) fn();
  assert.equal(open.hidden, false);
  assert.equal(open.title, "Versions Git de cette entrée");
  open.click();
  await flush();
  const list = documentMock.getElementById("gem-history-list");
  const rows = list.querySelectorAll("button");
  assert.equal(rows.length, 2);
  assert.match(rows[0].textContent, /Version actuelle sur main/);
  assert.match(documentMock.getElementById("gem-history-path").textContent, /content\/blog\/vie-du-gem\.md/);
  rows[1].click();
  await flush();
  assert.match(documentMock.getElementById("gem-history-preview").textContent, /# Ancien texte/);
  assert.equal(documentMock.getElementById("gem-history-restore").disabled, false);

  documentMock.getElementById("gem-history-restore").click();
  await flush();
  assert.equal(confirms.length, 1);
  assert.match(confirms[0], /Restaurer la version du/);
  assert.match(confirms[0], /nouveau commit/);
  assert.equal(calls.some((call) => call.action === "restore"), false);
  assert.equal(location.reloaded, false);

  confirmResult = true;
  documentMock.getElementById("gem-history-restore").click();
  await flush();
  assert.equal(calls.filter((call) => call.action === "restore").length, 1);
  assert.equal(calls.find((call) => call.action === "restore").sha, OLD);
  assert.equal(location.reloaded, true);
  assert.match(stored.get("gem-history-note") || "", /Version restaurée sur main/);
});

test("l’historique exige le super-admin et n’écrit pas hors des dossiers autorisés", async () => {
  const users = await usersJson();
  const admin = await sessionCookie("didier2a", ROLE_GITHUB_ADMIN);
  const animatrice = await sessionCookie("muriel", ROLE_ANIMATRICE);
  const forged = await sessionCookie("muriel", ROLE_GITHUB_ADMIN);

  const anon = await history("", { action: "list", path: "content/blog/vie-du-gem.md" }, { users });
  assert.equal(anon.status, 401);

  const get = await history(admin, { action: "list", path: "content/blog/vie-du-gem.md" }, { users, method: "GET" });
  assert.equal(get.status, 405);

  const denied = await history(animatrice, { action: "list", path: "content/blog/vie-du-gem.md" }, { users });
  assert.equal(denied.status, 403);
  assert.match((await denied.json()).error, /super-admin/);

  const forgedRes = await history(forged, { action: "list", path: "content/pages/qui-sommes-nous.md" }, { users });
  assert.equal(forgedRes.status, 401);

  const closed = await history(admin, { action: "list", path: "content/blog/vie-du-gem.md" }, { users, secret: "" });
  assert.equal(closed.status, 503);

  const noPat = await history(admin, { action: "list", path: "content/blog/vie-du-gem.md" }, { users, pat: "" });
  const noPatBody = await noPat.text();
  assert.equal(noPat.status, 503);
  assert.doesNotMatch(noPatBody, new RegExp(PAT));
  assert.match(noPatBody, /GITHUB_CONTENT_PAT/);

  const github = installGithub();
  try {
    const outside = await history(admin, { action: "list", path: "src/index.js" }, { users });
    assert.equal(outside.status, 403);
    const escape = await history(admin, { action: "list", path: "content/blog/../../src/index.js" }, { users });
    assert.equal(escape.status, 403);
    const badSha = await history(admin, { action: "read", path: "content/blog/vie-du-gem.md", sha: "main" }, { users });
    assert.equal(badSha.status, 400);
    assert.equal(github.calls.length, 0);

    const unknown = await history(admin, { action: "autre", path: "content/blog/vie-du-gem.md" }, { users });
    assert.equal(unknown.status, 422);

    const list = await history(
      admin,
      { action: "list", path: "content/blog/vie-du-gem.md", branch: "gh-pages" },
      { users }
    );
    const listed = await list.json();
    assert.equal(list.status, 200, JSON.stringify(listed));
    assert.match(list.headers.get("cache-control") || "", /no-store/);
    assert.deepEqual(listed.commits.map((item) => item.sha), [NEW, OLD]);
    assert.equal(listed.commits[1].author, "muriel (didier2a)");
    assert.equal(listed.commits[1].message, "[muriel] Ancienne version");
    assert.equal(JSON.stringify(listed).includes("@"), false);
    assert.equal(JSON.stringify(listed).includes("html_url"), false);
    assert.equal(JSON.stringify(listed).includes(PAT), false);
    const listUrl = github.calls.find((call) => call.href.includes("/commits?path="));
    assert.match(listUrl.href, /path=content%2Fblog%2Fvie-du-gem\.md/);
    assert.match(listUrl.href, /sha=main/);
    assert.doesNotMatch(listUrl.href, /gh-pages/);
    assert.equal(listUrl.authorization, `Bearer ${PAT}`);

    const preview = await history(admin, { action: "read", path: "content/blog/vie-du-gem.md", sha: OLD }, { users });
    const seen = await preview.json();
    assert.equal(preview.status, 200, JSON.stringify(seen));
    assert.equal(seen.content, "ancien\n");
    assert.equal(seen.binary, false);

    const secret = await history(admin, { action: "read", path: "content/blog/secret.md", sha: OLD }, { users });
    const secretBody = await secret.text();
    assert.equal(secret.status, 200);
    assert.match(secretBody, /\[secret\]/);
    assert.doesNotMatch(secretBody, new RegExp(PAT));

    const page = await history(admin, { action: "list", path: "content/pages/qui-sommes-nous.md" }, { users });
    assert.equal(page.status, 200);
    const media = await history(admin, { action: "list", path: "public/uploads/blog/cover.png" }, { users });
    assert.equal(media.status, 200);

    const missing = await history(
      admin,
      { action: "restore", path: "content/blog/introuvable.md", sha: OLD },
      { users }
    );
    const missingBody = await missing.json();
    assert.equal(missing.status, 404, JSON.stringify(missingBody));
    assert.match(missingBody.error, /ne contient pas ce fichier/);
    assert.equal(github.commits.length, 0);

    const restored = await history(
      admin,
      { action: "restore", path: "content/blog/vie-du-gem.md", sha: OLD },
      { users }
    );
    const restoredBody = await restored.json();
    assert.equal(restored.status, 200, JSON.stringify(restoredBody));
    assert.equal(restoredBody.restored, true);
    assert.equal(restoredBody.unchanged, false);
    assert.equal(restoredBody.commit, "commit2");
    assert.match(restoredBody.message, /restaurée sur main/);
    assert.equal(github.commits.length, 1);
    assert.equal(
      github.commits[0].message,
      "[didier2a] Restauration de content/blog/vie-du-gem.md — retour à la version aaaaaaa du 2026-01-15"
    );
    const blob = github.calls.find((call) => call.href.endsWith("/git/blobs"));
    assert.equal(Buffer.from(JSON.parse(blob.body).content, "base64").toString("utf8"), "ancien\n");
    const patch = github.calls.find((call) => call.href.endsWith("/git/refs/heads/main") && call.method === "PATCH");
    assert.equal(JSON.parse(patch.body).force, false);
  } finally {
    github.restore();
  }
});

test("restaurer la version déjà sur main ne crée pas de commit", async () => {
  const users = await usersJson();
  const admin = await sessionCookie("didier2a", ROLE_GITHUB_ADMIN);
  const github = installGithub("same");
  try {
    const restored = await history(
      admin,
      { action: "restore", path: "content/blog/vie-du-gem.md", sha: OLD },
      { users }
    );
    const body = await restored.json();
    assert.equal(restored.status, 200, JSON.stringify(body));
    assert.equal(body.unchanged, true);
    assert.equal(body.restored, false);
    assert.match(body.message, /déjà celle de main/);
    assert.equal(github.commits.length, 0);
    assert.equal(github.calls.some((call) => String(call.href).includes("/git/blobs")), false);
  } finally {
    github.restore();
  }
});

test("handleAdminHistory refuse une méthode autre que POST", async () => {
  const users = await usersJson();
  const response = await handleAdminHistory(
    new Request(`${ORIGIN}/api/admin-history`, { method: "PUT" }),
    env({ users })
  );
  assert.equal(response.status, 405);
});