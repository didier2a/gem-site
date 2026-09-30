(function () {
  const root = document.getElementById("scroll-nav");
  const fill = document.getElementById("scroll-progress-fill");
  const live = document.getElementById("scroll-progress-live");
  if (!root || !fill) return;

  const marks = Array.from(root.querySelectorAll(".scroll-progress-mark"));
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isHome = location.pathname === "/" || location.pathname === "/index.html";

  const labelOf = (btn) =>
    (btn.querySelector(".scroll-progress-tip") || {}).textContent ||
    btn.getAttribute("aria-label") ||
    "";

  function setActive(section) {
    let label = "";
    marks.forEach((btn) => {
      const on = btn.getAttribute("data-section") === section;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-current", on ? "true" : "false");
      if (on) label = labelOf(btn);
    });
    if (live && label) live.textContent = label;
    root.dataset.section = section || "";
  }

  function pathSection() {
    const p = location.pathname.replace(/\/index\.html$/, "/");
    if (p === "/" || p === "") return "accueil";
    if (p.startsWith("/qui-sommes-nous")) return "qui-sommes-nous";
    if (p.startsWith("/nos-activites")) return "activites";
    if (p.startsWith("/blog")) return "blog";
    if (p.startsWith("/nous-soutenir")) return "soutenir";
    if (p.startsWith("/contact")) return "contact";
    return null;
  }

  function updateProgress() {
    const el = document.documentElement;
    const max = el.scrollHeight - el.clientHeight;
    const pct = max > 0 ? Math.min(1, Math.max(0, el.scrollTop / max)) : 0;
    fill.style.transform = "scaleY(" + pct + ")";
    root.style.setProperty("--progress", String(pct));
  }

  function sectionIdFor(btn) {
    const section = btn.getAttribute("data-section");
    if (section === "accueil") return "accueil";
    return (btn.getAttribute("data-home") || "").replace(/^#/, "") || section;
  }

  marks.forEach((btn) => {
    btn.addEventListener("click", () => {
      const section = btn.getAttribute("data-section");
      if (isHome) {
        const el = document.getElementById(sectionIdFor(btn));
        if (el) {
          el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
          history.replaceState(null, "", "#" + sectionIdFor(btn));
          setActive(section);
          return;
        }
      }
      const href = btn.getAttribute("data-href");
      if (href) location.href = href;
    });
  });

  window.addEventListener("scroll", updateProgress, { passive: true });
  window.addEventListener("resize", updateProgress, { passive: true });
  updateProgress();

  if (isHome) {
    const sections = marks
      .map((btn) => {
        const id = sectionIdFor(btn);
        const el = document.getElementById(id);
        return el ? { id, section: btn.getAttribute("data-section"), el, label: labelOf(btn) } : null;
      })
      .filter(Boolean);

    if ("IntersectionObserver" in window && sections.length) {
      const ratios = new Map();
      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            ratios.set(entry.target.id, entry.isIntersecting ? entry.intersectionRatio : 0);
          });
          let best = null;
          let bestRatio = 0;
          ratios.forEach((r, id) => {
            if (r > bestRatio) {
              bestRatio = r;
              best = id;
            }
          });
          if (!best) return;
          const match = sections.find((s) => s.id === best);
          if (match) setActive(match.section);
        },
        { rootMargin: "-25% 0px -45% 0px", threshold: [0.08, 0.2, 0.4, 0.6] }
      );
      sections.forEach((s) => io.observe(s.el));
    }

    const hash = (location.hash || "").replace(/^#/, "");
    const m = sections.find((s) => s.id === hash);
    setActive(m ? m.section : "accueil");
  } else {
    const sec = pathSection();
    if (sec) setActive(sec);
    // On inner pages, fill reflects page scroll progress too
  }
})();
