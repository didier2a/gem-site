import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const js = readFileSync(new URL("../public/js/scroll-nav.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../public/css/editorial.css", import.meta.url), "utf8");
const astro = readFileSync(new URL("../src/components/GraduatedScrollbar.astro", import.meta.url), "utf8");

describe("règle iPad Safari — libellé tactile", () => {
  it("expose une hit zone dédiée ≥44px", () => {
    assert.match(astro, /data-gem-ruler-hit/);
    assert.match(css, /--gem-hit-w:\s*48px/);
    assert.match(css, /\.gem-ruler__hit/);
  });

  it("écoute touchstart/touchmove/touchend en plus des pointer events", () => {
    assert.match(js, /addEventListener\(\s*"touchstart"/);
    assert.match(js, /addEventListener\(\s*"touchmove"/);
    assert.match(js, /addEventListener\(\s*"touchend"/);
    assert.match(js, /passive:\s*false/);
  });

  it("ne masque pas le tip sur pointercancel", () => {
    // Le handler pointercancel ne doit PAS appeler hideTip / setLoupe(0, false)
    const idx = js.indexOf('addEventListener("pointercancel"');
    assert.ok(idx > 0);
    const chunk = js.slice(idx, idx + 450);
    assert.doesNotMatch(chunk, /hideTip\(/);
    assert.doesNotMatch(chunk, /setLoupe\(\s*0\s*,\s*false\s*\)/);
  });

  it("place le tip en position fixed avec z-index élevé", () => {
    assert.match(js, /tip\.style\.position\s*=\s*"fixed"/);
    assert.match(css, /\.gem-ruler__tip\s*\{[^}]*position:\s*fixed/s);
    assert.match(css, /z-index:\s*200/);
  });

  it("bump cache JS v11", () => {
    assert.match(astro, /scroll-nav\.js\?v=11/);
  });
});
