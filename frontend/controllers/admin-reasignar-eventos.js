(function () {
  "use strict";

  var auth = window.EventixAuth;
  var ui = window.EventixUI;
  var modal = document.getElementById("modal-reasignar-eventos");
  if (!auth || !ui || !modal) return;

  var destinationSelect = document.getElementById("agente-destino-eventos");
  var tableBody = document.getElementById("reasignar-eventos-lista");
  var message = document.getElementById("reasignar-eventos-mensaje");
  var actionMessage = document.getElementById("reasignar-eventos-accion-mensaje");
  var selectAll = document.getElementById("seleccionar-todos-eventos");
  var selectedButton = document.getElementById("reasignar-eventos-seleccionados");
  var allButton = document.getElementById("reasignar-eventos-todos");
  var sourceId = null;
  var events = [];
  var returnTarget = null;
  var returnList = null;

  function showMessage(target, text, isError) {
    target.textContent = text;
    target.hidden = !text;
    target.dataset.type = isError ? "error" : "success";
  }

  function formatDate(value) {
    if (!value) return "Fecha por confirmar";
    return new Intl.DateTimeFormat("es-CO", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(value));
  }

  function selectedCodes() {
    return Array.prototype.slice.call(
      tableBody.querySelectorAll('input[type="checkbox"]:checked')
    ).map(function (input) {
      return input.value;
    });
  }

  function renderEvents() {
    tableBody.replaceChildren();
    events.forEach(function (event) {
      var row = document.createElement("tr");
      var selectCell = document.createElement("td");
      var checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = event.codigo;
      checkbox.setAttribute("aria-label", "Seleccionar " + event.nombre);
      checkbox.addEventListener("change", function () {
        selectedButton.disabled = selectedCodes().length === 0;
        selectAll.checked = events.length > 0 && selectedCodes().length === events.length;
      });
      selectCell.appendChild(checkbox);
      row.appendChild(selectCell);

      [
        event.nombre + " (" + event.codigo + ")",
        formatDate(event.fecha_hora_inicio),
        event.estado,
        event.reservas
      ].forEach(function (value) {
        var cell = document.createElement("td");
        cell.textContent = String(value == null ? "—" : value);
        row.appendChild(cell);
      });
      tableBody.appendChild(row);
    });

    selectAll.checked = false;
    selectAll.disabled = events.length === 0;
    selectedButton.disabled = true;
    allButton.disabled = events.length === 0 || !destinationSelect.value;
    if (!events.length) {
      showMessage(message, "Este agente no tiene eventos para reasignar.", false);
    }
  }

  async function loadSourceEvents() {
    showMessage(message, "Cargando eventos...", false);
    var result = await auth.request(
      "/admin/usuarios/" + encodeURIComponent(sourceId) + "/eventos"
    );
    events = result.eventos || [];
    renderEvents();
    if (events.length) {
      showMessage(
        message,
        "Se encontraron " + events.length +
          " eventos. Reasigna el total o selecciona un subconjunto."
      );
    }
  }

  async function open(identification, eventCount, sourceButton, sourceList) {
    sourceId = identification;
    returnTarget = sourceButton || null;
    returnList = sourceList || "users";
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    actionMessage.hidden = true;
    events = [];
    tableBody.replaceChildren();
    selectAll.checked = false;
    selectedButton.disabled = true;
    allButton.disabled = true;
    destinationSelect.replaceChildren(new Option("Selecciona un agente aprobado", ""));
    showMessage(message, eventCount
      ? "El agente tiene " + eventCount + " eventos. Reasigna el total o selecciona un subconjunto."
      : "Selecciona un agente aprobado y los eventos que deseas transferir.", false);
    await ui.scrollToSection(modal);

    try {
      var result = await auth.request("/admin/usuarios?rol=agente");
      var destinations = (result.usuarios || []).filter(function (user) {
        return user.identificacion !== sourceId &&
          user.estado_aprobacion === "aprobado";
      });
      var hasDestinations = destinations.length > 0;
      destinations.forEach(function (user) {
        destinationSelect.add(new Option(
          [user.nombres, user.apellidos].filter(Boolean).join(" ") +
            " · " + user.identificacion,
          user.identificacion
        ));
      });
      await loadSourceEvents();
      if (!hasDestinations) {
        showMessage(message, "No hay otro agente aprobado disponible para recibir eventos.", true);
      }
      await ui.scrollToSection(modal);
    } catch (error) {
      showMessage(message, error.message, true);
    }
  }

  function close(completed) {
    var target = returnTarget;
    var identification = sourceId;
    var list = returnList;
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    sourceId = null;
    events = [];
    returnTarget = null;
    returnList = null;
    var result = {
      identificacion: identification,
      returnList: list
    };
    window.dispatchEvent(new CustomEvent("eventix:agent-transfer-closed", {
      detail: {
        completed: completed === true,
        identificacion: result.identificacion,
        returnList: result.returnList
      }
    }));
    ui.scrollToSection(target);
    return result;
  }

  async function reassign(codes) {
    if (!sourceId || !destinationSelect.value) {
      showMessage(actionMessage, "Selecciona un agente de destino aprobado.", true);
      return;
    }
    if (codes && !codes.length) {
      showMessage(actionMessage, "Selecciona al menos un evento.", true);
      return;
    }

    var destination = destinationSelect.options[destinationSelect.selectedIndex].text;
    var description = codes
      ? "los " + codes.length + " eventos seleccionados"
      : "todos los eventos";
    if (!window.confirm("¿Reasignar " + description + " a " + destination + "?")) return;

    selectedButton.disabled = true;
    allButton.disabled = true;
    actionMessage.hidden = true;
    try {
      var payload = { identificacion_destino: destinationSelect.value };
      if (codes) payload.codigos_evento = codes;
      var result = await auth.request(
        "/admin/agentes/" + encodeURIComponent(sourceId) + "/reasignar-eventos",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        }
      );
      var transfer = close(true);
      window.dispatchEvent(new CustomEvent("eventix:agent-events-reassigned", {
        detail: {
          identificacion: transfer.identificacion,
          eventosReasignados: result.eventos_reasignados,
          returnList: transfer.returnList
        }
      }));
    } catch (error) {
      showMessage(actionMessage, error.message, true);
    } finally {
      selectedButton.disabled = selectedCodes().length === 0;
      allButton.disabled = events.length === 0 || !destinationSelect.value;
    }
  }

  selectAll.addEventListener("change", function () {
    tableBody.querySelectorAll('input[type="checkbox"]').forEach(function (input) {
      input.checked = selectAll.checked;
    });
    selectedButton.disabled = selectedCodes().length === 0;
  });
  destinationSelect.addEventListener("change", function () {
    allButton.disabled = events.length === 0 || !destinationSelect.value;
  });
  selectedButton.addEventListener("click", function () {
    reassign(selectedCodes());
  });
  allButton.addEventListener("click", function () {
    reassign(null);
  });
  modal.querySelectorAll("[data-close-transfer-events]").forEach(function (button) {
    button.addEventListener("click", close);
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !modal.hidden) {
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    }
  });

  window.EventixAdminAgentTransfer = {
    open: open,
    isOpen: function () {
      return !modal.hidden;
    }
  };
})();
