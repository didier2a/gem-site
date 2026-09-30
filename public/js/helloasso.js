(function () {
  const cfg = window.GEM_SITE || {};
  const url = (cfg.HELLOASSO_DON_URL || "").trim();
  const ready = /^https:\/\/(www\.)?helloasso\.com\//i.test(url);

  function go(e) {
    if (e) e.preventDefault();
    if (ready) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    const target = document.getElementById("don-helloasso");
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      target.classList.add("is-highlight");
      setTimeout(() => target.classList.remove("is-highlight"), 1600);
    } else {
      window.location.href = "/nous-soutenir/#don-helloasso";
    }
  }

  document.querySelectorAll("[data-helloasso-don]").forEach((el) => {
    el.addEventListener("click", go);
    if (ready) {
      el.setAttribute("href", url);
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener noreferrer");
      el.classList.add("is-helloasso-live");
    } else {
      el.setAttribute("href", "/nous-soutenir/#don-helloasso");
      el.classList.add("is-helloasso-preview");
    }
  });

  // Status badge + iframe slot on support page
  const status = document.querySelector("[data-helloasso-status]");
  if (status) {
    status.textContent = ready
      ? "Lien HelloAsso actif — les dons s’ouvrent sur HelloAsso."
      : "Intégration prête (preview) — le lien du formulaire asso n’est pas encore branché.";
    status.classList.toggle("is-live", ready);
    status.classList.toggle("is-preview", !ready);
  }

  const frame = document.querySelector("[data-helloasso-frame]");
  const frameWrap = document.querySelector("[data-helloasso-frame-wrap]");
  if (frame && frameWrap) {
    if (ready) {
      // Widget-style embed when URL known (append /widget if classic form URL)
      let embed = url;
      if (!/\/widget\/?$/i.test(embed) && /\/formulaires\//i.test(embed)) {
        embed = embed.replace(/\/?$/, "/") + "widget";
      }
      frame.src = embed;
      frameWrap.hidden = false;
    } else {
      frameWrap.hidden = true;
    }
  }
})();
