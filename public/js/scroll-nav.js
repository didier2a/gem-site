/**
 * Colonne graduée discrète (filigrane) — barre de défilement à droite.
 * - Sections : main > section | .page-hero (générique)
 * - Dilatation section active + loupe sous doigt/souris (décroissant)
 * - Clic / glisser / toucher → scroll ; touch-action:none uniquement sur le rail
 * - prefers-reduced-motion respecté
 */
(function () {
  "use strict";

  var root = document.getElementById("gem-ruler");
  if (!root) return;

  var rail = root.querySelector("[data-gem-ruler-rail]");
  var segmentsEl = root.querySelector("[data-gem-ruler-segments]");
  var thumb = root.querySelector("[data-gem-ruler-thumb]");
  var loupe = root.querySelector("[data-gem-ruler-loupe]");
  var live = root.querySelector("[data-gem-ruler-live]");
  if (!rail || !segmentsEl || !thumb) return;

  var reduce = !!(
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  var sections = [];
  var dragging = false;
  var moved = false;
  var startY = 0;
  var raf = 0;
  var loupeRaf = 0;
  var io = null;
  var pendingJump = null;
  var loupeVisible = false;

  function docMax() {
    var el = document.documentElement;
    return Math.max(0, el.scrollHeight - el.clientHeight);
  }

  function discover() {
    var main = document.getElementById("main") || document.querySelector("main");
    if (!main) return [];
    var nodes = main.querySelectorAll(
      ":scope > section, :scope > .page-hero, :scope > header.page-hero"
    );
    if (!nodes.length) {
      nodes = main.querySelectorAll(
        "section.section, section.hero, .page-hero, header.page-hero"
      );
    }
    var list = [];
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var label = "";
      var labelled = el.getAttribute("aria-labelledby");
      if (labelled) {
        var labEl = document.getElementById(labelled);
        if (labEl) label = labEl.textContent || "";
      }
      if (!label) label = el.getAttribute("aria-label") || "";
      if (!label) {
        var h = el.querySelector("h1, h2, .section-title, .display");
        if (h) label = h.textContent || "";
      }
      label = String(label || "Section " + (list.length + 1))
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80);
      list.push({ el: el, label: label });
    }
    if (!list.length) list.push({ el: main, label: "Contenu" });
    return list;
  }

  function metrics() {
    var el = document.documentElement;
    return {
      max: Math.max(0, el.scrollHeight - el.clientHeight),
      pageH: el.scrollHeight,
      viewH: el.clientHeight,
    };
  }

  function scrollToSection(el) {
    if (!el) return;
    el.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      block: "start",
    });
  }

  function setScrollFromRailY(clientY) {
    var rect = rail.getBoundingClientRect();
    var t = (clientY - rect.top) / Math.max(rect.height, 1);
    t = Math.max(0, Math.min(1, t));
    window.scrollTo(0, t * docMax());
  }

  function setLoupe(clientY, on) {
    if (!loupe) return;
    if (!on) {
      if (loupeVisible) {
        loupeVisible = false;
        root.classList.remove("is-loupe");
        if (reduce) loupe.style.opacity = "0";
      }
      return;
    }
    var rect = rail.getBoundingClientRect();
    var t = (clientY - rect.top) / Math.max(rect.height, 1);
    t = Math.max(0, Math.min(1, t));
    root.style.setProperty("--gem-loupe-y", t * 100 + "%");
    if (!loupeVisible) {
      loupeVisible = true;
      root.classList.add("is-loupe");
    }
  }

  function scheduleLoupe(clientY, on) {
    if (loupeRaf) cancelAnimationFrame(loupeRaf);
    loupeRaf = requestAnimationFrame(function () {
      loupeRaf = 0;
      setLoupe(clientY, on);
    });
  }

  function buildSegments() {
    segmentsEl.innerHTML = "";
    sections = discover();
    var m = metrics();
    if (m.max <= 8) {
      root.hidden = true;
      document.documentElement.classList.remove("has-gem-ruler");
      return;
    }
    root.hidden = false;
    document.documentElement.classList.add("has-gem-ruler");

    var compact =
      (window.matchMedia &&
        window.matchMedia("(max-width: 720px)").matches) ||
      (window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
    root.classList.toggle("gem-ruler--compact", !!compact);

    var pageH = Math.max(m.pageH, 1);
    sections.forEach(function (s, idx) {
      var rect = s.el.getBoundingClientRect();
      var top = rect.top + window.scrollY;
      var height = Math.max(rect.height, 1);
      var y0 = Math.max(0, Math.min(100, (top / pageH) * 100));
      var y1 = Math.max(
        y0 + 0.4,
        Math.min(100, ((top + height) / pageH) * 100)
      );

      var seg = document.createElement("div");
      seg.className = "gem-ruler__segment";
      seg.style.top = y0 + "%";
      seg.style.height = y1 - y0 + "%";
      seg.dataset.index = String(idx);
      seg.setAttribute("role", "presentation");
      segmentsEl.appendChild(seg);
      s.seg = seg;
    });
  }

  function updateThumb() {
    var m = metrics();
    var pct = m.max > 0 ? window.scrollY / m.max : 0;
    pct = Math.max(0, Math.min(1, pct));
    var thumbH = Math.max(
      6,
      Math.min(36, (m.viewH / Math.max(m.pageH, 1)) * 100)
    );
    thumb.style.height = thumbH + "%";
    thumb.style.top = pct * (100 - thumbH) + "%";
    root.setAttribute("aria-valuenow", String(Math.round(pct * 100)));

    var probeX = Math.max(0, window.innerWidth - 28);
    var probeY = window.innerHeight * 0.5;
    var under = document.elementFromPoint(probeX, probeY);
    var dark = false;
    var node = under;
    while (node && node !== document.documentElement) {
      if (node.classList) {
        if (
          node.classList.contains("hero") ||
          node.classList.contains("section-dark") ||
          node.classList.contains("section-sea") ||
          node.classList.contains("site-footer")
        ) {
          dark = true;
          break;
        }
      }
      node = node.parentElement;
    }
    root.classList.toggle("gem-ruler--on-dark", dark);
  }

  function setActive(index) {
    sections.forEach(function (s, i) {
      if (s.seg) s.seg.classList.toggle("is-active", i === index);
    });
    if (live && sections[index]) live.textContent = sections[index].label;
  }

  function scheduleUpdate() {
    if (raf) return;
    raf = requestAnimationFrame(function () {
      raf = 0;
      updateThumb();
    });
  }

  function observe() {
    if (io) {
      io.disconnect();
      io = null;
    }
    if (!("IntersectionObserver" in window) || !sections.length) {
      setActive(0);
      return;
    }
    var ratios = new Map();
    io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          ratios.set(
            entry.target,
            entry.isIntersecting ? entry.intersectionRatio : 0
          );
        });
        var best = -1;
        var bestR = 0;
        sections.forEach(function (s, i) {
          var r = ratios.get(s.el) || 0;
          if (r > bestR) {
            bestR = r;
            best = i;
          }
        });
        if (best >= 0) setActive(best);
      },
      {
        rootMargin: "-22% 0px -48% 0px",
        threshold: [0.05, 0.15, 0.3, 0.5, 0.75],
      }
    );
    sections.forEach(function (s) {
      io.observe(s.el);
    });
  }

  function sectionAtClientY(clientY) {
    var rect = rail.getBoundingClientRect();
    var t = ((clientY - rect.top) / Math.max(rect.height, 1)) * 100;
    for (var i = 0; i < sections.length; i++) {
      var seg = sections[i].seg;
      if (!seg) continue;
      var top = parseFloat(seg.style.top) || 0;
      var h = parseFloat(seg.style.height) || 0;
      if (t >= top && t <= top + h) return sections[i];
    }
    return null;
  }

  rail.addEventListener("pointerdown", function (e) {
    if (e.button != null && e.button !== 0) return;
    dragging = true;
    moved = false;
    startY = e.clientY;
    pendingJump = sectionAtClientY(e.clientY);
    root.classList.add("is-dragging");
    scheduleLoupe(e.clientY, true);
    try {
      rail.setPointerCapture(e.pointerId);
    } catch (_) {}
    setScrollFromRailY(e.clientY);
    e.preventDefault();
  });

  rail.addEventListener("pointermove", function (e) {
    scheduleLoupe(e.clientY, true);
    if (!dragging) return;
    if (Math.abs(e.clientY - startY) > 3) moved = true;
    setScrollFromRailY(e.clientY);
  });

  // Desktop hover loupe (no scroll until click/drag)
  rail.addEventListener("pointerenter", function (e) {
    if (e.pointerType === "touch") return;
    scheduleLoupe(e.clientY, true);
  });
  rail.addEventListener("pointerleave", function (e) {
    if (dragging) return;
    if (e.pointerType === "touch") return;
    scheduleLoupe(0, false);
  });

  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    root.classList.remove("is-dragging");
    try {
      if (e && e.pointerId != null) rail.releasePointerCapture(e.pointerId);
    } catch (_) {}
    if (!moved && pendingJump) {
      scrollToSection(pendingJump.el);
    } else if (!moved && e) {
      setScrollFromRailY(e.clientY);
    }
    pendingJump = null;
    // Keep loupe briefly on touch end, then fade
    if (e && e.pointerType === "touch") {
      scheduleLoupe(e.clientY, true);
      setTimeout(function () {
        if (!dragging) scheduleLoupe(0, false);
      }, reduce ? 0 : 280);
    } else {
      scheduleLoupe(e ? e.clientY : 0, !!e && e.pointerType !== "touch");
      if (!e || e.pointerType === "touch") scheduleLoupe(0, false);
    }
  }
  rail.addEventListener("pointerup", endDrag);
  rail.addEventListener("pointercancel", function (e) {
    endDrag(e);
    scheduleLoupe(0, false);
  });

  function rebuild() {
    buildSegments();
    observe();
    updateThumb();
  }

  window.addEventListener("scroll", scheduleUpdate, { passive: true });
  window.addEventListener("resize", rebuild, { passive: true });
  if (document.readyState === "complete") rebuild();
  else window.addEventListener("load", rebuild, { once: true });
  rebuild();
})();
