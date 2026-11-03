(function () {
  "use strict";

  var auth = window.EventixAuth;

  function report(form, error) {
    var message = form.querySelector("[data-auth-message]");
    if (!message) {
      message = document.createElement("p");
      message.setAttribute("role", "alert");
      message.dataset.authMessage = "";
      form.appendChild(message);
    }
    message.textContent = error.message;
    message.hidden = false;
  }

  function bindLogout(button) {
    button.addEventListener("click", async function () {
      button.disabled = true;
      try {
        await auth.logout();
      } catch (error) {
        button.disabled = false;
        var message = document.querySelector("[data-session-error]");
        if (!message) {
          message = document.createElement("p");
          message.setAttribute("role", "alert");
          message.dataset.sessionError = "";
          document.body.prepend(message);
        }
        message.textContent = error.message;
      }
    });
  }

  function ensureSessionControls(user) {
    var container = document.querySelector(".nav-actions") ||
      document.querySelector(".barra-superior") ||
      document.querySelector("header");
    if (!container) return;
    document.querySelectorAll('a[href="login.html"], a[href="Login.html"], a[href="registro.html"]').forEach(function (link) {
      link.hidden = true;
    });
    if (user.role === "cliente" && !container.querySelector(".js-user-name")) {
      var name = document.createElement("span");
      name.className = "js-user-name";
      container.prepend(name);
      auth.showUser(user);
    }
    if (user.role === "cliente" && document.body.dataset.optionalSession) {
      var reservationsLink = document.createElement("a");
      reservationsLink.className = "btn btn-ghost";
      reservationsLink.href = "cliente-misreservas.html";
      reservationsLink.textContent = "Mis reservas";
      container.appendChild(reservationsLink);
    }
    if (!container.querySelector(".js-logout")) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn-ghost js-logout";
      button.textContent = "Cerrar sesión";
      container.appendChild(button);
      bindLogout(button);
    }
  }

  var registrationForm = document.getElementById("formulario-registro");
  if (registrationForm && auth) {
    var roleSelect = registrationForm.elements.rol;
    var citySelect = registrationForm.elements.id_ciudad;
    var submitButton = registrationForm.querySelector('button[type="submit"]');

    auth.request("/ciudades")
      .then(function (result) {
        citySelect.replaceChildren(new Option("Selecciona una ciudad", ""));
        (result.ciudades || []).forEach(function (city) {
          citySelect.add(new Option(
            city.ciudad + ", " + city.departamento,
            city.id_ciudad
          ));
        });
      })
      .catch(function (error) {
        report(registrationForm, error);
        submitButton.disabled = true;
      });

    registrationForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      var message = registrationForm.querySelector("[data-auth-message]");
      if (message) message.hidden = true;
      var nameInput = registrationForm.elements.nombre_completo;
      if (nameInput && nameInput.value.trim().split(/\s+/).filter(Boolean).length < 2) {
        report(registrationForm, new Error("Ingresa tu nombre y apellido."));
        nameInput.focus();
        return;
      }
      submitButton.disabled = true;
      submitButton.textContent = "Creando cuenta...";
      try {
        var result = await auth.register({
          identificacion: registrationForm.elements.num_identificacion.value,
          nombre_completo: registrationForm.elements.nombre_completo.value,
          correo: registrationForm.elements.correo.value,
          numero_telefono: registrationForm.elements.numero_telefono.value,
          id_ciudad: registrationForm.elements.id_ciudad.value,
          direccion: registrationForm.elements.direccion.value,
          contrasena: registrationForm.elements.contrasena.value,
          rol: roleSelect.value
        });
        window.location.replace(auth.roleHome(result.usuario.role));
      } catch (error) {
        report(registrationForm, error);
        submitButton.disabled = false;
        submitButton.textContent = "Crear cuenta";
      }
    });
  }

  var pageRole = document.body.dataset.requiredRole;
  if (pageRole && auth) {
    auth.requireRole(pageRole).then(function (user) {
      if (user) ensureSessionControls(user);
    }).catch(function (error) {
      var message = document.querySelector("[data-session-error]");
      if (!message) {
        message = document.createElement("p");
        message.setAttribute("role", "alert");
        message.dataset.sessionError = "";
        document.body.prepend(message);
      }
      message.textContent = error.message;
    });
  }

  document.querySelectorAll(".js-logout").forEach(bindLogout);

  if (document.body.dataset.optionalSession && auth) {
    auth.getCurrentUser().then(function (result) {
      auth.showUser(result.usuario);
      ensureSessionControls(result.usuario);
      document.querySelectorAll('a[href="login.html"], a[href="Login.html"], a[href="registro.html"]').forEach(function (link) {
        link.hidden = true;
      });
    }).catch(function (error) {
      if (error.status !== 401) {
        var message = document.createElement("p");
        message.setAttribute("role", "alert");
        message.textContent = error.message;
        document.body.prepend(message);
      }
    });
  }
})();
