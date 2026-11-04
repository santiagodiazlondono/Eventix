(function () {
  "use strict";

  var auth = window.EventixAuth;
  var form = document.getElementById("formulario-catalogo");
  if (!auth || !form) return;

  var tabs = Array.prototype.slice.call(
    document.querySelectorAll("[data-catalog-tab]")
  );
  var header = document.getElementById("catalogo-encabezado");
  var tableBody = document.getElementById("catalogo-lista");
  var message = document.getElementById("catalogo-mensaje");
  var modal = document.getElementById("modal-catalogo");
  var fieldsContainer = document.getElementById("catalogo-campos");
  var formMessage = document.getElementById("catalogo-form-mensaje");
  var addButton = document.getElementById("catalogo-agregar");
  var currentTab = "paises";
  var editingRecord = null;
  var records = {
    paises: [],
    departamentos: [],
    ciudades: [],
    administradores: [],
    usuarios: []
  };

  var definitions = {
    paises: {
      title: "país",
      endpoint: "/admin/catalogos/paises",
      headers: ["ID", "PAÍS", "DEPARTAMENTOS", "ACCIONES"]
    },
    departamentos: {
      title: "departamento",
      endpoint: "/admin/catalogos/departamentos",
      headers: ["ID", "DEPARTAMENTO", "PAÍS", "CIUDADES", "ACCIONES"]
    },
    ciudades: {
      title: "ciudad",
      endpoint: "/admin/catalogos/ciudades",
      headers: ["ID", "CIUDAD", "DEPARTAMENTO", "PAÍS", "ACCIONES"]
    },
    administradores: {
      title: "administrador",
      endpoint: "/admin/usuarios?rol=administrador",
      headers: ["IDENTIFICACIÓN", "ADMINISTRADOR", "CORREO", "TELÉFONO", "CIUDAD", "ACCIONES"]
    }
  };

  function showMessage(target, text, isError) {
    target.textContent = text;
    target.hidden = !text;
    target.dataset.type = isError ? "error" : "success";
  }

  function listFor(tab) {
    return tab === "administradores" ? records.administradores : records[tab];
  }

  function appendCell(row, value, className) {
    var cell = document.createElement("td");
    if (className) cell.className = className;
    cell.textContent = value === null || value === undefined || value === ""
      ? "—"
      : String(value);
    row.appendChild(cell);
  }

  function renderTable() {
    var definition = definitions[currentTab];
    var headingRow = document.createElement("tr");
    definition.headers.forEach(function (title) {
      var cell = document.createElement("th");
      cell.textContent = title;
      headingRow.appendChild(cell);
    });
    header.replaceChildren(headingRow);
    tableBody.replaceChildren();

    listFor(currentTab).forEach(function (record) {
      var row = document.createElement("tr");
      var id = currentTab === "paises" ? record.id_pais
        : currentTab === "departamentos" ? record.id_departamento
          : currentTab === "ciudades" ? record.id_ciudad
            : record.identificacion;
      if (currentTab === "administradores") {
        appendCell(row, id, "font-mono text-muted");
        appendCell(row, [record.nombres, record.apellidos].filter(Boolean).join(" "), "font-weight-500");
        appendCell(row, record.correo_electronico);
        appendCell(row, record.telefono);
        appendCell(row, record.ciudad);
      } else if (currentTab === "paises") {
        appendCell(row, id, "font-mono text-muted");
        appendCell(row, record.nombre, "font-weight-500");
        appendCell(row, record.cantidad_departamentos);
      } else if (currentTab === "departamentos") {
        appendCell(row, id, "font-mono text-muted");
        appendCell(row, record.nombre, "font-weight-500");
        appendCell(row, record.pais);
        appendCell(row, record.cantidad_ciudades);
      } else {
        appendCell(row, id, "font-mono text-muted");
        appendCell(row, record.nombre, "font-weight-500");
        appendCell(row, record.departamento);
        appendCell(row, record.pais);
      }

      var actions = document.createElement("td");
      actions.className = "text-right";
      var editButton = document.createElement("button");
      editButton.type = "button";
      editButton.className = "btn btn-ghost catalog-edit-button";
      editButton.textContent = "Editar";
      editButton.addEventListener("click", function () {
        openEditor(record);
      });
      var deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "btn btn-ghost catalog-delete-button";
      deleteButton.textContent = "Eliminar";
      deleteButton.addEventListener("click", function () {
        deleteRecord(record);
      });
      actions.append(editButton, deleteButton);
      row.appendChild(actions);
      tableBody.appendChild(row);
    });

    showMessage(
      message,
      listFor(currentTab).length ? "" : "No hay registros en esta sección.",
      false
    );
    addButton.textContent = "+ Agregar " + definition.title;
  }

  async function loadData() {
    showMessage(message, "Cargando catálogos...", false);
    var results = await Promise.all([
      auth.request("/admin/catalogos/paises"),
      auth.request("/admin/catalogos/departamentos"),
      auth.request("/admin/catalogos/ciudades"),
      auth.request("/admin/usuarios?rol=administrador"),
      auth.request("/ciudades")
    ]);
    records.paises = results[0].paises || [];
    records.departamentos = results[1].departamentos || [];
    records.ciudades = results[2].ciudades || [];
    records.administradores = results[3].usuarios || [];
    records.usuarios = results[4].ciudades || [];
    renderTable();
  }

  function addField(labelText, name, type, value) {
    var label = document.createElement("label");
    label.htmlFor = "catalogo-campo-" + name;
    label.textContent = labelText;
    var input = document.createElement(type === "select" ? "select" : "input");
    input.id = label.htmlFor;
    input.name = name;
    if (type !== "select") input.type = type;
    if (type === "text" || type === "email" || type === "password") {
      input.maxLength = type === "password" ? 72 : 100;
    }
    if (type === "password") {
      input.minLength = 8;
      input.autocomplete = "new-password";
    }
    if (value !== undefined && value !== null) input.value = String(value);
    fieldsContainer.append(label, input);
    return input;
  }

  function populateSelect(select, options, placeholder, idField, labelFn) {
    select.replaceChildren(new Option(placeholder, ""));
    options.forEach(function (option) {
      select.add(new Option(labelFn(option), option[idField]));
    });
  }

  function populateDepartments(countrySelect, departmentSelect, selectedId) {
    var countryId = countrySelect.value;
    var departments = records.departamentos.filter(function (department) {
      return String(department.id_pais) === String(countryId);
    });
    populateSelect(
      departmentSelect,
      departments,
      "Selecciona un departamento",
      "id_departamento",
      function (department) { return department.nombre; }
    );
    if (selectedId) departmentSelect.value = String(selectedId);
  }

  function buildFields(record) {
    fieldsContainer.replaceChildren();
    var tab = currentTab;
    var fields = {};
    if (tab === "paises") {
      fields.nombre = addField("Nombre del país", "nombre", "text", record && record.nombre);
      fields.nombre.required = true;
    } else if (tab === "departamentos") {
      var country = addField("País", "id_pais", "select");
      populateSelect(country, records.paises, "Selecciona un país", "id_pais", function (item) { return item.nombre; });
      if (record) country.value = String(record.id_pais);
      country.required = true;
      var departmentName = addField("Nombre del departamento", "nombre", "text", record && record.nombre);
      departmentName.required = true;
      fields.id_pais = country;
      fields.nombre = departmentName;
    } else if (tab === "ciudades") {
      var cityCountry = addField("País", "id_pais", "select");
      populateSelect(cityCountry, records.paises, "Selecciona un país", "id_pais", function (item) { return item.nombre; });
      if (record) cityCountry.value = String(record.id_pais);
      var department = addField("Departamento", "id_departamento", "select");
      populateDepartments(cityCountry, department, record && record.id_departamento);
      var cityName = addField("Nombre de la ciudad", "nombre", "text", record && record.nombre);
      cityCountry.required = true;
      department.required = true;
      cityName.required = true;
      cityCountry.addEventListener("change", function () {
        populateDepartments(cityCountry, department);
      });
      fields.id_pais = cityCountry;
      fields.id_departamento = department;
      fields.nombre = cityName;
    } else {
      fields.identificacion = addField("Identificación", "identificacion", "text", record && record.identificacion);
      fields.identificacion.required = true;
      fields.identificacion.maxLength = 20;
      fields.identificacion.readOnly = Boolean(record);
      fields.nombres = addField("Nombres", "nombres", "text", record && record.nombres);
      fields.nombres.maxLength = 100;
      fields.nombres.required = true;
      fields.apellidos = addField("Apellidos", "apellidos", "text", record && record.apellidos);
      fields.apellidos.maxLength = 100;
      fields.apellidos.required = true;
      fields.correo_electronico = addField("Correo electrónico", "correo_electronico", "email", record && record.correo_electronico);
      fields.correo_electronico.maxLength = 150;
      fields.correo_electronico.required = true;
      fields.telefono = addField("Teléfono", "telefono", "text", record && record.telefono);
      fields.telefono.maxLength = 20;
      fields.telefono.required = true;
      fields.id_ciudad = addField("Ciudad", "id_ciudad", "select");
      populateSelect(
        fields.id_ciudad,
        records.usuarios,
        "Selecciona una ciudad",
        "id_ciudad",
        function (city) { return city.ciudad + ", " + city.departamento; }
      );
      if (record) fields.id_ciudad.value = String(record.id_ciudad);
      fields.id_ciudad.required = true;
      fields.calle = addField("Dirección", "calle", "text", record && record.calle);
      fields.calle.maxLength = 150;
      fields.contrasena = addField(
        record ? "Nueva contraseña (opcional)" : "Contraseña",
        "contrasena",
        "password"
      );
      fields.contrasena.required = !record;
      fields.contrasena.placeholder = record ? "Déjala vacía para conservarla" : "Mínimo 8 caracteres";
    }
    return fields;
  }

  function openEditor(record) {
    editingRecord = record || null;
    form.reset();
    formMessage.hidden = true;
    var fields = buildFields(record);
    var title = editingRecord
      ? "Editar " + definitions[currentTab].title
      : "Agregar " + definitions[currentTab].title;
    document.getElementById("catalogo-modal-titulo").textContent = title;
    document.getElementById("catalogo-guardar").textContent =
      editingRecord ? "Guardar cambios" : "Agregar";
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    var firstField = Object.values(fields)[0];
    if (firstField) firstField.focus();
  }

  function closeEditor() {
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
  }

  async function refreshData() {
    await loadData();
  }

  async function deleteRecord(record) {
    var id = currentTab === "paises" ? record.id_pais
      : currentTab === "departamentos" ? record.id_departamento
        : currentTab === "ciudades" ? record.id_ciudad
          : record.identificacion;
    var name = currentTab === "administradores"
      ? [record.nombres, record.apellidos].filter(Boolean).join(" ")
      : record.nombre;
    if (!window.confirm('¿Eliminar "' + name + '"? La operación no se podrá realizar si hay registros asociados.')) return;
    try {
      if (currentTab === "administradores") {
        await auth.request("/admin/usuarios/" + encodeURIComponent(id), {
          method: "DELETE"
        });
      } else {
        await auth.request(
          "/admin/catalogos/" + currentTab + "/" + encodeURIComponent(id),
          { method: "DELETE" }
        );
      }
      await refreshData();
    } catch (error) {
      window.alert(error.message);
    }
  }

  tabs.forEach(function (tab) {
    tab.addEventListener("click", function (event) {
      event.preventDefault();
      currentTab = tab.dataset.catalogTab;
      tabs.forEach(function (item) {
        item.classList.toggle("is-active", item === tab);
      });
      window.history.replaceState(null, "", "#" + currentTab);
      renderTable();
    });
  });

  addButton.addEventListener("click", function () {
    openEditor(null);
  });
  modal.querySelectorAll("[data-close-catalogo]").forEach(function (button) {
    button.addEventListener("click", closeEditor);
  });
  modal.addEventListener("click", function (event) {
    if (event.target === modal) closeEditor();
  });

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    formMessage.hidden = true;
    var data = Object.fromEntries(new FormData(form).entries());
    if (!data.contrasena) delete data.contrasena;
    if (currentTab === "ciudades") delete data.id_pais;

    var isAdmin = currentTab === "administradores";
    var path = isAdmin
      ? "/admin/usuarios" + (editingRecord
        ? "/" + encodeURIComponent(editingRecord.identificacion)
        : "")
      : definitions[currentTab].endpoint + (editingRecord
        ? "/" + encodeURIComponent(
          currentTab === "paises" ? editingRecord.id_pais
            : currentTab === "departamentos" ? editingRecord.id_departamento
              : editingRecord.id_ciudad
        )
        : "");
    if (isAdmin) data.role = "administrador";
    var submitButton = document.getElementById("catalogo-guardar");
    submitButton.disabled = true;
    try {
      await auth.request(path, {
        method: editingRecord ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
      await refreshData();
      closeEditor();
    } catch (error) {
      showMessage(formMessage, error.message, true);
    } finally {
      submitButton.disabled = false;
    }
  });

  var initialTab = window.location.hash.slice(1);
  if (definitions[initialTab]) {
    currentTab = initialTab;
    tabs.forEach(function (tab) {
      tab.classList.toggle("is-active", tab.dataset.catalogTab === currentTab);
    });
  }
  loadData().catch(function (error) {
    showMessage(message, error.message, true);
  });
})();
