(function () {
  "use strict";

  var auth = window.EventixAuth;
  var form = document.getElementById("perfil-formulario");
  if (!auth || !form) return;

  var message = document.getElementById("perfil-mensaje");
  var deleteDialog = document.getElementById("perfil-eliminar-dialogo");
  var deleteForm = document.getElementById("perfil-eliminar-formulario");
  var cities = [];
  var profile = null;
  var editing = false;

  function showMessage(text, isError) {
    message.textContent = text;
    message.hidden = !text;
    message.dataset.type = isError ? "error" : "success";
  }

  function setEditing(enabled) {
    editing = enabled;
    form.querySelectorAll("input, select").forEach(function (element) {
      if (element.name !== "identificacion") {
        element.disabled = !enabled;
      }
    });
    document.getElementById("perfil-editar").hidden = enabled;
    document.getElementById("perfil-guardar").hidden = !enabled;
    document.getElementById("perfil-cancelar").hidden = !enabled;
  }

  function fillProfile(data) {
    form.elements.nombres.value = data.nombres || "";
    form.elements.apellidos.value = data.apellidos || "";
    form.elements.identificacion.value = data.identificacion || "";
    form.elements.correo_electronico.value = data.correo_electronico || "";
    form.elements.telefono.value = data.telefono || "";
    form.elements.calle.value = data.calle || "";
    form.elements.id_ciudad.value = String(data.id_ciudad || "");
    var fullName = [data.nombres, data.apellidos].filter(Boolean).join(" ");
    document.querySelectorAll("[data-perfil-nombre]").forEach(function (element) {
      element.textContent = fullName || data.correo_electronico;
    });
    document.querySelectorAll("[data-perfil-rol]").forEach(function (element) {
      element.textContent = {
        cliente: "Cliente",
        agente: "Agente",
        administrador: "Administrador"
      }[data.role] || "Usuario";
    });
    var initials = fullName.split(/\s+/).filter(Boolean).slice(0, 2)
      .map(function (part) { return part.charAt(0); })
      .join("").toUpperCase() || "U";
    document.querySelectorAll("[data-perfil-iniciales]").forEach(function (element) {
      element.textContent = initials;
    });
  }

  async function loadProfile() {
    var results = await Promise.all([
      auth.request("/perfil"),
      auth.request("/ciudades")
    ]);
    profile = results[0].perfil;
    cities = results[1].ciudades || [];
    var citySelect = form.elements.id_ciudad;
    citySelect.replaceChildren(new Option("Selecciona una ciudad", ""));
    cities.forEach(function (city) {
      citySelect.add(new Option(
        [city.ciudad, city.departamento].filter(Boolean).join(", "),
        city.id_ciudad
      ));
    });
    fillProfile(profile);
    setEditing(false);
  }

  function closeDeleteDialog() {
    deleteDialog.classList.remove("is-open");
    deleteDialog.setAttribute("aria-hidden", "true");
    deleteForm.reset();
    var deleteMessage = document.getElementById("perfil-eliminar-mensaje");
    if (deleteMessage) deleteMessage.hidden = true;
  }

  document.getElementById("perfil-editar").addEventListener("click", function () {
    showMessage("", false);
    setEditing(true);
    form.elements.nombres.focus();
  });

  document.getElementById("perfil-cancelar").addEventListener("click", function () {
    fillProfile(profile);
    showMessage("", false);
    setEditing(false);
  });

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    if (!editing) return;
    var submitButton = document.getElementById("perfil-guardar");
    submitButton.disabled = true;
    try {
      var result = await auth.request("/perfil", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombres: form.elements.nombres.value,
          apellidos: form.elements.apellidos.value,
          correo_electronico: form.elements.correo_electronico.value,
          telefono: form.elements.telefono.value,
          calle: form.elements.calle.value,
          id_ciudad: form.elements.id_ciudad.value
        })
      });
      profile = Object.assign({}, profile, result.perfil);
      fillProfile(profile);
      setEditing(false);
      showMessage("Tus datos se actualizaron correctamente.", false);
    } catch (error) {
      showMessage(error.message, true);
    } finally {
      submitButton.disabled = false;
    }
  });

  document.getElementById("perfil-eliminar").addEventListener("click", function () {
    deleteDialog.classList.add("is-open");
    deleteDialog.setAttribute("aria-hidden", "false");
    deleteForm.elements.contrasena.focus();
  });
  deleteDialog.querySelectorAll("[data-cerrar-eliminar]").forEach(function (button) {
    button.addEventListener("click", closeDeleteDialog);
  });
  deleteDialog.addEventListener("click", function (event) {
    if (event.target === deleteDialog) closeDeleteDialog();
  });
  deleteForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    if (deleteForm.elements.confirmacion.value.trim() !== "ELIMINAR") {
      var deleteMessage = document.getElementById("perfil-eliminar-mensaje");
      deleteMessage.textContent = "Escribe ELIMINAR para confirmar la acción.";
      deleteMessage.hidden = false;
      return;
    }
    var submitButton = document.getElementById("perfil-confirmar-eliminar");
    submitButton.disabled = true;
    try {
      await auth.request("/perfil", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contrasena: deleteForm.elements.contrasena.value })
      });
      window.location.replace("Login.html?mensaje=" + encodeURIComponent(
        "Tu cuenta fue eliminada y tu sesión se cerró."
      ));
    } catch (error) {
      var deleteMessage = document.getElementById("perfil-eliminar-mensaje");
      deleteMessage.textContent = error.message;
      deleteMessage.hidden = false;
    } finally {
      submitButton.disabled = false;
    }
  });

  loadProfile().catch(function (error) {
    showMessage(error.message, true);
  });
})();
