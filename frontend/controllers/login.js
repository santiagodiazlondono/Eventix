(function () {
  "use strict";

  var form = document.querySelector(".formulario-inicio");
  if (!form || !window.EventixAuth) return;

  var button = form.querySelector('button[type="submit"]');
  var message = document.getElementById("login-message");
  var loginNotice = new URLSearchParams(window.location.search).get("mensaje");
  if (loginNotice) {
    message.textContent = loginNotice;
    message.hidden = false;
  }
  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    message.hidden = true;
    button.disabled = true;
    button.textContent = "Iniciando sesión...";
    try {
      var result = await window.EventixAuth.login(
        form.elements["correo-electronico"].value,
        form.elements["clave-acceso"].value
      );
      window.location.replace(
        window.EventixAuth.roleHome(result.usuario.role)
      );
    } catch (error) {
      message.textContent = error.message;
      message.hidden = false;
      button.disabled = false;
      button.textContent = "Iniciar sesión";
    }
  });
})();
