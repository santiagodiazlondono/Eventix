(function () {
  "use strict";

  var auth = window.EventixAuth;
  var ui = window.EventixUI;
  var form = document.getElementById("formulario-usuario");
  if (!auth || !ui || !form) return;

  var tableBody = document.getElementById("usuarios-lista");
  var message = document.getElementById("usuarios-mensaje");
  var searchInput = document.getElementById("buscar-usuarios");
  var roleFilter = document.querySelector(".users-role-select");
  var modal = document.getElementById("modal-usuario");
  var formMessage = document.getElementById("usuario-form-mensaje");
  var citySelect = document.getElementById("usuario-ciudad");
  var agentEventsSection = document.getElementById("usuario-eventos");
  var agentEventsBody = document.getElementById("usuario-eventos-lista");
  var agentEventsMessage = document.getElementById("usuario-eventos-mensaje");
  var users = [];
  var isEditing = false;
  var editorOriginButton = null;
  var searchTimer = null;

  function showMessage(target, text, isError) {
    target.textContent = text;
    target.hidden = !text;
    target.dataset.type = isError ? "error" : "success";
  }

  function roleName(role) {
    return {
      cliente: "Cliente",
      agente: "Agente",
      administrador: "Administrador"
    }[role] || role;
  }

  function renderUsers() {
    var query = searchInput.value.trim().toLocaleLowerCase("es");
    var role = roleFilter.value;
    var visibleUsers = users.filter(function (user) {
      var fullName = [user.nombres, user.apellidos].join(" ");
      var matchesQuery = !query ||
        [fullName, user.correo_electronico, user.identificacion]
          .some(function (value) {
            return String(value || "").toLocaleLowerCase("es").includes(query);
          });
      return matchesQuery && (!role || user.role === role);
    });

    tableBody.replaceChildren();
    visibleUsers.forEach(function (user) {
      var row = document.createElement("tr");
      row.dataset.userIdentification = user.identificacion;
      var identity = document.createElement("td");
      var name = document.createElement("div");
      name.className = "user-name";
      name.textContent = [user.nombres, user.apellidos].filter(Boolean).join(" ");
      var email = document.createElement("div");
      email.className = "user-email";
      email.textContent = user.correo_electronico;
      identity.append(name, email);
      row.appendChild(identity);

      [
        user.identificacion,
        roleName(user.role),
        user.role === "agente"
          ? Number(user.eventos_activos || 0) + " / " + Number(user.eventos_total || 0)
          : "—",
        user.telefono || "—",
        [user.ciudad, user.departamento, user.pais].filter(Boolean).join(", ") || "—"
      ].forEach(function (value) {
        var cell = document.createElement("td");
        cell.textContent = value;
        row.appendChild(cell);
      });

      var actions = document.createElement("td");
      actions.className = "admin-action-group";
      var editButton = document.createElement("button");
      editButton.type = "button";
      editButton.className = "btn btn-ghost user-edit-btn admin-action-btn admin-action-btn--neutral";
      editButton.textContent = "Editar";
      editButton.addEventListener("click", function () {
        openUserEditor(user, editButton);
      });
      var deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "btn btn-ghost user-delete-btn admin-action-btn admin-action-btn--danger";
      deleteButton.textContent = "Eliminar";
      deleteButton.addEventListener("click", function () {
        deleteUser(user, deleteButton);
      });
      actions.append(editButton, deleteButton);
      row.appendChild(actions);
      tableBody.appendChild(row);
    });

    showMessage(
      message,
      visibleUsers.length ? "" : users.length
        ? "No hay usuarios que coincidan con los filtros."
        : "Todavía no hay usuarios registrados.",
      false
    );
  }

  async function loadUsers() {
    showMessage(message, "Cargando usuarios...", false);
    var result = await auth.request("/admin/usuarios");
    users = result.usuarios || [];
    renderUsers();
  }

  async function loadCities(selectedCityId) {
    var result = await auth.request("/ciudades");
    citySelect.replaceChildren(new Option("Selecciona una ciudad", ""));
    (result.ciudades || []).forEach(function (city) {
      citySelect.add(new Option(
        city.ciudad + ", " + city.departamento,
        city.id_ciudad
      ));
    });
    if (selectedCityId) citySelect.value = String(selectedCityId);
  }

  function formatEventDate(value) {
    if (!value) return "Fecha por confirmar";
    return new Intl.DateTimeFormat("es-CO", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(value));
  }

  async function loadAgentEvents(identification) {
    agentEventsBody.replaceChildren();
    showMessage(agentEventsMessage, "Cargando eventos...", false);
    try {
      var result = await auth.request(
        "/admin/usuarios/" + encodeURIComponent(identification) + "/eventos"
      );
      (result.eventos || []).forEach(function (event) {
        var row = document.createElement("tr");
        [event.nombre, formatEventDate(event.fecha_hora_inicio), event.estado, event.reservas]
          .forEach(function (value) {
            var cell = document.createElement("td");
            cell.textContent = String(value == null ? "—" : value);
            row.appendChild(cell);
          });
        agentEventsBody.appendChild(row);
      });
      showMessage(
        agentEventsMessage,
        result.eventos && result.eventos.length ? "" : "Este agente no tiene eventos.",
        false
      );
    } catch (error) {
      showMessage(agentEventsMessage, error.message, true);
    }
  }

  function closeModal(shouldReturnToOrigin) {
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    if (shouldReturnToOrigin !== false) {
      ui.scrollToSection(editorOriginButton);
    }
  }

  async function openUserEditor(user, sourceButton) {
    isEditing = Boolean(user);
    editorOriginButton = sourceButton || null;
    form.reset();
    formMessage.hidden = true;
    agentEventsSection.hidden = !user || user.role !== "agente";
    document.getElementById("modal-usuario-titulo").textContent =
      isEditing ? "Editar usuario" : "Nuevo usuario";
    document.getElementById("guardar-usuario").textContent =
      isEditing ? "Guardar cambios" : "Crear usuario";
    document.getElementById("contrasena-ayuda").textContent =
      isEditing ? "(opcional; déjala vacía para conservarla)" : "(mínimo 8 caracteres)";
    form.elements.identificacion.readOnly = isEditing;
    form.elements.contrasena.required = !isEditing;

    if (user) {
      form.elements.identificacion.value = user.identificacion;
      form.elements.nombres.value = user.nombres;
      form.elements.apellidos.value = user.apellidos;
      form.elements.correo_electronico.value = user.correo_electronico;
      form.elements.telefono.value = user.telefono || "";
      form.elements.calle.value = user.calle || "";
      form.elements.role.value = user.role;
    }

    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    try {
      await Promise.all([
        loadCities(user && user.id_ciudad),
        user && user.role === "agente"
          ? loadAgentEvents(user.identificacion)
          : Promise.resolve()
      ]);
      form.elements.nombres.focus();
    } catch (error) {
      showMessage(formMessage, error.message, true);
    }
  }

  async function deleteUser(user, sourceButton) {
    var name = [user.nombres, user.apellidos].filter(Boolean).join(" ");
    if (!window.confirm(
      '¿Eliminar la cuenta de "' + name + '"?\n\n' +
        "La persona perderá el acceso de inmediato. Si la cuenta tiene historial " +
        "(reservas o solicitudes resueltas), se desactiva y se borran sus datos " +
        "personales, pero el historial se conserva."
    )) return;
    try {
      var result = await auth.request("/admin/usuarios/" + encodeURIComponent(user.identificacion), {
        method: "DELETE"
      });
      await loadUsers();
      ui.scrollToSection(document.getElementById("directorio-title"));
      showMessage(
        message,
        result && result.cuenta_desactivada
          ? 'La cuenta de "' + name + '" tenía historial: ' +
            "se desactivó y se borraron sus datos personales. Ya no puede iniciar sesión."
          : 'La cuenta de "' + name + '" se eliminó.',
        false
      );
    } catch (error) {
      if (error.codigo === "TIENE_EVENTOS") {
        window.EventixAdminAgentTransfer.open(
          user.identificacion,
          error.eventos,
          sourceButton,
          "users"
        );
        return;
      }
      window.alert(error.message);
    }
  }

  searchInput.addEventListener("input", function () {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(renderUsers, 200);
  });
  roleFilter.addEventListener("change", renderUsers);
  document.getElementById("agregar-usuario").addEventListener("click", function () {
    openUserEditor(null, document.getElementById("agregar-usuario"));
  });
  document.getElementById("usuario-reasignar-eventos").addEventListener("click", function () {
    if (form.elements.identificacion.value) {
      var sourceId = form.elements.identificacion.value;
      closeModal(false);
      window.EventixAdminAgentTransfer.open(
        sourceId,
        undefined,
        editorOriginButton,
        "users"
      );
    }
  });
  modal.querySelectorAll("[data-close-usuario]").forEach(function (button) {
    button.addEventListener("click", closeModal);
  });
  modal.addEventListener("click", function (event) {
    if (event.target === modal) closeModal();
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && modal.classList.contains("is-open")) {
      event.preventDefault();
      closeModal();
    }
  });
  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    formMessage.hidden = true;
    var data = Object.fromEntries(new FormData(form).entries());
    if (!data.contrasena) delete data.contrasena;
    var path = "/admin/usuarios" + (isEditing
      ? "/" + encodeURIComponent(data.identificacion)
      : "");
    var submitButton = document.getElementById("guardar-usuario");
    submitButton.disabled = true;
    try {
      await auth.request(path, {
        method: isEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
      await loadUsers();
      closeModal();
    } catch (error) {
      showMessage(formMessage, error.message, true);
    } finally {
      submitButton.disabled = false;
    }
  });

  loadUsers().catch(function (error) {
    showMessage(message, error.message, true);
  });

  window.addEventListener("eventix:agent-events-reassigned", function (event) {
    loadUsers().then(function () {
      if (event.detail.returnList !== "users") return;
      var row = Array.prototype.find.call(
        tableBody.querySelectorAll("tr"),
        function (item) {
          return item.dataset.userIdentification === event.detail.identificacion;
        }
      );
      var target = row && row.querySelector("button");
      ui.scrollToSection(target || document.getElementById("directorio-title"));
      showMessage(
        message,
        "Se reasignaron " + event.detail.eventosReasignados + " eventos correctamente.",
        false
      );
    }).catch(function (error) {
      showMessage(message, error.message, true);
    });
    if (modal.classList.contains("is-open") &&
        !agentEventsSection.hidden && form.elements.identificacion.value) {
      loadAgentEvents(form.elements.identificacion.value);
    }
  });
})();
