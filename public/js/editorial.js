(function () {
  const header = document.querySelector(".site-header");
  const toggle = document.querySelector(".menu-toggle");
  const nav = document.querySelector("#main-menu");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function setExpanded(open) {
    if (!toggle || !nav) return;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    nav.classList.toggle("is-open", open);
    document.body.classList.toggle("nav-open", open);
    toggle.setAttribute("aria-label", open ? "Fermer le menu" : "Ouvrir le menu");
  }

  toggle?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const open = toggle.getAttribute("aria-expanded") !== "true";
    setExpanded(open);
  });

  nav?.querySelectorAll("a").forEach((a) => {
    a.addEventListener("click", () => setExpanded(false));
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setExpanded(false);
  });

  const onScroll = () => {
    if (!header) return;
    header.classList.toggle("is-scrolled", window.scrollY > 40);
  };
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  if (!reduce) {
    const items = document.querySelectorAll(".reveal");
    if ("IntersectionObserver" in window && items.length) {
      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add("is-in");
              io.unobserve(entry.target);
            }
          });
        },
        { rootMargin: "0px 0px -8% 0px", threshold: 0.12 }
      );
      items.forEach((el) => io.observe(el));
    } else {
      items.forEach((el) => el.classList.add("is-in"));
    }
  } else {
    document.querySelectorAll(".reveal").forEach((el) => el.classList.add("is-in"));
  }

  // Mark current nav link
  const path = location.pathname.replace(/\/index\.html$/, "/");
  nav?.querySelectorAll("a").forEach((a) => {
    const href = a.getAttribute("href");
    if (!href) return;
    if (href === "/" && (path === "/" || path === "")) {
      a.setAttribute("aria-current", "page");
    } else if (href !== "/" && path.startsWith(href)) {
      a.setAttribute("aria-current", "page");
    }
  });
})();
