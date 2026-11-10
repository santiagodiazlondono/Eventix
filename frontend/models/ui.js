(function () {
  "use strict";

  function scrollToSection(element) {
    if (!element) return Promise.resolve();

    return new Promise(function (resolve) {
      window.requestAnimationFrame(function () {
        var reducedMotion = window.matchMedia(
          "(prefers-reduced-motion: reduce)"
        ).matches;
        element.scrollIntoView({
          behavior: reducedMotion ? "auto" : "smooth",
          block: "start"
        });
        if (typeof element.focus === "function") {
          element.focus({ preventScroll: true });
        }
        resolve();
      });
    });
  }

  // Estilos del cuadro de motivo. Usa las variables de las dos hojas de estilo
  // del proyecto (styles.css y base.css) con un color de respaldo.
  var REASON_DIALOG_STYLE = [
    ".eventix-reason-dialog{width:min(28rem,calc(100vw - 2rem));padding:1.5rem;",
    "border:1px solid var(--border-strong,var(--borde,#33405E));border-radius:12px;",
    "background:var(--surface,var(--superficie,#141924));color:var(--text,var(--texto,#EDF1F7));",
    "font:inherit;box-shadow:0 24px 60px rgba(0,0,0,.5)}",
    ".eventix-reason-dialog::backdrop{background:rgba(5,8,14,.72)}",
    ".eventix-reason-dialog h2{margin:0 0 .5rem;font-size:1.15rem;font-weight:600}",
    ".eventix-reason-dialog p{margin:0 0 1rem;color:var(--text-muted,var(--texto-suave,#8C97AD));",
    "font-size:.9rem;line-height:1.5}",
    ".eventix-reason-dialog label{display:block;margin-bottom:.4rem;font-size:.82rem;font-weight:600}",
    ".eventix-reason-dialog textarea{display:block;width:100%;min-height:5.5rem;resize:vertical;",
    "padding:.65rem .75rem;border:1px solid var(--border-strong,var(--borde,#33405E));border-radius:8px;",
    "background:var(--surface-2,var(--superficie-campo,#1B2230));color:inherit;font:inherit;",
    "box-sizing:border-box}",
    ".eventix-reason-dialog textarea:focus{outline:none;border-color:var(--accent,var(--azul,#3D7EFF))}",
    ".eventix-reason-actions{display:flex;justify-content:flex-end;gap:.6rem;margin-top:1.25rem;flex-wrap:wrap}",
    ".eventix-reason-actions button{min-height:2.6rem;padding:.55rem 1rem;border-radius:8px;",
    "border:1px solid var(--border-strong,var(--borde,#33405E));background:transparent;color:inherit;",
    "font:inherit;font-weight:600;cursor:pointer}",
    ".eventix-reason-actions .eventix-reason-confirm{border-color:transparent;",
    "background:var(--danger,#FF5470);color:#fff}"
  ].join("");

  // Pide confirmación y un motivo opcional en un cuadro propio de la página
  // (window.prompt no está disponible en todos los navegadores).
  // Devuelve una promesa: el texto escrito (puede ser "") o null si se cierra.
  function askReason(options) {
    var config = options || {};
    return new Promise(function (resolve) {
      if (!document.getElementById("eventix-reason-style")) {
        var style = document.createElement("style");
        style.id = "eventix-reason-style";
        style.textContent = REASON_DIALOG_STYLE;
        document.head.appendChild(style);
      }

      var dialog = document.createElement("dialog");
      dialog.className = "eventix-reason-dialog";
      dialog.setAttribute("aria-labelledby", "eventix-reason-title");
      var form = document.createElement("form");
      form.method = "dialog";

      var title = document.createElement("h2");
      title.id = "eventix-reason-title";
      title.textContent = config.title || "Confirmar cancelación";
      var message = document.createElement("p");
      message.textContent = config.message || "";
      var label = document.createElement("label");
      label.htmlFor = "eventix-reason-text";
      label.textContent = "Motivo (opcional)";
      var textarea = document.createElement("textarea");
      textarea.id = "eventix-reason-text";
      textarea.maxLength = 500;
      textarea.placeholder = "Escribe el motivo de la cancelación";

      var actions = document.createElement("div");
      actions.className = "eventix-reason-actions";
      var backButton = document.createElement("button");
      backButton.type = "button";
      backButton.textContent = config.cancelLabel || "Volver";
      var confirmButton = document.createElement("button");
      confirmButton.type = "submit";
      confirmButton.className = "eventix-reason-confirm";
      confirmButton.textContent = config.confirmLabel || "Confirmar";
      actions.append(backButton, confirmButton);

      form.append(title, message, label, textarea, actions);
      dialog.appendChild(form);
      document.body.appendChild(dialog);

      var result = null;
      backButton.addEventListener("click", function () {
        dialog.close();
      });
      form.addEventListener("submit", function () {
        result = textarea.value.trim().slice(0, 500);
      });
      dialog.addEventListener("close", function () {
        dialog.remove();
        resolve(result);
      });

      dialog.showModal();
      textarea.focus();
    });
  }

  window.EventixUI = {
    scrollToSection: scrollToSection,
    askReason: askReason
  };
})();
