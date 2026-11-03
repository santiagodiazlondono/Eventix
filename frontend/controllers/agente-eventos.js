(function () {
  "use strict";

  var form = document.getElementById("formulario-evento");
  var statusMessage = document.getElementById("estado-formulario-evento");
  var citySelect = document.getElementById("ciudad-evento");
  var eventsTable = document.getElementById("mis-eventos-lista");
  var editor = document.getElementById("modal-editar");
  var editForm = document.getElementById("formulario-editar-evento");
  var editMessage = document.getElementById("editar-evento-mensaje");
  var countrySelect = document.getElementById("editar-pais");
  var departmentSelect = document.getElementById("editar-departamento");
  var editCitySelect = document.getElementById("editar-ciudad");
  var agentEvents = [];

  function updateCapacityTotal() {
    if (!form) return 0;
    var total = [
      form.elements.capacidad_general.value,
      form.elements.capacidad_vip.value,
      form.elements.capacidad_preferencial.value
    ].reduce(function (sum, value) {
      return sum + (Number(value) || 0);
    }, 0);
    document.getElementById("capacidad-total-vista").textContent =
      total.toLocaleString("es-CO");
    return total;
  }

  function showMessage(message, type) {
    if (!statusMessage) return;
    statusMessage.textContent = message;
    statusMessage.dataset.type = type;
    statusMessage.hidden = false;
  }

  function formatDate(value) {
    return value
      ? new Intl.DateTimeFormat("es-CO", {
        dateStyle: "medium",
        timeZone: "America/Bogota"
      }).format(new Date(value))
      : "Fecha por confirmar";
  }

  function statusClass(status) {
    var normalized = String(status || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    if (normalized.includes("boleteria")) return "badge-boleteria";
    if (normalized.includes("programado")) return "badge-programado";
    if (normalized.includes("vivo")) return "badge-envivo";
    return "";
  }

  function formatDateTimeInput(value) {
    if (!value) return "";
    var parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Bogota",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(new Date(value)).reduce(function (result, part) {
      result[part.type] = part.value;
      return result;
    }, {});
    return parts.year + "-" + parts.month + "-" + parts.day +
      "T" + parts.hour + ":" + parts.minute;
  }

  function appendOptions(select, items, placeholder, idKey) {
    select.replaceChildren(new Option(placeholder, ""));
    items.forEach(function (item) {
      select.add(new Option(item.nombre, item[idKey]));
    });
  }

  function renderAgentEvents(events) {
    var tableBody = eventsTable;
    if (!tableBody) return;

    tableBody.replaceChildren();
    events.forEach(function (event) {
      var row = document.createElement("tr");
      var values = [
        { text: event.codigo, className: "font-mono text-muted" },
        { text: event.nombre, className: "font-weight-500" },
        {
          text: [event.ciudad, event.departamento, event.pais]
            .filter(Boolean)
            .join(", ") || "—",
          className: "text-muted"
        },
        { text: formatDate(event.fecha_hora_inicio), className: "text-muted" },
        {
          text: Number(event.entradas_reservadas || 0).toLocaleString("es-CO") +
            " / " + Number(event.capacidad_total).toLocaleString("es-CO"),
          className: "font-mono"
        }
      ];

      values.forEach(function (value) {
        var cell = document.createElement("td");
        cell.className = value.className;
        cell.textContent = value.text;
        row.appendChild(cell);
      });

      var statusCell = document.createElement("td");
      var badge = document.createElement("span");
      badge.className = "badge " + statusClass(event.estado);
      badge.textContent = event.estado || "Sin estado";
      statusCell.appendChild(badge);
      row.appendChild(statusCell);

      var actionsCell = document.createElement("td");
      if (event.puede_editar) {
        var editButton = document.createElement("button");
        editButton.type = "button";
        editButton.className = "btn btn-ghost agent-edit-event";
        editButton.textContent = "Editar";
        editButton.setAttribute("aria-label", "Editar " + event.nombre);
        editButton.addEventListener("click", function () {
          openEditor(event.codigo);
        });
        actionsCell.appendChild(editButton);
      } else {
        actionsCell.textContent = "—";
      }
      row.appendChild(actionsCell);
      tableBody.appendChild(row);
    });

    var message = document.getElementById("mis-eventos-mensaje");
    if (message) {
      message.textContent = events.length
        ? ""
        : "No hay eventos disponibles.";
      message.hidden = events.length > 0;
    }
  }

  function setEditMessage(message, type) {
    if (!editMessage) return;
    editMessage.textContent = message;
    editMessage.dataset.type = type;
    editMessage.hidden = false;
  }

  async function loadDepartments(countryId, selectedDepartmentId) {
    appendOptions(departmentSelect, [], "Cargando departamentos...", "id_departamento");
    departmentSelect.disabled = true;
    appendOptions(editCitySelect, [], "Selecciona un departamento", "id_ciudad");
    editCitySelect.disabled = true;
    if (!countryId) {
      appendOptions(departmentSelect, [], "Selecciona un país", "id_departamento");
      return;
    }

    var result = await window.Eventix.get(
      "/paises/" + encodeURIComponent(countryId) + "/departamentos"
    );
    appendOptions(departmentSelect, result.departamentos || [], "Selecciona un departamento", "id_departamento");
    departmentSelect.disabled = false;
    if (selectedDepartmentId) {
      departmentSelect.value = String(selectedDepartmentId);
      await loadCities(selectedDepartmentId);
    }
  }

  async function loadCities(departmentId, selectedCityId) {
    appendOptions(editCitySelect, [], "Cargando ciudades...", "id_ciudad");
    editCitySelect.disabled = true;
    if (!departmentId) {
      appendOptions(editCitySelect, [], "Selecciona un departamento", "id_ciudad");
      return;
    }

    var result = await window.Eventix.get(
      "/departamentos/" + encodeURIComponent(departmentId) + "/ciudades"
    );
    appendOptions(editCitySelect, result.ciudades || [], "Selecciona una ciudad", "id_ciudad");
    editCitySelect.disabled = false;
    if (selectedCityId) editCitySelect.value = String(selectedCityId);
  }

  async function loadCountries(selectedCountryId, selectedDepartmentId, selectedCityId) {
    var result = await window.Eventix.get("/paises");
    appendOptions(countrySelect, result.paises || [], "Selecciona un país", "id_pais");
    if (selectedCountryId) {
      countrySelect.value = String(selectedCountryId);
      await loadDepartments(selectedCountryId, selectedDepartmentId);
      if (selectedCityId) editCitySelect.value = String(selectedCityId);
    }
  }

  async function openEditor(code) {
    var event = agentEvents.find(function (item) {
      return item.codigo === code;
    });
    if (!event) {
      setEditMessage("No se encontró el evento seleccionado. Recarga la tabla e inténtalo de nuevo.", "error");
      return;
    }

    editForm.elements.codigo.value = event.codigo;
    editForm.elements.nombre_evento.value = event.nombre || "";
    editForm.elements.teatro.value = event.teatro || "";
    editForm.elements.fecha_hora_inicio.value = formatDateTimeInput(event.fecha_hora_inicio);
    editForm.elements.fecha_hora_fin_estimada.value = formatDateTimeInput(event.fecha_hora_fin_estimada);
    editForm.elements.precio_base.value = event.precio_base;
    editForm.elements.precio_vip.value = event.precio_vip;
    editForm.elements.precio_preferencial.value = event.precio_preferencial;
    editForm.elements.capacidad_general.value = event.capacidad_general;
    editForm.elements.capacidad_vip.value = event.capacidad_vip;
    editForm.elements.capacidad_preferencial.value = event.capacidad_preferencial;
    editForm.elements.url_imagen.value = event.url_imagen || "";
    editForm.elements.observaciones.value = event.observaciones || "";
    editForm.elements.descripcion.value = event.descripcion || "";
    updateEditCapacityTotal();
    editMessage.hidden = true;
    editor.classList.add("is-open");
    editor.setAttribute("aria-hidden", "false");

    try {
      await loadCountries(event.id_pais, event.id_departamento, event.id_ciudad);
      document.getElementById("editar-nombre").focus();
    } catch (error) {
      console.error("No se pudo cargar la ubicación del evento:", error);
      setEditMessage(error.message, "error");
    }
  }

  function closeEditor() {
    editor.classList.remove("is-open");
    editor.setAttribute("aria-hidden", "true");
  }

  function updateEditCapacityTotal() {
    if (!editForm) return;
    var total = [
      editForm.elements.capacidad_general.value,
      editForm.elements.capacidad_vip.value,
      editForm.elements.capacidad_preferencial.value
    ].reduce(function (sum, value) {
      return sum + (Number(value) || 0);
    }, 0);
    document.getElementById("editar-capacidad-total").textContent =
      total.toLocaleString("es-CO");
  }

  if (!form && !eventsTable) return;

  window.Eventix.get("/auth/me")
    .then(function (userResult) {
      if (!userResult.usuario || userResult.usuario.role !== "agente") {
        throw new Error("Tu cuenta no tiene permisos de agente.");
      }
    })
    .then(function () {
      if (form) {
        return window.Eventix.get("/ciudades")
          .then(function (cityResult) {
            appendOptions(citySelect, [], "Selecciona una ciudad", "id_ciudad");
            (cityResult.ciudades || []).forEach(function (city) {
              citySelect.add(new Option(
                city.ciudad + ", " + city.departamento,
                city.id_ciudad
              ));
            });
          });
      }
    })
    .then(function () {
      if (eventsTable) {
        return window.Eventix.get("/agente/eventos")
          .then(function (result) {
            agentEvents = result.eventos || [];
            renderAgentEvents(agentEvents);
          });
      }
    })
    .catch(function (error) {
      if (error.status === 401) {
        var page = document.getElementById("formulario-evento")
          ? "agente-registro.html"
          : "agente-mis-eventos.html";
        window.location.replace("Login.html?next=" + page);
        return;
      }

      console.error("No se pudo preparar el panel del agente:", error);
      if (form) {
        citySelect.replaceChildren(new Option("No se pudieron cargar las ciudades", ""));
        showMessage(error.message, "error");
      }

      var message = document.getElementById("mis-eventos-mensaje");
      if (message) {
        message.textContent = error.message;
        message.hidden = false;
      }
    });

  if (editor) {
    countrySelect.addEventListener("change", function () {
      loadDepartments(countrySelect.value).catch(function (error) {
        setEditMessage(error.message, "error");
      });
    });
    departmentSelect.addEventListener("change", function () {
      loadCities(departmentSelect.value).catch(function (error) {
        setEditMessage(error.message, "error");
      });
    });
    [
      editForm.elements.capacidad_general,
      editForm.elements.capacidad_vip,
      editForm.elements.capacidad_preferencial
    ].forEach(function (input) {
      input.addEventListener("input", updateEditCapacityTotal);
    });
    editForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      editMessage.hidden = true;
      var code = editForm.elements.codigo.value;
      var data = Object.fromEntries(new FormData(editForm).entries());
      delete data.codigo;
      var submitButton = document.getElementById("guardar-cambios-evento");
      submitButton.disabled = true;
      submitButton.textContent = "Guardando...";
      try {
        await window.Eventix.get("/agente/eventos/" + encodeURIComponent(code), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data)
        });
        var result = await window.Eventix.get("/agente/eventos");
        agentEvents = result.eventos || [];
        renderAgentEvents(agentEvents);
        closeEditor();
      } catch (error) {
        setEditMessage(error.message, "error");
      } finally {
        submitButton.disabled = false;
        submitButton.textContent = "Guardar cambios";
      }
    });
    editor.querySelectorAll("[data-close-editor]").forEach(function (button) {
      button.addEventListener("click", closeEditor);
    });
    editor.addEventListener("click", function (event) {
      if (event.target === editor) closeEditor();
    });
  }

  if (!form) return;

  var startInput = form.elements.fecha_hora_inicio;
  var endInput = form.elements.fecha_hora_fin_estimada;
  [
    form.elements.capacidad_general,
    form.elements.capacidad_vip,
    form.elements.capacidad_preferencial
  ].forEach(function (input) {
    input.addEventListener("input", updateCapacityTotal);
  });
  startInput.addEventListener("change", function () {
    endInput.min = startInput.value;
  });

  form.addEventListener("reset", function () {
    statusMessage.hidden = true;
    endInput.min = "";
    window.setTimeout(updateCapacityTotal, 0);
  });

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    statusMessage.hidden = true;

    var data = Object.fromEntries(new FormData(form).entries());
    data.capacidad_total = updateCapacityTotal();

    var submitButton = document.getElementById("publicar-evento");
    submitButton.disabled = true;
    submitButton.textContent = "Publicando...";

    try {
      var result = await window.Eventix.get("/eventos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
      form.reset();
      showMessage(
        "El evento " + result.evento.codigo + " se publicó correctamente como Programado.",
        "success"
      );
    } catch (error) {
      showMessage(error.message, "error");
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Publicar evento";
    }
  });
})();
