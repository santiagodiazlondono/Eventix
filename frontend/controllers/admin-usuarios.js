(function () {
  "use strict";

  var auth = window.EventixAuth;
  var form = document.getElementById("formulario-usuario");
  if (!auth || !form) return;

  var tableBody = document.getElementById("usuarios-lista");
  var message = document.getElementById("usuarios-mensaje");
  var searchInput = document.getElementById("buscar-usuarios");
  var roleFilter = document.querySelector(".users-role-select");
  var modal = document.getElementById("modal-usuario");
  var formMessage = document.getElementById("usuario-form-mensaje");
  var citySelect = document.getElementById("usuario-ciudad");
  var users = [];
  var isEditing = false;

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
        user.telefono || "—",
        [user.ciudad, user.departamento, user.pais].filter(Boolean).join(", ") || "—"
      ].forEach(function (value) {
        var cell = document.createElement("td");
        cell.textContent = value;
        row.appendChild(cell);
      });

      var actions = document.createElement("td");
      actions.className = "admin-text-right";
      var editButton = document.createElement("button");
      editButton.type = "button";
      editButton.className = "btn btn-ghost user-edit-btn";
      editButton.textContent = "Editar";
      editButton.addEventListener("click", function () {
        openUserEditor(user);
      });
      var deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "btn btn-ghost user-delete-btn";
      deleteButton.textContent = "Eliminar";
      deleteButton.addEventListener("click", function () {
        deleteUser(user);
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

  function closeModal() {
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
  }

  async function openUserEditor(user) {
    isEditing = Boolean(user);
    form.reset();
    formMessage.hidden = true;
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
      await loadCities(user && user.id_ciudad);
      form.elements.nombres.focus();
    } catch (error) {
      showMessage(formMessage, error.message, true);
    }
  }

  async function deleteUser(user) {
    var name = [user.nombres, user.apellidos].filter(Boolean).join(" ");
    if (!window.confirm('¿Eliminar la cuenta de "' + name + '"?')) return;
    try {
      await auth.request("/admin/usuarios/" + encodeURIComponent(user.identificacion), {
        method: "DELETE"
      });
      await loadUsers();
    } catch (error) {
      window.alert(error.message);
    }
  }

  searchInput.addEventListener("input", renderUsers);
  roleFilter.addEventListener("change", renderUsers);
  document.getElementById("agregar-usuario").addEventListener("click", function () {
    openUserEditor(null);
  });
  modal.querySelectorAll("[data-close-usuario]").forEach(function (button) {
    button.addEventListener("click", closeModal);
  });
  modal.addEventListener("click", function (event) {
    if (event.target === modal) closeModal();
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
})();
