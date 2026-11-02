(function () {
  "use strict";

  var form = document.querySelector(".formulario-inicio");
  if (!form || !window.Eventix) return;

  var button = form.querySelector('button[type="submit"]');
  var message = document.getElementById("login-message");

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    message.hidden = true;
    button.disabled = true;
    button.textContent = "Iniciando sesión...";

    try {
      var result = await window.Eventix.get("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          correo: form.elements["correo-electronico"].value,
          contrasena: form.elements["clave-acceso"].value
        })
      });

      var destinations = {
        agente: "agente-registro.html",
        administrador: "admin-panel.html",
        cliente: "Index.html"
      };
      var requestedDestination = new URLSearchParams(window.location.search).get("next");
      var destination = requestedDestination === destinations[result.usuario.role]
        ? requestedDestination
        : destinations[result.usuario.role];

      if (!destination) {
        throw new Error("La cuenta no tiene un rol habilitado para ingresar.");
      }

      window.location.replace(destination);
    } catch (error) {
      message.textContent = error.message;
      message.hidden = false;
      button.disabled = false;
      button.textContent = "Iniciar sesión";
    }
  });
})();
