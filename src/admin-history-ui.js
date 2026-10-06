/**
 * Bouton et panneau « Historique » injectés dans /admin/ pour github_admin.
 * Le script ne parle qu’à /api/admin-history. Il ne contient aucun secret.
 *
 * Decap (publication simple, sans editorial_workflow) ne propose pas de
 * choisir un commit. Sa seule marche arrière native est la sauvegarde
 * locale du navigateur (localForage, clé backup.<collection>.<slug>) :
 * un brouillon non enregistré, pas une version GitHub.
 */

export function entryFileFromAdminHash(hash) {
  var raw = String(hash || "").replace(/^#/, "");
  var pathOnly = raw.split("?")[0];
  var parts = pathOnly.split("/").filter(Boolean);
  if (parts[0] !== "collections" || parts.length < 3) return { kind: "none" };
  var collection = parts[1];
  var folders = { blog: "content/blog", pages: "content/pages" };
  if (!Object.prototype.hasOwnProperty.call(folders, collection)) return { kind: "none" };
  if (parts[2] === "new") return { kind: "unpublished", collection: collection };
  if (parts[2] !== "entries" || parts.length < 4) return { kind: "none" };
  var slug = parts.slice(3).join("/");
  try {
    slug = decodeURIComponent(slug);
  } catch (e) {
    return { kind: "invalid", collection: collection };
  }
  if (!/^[a-zA-Z0-9._-]{1,120}$/.test(slug)) return { kind: "invalid", collection: collection };
  return {
    kind: "entry",
    collection: collection,
    slug: slug,
    path: folders[collection] + "/" + slug + ".md",
  };
}

export function historyButtonHtml() {
  return `<button type="button" id="gem-history-open" data-gem-history="github_admin" hidden aria-haspopup="dialog" aria-controls="gem-history-panel" style="position:fixed;top:58px;right:12px;z-index:10000;margin:0;font-family:Barlow,sans-serif;font-weight:700;color:#1c534a;background:#fffefc;border:1px solid rgba(42,124,111,.45);border-radius:0.35rem;padding:0.55rem 0.8rem;cursor:pointer">Historique</button>`;
}

export function historyPanelHtml() {
  return `<script defer>
(function () {
  var resolveEntry = ${entryFileFromAdminHash.toString()};
  var ENDPOINT = "/api/admin-history";
  var NOTE_KEY = "gem-history-note";
  var previewToken = 0;
  var busy = false;
  var selected = null;
  var currentEntry = null;

  function formatDate(iso) {
    if (!iso) return "date inconnue";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "date inconnue";
    try {
      return new Intl.DateTimeFormat("fr-FR", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Europe/Paris"
      }).format(d);
    } catch (e) {
      return iso;
    }
  }

  function showNote(text) {
    var prev = document.getElementById("gem-history-note");
    if (prev && prev.parentNode) prev.parentNode.removeChild(prev);
    var el = document.createElement("p");
    el.id = "gem-history-note";
    el.setAttribute("role", "status");
    el.textContent = text;
    el.style.cssText = "position:fixed;bottom:1.25rem;left:1.25rem;z-index:10070;max-width:min(28rem,calc(100% - 2rem));margin:0;background:#f3faf7;color:#1c534a;border:1px solid rgba(42,124,111,.35);border-radius:.35rem;padding:.7rem .85rem;font-family:Barlow,sans-serif;font-size:.95rem;box-shadow:0 8px 24px rgba(28,83,74,.12)";
    document.body.appendChild(el);
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 6000);
  }

  function clearDecapBackup(collection, slug) {
    return new Promise(function (resolve) {
      var finished = false;
      function done() {
        if (finished) return;
        finished = true;
        resolve();
      }
      try {
        localStorage.removeItem("localforage/keyvaluepairs/backup." + collection + "." + slug);
        localStorage.removeItem("localforage/keyvaluepairs/backup." + collection);
        localStorage.removeItem("localforage/keyvaluepairs/backup");
      } catch (e) {}
      if (!window.indexedDB) {
        done();
        return;
      }
      function openAndDelete() {
        var req;
        try {
          req = indexedDB.open("localforage");
        } catch (e) {
          done();
          return;
        }
        var timer = setTimeout(done, 1500);
        req.onerror = function () {
          clearTimeout(timer);
          done();
        };
        req.onsuccess = function () {
          clearTimeout(timer);
          var db = req.result;
          try {
            if (!db.objectStoreNames.contains("keyvaluepairs")) {
              db.close();
              done();
              return;
            }
            var tx = db.transaction("keyvaluepairs", "readwrite");
            var store = tx.objectStore("keyvaluepairs");
            store.delete("backup." + collection + "." + slug);
            store.delete("backup." + collection);
            store.delete("backup");
            tx.oncomplete = function () {
              db.close();
              done();
            };
            tx.onerror = function () {
              db.close();
              done();
            };
            tx.onabort = function () {
              db.close();
              done();
            };
          } catch (e) {
            try { db.close(); } catch (e2) {}
            done();
          }
        };
      }
      if (typeof indexedDB.databases === "function") {
        indexedDB.databases().then(function (list) {
          var found = (list || []).some(function (db) { return db && db.name === "localforage"; });
          if (!found) done();
          else openAndDelete();
        }).catch(openAndDelete);
      } else {
        openAndDelete();
      }
    });
  }

  function setStatus(text) {
    var el = document.getElementById("gem-history-status");
    if (el) el.textContent = text || "";
  }

  function closePanel() {
    var panel = document.getElementById("gem-history-panel");
    if (panel) panel.hidden = true;
  }

  function ensurePanel() {
    var panel = document.getElementById("gem-history-panel");
    if (panel) return panel;
    panel = document.createElement("div");
    panel.id = "gem-history-panel";
    panel.hidden = true;
    panel.style.cssText = "position:fixed;inset:0;z-index:10050;background:rgba(28,40,36,.45);display:flex;align-items:flex-start;justify-content:center;padding:4.5rem 1rem 1rem;box-sizing:border-box";
    var dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "gem-history-title");
    dialog.style.cssText = "width:min(42rem,100%);max-height:min(40rem,calc(100vh - 6rem));overflow:auto;background:#fffefc;color:#1c534a;border-radius:.5rem;padding:1rem 1.1rem 1.15rem;box-shadow:0 16px 40px rgba(28,40,36,.2);font-family:Barlow,sans-serif";
    var head = document.createElement("div");
    head.style.cssText = "display:flex;justify-content:space-between;gap:.75rem;align-items:center";
    var title = document.createElement("h2");
    title.id = "gem-history-title";
    title.textContent = "Historique des versions";
    title.style.cssText = "margin:0;font-size:1.15rem;font-weight:700";
    var close = document.createElement("button");
    close.type = "button";
    close.id = "gem-history-close";
    close.textContent = "Fermer";
    close.style.cssText = "font:inherit;font-weight:700;color:#1c534a;background:#fff;border:1px solid rgba(42,124,111,.45);border-radius:.35rem;padding:.4rem .7rem;cursor:pointer";
    head.appendChild(title);
    head.appendChild(close);
    var path = document.createElement("p");
    path.id = "gem-history-path";
    path.style.cssText = "margin:.75rem 0 .25rem;font-size:.85rem;word-break:break-all";
    var status = document.createElement("p");
    status.id = "gem-history-status";
    status.setAttribute("role", "status");
    status.style.cssText = "margin:0 0 .6rem;min-height:1.2em";
    var list = document.createElement("div");
    list.id = "gem-history-list";
    var previewTitle = document.createElement("h3");
    previewTitle.textContent = "Aperçu";
    previewTitle.style.cssText = "margin:1rem 0 .35rem;font-size:1rem";
    var preview = document.createElement("pre");
    preview.id = "gem-history-preview";
    preview.style.cssText = "margin:0;max-height:12rem;overflow:auto;white-space:pre-wrap;word-break:break-word;background:#f4f7f6;border-radius:.35rem;padding:.7rem;font-size:.85rem";
    var restore = document.createElement("button");
    restore.type = "button";
    restore.id = "gem-history-restore";
    restore.textContent = "Restaurer cette version";
    restore.disabled = true;
    restore.style.cssText = "margin-top:.85rem;font:inherit;font-weight:700;color:#fffefc;background:#2a7c6f;border:0;border-radius:.35rem;padding:.55rem .85rem;cursor:pointer";
    var help = document.createElement("p");
    help.id = "gem-history-help";
    help.textContent = "Les 30 derniers commits de ce fichier sur main. Restaurer écrit un nouveau commit : l’historique déjà publié n’est pas réécrit. La première ligne est la version actuelle ; la choisir recharge l’éditeur et abandonne les modifications non enregistrées.";
    help.style.cssText = "margin:.75rem 0 0;font-size:.85rem;line-height:1.4";
    dialog.appendChild(head);
    dialog.appendChild(path);
    dialog.appendChild(status);
    dialog.appendChild(list);
    dialog.appendChild(previewTitle);
    dialog.appendChild(preview);
    dialog.appendChild(restore);
    dialog.appendChild(help);
    panel.appendChild(dialog);
    document.body.appendChild(panel);
    close.addEventListener("click", closePanel);
    panel.addEventListener("click", function (event) {
      if (event.target === panel) closePanel();
    });
    restore.addEventListener("click", restoreSelected);
    return panel;
  }

  function post(body) {
    return fetch(ENDPOINT, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        return { ok: res.ok, status: res.status, data: data || {} };
      });
    });
  }

  function resetPreview() {
    selected = null;
    previewToken += 1;
    var preview = document.getElementById("gem-history-preview");
    if (preview) preview.textContent = "";
    var restore = document.getElementById("gem-history-restore");
    if (restore) restore.disabled = true;
  }

  function renderCommits(commits) {
    var list = document.getElementById("gem-history-list");
    list.textContent = "";
    commits.forEach(function (commit, index) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.style.cssText = "display:block;width:100%;text-align:left;margin:0 0 .45rem;padding:.55rem .7rem;border:1px solid rgba(42,124,111,.28);border-radius:.35rem;background:#fff;color:#1c534a;font:inherit;cursor:pointer";
      var when = document.createElement("strong");
      when.style.display = "block";
      when.textContent = formatDate(commit.date) + " — " + (commit.author || "Auteur inconnu") + " · " + String(commit.sha || "").slice(0, 7);
      var msg = document.createElement("span");
      msg.style.display = "block";
      msg.style.marginTop = ".15rem";
      msg.textContent = (index === 0 ? "Version actuelle sur main. " : "") + (commit.message || "");
      btn.appendChild(when);
      btn.appendChild(msg);
      btn.addEventListener("click", function () { selectCommit(commit, btn); });
      list.appendChild(btn);
    });
  }

  function loadList(path) {
    setStatus("Chargement des versions…");
    document.getElementById("gem-history-list").textContent = "";
    resetPreview();
    return post({ action: "list", path: path }).then(function (res) {
      if (!currentEntry || currentEntry.path !== path) return;
      if (!res.ok) {
        setStatus(res.data.error || "Impossible de lire l’historique.");
        return;
      }
      var commits = res.data.commits || [];
      renderCommits(commits);
      if (!commits.length) setStatus("Aucun commit sur main pour ce fichier.");
      else setStatus(commits.length + (commits.length > 1 ? " versions récentes sur main." : " version récente sur main."));
    }).catch(function () {
      setStatus("Impossible de joindre l’historique.");
    });
  }

  function selectCommit(commit, btn) {
    if (!currentEntry || currentEntry.kind !== "entry" || !commit || !commit.sha) return;
    selected = commit;
    var list = document.getElementById("gem-history-list");
    var buttons = list.querySelectorAll("button");
    for (var i = 0; i < buttons.length; i++) {
      var on = buttons[i] === btn;
      buttons[i].style.borderColor = on ? "#2a7c6f" : "rgba(42,124,111,.28)";
      buttons[i].style.background = on ? "#f3faf7" : "#fff";
      buttons[i].setAttribute("aria-pressed", on ? "true" : "false");
    }
    var token = ++previewToken;
    var preview = document.getElementById("gem-history-preview");
    var restore = document.getElementById("gem-history-restore");
    preview.textContent = "Chargement de l’aperçu…";
    restore.disabled = true;
    post({ action: "read", path: currentEntry.path, sha: commit.sha }).then(function (res) {
      if (token !== previewToken) return;
      if (!res.ok) {
        preview.textContent = res.data.error || "Aperçu impossible.";
        return;
      }
      if (res.data.binary) {
        preview.textContent = "Aperçu texte indisponible pour ce fichier. La restauration reste possible.";
      } else if (!res.data.content) {
        preview.textContent = "(fichier vide)";
      } else {
        preview.textContent = res.data.content + (res.data.truncated ? "\\n\\n[Aperçu tronqué — la restauration utilise le fichier complet.]" : "");
      }
      restore.disabled = false;
    }).catch(function () {
      if (token !== previewToken) return;
      preview.textContent = "Aperçu impossible.";
    });
  }

  function restoreSelected() {
    if (busy || !selected || !currentEntry || currentEntry.kind !== "entry") return;
    var label = formatDate(selected.date);
    var ok = window.confirm(
      "Restaurer la version du " + label + " sur main ?\\n\\nUn nouveau commit sera créé. Les modifications non enregistrées de cet écran seront perdues."
    );
    if (!ok) return;
    busy = true;
    var restore = document.getElementById("gem-history-restore");
    restore.disabled = true;
    setStatus("Restauration en cours…");
    post({ action: "restore", path: currentEntry.path, sha: selected.sha }).then(function (res) {
      if (!res.ok) {
        busy = false;
        restore.disabled = false;
        setStatus(res.data.error || "Restauration impossible.");
        return;
      }
      var note = res.data.unchanged
        ? "Cette version est déjà sur main. L’éditeur a été rechargé sans les modifications non enregistrées."
        : "Version restaurée sur main. L’éditeur affiche le fichier enregistré.";
      try { sessionStorage.setItem(NOTE_KEY, note); } catch (e) {}
      return clearDecapBackup(currentEntry.collection, currentEntry.slug).then(function () {
        location.reload();
      });
    }).catch(function () {
      busy = false;
      restore.disabled = false;
      setStatus("Restauration impossible.");
    });
  }

  function openPanel() {
    var entry = resolveEntry(location.hash);
    currentEntry = entry;
    var panel = ensurePanel();
    panel.hidden = false;
    document.getElementById("gem-history-path").textContent = entry && entry.path ? entry.path : "";
    resetPreview();
    document.getElementById("gem-history-list").textContent = "";
    if (!entry || entry.kind === "unpublished") {
      setStatus("Cet article n’a pas encore été publié : aucun fichier sur main, donc pas d’historique à restaurer.");
      return;
    }
    if (entry.kind === "invalid") {
      setStatus("Adresse de l’article illisible. Rouvrez l’entrée depuis la liste.");
      return;
    }
    if (entry.kind !== "entry") {
      setStatus("Ouvrez un article ou une page déjà enregistrée pour voir son historique.");
      return;
    }
    loadList(entry.path);
    var close = document.getElementById("gem-history-close");
    if (close) close.focus();
  }

  function syncButton() {
    var btn = document.getElementById("gem-history-open");
    if (!btn) return;
    var entry = resolveEntry(location.hash);
    var show = entry.kind === "entry" || entry.kind === "unpublished" || entry.kind === "invalid";
    btn.hidden = !show;
    if (entry.kind === "unpublished") btn.title = "Cet article n’a pas encore de version sur main";
    else if (entry.kind === "entry") btn.title = "Versions Git de cette entrée";
    else btn.title = "Historique";
  }

  function boot() {
    var btn = document.getElementById("gem-history-open");
    if (!btn || btn.getAttribute("data-gem-bound") === "1") return;
    btn.setAttribute("data-gem-bound", "1");
    btn.addEventListener("click", openPanel);
    window.addEventListener("hashchange", function () {
      syncButton();
      var panel = document.getElementById("gem-history-panel");
      if (panel && !panel.hidden) openPanel();
    });
    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape") return;
      var panel = document.getElementById("gem-history-panel");
      if (panel && !panel.hidden) closePanel();
    });
    syncButton();
    try {
      var note = sessionStorage.getItem(NOTE_KEY);
      if (note) {
        sessionStorage.removeItem(NOTE_KEY);
        showNote(note);
      }
    } catch (e) {}
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
</script>`;
}
