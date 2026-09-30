import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import worker from "../src/index.js";
import { hashPassword, verifyPassword } from "../src/admin-auth.js";

const PAT = "github_pat_TESTONLY_do_not_leak_ABCDEF";
const OAUTH_SECRET = "oauth-client-secret-test-do-not-leak";
const SESSION_SECRET = "session-secret-test-do-not-leak";

const DECAP_HTML = `<!doctype html><html><head>
<script src="https://unpkg.com/decap-cms@^3.0.0/dist/decap-cms.js" defer></script>
</head><body></body></html>`;

function env(extra = {}) {
  return {
    ADMIN_SESSION_SECRET: SESSION_SECRET,
    ADMIN_USERS: extra.users ?? "",
    GITHUB_CONTENT_PAT: extra.pat,
    GITHUB_OAUTH_CLIENT_ID: extra.clientId,
    GITHUB_OAUTH_CLIENT_SECRET: extra.clientSecret,
    ASSETS: {
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/admin/" || url.pathname === "/admin/index.html") {
          return new Response(DECAP_HTML, {
            headers: { "content-type": "text/html; charset=utf-8" },
          });
        }
        if (url.pathname === "/admin/config.yml") {
          return new Response("backend:\n  name: proxy\n  proxy_url: /api/decap-proxy\n", {
            headers: { "content-type": "text/yaml" },
          });
        }
        return new Response("<p>accueil</p>", {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      },
    },
  };
}

async function login(users, password, username = "muriel") {
  const response = await worker.fetch(
    new Request("https://gem-casa-preview.infoserv2a.workers.dev/api/admin-login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username, password }),
    }),
    env({ users })
  );
  return response;
}

test("GET /admin/ sans cookie sert la page de connexion, pas Decap", async () => {
  const hash = await hashPassword("mot-de-passe-test", { iterations: 10000 });
  const response = await worker.fetch(
    new Request("https://gem-casa-preview.infoserv2a.workers.dev/admin/"),
    env({ users: JSON.stringify([{ username: "muriel", hash }]) })
  );
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /Espace d’édition/);
  assert.match(html, /name="password"/);
  assert.doesNotMatch(html, /unpkg\.com\/decap-cms/);
  assert.doesNotMatch(html, /GITHUB_CONTENT_PAT|github_pat_/);
});

test("mauvais mot de passe : message sur la page, pas de cookie", async () => {
  const hash = await hashPassword("mot-de-passe-test", { iterations: 10000 });
  const response = await login(JSON.stringify([{ username: "muriel", hash }]), "pas-le-bon");
  const html = await response.text();
  assert.equal(response.status, 401);
  assert.match(html, /Identifiant ou mot de passe incorrect/);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("bon mot de passe : cookie HttpOnly Secure SameSite=Lax puis Decap", async () => {
  const password = "mot-de-passe-test";
  const hash = await hashPassword(password, { iterations: 10000 });
  const users = JSON.stringify([{ username: "muriel", hash }]);
  const response = await login(users, password);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/admin/");
  const cookie = response.headers.get("set-cookie") || "";
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /^gem_admin_session=/);
  assert.doesNotMatch(cookie, new RegExp(password));

  const admin = await worker.fetch(
    new Request("https://gem-casa-preview.infoserv2a.workers.dev/admin/", {
      headers: { cookie },
    }),
    env({ users, pat: PAT })
  );
  const html = await admin.text();
  assert.equal(admin.status, 200);
  assert.match(html, /decap-cms/);
  assert.match(html, /decap-cms-user/);
  assert.match(html, /backendName/);
  assert.match(html, /proxy/);
  assert.match(html, /Se déconnecter/);
  assert.doesNotMatch(html, new RegExp(PAT));
  assert.doesNotMatch(html, new RegExp(SESSION_SECRET));
});

test("config.yml et /admin/index.html restent derrière la porte", async () => {
  const hash = await hashPassword("mot-de-passe-test", { iterations: 10000 });
  const users = JSON.stringify([{ username: "muriel", hash }]);
  const hidden = await worker.fetch(
    new Request("https://gem-casa-preview.infoserv2a.workers.dev/admin/config.yml"),
    env({ users })
  );
  const hiddenBody = await hidden.text();
  assert.match(hiddenBody, /Espace d’édition/);
  assert.doesNotMatch(hiddenBody, /proxy_url/);

  const login = await worker.fetch(
    new Request("https://gem-casa-preview.infoserv2a.workers.dev/api/admin-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "muriel", password: "mot-de-passe-test" }),
    }),
    env({ users })
  );
  const cookie = login.headers.get("set-cookie");
  const yaml = await worker.fetch(
    new Request("https://gem-casa-preview.infoserv2a.workers.dev/admin/config.yml", {
      headers: { cookie },
    }),
    env({ users })
  );
  assert.match(await yaml.text(), /proxy_url/);
});

test("secrets absents : page de mise en place, pas une pile d’erreur", async () => {
  const response = await worker.fetch(
    new Request("https://gem-casa-preview.infoserv2a.workers.dev/admin/"),
    env({ users: "" })
  );
  const html = await response.text();
  assert.equal(response.status, 503);
  assert.match(html, /ADMIN_USERS/);
  assert.match(html, /pas encore ouvert/);
  assert.doesNotMatch(html, /unpkg\.com\/decap-cms/);
  assert.doesNotMatch(html, /TypeError|stack/);
});

test("déconnexion efface le cookie", async () => {
  const response = await worker.fetch(
    new Request("https://gem-casa-preview.infoserv2a.workers.dev/api/admin-logout", {
      method: "POST",
    }),
    env()
  );
  assert.equal(response.status, 303);
  assert.match(response.headers.get("set-cookie") || "", /Max-Age=0/);
});

test("cookie modifié ne passe pas la porte", async () => {
  const hash = await hashPassword("mot-de-passe-test", { iterations: 10000 });
  const users = JSON.stringify([{ username: "muriel", hash }]);
  const loginResponse = await login(users, "mot-de-passe-test");
  const cookie = (loginResponse.headers.get("set-cookie") || "").replace(
    /gem_admin_session=./,
    "gem_admin_session=x"
  );
  const admin = await worker.fetch(
    new Request("https://gem-casa-preview.infoserv2a.workers.dev/admin/", {
      headers: { cookie },
    }),
    env({ users })
  );
  assert.match(await admin.text(), /Espace d’édition/);
});

test("/api/oauth redirige vers GitHub quand les secrets sont posés", async () => {
  const response = await worker.fetch(
    new Request("https://gem-casa-preview.infoserv2a.workers.dev/api/oauth"),
    env({ clientId: "iv1.test", clientSecret: OAUTH_SECRET })
  );
  assert.equal(response.status, 302);
  const location = response.headers.get("location") || "";
  assert.match(location, /^https:\/\/github\.com\/login\/oauth\/authorize\?/);
  assert.match(location, /client_id=iv1\.test/);
  assert.doesNotMatch(location, new RegExp(OAUTH_SECRET));
  assert.doesNotMatch(response.headers.get("set-cookie") || "", new RegExp(OAUTH_SECRET));
});

test("/api/oauth sans secrets explique la configuration", async () => {
  const response = await worker.fetch(
    new Request("https://gem-casa-preview.infoserv2a.workers.dev/api/oauth"),
    env()
  );
  const html = await response.text();
  assert.equal(response.status, 503);
  assert.match(html, /GITHUB_OAUTH_CLIENT_ID/);
  assert.doesNotMatch(html, /TypeError|stack/);
});

test("POST /api/contact reste en place", async () => {
  const response = await worker.fetch(
    new Request("https://gem-casa-preview.infoserv2a.workers.dev/api/contact", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nom: "A",
        prenom: "B",
        email: "a@example.org",
        message: "Bonjour",
        consent: true,
      }),
    }),
    env()
  );
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.ok, false);
});

test("la page d’accueil n’est pas derrière la porte", async () => {
  const response = await worker.fetch(
    new Request("https://gem-casa-preview.infoserv2a.workers.dev/"),
    env()
  );
  assert.match(await response.text(), /accueil/);
});

test("proxy : session + jeton, lecture et enregistrement sans exposer le PAT", async () => {
  const password = "mot-de-passe-test";
  const hash = await hashPassword(password, { iterations: 10000 });
  const users = JSON.stringify([{ username: "muriel", hash }]);
  const logged = await login(users, password);
  const cookie = logged.headers.get("set-cookie");
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const href = String(url);
    if (href.includes("/contents/content/blog?")) {
      return new Response(
        JSON.stringify([
          { name: "vie.md", path: "content/blog/vie.md", type: "file", sha: "abc" },
        ]),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (href.endsWith("/contents/content/blog/vie.md?ref=main")) {
      const content = Buffer.from("# Vie\n", "utf8").toString("base64");
      return new Response(JSON.stringify({ type: "file", encoding: "base64", content, sha: "abc" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (href.endsWith("/git/ref/heads/main")) {
      return new Response(JSON.stringify({ object: { sha: "commit1" } }), { status: 200 });
    }
    if (href.endsWith("/git/commits/commit1")) {
      return new Response(JSON.stringify({ tree: { sha: "tree1" } }), { status: 200 });
    }
    if (href.endsWith("/git/blobs") && init.method === "POST") {
      return new Response(JSON.stringify({ sha: "blob1" }), { status: 200 });
    }
    if (href.endsWith("/git/trees") && init.method === "POST") {
      return new Response(JSON.stringify({ sha: "tree2" }), { status: 200 });
    }
    if (href.endsWith("/git/commits") && init.method === "POST") {
      return new Response(JSON.stringify({ sha: "commit2" }), { status: 200 });
    }
    if (href.endsWith("/git/refs/heads/main") && init.method === "PATCH") {
      return new Response(JSON.stringify({ ref: "refs/heads/main" }), { status: 200 });
    }
    return new Response(JSON.stringify({ message: "unexpected " + href }), { status: 500 });
  };
  try {
    const list = await worker.fetch(
      new Request("https://gem-casa-preview.infoserv2a.workers.dev/api/decap-proxy", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          action: "entriesByFolder",
          params: { branch: "main", folder: "content/blog", extension: "md", depth: 1 },
        }),
      }),
      env({ users, pat: PAT })
    );
    const entries = await list.json();
    assert.equal(list.status, 200);
    assert.equal(entries[0].data, "# Vie\n");
    assert.equal(entries[0].file.path, "content/blog/vie.md");
    assert.doesNotMatch(JSON.stringify(entries), new RegExp(PAT));

    const save = await worker.fetch(
      new Request("https://gem-casa-preview.infoserv2a.workers.dev/api/decap-proxy", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          action: "persistEntry",
          params: {
            branch: "main",
            dataFiles: [{ path: "content/blog/vie.md", slug: "vie", raw: "# Vie du GEM\n" }],
            assets: [],
            options: { commitMessage: "Mise à jour Vie", useWorkflow: false },
          },
        }),
      }),
      env({ users, pat: PAT })
    );
    const saved = await save.json();
    assert.equal(save.status, 200, JSON.stringify(saved));
    assert.match(saved.message, /enregistré/);
    assert.doesNotMatch(JSON.stringify(saved), new RegExp(PAT));
  } finally {
    globalThis.fetch = original;
  }

  const githubCalls = calls.filter((call) => call.url.startsWith("https://api.github.com/"));
  assert.ok(githubCalls.length >= 2);
  for (const call of githubCalls) {
    assert.equal(call.init.headers.authorization, `Bearer ${PAT}`);
    assert.doesNotMatch(JSON.stringify(call.init.body || ""), new RegExp(SESSION_SECRET));
  }
  const commit = githubCalls.find((call) => call.url.endsWith("/git/commits") && call.init.method === "POST");
  assert.ok(commit);
  assert.match(commit.init.body, /\[muriel\]/);
  assert.doesNotMatch(commit.init.body, new RegExp(PAT));
});

test("proxy sans cookie ou sans jeton : erreur française, pas de jeton", async () => {
  const hash = await hashPassword("mot-de-passe-test", { iterations: 10000 });
  const users = JSON.stringify([{ username: "muriel", hash }]);
  const anon = await worker.fetch(
    new Request("https://gem-casa-preview.infoserv2a.workers.dev/api/decap-proxy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "entriesByFolder", params: { folder: "content/blog" } }),
    }),
    env({ users, pat: PAT })
  );
  const anonBody = await anon.json();
  assert.equal(anon.status, 401);
  assert.match(anonBody.error, /Connexion requise/);
  assert.doesNotMatch(anonBody.error, new RegExp(PAT));

  const logged = await login(users, "mot-de-passe-test");
  const cookie = logged.headers.get("set-cookie");
  const missing = await worker.fetch(
    new Request("https://gem-casa-preview.infoserv2a.workers.dev/api/decap-proxy", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        action: "persistEntry",
        params: { dataFiles: [{ path: "content/blog/a.md", raw: "x" }] },
      }),
    }),
    env({ users })
  );
  const missingBody = await missing.json();
  assert.equal(missing.status, 503);
  assert.match(missingBody.error, /GITHUB_CONTENT_PAT/);
  assert.match(missingBody.error, /gem-casa-preview/);
});

test("le proxy refuse un chemin hors contenu et une autre branche", async () => {
  const hash = await hashPassword("mot-de-passe-test", { iterations: 10000 });
  const users = JSON.stringify([{ username: "muriel", hash }]);
  const logged = await login(users, "mot-de-passe-test");
  const cookie = logged.headers.get("set-cookie");
  let called = false;
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    called = true;
    return new Response("{}", { status: 200 });
  };
  try {
    const response = await worker.fetch(
      new Request("https://gem-casa-preview.infoserv2a.workers.dev/api/decap-proxy", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          action: "getEntry",
          params: { branch: "main", path: "content/blog/../../src/index.js" },
        }),
      }),
      env({ users, pat: PAT })
    );
    const body = await response.json();
    assert.equal(response.status, 403);
    assert.match(body.error, /chemin/);
    assert.equal(called, false);

    const branch = await worker.fetch(
      new Request("https://gem-casa-preview.infoserv2a.workers.dev/api/decap-proxy", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          action: "getEntry",
          params: { branch: "evil", path: "content/blog/vie.md" },
        }),
      }),
      env({ users, pat: PAT })
    );
    assert.equal(branch.status, 422);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = original;
  }
});

test("l’empreinte du script se vérifie et ne contient pas le mot de passe", async () => {
  const password = "phrase-de-test-assez-longue";
  const run = spawnSync(process.execPath, ["scripts/hash-admin-password.mjs", "muriel"], {
    env: { ...process.env, ADMIN_PASSWORD: password },
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  assert.doesNotMatch(run.stdout, new RegExp(password));
  const line = run.stdout.trim().split("\n").at(-1);
  const parsed = JSON.parse(line);
  assert.equal(parsed[0].username, "muriel");
  assert.equal(await verifyPassword(password, parsed[0].hash), true);
  assert.equal(await verifyPassword("autre-mot", parsed[0].hash), false);
});

test("la config Decap du dépôt pointe vers le proxy, sans jeton", () => {
  const yaml = readFileSync(new URL("../public/admin/config.yml", import.meta.url), "utf8");
  assert.match(yaml, /name: proxy/);
  assert.match(yaml, /proxy_url: \/api\/decap-proxy/);
  assert.match(yaml, /branch: main/);
  assert.doesNotMatch(yaml, /github_pat_|ghp_|publish_mode:\s*editorial_workflow/);
});
