(function () {
  document.querySelectorAll("[data-map-encart]").forEach((root) => {
    const frame = root.querySelector("iframe");
    const tabs = root.querySelectorAll("[data-view]");
    if (!frame || !tabs.length) return;

    const urls = {
      street: root.getAttribute("data-street-url"),
      map: root.getAttribute("data-map-url"),
    };

    function setView(view) {
      if (!urls[view]) return;
      frame.src = urls[view];
      frame.setAttribute("data-active-view", view);
      tabs.forEach((btn) => {
        const on = btn.getAttribute("data-view") === view;
        btn.setAttribute("aria-selected", on ? "true" : "false");
        btn.classList.toggle("is-active", on);
      });
    }

    tabs.forEach((btn) => {
      btn.addEventListener("click", () => setView(btn.getAttribute("data-view")));
    });

    // Default: Street View
    setView("street");
  });
})();
