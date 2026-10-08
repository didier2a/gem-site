import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword } from "../src/admin-auth.js";
import {
  decodeMedia,
  MAX_MEDIA_BASE64_CHARS,
  MAX_MEDIA_BYTES,
  MEDIA_TOO_LARGE_ERROR,
  roleMayUsePath,
} from "../src/decap-proxy.js";
import worker from "../src/index.js";

const PAT = "github_pat_TESTONLY_do_not_leak_ABCDEF";
const SESSION_SECRET = "session-secret-test-do-not-leak";
const ORIGIN = "https://gem-casa-preview.infoserv2a.workers.dev";

test("6 Mo se mesure après décodage base64, pas sur la longueur de la chaîne", () => {
  assert.equal(MAX_MEDIA_BYTES, 6_000_000);
  assert.equal(MAX_MEDIA_BASE64_CHARS, 8_000_000);

  const under = Buffer.alloc(4_500_001, 7);
  const underB64 = under.toString("base64");
  assert.ok(underB64.length > 6_000_000, "le base64 dépasse 6 Mo de caractères");
  assert.ok(underB64.length <= MAX_MEDIA_BASE64_CHARS);
  assert.equal(decodeMedia(underB64).length, under.length);

  const exact = Buffer.alloc(MAX_MEDIA_BYTES, 3);
  assert.equal(decodeMedia(exact.toString("base64")).length, MAX_MEDIA_BYTES);

  const wrapped = exact.toString("base64").replace(/(.{76})/g, "$1\n");
  assert.equal(decodeMedia(wrapped).length, MAX_MEDIA_BYTES);

  const dataUrl = `data:image/png;base64,${Buffer.from("img").toString("base64")}`;
  assert.equal(Buffer.from(decodeMedia(dataUrl)).toString("utf8"), "img");

  assert.throws(() => decodeMedia(Buffer.alloc(MAX_MEDIA_BYTES + 1, 1).toString("base64")), {
    message: MEDIA_TOO_LARGE_ERROR,
  });
  assert.throws(() => decodeMedia("A".repeat(MAX_MEDIA_BASE64_CHARS + 4)), {
    message: MEDIA_TOO_LARGE_ERROR,
  });
});

test("animatrice : image de page acceptée, image au-delà de 6 Mo refusée en français", async () => {
  assert.equal(roleMayUsePath("animatrice", "public/uploads/pages/photo.jpg"), true);
  assert.equal(roleMayUsePath("github_admin", "public/uploads/pages"), true);

  const hash = await hashPassword("mot-de-passe-test", { iterations: 10000 });
  const users = JSON.stringify([{ username: "muriel", hash }]);
  const env = {
    ADMIN_SESSION_SECRET: SESSION_SECRET,
    ADMIN_USERS: users,
    ADMIN_GITHUB_LOGINS: "didier2a",
    GITHUB_CONTENT_PAT: PAT,
    ASSETS: { async fetch() { return new Response("ok"); } },
  };
  const logged = await worker.fetch(
    new Request(`${ORIGIN}/api/admin-login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "muriel", password: "mot-de-passe-test" }),
    }),
    env
  );
  const cookie = String(logged.headers.get("set-cookie") || "").split(";")[0];

  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    calls.push(href);
    if (href.includes("/contents/public/uploads/")) {
      return Response.json({
        type: "file",
        encoding: "base64",
        content: Buffer.from("img").toString("base64"),
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

  async function proxy(body) {
    return worker.fetch(
      new Request(`${ORIGIN}/api/decap-proxy`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      env
    );
  }

  try {
    const saved = await proxy({
      action: "persistMedia",
      params: {
        asset: { path: "public/uploads/pages/photo.jpg", content: Buffer.from("img").toString("base64") },
      },
    });
    const savedBody = await saved.json();
    assert.equal(saved.status, 200, JSON.stringify(savedBody));
    assert.equal(savedBody.path, "public/uploads/pages/photo.jpg");

    const before = calls.length;
    const tooBig = await proxy({
      action: "persistMedia",
      params: {
        asset: { path: "public/uploads/blog/trop.jpg", content: "A".repeat(MAX_MEDIA_BASE64_CHARS + 4) },
      },
    });
    const tooBigBody = await tooBig.json();
    assert.equal(tooBig.status, 413);
    assert.equal(tooBigBody.error, MEDIA_TOO_LARGE_ERROR);
    assert.equal(calls.length, before, "un fichier trop lourd ne part pas vers GitHub");

    const empty = await proxy({
      action: "persistMedia",
      params: { asset: { path: "public/uploads/pages/vide.jpg", content: "" } },
    });
    const emptyBody = await empty.json();
    assert.equal(empty.status, 413);
    assert.match(emptyBody.error, /vide/i);
  } finally {
    globalThis.fetch = original;
  }
});
