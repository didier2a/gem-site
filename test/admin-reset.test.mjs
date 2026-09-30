import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, test } from "node:test";
import worker from "../src/index.js";
import { hashPassword, parseUsers, verifyPassword } from "../src/admin-auth.js";
import {
  FORGOT_SUCCESS,
  PREVIEW_ORIGIN,
  consumeResetJti,
  issueResetToken,
  readResetToken,
} from "../src/admin-reset.js";

const SESSION_SECRET = "session-secret-test-do-not-leak";
const RESEND_KEY = "re_test_do_not_leak";
const RESEND_FROM = "GEM Test <motdepasse@example.org>";
const CF_TOKEN = "cf-token-test-do-not-leak";
const CF_ACCOUNT = "0123456789abcdef0123456789abcdef";
const ORIGIN = PREVIEW_ORIGIN;

const DECAP_HTML = `<!doctype html><html><head>
<script src="https://unpkg.com/decap-cms@^3.0.0/dist/decap-cms.js" defer></script>
</head><body></body></html>`;

function memoryKv() {
  const map = new Map();
  return {
    async get(key) {
      const row = map.get(key);
      if (!row) return null;
      if (row.expires && row.expires <= Date.now()) {
        map.delete(key);
        return null;
      }
      return row.value;
    },
    async put(key, value, options = {}) {
      const ttl = options.expirationTtl;
      if (ttl != null && (!Number.isFinite(ttl) || ttl < 60)) {
        throw new Error(`expirationTtl invalide: ${ttl}`);
      }
      map.set(key, {
        value: String(value),
        expires: ttl ? Date.now() + ttl * 1000 : 0,
      });
    },
    async delete(key) {
      map.delete(key);
    },
  };
}

function makeEnv({ users, kv = memoryKv(), extra = {} } = {}) {
  return {
    ADMIN_SESSION_SECRET: SESSION_SECRET,
    ADMIN_USERS: users ?? "",
    RESEND_API_KEY: extra.resendKey === undefined ? RESEND_KEY : extra.resendKey,
    RESEND_FROM: extra.resendFrom === undefined ? RESEND_FROM : extra.resendFrom,
    ADMIN_SUPERADMIN_EMAIL: extra.super ?? "super@example.org",
    ADMIN_NOTIFY_EMAIL: extra.notify ?? "notify@example.org",
    ADMIN_RESET_KV: extra.kv === undefined ? kv : extra.kv,
    CF_API_TOKEN: extra.cfToken,
    CF_ACCOUNT_ID: extra.cfAccount,
    ASSETS: {
      async fetch() {
        return new Response(DECAP_HTML, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      },
    },
  };
}

async function storedHash() {
  return hashPassword("mot-de-passe-test", { iterations: 10000 });
}

function post(pathname, fields, { ip = "203.0.113.10", host = ORIGIN } = {}) {
  return new Request(`${host}${pathname}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "cf-connecting-ip": ip,
    },
    body: new URLSearchParams(fields),
  });
}

async function withFetch(impl, fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(String(init.body)) : null;
    const call = { url: String(url), method: init.method, headers: init.headers || {}, body };
    calls.push(call);
    return impl(call);
  };
  try {
    await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

function okMail() {
  return new Response(JSON.stringify({ id: "email_1" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function linkIn(text) {
  const match = String(text).match(/https:\/\/gem-casa-preview\.infoserv2a\.workers\.dev\/\S+/);
  assert.ok(match, text);
  return new URL(match[0]);
}

describe("mot de passe oublié", { concurrency: false }, () => {
  test("parseUsers garde l’adresse et reste compatible sans", async () => {
    const hash = "pbkdf2$10000$aaaa$bbbb";
    const users = parseUsers(
      JSON.stringify([
        { username: "muriel", hash, email: "Muriel@Example.org" },
        { username: "bureau", hash },
      ])
    );
    assert.equal(users[0].email, "muriel@example.org");
    assert.equal(users[1].email, undefined);
    assert.equal(await verifyPassword("autre", hash), false);
    assert.equal(
      parseUsers(JSON.stringify([{ username: "muriel", hash, email: "pas-une-adresse" }])),
      null
    );
    const legacy = parseUsers(JSON.stringify([{ username: "muriel", hash }]));
    assert.equal(legacy[0].username, "muriel");
    assert.equal(legacy[0].email, undefined);
  });

  test("la connexion affiche le lien et un compte avec adresse entre encore", async () => {
    const hash = await storedHash();
    const users = JSON.stringify([{ username: "muriel", hash, email: "animatrice@example.org" }]);
    const page = await worker.fetch(new Request(`${ORIGIN}/admin/`), makeEnv({ users }));
    const html = await page.text();
    assert.match(html, /href="\/admin\/mot-de-passe-oublie"/);
    assert.match(html, /Mot de passe oublié/);
    assert.doesNotMatch(html, /unpkg\.com\/decap-cms/);

    const login = await worker.fetch(
      post("/api/admin-login", { username: "muriel", password: "mot-de-passe-test" }),
      makeEnv({ users })
    );
    assert.equal(login.status, 303);
    assert.match(login.headers.get("set-cookie") || "", /^gem_admin_session=/);
  });

  test("le formulaire oublié et un chemin reset-password ne chargent pas Decap", async () => {
    const hash = await storedHash();
    const users = JSON.stringify([{ username: "muriel", hash }]);
    const forgot = await worker.fetch(
      new Request(`${ORIGIN}/admin/mot-de-passe-oublie`),
      makeEnv({ users })
    );
    const forgotHtml = await forgot.text();
    assert.equal(forgot.status, 200);
    assert.match(forgotHtml, /Identifiant ou adresse/);
    assert.doesNotMatch(forgotHtml, /unpkg\.com\/decap-cms/);

    const other = await worker.fetch(new Request(`${ORIGIN}/admin/reset-password`), makeEnv({ users }));
    const otherHtml = await other.text();
    assert.match(otherHtml, /Espace d’édition/);
    assert.doesNotMatch(otherHtml, /Nouveau mot de passe/);
    assert.doesNotMatch(otherHtml, /unpkg\.com\/decap-cms/);
  });

  test("réponse oubliée identique, sans énumération", async () => {
    const hash = await storedHash();
    const users = JSON.stringify([{ username: "muriel", hash, email: "animatrice@example.org" }]);
    const env = makeEnv({ users });
    await withFetch(() => okMail(), async (calls) => {
      const unknown = await worker.fetch(post("/api/admin-mot-de-passe-oublie", { identifiant: "personne" }), env);
      const unknownHtml = await unknown.text();
      assert.equal(unknown.status, 200);
      assert.equal(calls.length, 0);

      const known = await worker.fetch(
        post("/api/admin-mot-de-passe-oublie", { identifiant: "muriel" }, { host: "https://evil.example" }),
        env
      );
      const knownHtml = await known.text();
      assert.equal(known.status, 200);
      assert.equal(knownHtml, unknownHtml);
      assert.match(knownHtml, new RegExp(FORGOT_SUCCESS.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.doesNotMatch(knownHtml, /muriel|animatrice@example\.org|introuvable|aucun compte/i);
      assert.equal(calls.length, 1);
      const link = linkIn(calls[0].body.text);
      assert.equal(link.origin, PREVIEW_ORIGIN);
      assert.equal(link.pathname, "/admin/");
      assert.ok(link.searchParams.get("reset"));
      assert.doesNotMatch(calls[0].body.text, /reset-password|evil\.example/);
    });
  });

  test("Resend : bcc, dédoublonnage, récupération, expéditeur du secret", async () => {
    const hash = await storedHash();
    const cases = [
      {
        name: "primaire et deux copies",
        email: "animatrice@example.org",
        super: "super@example.org",
        notify: "notify@example.org",
        to: ["animatrice@example.org"],
        bcc: ["super@example.org", "notify@example.org"],
        recovery: false,
      },
      {
        name: "secrets de notification identiques",
        email: "animatrice@example.org",
        super: "copie@example.org",
        notify: "Copie@Example.org",
        to: ["animatrice@example.org"],
        bcc: ["copie@example.org"],
        recovery: false,
      },
      {
        name: "superadmin égal à la primaire",
        email: "animatrice@example.org",
        super: "Animatrice@Example.org",
        notify: "notify@example.org",
        to: ["animatrice@example.org"],
        bcc: ["notify@example.org"],
        recovery: false,
      },
      {
        name: "tous égaux à la primaire",
        email: "animatrice@example.org",
        super: "animatrice@example.org",
        notify: "ANIMATRICE@example.org",
        to: ["animatrice@example.org"],
        bcc: undefined,
        recovery: false,
      },
      {
        name: "compte sans adresse",
        email: "",
        super: "super@example.org",
        notify: "notify@example.org",
        to: ["super@example.org"],
        bcc: ["notify@example.org"],
        recovery: true,
      },
      {
        name: "compte sans adresse et secrets identiques",
        email: "",
        super: "super@example.org",
        notify: "super@example.org",
        to: ["super@example.org"],
        bcc: undefined,
        recovery: true,
      },
    ];

    for (const item of cases) {
      const entry = { username: "muriel", hash };
      if (item.email) entry.email = item.email;
      const env = makeEnv({
        users: JSON.stringify([entry]),
        extra: { super: item.super, notify: item.notify },
      });
      await withFetch(() => okMail(), async (calls) => {
        const response = await worker.fetch(
          post("/api/admin-mot-de-passe-oublie", { identifiant: item.email ? "Animatrice@Example.org" : "muriel" }),
          env
        );
        assert.equal(response.status, 200, item.name);
        assert.equal(calls.length, 1, item.name);
        const mail = calls[0];
        assert.equal(mail.url, "https://api.resend.com/emails", item.name);
        assert.equal(mail.body.from, RESEND_FROM, item.name);
        assert.deepEqual(mail.body.to, item.to, item.name);
        assert.deepEqual(mail.body.bcc, item.bcc, item.name);
        assert.equal(mail.headers.Authorization, `Bearer ${RESEND_KEY}`, item.name);
        assert.doesNotMatch(mail.body.from, /onboarding@resend\.dev/, item.name);
        const link = linkIn(mail.body.text);
        assert.equal(link.pathname, "/admin/", item.name);
        assert.match(mail.body.text, /Compte : muriel/, item.name);
        if (item.recovery) assert.match(mail.body.text, /Copie de récupération/, item.name);
        else assert.doesNotMatch(mail.body.text, /Copie de récupération/, item.name);
        const html = await response.text();
        assert.doesNotMatch(html, new RegExp(RESEND_KEY));
        assert.doesNotMatch(html, /pbkdf2\$/);
      });
    }
  });

  test("si Resend refuse le bcc, des courriels copie partent séparément", async () => {
    const hash = await storedHash();
    const users = JSON.stringify([{ username: "muriel", hash, email: "animatrice@example.org" }]);
    const env = makeEnv({ users, extra: { super: "super@example.org", notify: "notify@example.org" } });
    await withFetch((call) => {
      if (call.body.bcc) return new Response("bcc refused", { status: 403 });
      return okMail();
    }, async (calls) => {
      const response = await worker.fetch(post("/api/admin-mot-de-passe-oublie", { identifiant: "muriel" }), env);
      assert.equal(response.status, 200);
      assert.equal(calls.length, 4);
      assert.deepEqual(calls[0].body.bcc, ["super@example.org", "notify@example.org"]);
      assert.equal(calls[1].body.to[0], "animatrice@example.org");
      assert.equal(calls[1].body.bcc, undefined);
      assert.doesNotMatch(calls[1].body.subject, /^Copie — /);
      assert.match(calls[2].body.subject, /^Copie — /);
      assert.match(calls[3].body.subject, /^Copie — /);
      assert.equal(calls[2].body.to[0], "super@example.org");
      assert.equal(calls[3].body.to[0], "notify@example.org");
      const link = linkIn(calls[2].body.text);
      assert.equal(link.pathname, "/admin/");
    });
  });

  test("sans KV, sans clé ou sans expéditeur : même succès, aucun envoi", async () => {
    const hash = await storedHash();
    const users = JSON.stringify([{ username: "muriel", hash, email: "animatrice@example.org" }]);
    const variants = [
      makeEnv({ users, extra: { kv: null } }),
      makeEnv({ users, extra: { resendKey: "" } }),
      makeEnv({ users, extra: { resendFrom: "" } }),
    ];
    for (const env of variants) {
      await withFetch(() => okMail(), async (calls) => {
        const response = await worker.fetch(post("/api/admin-mot-de-passe-oublie", { identifiant: "muriel" }), env);
        const html = await response.text();
        assert.equal(response.status, 200);
        assert.match(html, /Si un compte correspond/);
        assert.equal(calls.length, 0);
        assert.doesNotMatch(html, /onboarding@resend\.dev/);
      });
    }
  });

  test("plafond oublié et plafond réinitialisation", async () => {
    const hash = await storedHash();
    const users = JSON.stringify([{ username: "muriel", hash }]);
    const forgotEnv = makeEnv({ users });
    for (let i = 0; i < 5; i++) {
      const response = await worker.fetch(
        post("/api/admin-mot-de-passe-oublie", { identifiant: "inconnu" }, { ip: "203.0.113.50" }),
        forgotEnv
      );
      assert.equal(response.status, 200);
    }
    const blocked = await worker.fetch(
      post("/api/admin-mot-de-passe-oublie", { identifiant: "muriel" }, { ip: "203.0.113.50" }),
      forgotEnv
    );
    const blockedHtml = await blocked.text();
    assert.equal(blocked.status, 429);
    assert.match(blockedHtml, /Trop de tentatives/);
    assert.doesNotMatch(blockedHtml, /Si un compte correspond/);

    const resetEnv = makeEnv({ users });
    for (let i = 0; i < 8; i++) {
      const response = await worker.fetch(
        post("/api/admin-nouveau-mot-de-passe", { token: "jeton-invalide", password: "aaaaaaaa", confirmation: "aaaaaaaa" }, { ip: "203.0.113.60" }),
        resetEnv
      );
      assert.equal(response.status, 400);
    }
    const resetBlocked = await worker.fetch(
      post("/api/admin-nouveau-mot-de-passe", { token: "jeton-invalide", password: "aaaaaaaa", confirmation: "aaaaaaaa" }, { ip: "203.0.113.60" }),
      resetEnv
    );
    assert.equal(resetBlocked.status, 429);
    assert.match(await resetBlocked.text(), /Trop de tentatives/);
  });

  test("jeton expiré, déjà utilisé, ou plus lié à l’empreinte", async () => {
    const hash = await storedHash();
    const user = { username: "muriel", hash, email: "animatrice@example.org" };
    const kv = memoryKv();
    const expired = await issueResetToken(SESSION_SECRET, kv, user, Date.now() - 2 * 60 * 60 * 1000);
    assert.equal(await readResetToken(expired, SESSION_SECRET, kv, [user]), null);

    const kvLive = memoryKv();
    const token = await issueResetToken(SESSION_SECRET, kvLive, user);
    const first = await readResetToken(token, SESSION_SECRET, kvLive, [user]);
    assert.equal(first.username, "muriel");
    assert.equal(await consumeResetJti(kvLive, first.jti, first.username), true);
    assert.equal(await readResetToken(token, SESSION_SECRET, kvLive, [user]), null);
    assert.equal(await consumeResetJti(kvLive, first.jti, first.username), false);

    const kvHash = memoryKv();
    const bound = await issueResetToken(SESSION_SECRET, kvHash, user);
    const moved = { ...user, hash: `${hash}autre` };
    assert.equal(await readResetToken(bound, SESSION_SECRET, kvHash, [moved]), null);

    const env = makeEnv({ users: JSON.stringify([user]), kv });
    const page = await worker.fetch(
      new Request(`${ORIGIN}/admin/?reset=${encodeURIComponent(expired)}`),
      env
    );
    const html = await page.text();
    assert.equal(page.status, 400);
    assert.match(html, /plus valable/);
    assert.doesNotMatch(html, /unpkg\.com\/decap-cms/);
    assert.doesNotMatch(html, /<script>alert/);
  });

  test("un jeton de réinitialisation n’ouvre pas la session, et /admin/?reset= masque Decap", async () => {
    const hash = await storedHash();
    const user = { username: "muriel", hash };
    const users = JSON.stringify([user]);
    const kv = memoryKv();
    const token = await issueResetToken(SESSION_SECRET, kv, user);
    const env = makeEnv({ users, kv });

    const asCookie = await worker.fetch(
      new Request(`${ORIGIN}/admin/`, { headers: { cookie: `gem_admin_session=${token}` } }),
      env
    );
    const cookieHtml = await asCookie.text();
    assert.match(cookieHtml, /Espace d’édition/);
    assert.doesNotMatch(cookieHtml, /unpkg\.com\/decap-cms/);

    const login = await worker.fetch(post("/api/admin-login", { username: "muriel", password: "mot-de-passe-test" }), env);
    const cookie = login.headers.get("set-cookie");
    const reset = await worker.fetch(
      new Request(`${ORIGIN}/admin?reset=${encodeURIComponent(token)}`, { headers: { cookie } }),
      env
    );
    const html = await reset.text();
    assert.equal(reset.status, 200);
    assert.equal(reset.headers.get("location"), null);
    assert.match(html, /Nouveau mot de passe/);
    assert.match(html, /name="confirmation"/);
    assert.match(html, /action="\/api\/admin-nouveau-mot-de-passe"/);
    assert.doesNotMatch(html, /unpkg\.com\/decap-cms/);
    assert.doesNotMatch(html, /Se déconnecter/);

    const xss = await worker.fetch(
      new Request(`${ORIGIN}/admin/?reset=${encodeURIComponent("<script>alert(1)</script>")}`),
      env
    );
    assert.doesNotMatch(await xss.text(), /<script>alert|alert\(1\)/);
  });

  test("mots de passe trop court ou différents : le jeton reste utilisable", async () => {
    const hash = await storedHash();
    const users = JSON.stringify([{ username: "muriel", hash, email: "animatrice@example.org" }]);
    const env = makeEnv({ users, extra: { super: "super@example.org", notify: "notify@example.org" } });
    await withFetch(() => okMail(), async (calls) => {
      await worker.fetch(post("/api/admin-mot-de-passe-oublie", { identifiant: "muriel" }), env);
      const token = linkIn(calls[0].body.text).searchParams.get("reset");
      const short = await worker.fetch(
        post("/api/admin-nouveau-mot-de-passe", { token, password: "court", confirmation: "court" }),
        env
      );
      assert.equal(short.status, 400);
      assert.match(await short.text(), /8 caractères/);
      assert.equal(calls.length, 1);

      const mismatch = await worker.fetch(
        post("/api/admin-nouveau-mot-de-passe", {
          token,
          password: "nouveau-mot-9",
          confirmation: "nouveau-mot-8",
        }),
        env
      );
      const mismatchHtml = await mismatch.text();
      assert.equal(mismatch.status, 400);
      assert.match(mismatchHtml, /ne correspondent pas/);
      assert.doesNotMatch(mismatchHtml, /nouveau-mot-9|pbkdf2\$/);
      assert.equal(calls.length, 1);

      const ok = await worker.fetch(
        post("/api/admin-nouveau-mot-de-passe", {
          token,
          password: "nouveau-mot-9",
          confirmation: "nouveau-mot-9",
        }),
        env
      );
      assert.equal(ok.status, 200);
      assert.match(await ok.text(), /pas encore actif/);
    });
  });

  test("sans API Cloudflare, le JSON part seulement aux adresses de notification, une fois", async () => {
    const hash = await storedHash();
    const other = await hashPassword("autre-mot-de-passe", { iterations: 10000 });
    const users = JSON.stringify([
      { username: "muriel", hash, email: "animatrice@example.org" },
      { username: "bureau", hash: other, email: "bureau@example.org" },
    ]);
    const env = makeEnv({ users });
    const password = "nouveau-mot-9";
    await withFetch(() => okMail(), async (calls) => {
      await worker.fetch(post("/api/admin-mot-de-passe-oublie", { identifiant: "muriel" }), env);
      const token = linkIn(calls[0].body.text).searchParams.get("reset");
      const response = await worker.fetch(
        post("/api/admin-nouveau-mot-de-passe", { token, password, confirmation: password }),
        env
      );
      const html = await response.text();
      assert.equal(response.status, 200);
      assert.match(html, /pas encore actif/);
      assert.match(html, /courriel/);
      assert.match(response.headers.get("set-cookie") || "", /Max-Age=0/);
      assert.doesNotMatch(html, /pbkdf2\$|nouveau-mot-9|animatrice@example\.org/);
      assert.equal(calls.length, 2);
      assert.ok(calls.every((call) => call.url === "https://api.resend.com/emails"));
      const secretMail = calls[1].body;
      const recipients = [...secretMail.to, ...(secretMail.bcc || [])];
      assert.deepEqual(recipients.sort(), ["notify@example.org", "super@example.org"]);
      assert.ok(!recipients.includes("animatrice@example.org"));
      assert.match(secretMail.text, /à coller à la main/);
      assert.match(secretMail.text, /n’est pas configuré/);
      const line = secretMail.text.split("\n").find((row) => row.startsWith("["));
      const parsed = JSON.parse(line);
      assert.equal(parsed[1].username, "bureau");
      assert.equal(parsed[1].hash, other);
      assert.equal(parsed[0].email, "animatrice@example.org");
      assert.equal(await verifyPassword(password, parsed[0].hash), true);
      assert.doesNotMatch(html, new RegExp(parsed[0].hash.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

      const again = await worker.fetch(
        post("/api/admin-nouveau-mot-de-passe", { token, password, confirmation: password }),
        env
      );
      assert.equal(again.status, 400);
      assert.match(await again.text(), /plus valable/);
      assert.equal(calls.length, 2);
    });
  });

  test("avec l’API Cloudflare, ADMIN_USERS est mis à jour et le navigateur ne voit pas l’empreinte", async () => {
    const hash = await storedHash();
    const users = JSON.stringify([{ username: "muriel", hash, email: "animatrice@example.org" }]);
    const env = makeEnv({ users, extra: { cfToken: CF_TOKEN, cfAccount: CF_ACCOUNT } });
    const password = "nouveau-mot-9";
    await withFetch((call) => {
      if (call.url.startsWith("https://api.cloudflare.com/")) {
        return new Response(
          JSON.stringify({
            success: true,
            result: { name: "ADMIN_USERS", text: "ECHO_SHOULD_NOT_LEAK", type: "secret_text" },
          }),
          { status: 200 }
        );
      }
      return okMail();
    }, async (calls) => {
      await worker.fetch(post("/api/admin-mot-de-passe-oublie", { identifiant: "muriel" }), env);
      const token = linkIn(calls[0].body.text).searchParams.get("reset");
      const response = await worker.fetch(
        post("/api/admin-nouveau-mot-de-passe", { token, password, confirmation: password }),
        env
      );
      const html = await response.text();
      assert.equal(response.status, 200);
      assert.match(html, /mise à jour automatique/);
      assert.doesNotMatch(html, /pbkdf2\$|ECHO_SHOULD_NOT_LEAK|nouveau-mot-9|cf-token-test/);
      const put = calls.find((call) => call.url.startsWith("https://api.cloudflare.com/"));
      assert.ok(put);
      assert.equal(put.method, "PUT");
      assert.equal(
        put.url,
        `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/workers/scripts/gem-casa-preview/secrets`
      );
      assert.equal(put.headers.Authorization, `Bearer ${CF_TOKEN}`);
      assert.equal(put.body.name, "ADMIN_USERS");
      assert.equal(put.body.type, "secret_text");
      const parsed = JSON.parse(put.body.text);
      assert.equal(parsed[0].email, "animatrice@example.org");
      assert.equal(await verifyPassword(password, parsed[0].hash), true);
      assert.doesNotMatch(html, new RegExp(parsed[0].hash.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      const notices = calls.filter((call) => call.url.includes("api.resend.com") && call !== calls[0]);
      assert.ok(notices.length >= 1);
      for (const notice of notices) {
        assert.doesNotMatch(notice.body.text, /pbkdf2\$|ECHO_SHOULD_NOT_LEAK|nouveau-mot-9/);
        assert.match(notice.body.text, /mise à jour automatique/);
      }
      const again = await worker.fetch(
        post("/api/admin-nouveau-mot-de-passe", { token, password, confirmation: password }),
        env
      );
      assert.equal(again.status, 400);
      assert.match(await again.text(), /plus valable/);
    });
  });

  test("si l’API échoue, le JSON part par courriel sans recopier la réponse Cloudflare", async () => {
    const hash = await storedHash();
    const users = JSON.stringify([{ username: "muriel", hash, email: "animatrice@example.org" }]);
    const env = makeEnv({ users, extra: { cfToken: CF_TOKEN, cfAccount: CF_ACCOUNT } });
    const password = "nouveau-mot-9";
    await withFetch((call) => {
      if (call.url.startsWith("https://api.cloudflare.com/")) {
        return new Response(JSON.stringify({ success: false, errors: [{ message: "ECHO_SHOULD_NOT_LEAK" }] }), {
          status: 403,
        });
      }
      return okMail();
    }, async (calls) => {
      await worker.fetch(post("/api/admin-mot-de-passe-oublie", { identifiant: "muriel" }), env);
      const token = linkIn(calls[0].body.text).searchParams.get("reset");
      const response = await worker.fetch(
        post("/api/admin-nouveau-mot-de-passe", { token, password, confirmation: password }),
        env
      );
      const html = await response.text();
      assert.match(html, /pas encore actif/);
      assert.doesNotMatch(html, /pbkdf2\$|ECHO_SHOULD_NOT_LEAK|nouveau-mot-9/);
      const secretMail = calls.find((call) => call.body?.subject?.includes("ADMIN_USERS"));
      assert.ok(secretMail);
      assert.match(secretMail.body.text, /HTTP 403/);
      assert.match(secretMail.body.text, /pbkdf2\$/);
      assert.doesNotMatch(secretMail.body.text, /ECHO_SHOULD_NOT_LEAK/);
      const recipients = [...secretMail.body.to, ...(secretMail.body.bcc || [])];
      assert.deepEqual(recipients.sort(), ["notify@example.org", "super@example.org"]);
    });
  });

  test("le script ajoute l’adresse sans afficher le mot de passe", async () => {
    const password = "phrase-de-test-assez-longue";
    const run = spawnSync(
      process.execPath,
      ["scripts/hash-admin-password.mjs", "muriel", "Muriel@Example.org"],
      { env: { ...process.env, ADMIN_PASSWORD: password }, encoding: "utf8" }
    );
    assert.equal(run.status, 0, run.stderr);
    assert.doesNotMatch(run.stdout, new RegExp(password));
    const parsed = JSON.parse(run.stdout.trim().split("\n").at(-1));
    assert.equal(parsed[0].username, "muriel");
    assert.equal(parsed[0].email, "muriel@example.org");
    assert.equal(await verifyPassword(password, parsed[0].hash), true);

    const bad = spawnSync(process.execPath, ["scripts/hash-admin-password.mjs", "muriel", "pas-une-adresse"], {
      env: { ...process.env, ADMIN_PASSWORD: password },
      encoding: "utf8",
    });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /Adresse refusée/);
    assert.doesNotMatch(`${bad.stdout}${bad.stderr}`, new RegExp(password));
  });
});
