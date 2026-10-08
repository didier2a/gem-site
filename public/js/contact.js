(function () {
  const form = document.getElementById("contact-form");
  if (!form) return;

  const status = document.getElementById("contact-status");
  const submit = document.getElementById("contact-submit");

  function show(msg, ok) {
    if (!status) return;
    status.hidden = false;
    status.textContent = msg;
    status.classList.toggle("is-ok", !!ok);
    status.classList.toggle("is-err", !ok);
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;

    const data = {
      nom: form.nom.value,
      prenom: form.prenom.value,
      email: form.email.value,
      tel: form.tel.value,
      sujet: form.sujet.value,
      message: form.message.value,
      consent: form.consent.checked,
      website: form.website ? form.website.value : "",
    };

    const originalLabel = submit ? submit.textContent : "Envoyer le message";
    if (submit) {
      submit.disabled = true;
      submit.textContent = "Envoi…";
    }
    show("Envoi en cours…", true);

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(data),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        throw new Error(body.error || "Échec de l’envoi.");
      }
      form.reset();
      show("Message envoyé. Merci — nous vous répondrons à gempv@laposte.net bientôt.", true);
    } catch (err) {
      show(
        (err && err.message) ||
          "Envoi impossible. Écrivez-nous à gempv@laposte.net.",
        false
      );
    } finally {
      if (submit) {
        submit.disabled = false;
        submit.textContent = originalLabel;
      }
    }
  });
})();
