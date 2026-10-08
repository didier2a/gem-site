import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { createSession, ROLE_GITHUB_ADMIN } from "../src/admin-auth.js";
import {
  assertMediaBase64,
  canonicalMediaRepoPath,
  decodedBase64Size,
  encodeMediaPointer,
  MAX_MEDIA_BASE64_CHARS,
  MAX_MEDIA_BYTES,
  MEDIA_TOO_LARGE_ERROR,
  MEDIA_URL_MARKER,
  publicUrlForRepoPath,
  roleMayUsePath,
} from "../src/decap-proxy.js";
import worker from "../src/index.js";

const PAT = "github_pat_TESTONLY_do_not_leak_ABCDEF";
const SESSION_SECRET = "session-secret-test-do-not-leak";
const ORIGIN = "https://gem-casa-preview.infoserv2a.workers.dev";
const USERS = JSON.stringify([{ username: "muriel", hash: "pbkdf2$10000$salt$hash" }]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

function imageBase64(size, magic) {
  const bytes = Buffer.alloc(size, 9);
  magic.copy(bytes, 0);
  return bytes.toString("base64");
}

function env() {
  return {
    ADMIN_SESSION_SECRET: SESSION_SECRET,
    ADMIN_USERS: USERS,
    ADMIN_GITHUB_LOGINS: "didier2a",
    GITHUB_CONTENT_PAT: PAT,
    ASSETS: { async fetch() { return new Response("ok"); } },
  };
}

async function cookieFor(username, role) {
  const token = await createSession(SESSION_SECRET, username, role);
  return `gem_admin_session=${token}`;
}

function installGithub(reply) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    const method = init.method || "GET";
    calls.push({ href, method, body: init.body || "" });
    return reply(href, method, init);
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

function standardWrite(href, method) {
  if (href.endsWith("/git/ref/heads/main")) return Response.json({ object: { sha: "commit1" } });
  if (href.endsWith("/git/commits/commit1")) return Response.json({ tree: { sha: "tree1" } });
  if (href.endsWith("/git/blobs") && method === "POST") return Response.json({ sha: "blob1" });
  if (href.endsWith("/git/trees") && method === "POST") return Response.json({ sha: "tree2" });
  if (href.endsWith("/git/commits") && method === "POST") return Response.json({ sha: "commit2" });
  if (href.endsWith("/git/refs/heads/main") && method === "PATCH") return Response.json({ ref: "refs/heads/main" });
  return null;
}

test("6 Mo se mesure sur la longueur base64 et le padding, sans décoder", () => {
  assert.equal(MAX_MEDIA_BYTES, 6_000_000);
  assert.equal(MAX_MEDIA_BASE64_CHARS, 8_000_000);

  const under = Buffer.alloc(4_500_001, 7);
  const underB64 = under.toString("base64");
  assert.ok(underB64.length > 6_000_000);
  assert.ok(underB64.length <= MAX_MEDIA_BASE64_CHARS);
  assert.equal(decodedBase64Size(assertMediaBase64(underB64)), under.length);

  const exact = Buffer.alloc(MAX_MEDIA_BYTES, 3).toString("base64");
  assert.equal(decodedBase64Size(assertMediaBase64(exact)), MAX_MEDIA_BYTES);
  const wrapped = exact.replace(/(.{76})/g, "$1\n");
  assert.equal(decodedBase64Size(assertMediaBase64(wrapped)), MAX_MEDIA_BYTES);

  const dataUrl = `data:image/png;base64,${Buffer.from("img").toString("base64")}`;
  assert.equal(assertMediaBase64(dataUrl), Buffer.from("img").toString("base64"));

  assert.throws(() => assertMediaBase64(Buffer.alloc(MAX_MEDIA_BYTES + 1, 1).toString("base64")), {
    message: MEDIA_TOO_LARGE_ERROR,
  });
  assert.throws(() => assertMediaBase64("A".repeat(MAX_MEDIA_BASE64_CHARS + 4)), {
    message: MEDIA_TOO_LARGE_ERROR,
  });
  assert.throws(() => assertMediaBase64("@@@@"), /illisible/i);
});

test("un media_folder sans slash est ramené vers public/uploads", () => {
  assert.equal(
    canonicalMediaRepoPath("content/pages/public/uploads/pages/img_0033.png"),
    "public/uploads/pages/img_0033.png"
  );
  assert.equal(
    canonicalMediaRepoPath("content/blog/public/uploads/blog/cover.png"),
    "public/uploads/blog/cover.png"
  );
  assert.equal(canonicalMediaRepoPath("content/pages/public/uploads/pages"), "public/uploads/pages");
  assert.equal(canonicalMediaRepoPath("public/uploads/pages/illu-bienvenue.png"), "public/uploads/pages/illu-bienvenue.png");
  assert.equal(canonicalMediaRepoPath("content/pages/accueil.md"), "content/pages/accueil.md");
  assert.equal(publicUrlForRepoPath("public/uploads/pages/illu-bienvenue.png"), "/uploads/pages/illu-bienvenue.png");
  assert.equal(roleMayUsePath("animatrice", "public/uploads/pages/photo.jpg"), true);
  assert.equal(roleMayUsePath("github_admin", "public/uploads/pages"), true);

  const yaml = readFileSync(new URL("../public/admin/config.yml", import.meta.url), "utf8");
  assert.match(yaml, /^media_folder: \/public\/uploads\/blog$/m);
  assert.match(yaml, /^    media_folder: \/public\/uploads\/blog$/m);
  assert.match(yaml, /^    media_folder: \/public\/uploads\/pages$/m);
  assert.doesNotMatch(yaml, /^ {0,4}media_folder: public\/uploads\//m);

  const wrangler = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  assert.match(wrangler, /"observability"\s*:\s*\{[^}]*"enabled"\s*:\s*true/s);
});

test("le pointeur de médiathèque s’affiche avec l’URL publique", () => {
  const html = readFileSync(new URL("../public/admin/index.html", import.meta.url), "utf8");
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  new Function(script);
  const pointerScript = script.slice(0, script.indexOf("})();") + 5);
  const pointer = encodeMediaPointer("/uploads/pages/illu-bienvenue.png");
  const bytes = new Uint8Array(Buffer.from(pointer, "base64"));
  assert.equal(Buffer.from(bytes.subarray(0, MEDIA_URL_MARKER.length)).toString(), MEDIA_URL_MARKER);

  const saved = URL.createObjectURL;
  const context = { Blob, File, URL, TextDecoder, Uint8Array, WeakMap, console };
  context.window = context;
  vm.createContext(context);
  try {
    vm.runInContext(pointerScript, context);
    const blob = new context.Blob([bytes]);
    const file = new context.File([blob], "illu-bienvenue.png");
    assert.equal(context.URL.createObjectURL(file), "/uploads/pages/illu-bienvenue.png");
    const real = new context.Blob([new Uint8Array([1, 2, 3])]);
    assert.match(String(context.URL.createObjectURL(real)), /^blob:/);
  } finally {
    URL.createObjectURL = saved;
  }
});

test("PNG et JPEG autour de 6 Mo : acceptés sans relecture, trop lourd refusé", async () => {
  const cookie = await cookieFor("muriel", "animatrice");
  const github = installGithub((href, method) => {
    const usual = standardWrite(href, method);
    if (usual) return usual;
    return Response.json({ message: "unexpected " + href }, { status: 500 });
  });

  async function proxy(body) {
    return worker.fetch(
      new Request(`${ORIGIN}/api/decap-proxy`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      env()
    );
  }

  try {
    const png = imageBase64(5_900_000, PNG);
    const beforePng = github.calls.length;
    const savedPng = await proxy({
      action: "persistMedia",
      params: { asset: { path: "public/uploads/pages/illustration.png", content: png } },
    });
    const pngBody = await savedPng.json();
    assert.equal(savedPng.status, 200, JSON.stringify({ error: pngBody.error }));
    assert.equal(pngBody.path, "public/uploads/pages/illustration.png");
    assert.equal(pngBody.id, "blob1");
    assert.equal(pngBody.encoding, "base64");
    assert.equal(pngBody.content, png);
    const pngCalls = github.calls.slice(beforePng);
    assert.equal(pngCalls.some((call) => call.href.includes("/contents/")), false);
    const pngBlob = pngCalls.find((call) => call.href.endsWith("/git/blobs") && call.method === "POST");
    assert.equal(JSON.parse(pngBlob.body).content, png);

    const jpeg = imageBase64(5_900_000, JPEG);
    const beforeJpeg = github.calls.length;
    const savedJpeg = await proxy({
      action: "persistEntry",
      params: {
        dataFiles: [{ path: "content/pages/accueil.md", raw: "titre: Accueil\n" }],
        assets: [{ path: "content/pages/public/uploads/pages/photo.jpg", content: jpeg }],
      },
    });
    const jpegBody = await savedJpeg.json();
    assert.equal(savedJpeg.status, 200, JSON.stringify(jpegBody));
    const jpegCalls = github.calls.slice(beforeJpeg);
    assert.equal(jpegCalls.some((call) => call.href.includes("/contents/")), false);
    const jpegBlob = jpegCalls.find((call) => call.href.endsWith("/git/blobs") && call.method === "POST" && String(call.body).includes(jpeg.slice(0, 40)));
    const posted = JSON.parse(jpegBlob.body);
    assert.equal(posted.content, jpeg);
    const tree = jpegCalls.find((call) => call.href.endsWith("/git/trees") && call.method === "POST");
    const treeBody = JSON.parse(tree.body);
    assert.ok(treeBody.tree.some((item) => item.path === "public/uploads/pages/photo.jpg"));
    assert.equal(treeBody.tree.some((item) => String(item.path).includes("content/pages/public/")), false);

    const beforeBig = github.calls.length;
    const tooBig = await proxy({
      action: "persistMedia",
      params: {
        asset: { path: "public/uploads/blog/trop.jpg", content: imageBase64(6_100_000, JPEG) },
      },
    });
    const tooBigBody = await tooBig.json();
    assert.equal(tooBig.status, 413);
    assert.equal(tooBigBody.error, MEDIA_TOO_LARGE_ERROR);
    assert.equal(github.calls.length, beforeBig);

    const empty = await proxy({
      action: "persistMedia",
      params: { asset: { path: "public/uploads/pages/vide.jpg", content: "" } },
    });
    assert.equal(empty.status, 413);
    assert.match((await empty.json()).error, /vide/i);
  } finally {
    github.restore();
  }
});

test("getMedia liste sans télécharger, getMediaFile lit les fichiers de plus de 1 Mo", async () => {
  const cookie = await cookieFor("muriel", "animatrice");
  const heavy = imageBase64(1_200_000, JPEG);
  const github = installGithub((href, method) => {
    if (href.includes("/contents/public/uploads/pages?") || href.includes("/contents/public/uploads/pages?ref=")) {
      return Response.json([
        {
          name: "illu-bienvenue.png",
          path: "public/uploads/pages/illu-bienvenue.png",
          type: "file",
          sha: "sha-illu",
          size: 48211,
        },
        {
          name: "photo.jpg",
          path: "public/uploads/pages/photo.jpg",
          type: "file",
          sha: "sha-photo",
          size: 5_500_000,
        },
      ]);
    }
    if (href.includes("/contents/public/uploads/pages/photo.jpg")) {
      return Response.json({
        type: "file",
        encoding: "none",
        size: 1_200_000,
        sha: "sha-photo",
        path: "public/uploads/pages/photo.jpg",
        name: "photo.jpg",
      });
    }
    if (href.includes("/git/blobs/sha-photo") && method === "GET") {
      return Response.json({ sha: "sha-photo", encoding: "base64", content: heavy, size: 1_200_000 });
    }
    return Response.json({ message: "unexpected " + href }, { status: 500 });
  });

  async function proxy(body) {
    return worker.fetch(
      new Request(`${ORIGIN}/api/decap-proxy`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      env()
    );
  }

  try {
    const listed = await proxy({
      action: "getMedia",
      params: { mediaFolder: "content/pages/public/uploads/pages" },
    });
    const files = await listed.json();
    assert.equal(listed.status, 200, JSON.stringify(files));
    assert.equal(files.length, 2);
    assert.equal(files[0].path, "public/uploads/pages/illu-bienvenue.png");
    assert.equal(files[0].url, "/uploads/pages/illu-bienvenue.png");
    assert.equal(files[0].size, 48211);
    assert.equal(Buffer.from(files[0].content, "base64").toString("utf8"), `${MEDIA_URL_MARKER}/uploads/pages/illu-bienvenue.png`);
    assert.equal(files[1].size, 5_500_000);
    assert.equal(github.calls.some((call) => call.href.includes("/git/blobs/")), false);
    assert.equal(github.calls.filter((call) => call.href.includes("/contents/")).length, 1);

    const beforeFile = github.calls.length;
    const one = await proxy({
      action: "getMediaFile",
      params: { path: "content/pages/public/uploads/pages/photo.jpg" },
    });
    const oneBody = await one.json();
    assert.equal(one.status, 200, JSON.stringify({ error: oneBody.error }));
    assert.equal(oneBody.path, "public/uploads/pages/photo.jpg");
    assert.equal(oneBody.content, heavy);
    assert.equal(oneBody.id, "sha-photo");
    const fileCalls = github.calls.slice(beforeFile);
    assert.ok(fileCalls.some((call) => call.href.includes("/git/blobs/sha-photo")));
  } finally {
    github.restore();
  }
});

test("l’historique lit et restaure un média de plus de 1 Mo via les blobs", async () => {
  const cookie = await cookieFor("didier2a", ROLE_GITHUB_ADMIN);
  const heavy = imageBase64(1_200_000, PNG);
  const sha = "c".repeat(40);
  const github = installGithub((href, method) => {
    const usual = standardWrite(href, method);
    if (usual) return usual;
    if (href.includes("/commits?path=")) {
      return Response.json([
        {
          sha,
          commit: { message: "photo", author: { name: "muriel", date: "2026-03-02T00:00:00Z" } },
        },
      ]);
    }
    if (href.includes("/contents/public/uploads/pages/photo.png")) {
      const ref = new URL(href).searchParams.get("ref");
      if (ref === "main") {
        return Response.json({
          type: "file",
          encoding: "none",
          size: 1_200_000,
          sha: "current-blob",
          path: "public/uploads/pages/photo.png",
        });
      }
      return Response.json({
        type: "file",
        encoding: "none",
        size: 1_200_000,
        sha: "old-blob",
        path: "public/uploads/pages/photo.png",
      });
    }
    if (href.includes("/git/blobs/old-blob")) return Response.json({ content: heavy, encoding: "base64", sha: "old-blob" });
    if (href.includes("/git/blobs/current-blob")) {
      return Response.json({ content: imageBase64(1_200_000, JPEG), encoding: "base64", sha: "current-blob" });
    }
    if (href.endsWith(`/commits/${sha}`)) {
      return Response.json({ commit: { author: { date: "2026-03-02T00:00:00Z" } } });
    }
    return Response.json({ message: "unexpected " + href }, { status: 500 });
  });

  async function history(body) {
    return worker.fetch(
      new Request(`${ORIGIN}/api/admin-history`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      env()
    );
  }

  try {
    const preview = await history({ action: "read", path: "public/uploads/pages/photo.png", sha });
    const seen = await preview.json();
    assert.equal(preview.status, 200, JSON.stringify(seen));
    assert.equal(seen.binary, true);
    assert.equal(seen.content, "");
    assert.equal(JSON.stringify(seen).includes(heavy.slice(0, 80)), false);

    const restored = await history({ action: "restore", path: "public/uploads/pages/photo.png", sha });
    const restoredBody = await restored.json();
    assert.equal(restored.status, 200, JSON.stringify(restoredBody));
    assert.equal(restoredBody.restored, true);
    const blob = github.calls.find((call) => call.href.endsWith("/git/blobs") && call.method === "POST");
    assert.equal(JSON.parse(blob.body).content, heavy);

    github.calls.length = 0;
    globalThis.fetch = async (url) => {
      const href = String(url);
      github.calls.push({ href, method: "GET", body: "" });
      if (href.includes("/contents/public/uploads/pages/trop.png")) {
        return Response.json({ type: "file", encoding: "none", size: 6_100_000, sha: "too-big" });
      }
      return Response.json({ message: "unexpected " + href }, { status: 500 });
    };
    const refused = await history({ action: "read", path: "public/uploads/pages/trop.png", sha });
    const refusedBody = await refused.json();
    assert.equal(refused.status, 413, JSON.stringify(refusedBody));
    assert.match(refusedBody.error, /trop long/);
    assert.equal(github.calls.some((call) => call.href.includes("/git/blobs/")), false);
  } finally {
    github.restore();
  }
});

test("une erreur proxy est journalisée sans secret ni contenu", async () => {
  const cookie = await cookieFor("muriel", "animatrice");
  const logs = [];
  const originalError = console.error;
  console.error = (...args) => logs.push(args.map(String).join(" "));
  const png = Buffer.from("png-secret-bytes").toString("base64");
  const github = installGithub(() => Response.json({ message: `bad token ${PAT}` }, { status: 500 }));
  try {
    const response = await worker.fetch(
      new Request(`${ORIGIN}/api/decap-proxy`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          action: "persistMedia",
          params: { asset: { path: "public/uploads/pages/photo.png", content: png } },
        }),
      }),
      env()
    );
    assert.equal(response.status, 500);
    const body = await response.text();
    assert.doesNotMatch(body, new RegExp(PAT));
    assert.match(logs.join("\n"), /decap-proxy/);
    assert.match(logs.join("\n"), /persistMedia/);
    assert.doesNotMatch(logs.join("\n"), new RegExp(PAT));
    assert.doesNotMatch(logs.join("\n"), new RegExp(png));
  } finally {
    console.error = originalError;
    github.restore();
  }
});

test("le nouveau chemin d’une image de 5 Mo reste très en dessous de l’ancien décodage", () => {
  const bytes = Buffer.alloc(5_000_000, 7);
  PNG.copy(bytes, 0);
  const b64 = bytes.toString("base64");
  const requestBody = JSON.stringify({
    action: "persistMedia",
    params: { asset: { path: "public/uploads/pages/cinq.png", content: b64 } },
  });

  const before = process.cpuUsage();
  const started = performance.now();
  const parsed = JSON.parse(requestBody);
  const payload = assertMediaBase64(parsed.params.asset.content);
  const raw = `{"content":"${payload}","encoding":"base64"}`;
  const response =
    `{"id":"blob1","content":"${payload}","encoding":"base64",` +
    `"path":"public/uploads/pages/cinq.png","name":"cinq.png"}`;
  const cpu = process.cpuUsage(before);
  const passMs = (cpu.user + cpu.system) / 1000;
  const wallMs = performance.now() - started;
  const totalMs = passMs;
  assert.equal(decodedBase64Size(payload), 5_000_000);
  assert.equal(JSON.parse(raw).content, b64);
  assert.equal(JSON.parse(response).content, b64);

  const sample = bytes.subarray(0, 500_000);
  const oldStarted = process.cpuUsage();
  let bin = "";
  for (let i = 0; i < sample.length; i++) bin += String.fromCharCode(sample[i]);
  btoa(bin);
  const oldCpu = process.cpuUsage(oldStarted);
  const oldMs = (oldCpu.user + oldCpu.system) / 1000;
  console.log(
    JSON.stringify({
      passThroughCpuMs: Math.round(totalMs * 10) / 10,
      passThroughWallMs: Math.round(wallMs * 10) / 10,
      legacyLoopCpuMsFor500k: Math.round(oldMs * 10) / 10,
      base64Chars: b64.length,
    })
  );
  assert.ok(totalMs * 5 < oldMs * (5_000_000 / 500_000), `nouveau ${totalMs} ms pour 5 Mo, ancien ${oldMs} ms pour 0,5 Mo`);
  assert.ok(totalMs < 100, `CPU du nouveau chemin : ${totalMs} ms`);
});
