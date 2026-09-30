import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { hashPassword } from "../src/admin-auth.js";
import worker from "../src/index.js";

const SESSION_SECRET = "session-secret-test-do-not-leak";
const OAUTH_SECRET = "oauth-client-secret-test-do-not-leak";
const CLIENT_ID = "iv1.test";
const ACCESS_TOKEN = "gho_test_do_not_leak";
const ORIGIN = "https://gem-casa-preview.infoserv2a.workers.dev";

const DECAP_HTML = `<!doctype html><html><head>
<script src="https://unpkg.com/decap-cms@^3.0.0/dist/decap-cms.js" defer></script>
</head><body></body></html>`;

function env(extra = {}) {
  return {
    ADMIN_SESSION_SECRET: SESSION_SECRET,
    ADMIN_USERS: extra.users ?? "",
    ADMIN_GITHUB_LOGINS: extra.githubLogins ?? "",
    GITHUB_OAUTH_CLIENT_ID: extra.clientId,
    GITHUB_OAUTH_CLIENT_SECRET: extra.clientSecret,
    ASSETS: {
      async fetch() {
        return new Response(DECAP_HTML, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      },
    },
  };
}

async function withFetch(impl, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

function cookiePair(header) {
  return String(header || "").split(";")[0];
}

describe("connexion GitHub sur la porte", { concurrency: false }, async () => {
  const hash = await hashPassword("mot-de-passe-test", { iterations: 10000 });
  const users = JSON.stringify([{ username: "muriel", hash }]);
  const house = { users, clientId: CLIENT_ID, clientSecret: OAUTH_SECRET, githubLogins: "Compte-GitHub" };

  test("la page de connexion montre le mot de passe et GitHub, sans secret", async () => {
    const page = await worker.fetch(new Request(`${ORIGIN}/admin/`), env(house));
    const html = await page.text();
    assert.match(html, /name="password"/);
    assert.match(html, /action="\/api\/admin-login"/);
    assert.match(html, /href="\/admin\/mot-de-passe-oublie"/);
    assert.match(html, /href="\/api\/oauth\?intent=admin"/);
    assert.match(html, /Se connecter avec GitHub/);
    assert.doesNotMatch(html, new RegExp(OAUTH_SECRET));
    assert.doesNotMatch(html, /unpkg\.com\/decap-cms/);

    const login = await worker.fetch(
      new Request(`${ORIGIN}/api/admin-login`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ username: "muriel", password: "mot-de-passe-test" }),
      }),
      env({ users })
    );
    assert.equal(login.status, 303);
    assert.match(login.headers.get("set-cookie") || "", /^gem_admin_session=/);
    assert.doesNotMatch(login.headers.get("set-cookie") || "", /gho_|github/);
  });

  test("intent=admin ouvre une session pour le login autorisé, sans exposer le jeton", async () => {
    const start = await worker.fetch(new Request(`${ORIGIN}/api/oauth?intent=admin`), env(house));
    assert.equal(start.status, 302);
    const location = new URL(start.headers.get("location"));
    assert.equal(location.origin + location.pathname, "https://github.com/login/oauth/authorize");
    assert.equal(location.searchParams.get("client_id"), CLIENT_ID);
    assert.equal(location.searchParams.get("scope"), "read:user");
    assert.match(location.searchParams.get("state") || "", /^a\./);
    assert.doesNotMatch(location.toString(), new RegExp(OAUTH_SECRET));
    const stateCookie = cookiePair(start.headers.get("set-cookie"));
    const state = location.searchParams.get("state");

    const done = await withFetch(async (url, init = {}) => {
      const href = String(url);
      if (href === "https://github.com/login/oauth/access_token") {
        const body = JSON.parse(init.body);
        assert.equal(body.client_secret, OAUTH_SECRET);
        assert.equal(body.code, "code-test");
        return Response.json({ access_token: ACCESS_TOKEN });
      }
      if (href === "https://api.github.com/user") {
        assert.equal(init.headers.authorization, `Bearer ${ACCESS_TOKEN}`);
        return Response.json({ login: "compte-github" });
      }
      throw new Error(`appel inattendu ${href}`);
    }, () =>
      worker.fetch(
        new Request(`${ORIGIN}/api/oauth/callback?code=code-test&state=${encodeURIComponent(state)}`, {
          headers: { cookie: stateCookie },
        }),
        env(house)
      )
    );

    assert.equal(done.status, 303);
    assert.equal(done.headers.get("location"), "/admin/");
    const body = await done.text();
    assert.equal(body, "");
    const cookies = done.headers.getSetCookie();
    const session = cookies.find((item) => item.startsWith("gem_admin_session="));
    const cleared = cookies.find((item) => item.startsWith("gem_oauth_state="));
    assert.ok(session);
    assert.match(session, /HttpOnly/);
    assert.doesNotMatch(session, new RegExp(ACCESS_TOKEN));
    assert.match(cleared || "", /Max-Age=0/);

    const admin = await worker.fetch(
      new Request(`${ORIGIN}/admin/`, { headers: { cookie: cookiePair(session) } }),
      env(house)
    );
    const html = await admin.text();
    assert.match(html, /decap-cms/);
    assert.match(html, /compte-github/);
    assert.doesNotMatch(html, /name="password"/);
    assert.doesNotMatch(html, new RegExp(ACCESS_TOKEN));
  });

  test("un login GitHub non listé n’obtient pas de session", async () => {
    const start = await worker.fetch(new Request(`${ORIGIN}/api/oauth?intent=admin`), env(house));
    const state = new URL(start.headers.get("location")).searchParams.get("state");
    const stateCookie = cookiePair(start.headers.get("set-cookie"));
    const done = await withFetch(async (url) => {
      if (String(url) === "https://github.com/login/oauth/access_token") {
        return Response.json({ access_token: ACCESS_TOKEN });
      }
      return Response.json({ login: "intrus" });
    }, () =>
      worker.fetch(
        new Request(`${ORIGIN}/api/oauth/callback?code=code-test&state=${encodeURIComponent(state)}`, {
          headers: { cookie: stateCookie },
        }),
        env(house)
      )
    );
    const html = await done.text();
    assert.equal(done.status, 403);
    assert.match(html, /n’est pas autorisé/);
    assert.doesNotMatch(html, new RegExp(ACCESS_TOKEN));
    assert.doesNotMatch(html, new RegExp(OAUTH_SECRET));
    assert.equal(done.headers.getSetCookie().some((item) => item.startsWith("gem_admin_session=")), false);
  });

  test("sans intent, le callback reste le dialogue Decap et ne pose pas la session", async () => {
    const start = await worker.fetch(new Request(`${ORIGIN}/api/oauth`), env(house));
    const location = new URL(start.headers.get("location"));
    assert.equal(location.searchParams.get("scope"), "repo user");
    assert.doesNotMatch(location.searchParams.get("state") || "", /^a\./);
    const state = location.searchParams.get("state");
    const stateCookie = cookiePair(start.headers.get("set-cookie"));
    const done = await withFetch(async (url) => {
      if (String(url).includes("api.github.com/user")) throw new Error("le dialogue Decap ne doit pas lire /user");
      return Response.json({ access_token: ACCESS_TOKEN });
    }, () =>
      worker.fetch(
        new Request(`${ORIGIN}/api/oauth/callback?code=code-test&state=${state}`, {
          headers: { cookie: stateCookie },
        }),
        env(house)
      )
    );
    const html = await done.text();
    assert.equal(done.status, 200);
    assert.match(html, /authorization:github:success:/);
    assert.match(html, new RegExp(ACCESS_TOKEN));
    assert.equal(done.headers.getSetCookie().some((item) => item.startsWith("gem_admin_session=")), false);
  });
});
