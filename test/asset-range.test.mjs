import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.js";

const FILE = Uint8Array.from({ length: 10 }, (_, i) => i);

function env() {
  return {
    ASSETS: {
      async fetch() {
        return new Response(FILE, {
          headers: {
            "content-type": "video/mp4",
            "content-length": String(FILE.byteLength),
            etag: '"abc"',
            "cache-control": "public, max-age=0, must-revalidate",
          },
        });
      },
    },
  };
}

function get(headers) {
  return worker.fetch(
    new Request("https://gem-casa-preview.infoserv2a.workers.dev/uploads/blog/rando-mare-e-mare.mp4", {
      headers,
    }),
    env()
  );
}

test("un GET sans Range renvoie le fichier entier", async () => {
  const response = await get();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "video/mp4");
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), FILE);
});

test("Range bytes=0-1 répond 206 avec la bonne longueur", async () => {
  const response = await get({ range: "bytes=0-1" });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-type"), "video/mp4");
  assert.equal(response.headers.get("content-length"), "2");
  assert.equal(response.headers.get("content-range"), "bytes 0-1/10");
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), Uint8Array.of(0, 1));
});

test("Range ouvert et suffixe", async () => {
  const open = await get({ range: "bytes=8-" });
  assert.equal(open.status, 206);
  assert.equal(open.headers.get("content-range"), "bytes 8-9/10");
  assert.deepEqual(new Uint8Array(await open.arrayBuffer()), Uint8Array.of(8, 9));

  const suffix = await get({ range: "bytes=-2" });
  assert.equal(suffix.status, 206);
  assert.equal(suffix.headers.get("content-range"), "bytes 8-9/10");
  assert.deepEqual(new Uint8Array(await suffix.arrayBuffer()), Uint8Array.of(8, 9));
});

test("Range hors fichier : 416", async () => {
  const response = await get({ range: "bytes=100-101" });
  assert.equal(response.status, 416);
  assert.equal(response.headers.get("content-range"), "bytes */10");
});

test("sans Content-Length, le corps est mesuré et le Range reste 206", async () => {
  const response = await worker.fetch(
    new Request("https://gem-casa-preview.infoserv2a.workers.dev/uploads/blog/sans-longueur.mp4", {
      headers: { range: "bytes=2-4" },
    }),
    {
      ASSETS: {
        async fetch() {
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(FILE);
                controller.close();
              },
            }),
            { headers: { "content-type": "video/mp4", etag: '"stream"' } }
          );
        },
      },
    }
  );
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-type"), "video/mp4");
  assert.equal(response.headers.get("content-range"), "bytes 2-4/10");
  assert.equal(response.headers.get("content-length"), "3");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), Uint8Array.of(2, 3, 4));
});

test("If-Range qui ne correspond pas laisse le fichier entier", async () => {
  const response = await get({ range: "bytes=0-1", "if-range": '"autre"' });
  assert.equal(response.status, 200);
  assert.equal((await response.arrayBuffer()).byteLength, 10);
});
