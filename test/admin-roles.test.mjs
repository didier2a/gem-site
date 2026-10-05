import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  configYamlForRole,
  createSession,
  hashPassword,
  PAGES_DENIED_MESSAGE,
  ROLE_ANIMATRICE,
  ROLE_GITHUB_ADMIN,
} from "../src/admin-auth.js";
import worker from "../src/index.js";

const PAT = "github_pat_TESTONLY_do_not_leak_ABCDEF";
const SESSION_SECRET = "session-secret-test-do-not-leak";
const OAUTH_SECRET = "oauth-client-secret-test-do-not-leak";
const CLIENT_ID = "iv1.test";
const ACCESS_TOKEN = "gho_test_do_not_leak";
const ORIGIN = "https://gem-casa-preview.infoserv2a.workers.dev";
const REAL_YAML = readFileSync(new URL("../public/admin/config.yml", import.meta.url), "utf8");

const DECAP_HTML = `<!doctype html><html><head>
<script src="https://unpkg.com/decap-cms@^3.0.0/dist/decap-cms.js" defer></script>
</head><body></body></html>`;

function env(extra = {}) {
  return {
    ADMIN_SESSION_SECRET: SESSION_SECRET,
    ADMIN_USERS: extra.users ?? "",
    ADMIN_GITHUB_LOGINS: extra.githubLogins ?? "",
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
          return new Response(REAL_YAML, {
            headers: { "content-type": "text/yaml; charset=utf-8" },
          });
        }
        return new Response(`<main data-path="${url.pathname}">page publique</main>`, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      },
    },
  };
}

function cookiePair(header) {
  return String(header || "").split(";")[0];
}

function payloadOf(setCookie) {
  const token = cookiePair(setCookie).replace(/^gem_admin_session=/, "");
  const b64 = token.slice(0, token.lastIndexOf("."));
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const json = Buffer.from(b64.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64").toString("utf8");
  return JSON.parse(json);
}

function installGithub() {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    calls.push(href);
    if (href.includes("/contents/content/blog?")) {
      return Response.json([{ name: "vie.md", path: "content/blog/vie.md", type: "file", sha: "abc" }]);
    }
    if (href.includes("/contents/content/pages?")) {
      return Response.json([
        { name: "qui-sommes-nous.md", path: "content/pages/qui-sommes-nous.md", type: "file", sha: "p1" },
      ]);
    }
    if (href.includes("/contents/content/blog/vie.md")) {
      return Response.json({
        type: "file",
        encoding: "base64",
        content: Buffer.from("# Vie\n", "utf8").toString("base64"),
        sha: "abc",
      });
    }
    if (href.includes("/contents/content/pages/")) {
      return Response.json({
        type: "file",
        encoding: "base64",
        content: Buffer.from("# Page secrète\n", "utf8").toString("base64"),
        sha: "p1",
      });
    }
    if (href.includes("/contents/public/uploads/blog/")) {
      return Response.json({
        type: "file",
        encoding: "base64",
        content: Buffer.from("img", "utf8").toString("base64"),
        sha: "m1",
      });
    }
    if (href.endsWith("/git/ref/heads/main")) return Response.json({ object: { sha: "commit1" } });
    if (href.endsWith("/git/commits/commit1")) return Response.json({ tree: { sha: "tree1" } });
    if (href.endsWith("/git/blobs") && init.method === "POST") return Response.json({ sha: "blob1" });
    if (href.endsWith("/git/trees") && init.method === "POST") return Response.json({ sha: "tree2" });
    if (href.endsWith("/git/commits") && init.method === "POST") return Response.json({ sha: "commit2" });
    if (href.endsWith("/git/refs/heads/main") && init.method === "PATCH") {
      return Response.json({ ref: "refs/heads/main" });
    }
    return Response.json({ message: "unexpected " + href }, { status: 500 });
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

async function proxy(cookie, users, body, githubLogins = "didier2a") {
  return worker.fetch(
    new Request(`${ORIGIN}/api/decap-proxy`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    env({ users, githubLogins, pat: PAT })
  );
}

test("la config du dépôt garde les pages ; l’animatrice n’en reçoit que le blog", async () => {
  assert.match(REAL_YAML, /name: pages/);
  assert.match(REAL_YAML, /content\/pages\/qui-sommes-nous\.md/);
  const animatrice = configYamlForRole(REAL_YAML, ROLE_ANIMATRICE);
  assert.match(animatrice, /name: blog/);
  assert.match(animatrice, /folder: content\/blog/);
  assert.match(animatrice, /proxy_url: \/api\/decap-proxy/);
  assert.match(animatrice, /media_folder: public\/uploads\/blog/);
  assert.doesNotMatch(animatrice, /name:\s*['"]?pages['"]?/);
  assert.doesNotMatch(animatrice, /content\/pages/);
  assert.doesNotMatch(animatrice, /qui-sommes-nous/);
  const admin = configYamlForRole(REAL_YAML, ROLE_GITHUB_ADMIN);
  assert.match(admin, /name: pages/);
  assert.match(admin, /content\/pages\/nous-soutenir\.md/);

  const extra = configYamlForRole(
    "collections:\n  - name: blog\n    folder: content/blog\n  - name: pages\n    file: content/pages/a.md\n  - name: equipe\n    folder: content/equipe\nsite_url: https://example.org\n",
    ROLE_ANIMATRICE
  );
  assert.match(extra, /name: blog/);
  assert.match(extra, /site_url:/);
  assert.doesNotMatch(extra, /name: pages/);
  assert.doesNotMatch(extra, /name: equipe/);
});

test("session animatrice : Decap sans pages, proxy blog seulement, site public lisible", async () => {
  const hash = await hashPassword("mot-de-passe-test", { iterations: 10000 });
  const users = JSON.stringify([{ username: "muriel", hash }]);
  const logged = await worker.fetch(
    new Request(`${ORIGIN}/api/admin-login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "muriel", password: "mot-de-passe-test" }),
    }),
    env({ users, githubLogins: "didier2a" })
  );
  const rawCookie = logged.headers.get("set-cookie") || "";
  assert.equal(payloadOf(rawCookie).role, ROLE_ANIMATRICE);
  assert.equal(payloadOf(rawCookie).u, "muriel");
  const cookie = cookiePair(rawCookie);

  const door = await worker.fetch(new Request(`${ORIGIN}/admin/`), env({ users, githubLogins: "didier2a" }));
  const doorHtml = await door.text();
  assert.match(doorHtml, /name="password"/);
  assert.match(doorHtml, /href="\/api\/oauth\?intent=admin"/);
  assert.match(doorHtml, /Se connecter avec GitHub/);
  assert.match(doorHtml, /Mot de passe oublié/);
  assert.doesNotMatch(doorHtml, /unpkg\.com\/decap-cms/);

  const admin = await worker.fetch(new Request(`${ORIGIN}/admin/`, { headers: { cookie } }), env({ users, githubLogins: "didier2a" }));
  const html = await admin.text();
  assert.match(html, /decap-cms/);
  assert.match(html, /data-gem-role="animatrice"/);
  assert.doesNotMatch(html, /id="gem-role-note"/);
  assert.match(html, /#\/collections\/blog/);
  assert.match(html, /gem-publish-note/);
  assert.match(html, /registerEventListener/);
  assert.match(html, /postPublish/);
  assert.match(html, /Après une publication, comptez au moins 2 minutes avant de la voir en ligne sur le site\./);
  assert.match(html, /setTimeout\(function \(\) \{ dismissNote\(el\); \}, 5000\)/);
  assert.doesNotMatch(html, /Publié !/);
  assert.doesNotMatch(html, /gem-publish-toast/);
  assert.match(html, /src="https:\/\/unpkg\.com\/decap-cms@[^"]+\/dist\/decap-cms\.js"/);
  assert.doesNotMatch(html, /decap-cms<script/);

  const yamlRes = await worker.fetch(
    new Request(`${ORIGIN}/admin/config.yml`, { headers: { cookie } }),
    env({ users, githubLogins: "didier2a" })
  );
  const yaml = await yamlRes.text();
  assert.match(yamlRes.headers.get("cache-control") || "", /no-store/);
  assert.match(yaml, /name: blog/);
  assert.doesNotMatch(yaml, /name:\s*pages/);
  assert.doesNotMatch(yaml, /content\/pages/);

  const github = installGithub();
  try {
    const list = await proxy(cookie, users, {
      action: "entriesByFolder",
      params: { branch: "main", folder: "content/blog", extension: "md", depth: 1 },
    });
    const entries = await list.json();
    assert.equal(list.status, 200, JSON.stringify(entries));
    assert.equal(entries[0].file.path, "content/blog/vie.md");

    const readPage = await proxy(cookie, users, {
      action: "getEntry",
      params: { branch: "main", path: "content/pages/qui-sommes-nous.md" },
    });
    const readBody = await readPage.json();
    assert.equal(readPage.status, 403);
    assert.equal(readBody.error, PAGES_DENIED_MESSAGE);
    assert.doesNotMatch(readBody.error, /Page secrète/);

    const listPages = await proxy(cookie, users, {
      action: "entriesByFolder",
      params: { branch: "main", folder: "content/pages", extension: "md" },
    });
    assert.equal(listPages.status, 403);
    assert.equal((await listPages.json()).error, PAGES_DENIED_MESSAGE);

    const mixed = await proxy(cookie, users, {
      action: "entriesByFiles",
      params: {
        files: [
          { path: "content/blog/vie.md" },
          { path: "content/pages/qui-sommes-nous.md", label: "Qui sommes-nous ?" },
        ],
      },
    });
    assert.equal(mixed.status, 403);

    const savePage = await proxy(cookie, users, {
      action: "persistEntry",
      params: {
        branch: "main",
        dataFiles: [{ path: "content/pages/qui-sommes-nous.md", raw: "# Piraté\n" }],
        assets: [],
      },
    });
    assert.equal(savePage.status, 403);
    assert.equal((await savePage.json()).error, PAGES_DENIED_MESSAGE);

    const saveMixed = await proxy(cookie, users, {
      action: "persistEntry",
      params: {
        dataFiles: [
          { path: "content/blog/vie.md", raw: "# Vie\n" },
          { path: "content/pages/nos-activites.md", raw: "# Non\n" },
        ],
      },
    });
    assert.equal(saveMixed.status, 403);

    const remove = await proxy(cookie, users, {
      action: "deleteFiles",
      params: { paths: ["content/pages/nous-soutenir.md"] },
    });
    assert.equal(remove.status, 403);

    const mediaPage = await proxy(cookie, users, {
      action: "persistMedia",
      params: { asset: { path: "content/pages/photo.png", content: Buffer.from("x").toString("base64") } },
    });
    assert.equal(mediaPage.status, 403);

    const callsBeforeBlogWrite = github.calls.length;
    const saveBlog = await proxy(cookie, users, {
      action: "persistEntry",
      params: {
        branch: "main",
        dataFiles: [{ path: "content/blog/vie.md", raw: "# Vie du GEM\n" }],
        assets: [],
        options: { commitMessage: "Article" },
      },
    });
    assert.equal(saveBlog.status, 200, JSON.stringify(await saveBlog.clone().json()));
    assert.ok(github.calls.slice(callsBeforeBlogWrite).some((href) => href.includes("/git/commits")));
    assert.equal(
      github.calls.some((href) => href.includes("content/pages")),
      false
    );

    const cover = await proxy(cookie, users, {
      action: "persistMedia",
      params: {
        asset: { path: "public/uploads/blog/cover.png", content: Buffer.from("img").toString("base64") },
        options: { commitMessage: "Couverture" },
      },
    });
    const coverBody = await cover.json();
    assert.equal(cover.status, 200, JSON.stringify(coverBody));
    assert.equal(coverBody.path, "public/uploads/blog/cover.png");
  } finally {
    github.restore();
  }

  for (const path of ["/", "/blog/", "/qui-sommes-nous/", "/nos-activites/", "/nous-soutenir/"]) {
    const anon = await worker.fetch(new Request(`${ORIGIN}${path}`), env({ users }));
    const anonHtml = await anon.text();
    assert.equal(anon.status, 200);
    assert.match(anonHtml, /page publique/);
    assert.doesNotMatch(anonHtml, /Espace d’édition|gem-role-note|decap-cms/);

    const asAnimatrice = await worker.fetch(
      new Request(`${ORIGIN}${path}`, { headers: { cookie } }),
      env({ users, githubLogins: "didier2a" })
    );
    const seen = await asAnimatrice.text();
    assert.match(seen, new RegExp(`data-path="${path}"`));
    assert.doesNotMatch(seen, /gem-role-note|Espace d’édition/);
  }
});

test("session GitHub ADMIN_GITHUB_LOGINS : Decap complet et écriture des pages", async () => {
  const hash = await hashPassword("mot-de-passe-test", { iterations: 10000 });
  const users = JSON.stringify([{ username: "muriel", hash }]);
  const house = { users, clientId: CLIENT_ID, clientSecret: OAUTH_SECRET, githubLogins: "didier2a" };
  const start = await worker.fetch(new Request(`${ORIGIN}/api/oauth?intent=admin`), env(house));
  const location = new URL(start.headers.get("location"));
  const state = location.searchParams.get("state");
  const stateCookie = cookiePair(start.headers.get("set-cookie"));
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url) === "https://github.com/login/oauth/access_token") {
      return Response.json({ access_token: ACCESS_TOKEN });
    }
    if (String(url) === "https://api.github.com/user") return Response.json({ login: "didier2a" });
    throw new Error(`appel inattendu ${url}`);
  };
  let done;
  try {
    done = await worker.fetch(
      new Request(`${ORIGIN}/api/oauth/callback?code=code-test&state=${encodeURIComponent(state)}`, {
        headers: { cookie: stateCookie },
      }),
      env(house)
    );
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(done.status, 303);
  const session = done.headers.getSetCookie().find((item) => item.startsWith("gem_admin_session="));
  assert.equal(payloadOf(session).role, ROLE_GITHUB_ADMIN);
  assert.equal(payloadOf(session).u, "didier2a");
  const cookie = cookiePair(session);

  const admin = await worker.fetch(new Request(`${ORIGIN}/admin/`, { headers: { cookie } }), env(house));
  const html = await admin.text();
  assert.match(html, /decap-cms/);
  assert.match(html, /data-gem-role="github_admin"/);
  assert.match(html, /didier2a/);
  assert.doesNotMatch(html, /id="gem-role-note"/);
  assert.doesNotMatch(html, /name="password"/);
  assert.doesNotMatch(html, /Ce compte peut modifier les articles du blog/);
  assert.match(html, /gem-publish-note/);
  assert.match(html, /registerEventListener/);
  assert.match(html, /postPublish/);
  assert.match(html, /Après une publication, comptez au moins 2 minutes avant de la voir en ligne sur le site\./);
  assert.match(html, /setTimeout\(function \(\) \{ dismissNote\(el\); \}, 5000\)/);
  assert.doesNotMatch(html, /Publié !/);
  assert.doesNotMatch(html, /gem-publish-toast/);
  assert.match(html, /src="https:\/\/unpkg\.com\/decap-cms@[^"]+\/dist\/decap-cms\.js"/);
  assert.doesNotMatch(html, /decap-cms<script/);

  const yaml = await worker.fetch(
    new Request(`${ORIGIN}/admin/config.yml`, { headers: { cookie } }),
    env(house)
  );
  const config = await yaml.text();
  assert.match(config, /name: pages/);
  assert.match(config, /name: blog/);
  assert.match(config, /content\/pages\/qui-sommes-nous\.md/);

  const github = installGithub();
  try {
    const readPage = await proxy(
      cookie,
      users,
      { action: "getEntry", params: { branch: "main", path: "content/pages/qui-sommes-nous.md" } },
      "didier2a"
    );
    const page = await readPage.json();
    assert.equal(readPage.status, 200, JSON.stringify(page));
    assert.equal(page.data, "# Page secrète\n");

    const save = await proxy(
      cookie,
      users,
      {
        action: "persistEntry",
        params: {
          branch: "main",
          dataFiles: [{ path: "content/pages/nos-activites.md", raw: "# Activités\n" }],
          assets: [],
          options: { commitMessage: "Page" },
        },
      },
      "didier2a"
    );
    const saved = await save.json();
    assert.equal(save.status, 200, JSON.stringify(saved));
    assert.match(saved.message, /enregistré/);
  } finally {
    github.restore();
  }
});

test("un rôle signé qui ne correspond pas au compte est refusé ; un ancien cookie est déduit", async () => {
  const hash = await hashPassword("mot-de-passe-test", { iterations: 10000 });
  const users = JSON.stringify([{ username: "muriel", hash }]);
  const forged = await createSession(SESSION_SECRET, "muriel", ROLE_GITHUB_ADMIN);
  const forgedPage = await worker.fetch(
    new Request(`${ORIGIN}/admin/`, { headers: { cookie: `gem_admin_session=${forged}` } }),
    env({ users, githubLogins: "didier2a" })
  );
  assert.match(await forgedPage.text(), /Espace d’édition/);

  const legacyHouse = await createSession(SESSION_SECRET, "muriel", null);
  const legacyYaml = await worker.fetch(
    new Request(`${ORIGIN}/admin/config.yml`, { headers: { cookie: `gem_admin_session=${legacyHouse}` } }),
    env({ users, githubLogins: "didier2a" })
  );
  const legacyConfig = await legacyYaml.text();
  assert.doesNotMatch(legacyConfig, /content\/pages/);
  assert.match(legacyConfig, /name: blog/);

  const legacyAdmin = await createSession(SESSION_SECRET, "didier2a", null);
  const adminYaml = await worker.fetch(
    new Request(`${ORIGIN}/admin/config.yml`, { headers: { cookie: `gem_admin_session=${legacyAdmin}` } }),
    env({ users, githubLogins: "didier2a" })
  );
  assert.match(await adminYaml.text(), /name: pages/);
});
