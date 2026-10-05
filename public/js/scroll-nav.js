/**
 * Colonne graduée filigrane — variante 3c (loupe = allongement des traits).
 * Desktop : filigrane 3b + loupe au survol. Mobile : loupe tactile 3c.
 * Rendu SVG (traits vectoriels lisibles). Pas de rond « doigt » dessiné.
 */
(function () {
  "use strict";

  var root = document.getElementById("gem-ruler");
  if (!root) return;

  var rail = root.querySelector("[data-gem-ruler-rail]");
  var svg = root.querySelector("[data-gem-ruler-svg]");
  var thumb = root.querySelector("[data-gem-ruler-thumb]");
  var live = root.querySelector("[data-gem-ruler-live]");
  if (!rail || !svg || !thumb) return;

  var NS = "http://www.w3.org/2000/svg";
  var reduce = !!(
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );

  var sections = [];
  var activeIndex = 0;
  var dragging = false;
  var moved = false;
  var startY = 0;
  var pendingJump = null;
  var loupeOn = false;
  var loupeY = 0.5; // 0–1 along rail
  var raf = 0;
  var paintRaf = 0;
  var io = null;
  var tickLines = [];
  var axisLine = null;

  function docMax() {
    var el = document.documentElement;
    return Math.max(0, el.scrollHeight - el.clientHeight);
  }

  function metrics() {
    var el = document.documentElement;
    return {
      max: Math.max(0, el.scrollHeight - el.clientHeight),
      pageH: el.scrollHeight,
      viewH: el.clientHeight,
    };
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
      list.push({ el: el, label: label, y0: 0, y1: 1 });
    }
    if (!list.length) list.push({ el: main, label: "Contenu", y0: 0, y1: 1 });
    return list;
  }

  function measureSections() {
    var m = metrics();
    var pageH = Math.max(m.pageH, 1);
    sections.forEach(function (s) {
      var rect = s.el.getBoundingClientRect();
      var top = rect.top + window.scrollY;
      var height = Math.max(rect.height, 1);
      s.y0 = Math.max(0, Math.min(1, top / pageH));
      s.y1 = Math.max(s.y0 + 0.004, Math.min(1, (top + height) / pageH));
    });
  }

  function isCompact() {
    return (
      (window.matchMedia && window.matchMedia("(max-width: 720px)").matches) ||
      (window.matchMedia && window.matchMedia("(pointer: coarse)").matches)
    );
  }

  function colors() {
    var dark = root.classList.contains("gem-ruler--on-dark");
    if (dark) {
      return {
        tick: "rgba(255,254,252,0.26)",
        major: "rgba(255,254,252,0.34)",
        active: "rgba(255,254,252,0.55)",
        loupe: "rgba(255,254,252,0.62)",
        axis: "rgba(255,254,252,0.22)",
        thumb: "rgba(255,254,252,0.58)",
      };
    }
    return {
      tick: "rgba(14,41,37,0.26)",
      major: "rgba(14,41,37,0.34)",
      active: "rgba(14,41,37,0.55)",
      loupe: "rgba(14,41,37,0.62)",
      axis: "rgba(14,41,37,0.22)",
      thumb: "rgba(14,41,37,0.55)",
    };
  }

  function lengths() {
    var compact = root.classList.contains("gem-ruler--compact");
    if (compact) {
      return { minor: 7, major: 10, active: 14, loupeMax: 18, step: 6, stroke: 1.25 };
    }
    return { minor: 8, major: 12, active: 16, loupeMax: 22, step: 7, stroke: 1.35 };
  }

  function sectionAtT(t) {
    for (var i = 0; i < sections.length; i++) {
      if (t >= sections[i].y0 && t <= sections[i].y1) return i;
    }
    return -1;
  }

  function ensureSvg(h, w) {
    svg.setAttribute("width", String(w));
    svg.setAttribute("height", String(h));
    svg.setAttribute("viewBox", "0 0 " + w + " " + h);
    svg.style.width = w + "px";
    svg.style.height = h + "px";
  }

  function rebuildTicks() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    tickLines = [];
    axisLine = null;

    var rect = rail.getBoundingClientRect();
    var h = Math.max(Math.round(rect.height), 1);
    var L = lengths();
    var w = Math.max(L.loupeMax + 6, 22);
    root.style.setProperty("--gem-rail-w", w + "px");
    ensureSvg(h, w);

    var c = colors();
    axisLine = document.createElementNS(NS, "line");
    axisLine.setAttribute("x1", String(w - 0.5));
    axisLine.setAttribute("x2", String(w - 0.5));
    axisLine.setAttribute("y1", "0");
    axisLine.setAttribute("y2", String(h));
    axisLine.setAttribute("stroke", c.axis);
    axisLine.setAttribute("stroke-width", "1");
    axisLine.setAttribute("stroke-linecap", "round");
    svg.appendChild(axisLine);

    var g = document.createElementNS(NS, "g");
    svg.appendChild(g);

    var step = L.step;
    var count = Math.floor(h / step);
    for (var i = 0; i <= count; i++) {
      var y = i * step + 0.5;
      if (y > h) break;
      var line = document.createElementNS(NS, "line");
      line.setAttribute("y1", String(y));
      line.setAttribute("y2", String(y));
      line.setAttribute("stroke-linecap", "round");
      line.setAttribute("stroke-width", String(L.stroke));
      line.dataset.i = String(i);
      line.dataset.major = i % 5 === 0 ? "1" : "0";
      g.appendChild(line);
      tickLines.push(line);
    }
    paintTicks();
  }

  function paintTicks() {
    var rect = rail.getBoundingClientRect();
    var h = Math.max(rect.height, 1);
    var w = parseFloat(root.style.getPropertyValue("--gem-rail-w")) || 22;
    var L = lengths();
    var c = colors();
    if (axisLine) axisLine.setAttribute("stroke", c.axis);

    for (var i = 0; i < tickLines.length; i++) {
      var line = tickLines[i];
      var y = parseFloat(line.getAttribute("y1")) || 0;
      var t = y / h;
      var major = line.dataset.major === "1";
      var inActive = sectionAtT(t) === activeIndex;
      var len = major ? L.major : L.minor;
      var stroke = major ? c.major : c.tick;

      if (inActive) {
        len = L.active;
        stroke = c.active;
      }

      if (loupeOn) {
        var dy = Math.abs(t - loupeY);
        // Variante 3c : allonge les traits eux-mêmes (pas de halo), décroissant
        var sigma = 0.09;
        var fall = Math.exp(-(dy * dy) / (2 * sigma * sigma));
        if (fall > 0.03) {
          var target = L.loupeMax * fall + L.minor * (1 - fall);
          if (inActive) target = Math.max(target, L.active);
          len = Math.max(len, target);
          if (fall > 0.2) stroke = c.loupe;
          else if (fall > 0.08) stroke = c.active;
        }
      }

      var x2 = w - 0.5;
      var x1 = x2 - len;
      line.setAttribute("x1", String(x1));
      line.setAttribute("x2", String(x2));
      line.setAttribute("stroke", stroke);
    }
    thumb.style.background = c.thumb;
  }

  function schedulePaint() {
    if (paintRaf) return;
    paintRaf = requestAnimationFrame(function () {
      paintRaf = 0;
      paintTicks();
    });
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
    updateThumb();
    paintTicks();
  }

  function setLoupe(clientY, on) {
    if (!on) {
      if (loupeOn) {
        loupeOn = false;
        root.classList.remove("is-loupe");
        schedulePaint();
      }
      return;
    }
    var rect = rail.getBoundingClientRect();
    loupeY = (clientY - rect.top) / Math.max(rect.height, 1);
    loupeY = Math.max(0, Math.min(1, loupeY));
    root.style.setProperty("--gem-loupe-y", loupeY * 100 + "%");
    if (!loupeOn) {
      loupeOn = true;
      root.classList.add("is-loupe");
    }
    schedulePaint();
  }

  function updateThumb() {
    var m = metrics();
    var pct = m.max > 0 ? window.scrollY / m.max : 0;
    pct = Math.max(0, Math.min(1, pct));
    var thumbH = Math.max(
      10,
      Math.min(40, (m.viewH / Math.max(m.pageH, 1)) * 100)
    );
    thumb.style.height = thumbH + "%";
    thumb.style.top = pct * (100 - thumbH) + "%";
    root.setAttribute("aria-valuenow", String(Math.round(pct * 100)));

    // Dark detection: sample content left of the rail (not the rail itself)
    var probeX = Math.max(0, window.innerWidth - 48);
    var probeY = window.innerHeight * 0.5;
    // Temporarily ignore pointer-events on ruler so elementFromPoint hits content
    var prev = root.style.pointerEvents;
    root.style.pointerEvents = "none";
    var under = document.elementFromPoint(probeX, probeY);
    root.style.pointerEvents = prev;

    var dark = false;
    var node = under;
    while (node && node !== document.documentElement) {
      if (node.classList) {
        if (
          node.classList.contains("hero") ||
          node.classList.contains("section-dark") ||
          node.classList.contains("section-sea") ||
          node.classList.contains("site-footer") ||
          node.classList.contains("site-header")
        ) {
          dark = true;
          break;
        }
      }
      node = node.parentElement;
    }
    var was = root.classList.contains("gem-ruler--on-dark");
    root.classList.toggle("gem-ruler--on-dark", dark);
    if (was !== dark) schedulePaint();
  }

  function setActive(index) {
    activeIndex = index;
    if (live && sections[index]) live.textContent = sections[index].label;
    schedulePaint();
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
    var t = (clientY - rect.top) / Math.max(rect.height, 1);
    var idx = sectionAtT(t);
    return idx >= 0 ? sections[idx] : null;
  }

  rail.addEventListener("pointerdown", function (e) {
    if (e.button != null && e.button !== 0) return;
    dragging = true;
    moved = false;
    startY = e.clientY;
    pendingJump = sectionAtClientY(e.clientY);
    root.classList.add("is-dragging");
    setLoupe(e.clientY, true);
    try {
      rail.setPointerCapture(e.pointerId);
    } catch (_) {}
    setScrollFromRailY(e.clientY);
    e.preventDefault();
  });

  rail.addEventListener("pointermove", function (e) {
    setLoupe(e.clientY, true);
    if (!dragging) return;
    if (Math.abs(e.clientY - startY) > 3) moved = true;
    setScrollFromRailY(e.clientY);
  });

  rail.addEventListener("pointerenter", function (e) {
    if (e.pointerType === "touch") return;
    setLoupe(e.clientY, true);
  });
  rail.addEventListener("pointerleave", function (e) {
    if (dragging) return;
    if (e.pointerType === "touch") return;
    setLoupe(0, false);
  });

  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    root.classList.remove("is-dragging");
    try {
      if (e && e.pointerId != null) rail.releasePointerCapture(e.pointerId);
    } catch (_) {}
    if (!moved && pendingJump) scrollToSection(pendingJump.el);
    else if (!moved && e) setScrollFromRailY(e.clientY);
    pendingJump = null;
    if (e && e.pointerType === "touch") {
      setLoupe(e.clientY, true);
      setTimeout(function () {
        if (!dragging) setLoupe(0, false);
      }, reduce ? 0 : 280);
    } else if (!e || e.pointerType === "touch") {
      setLoupe(0, false);
    }
  }
  rail.addEventListener("pointerup", endDrag);
  rail.addEventListener("pointercancel", function (e) {
    endDrag(e);
    setLoupe(0, false);
  });

  function rebuild() {
    var m = metrics();
    if (m.max <= 8) {
      root.hidden = true;
      document.documentElement.classList.remove("has-gem-ruler");
      return;
    }
    root.hidden = false;
    document.documentElement.classList.add("has-gem-ruler");
    root.classList.toggle("gem-ruler--compact", isCompact());

    sections = discover();
    measureSections();
    rebuildTicks();
    observe();
    updateThumb();
  }

  window.addEventListener("scroll", scheduleUpdate, { passive: true });
  window.addEventListener("resize", rebuild, { passive: true });
  if (document.readyState === "complete") rebuild();
  else window.addEventListener("load", rebuild, { once: true });
  rebuild();
})();
