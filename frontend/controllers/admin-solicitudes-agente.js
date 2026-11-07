(function () {
  "use strict";

  var auth = window.EventixAuth;
  var ui = window.EventixUI;
  var tableBody = document.getElementById("solicitudes-agente-lista");
  if (!auth || !ui || !tableBody) return;

  var filter = document.getElementById("filtro-solicitudes-agente");
  var listMessage = document.getElementById("solicitudes-agente-mensaje");
  var detailPanel = document.getElementById("modal-solicitud-agente");
  var detailMessage = document.getElementById("solicitud-agente-detalle-mensaje");
  var actionMessage = document.getElementById("solicitud-agente-accion-mensaje");
  var actions = document.getElementById("solicitud-agente-acciones");
  var reasonInput = document.getElementById("motivo-solicitud-agente");
  var currentRequest = null;
  var originButton = null;
  var originIdentification = null;

  function showMessage(target, text, isError) {
    target.textContent = text;
    target.hidden = !text;
    target.dataset.type = isError ? "error" : "success";
  }

  function formatDate(value) {
    if (!value) return "—";
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("es-CO", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(date);
  }

  function transitionFor(state) {
    return {
      pendiente: { action: "aprobar", label: "Aprobar" },
      aprobado: { action: "revocar", label: "Revocar" },
      rechazado: { action: "reactivar", label: "Reactivar" }
    }[state] || null;
  }

  async function refreshListAndCount() {
    await loadRequests();
    await auth.refreshPendingAgentCount();
  }

  async function performTransition(identification, action, reason, activeEvents) {
    var prompts = {
      aprobar: "¿Aprobar esta solicitud y habilitar el acceso de agente?",
      revocar: activeEvents
        ? "Este agente tiene " + activeEvents +
          " eventos activos. Puedes reasignarlos desde el detalle. ¿Deseas revocar el acceso de todos modos?"
        : "¿Revocar el acceso de este agente?",
      reactivar: "¿Reactivar el acceso de este agente?"
    };
    if (!window.confirm(prompts[action])) return false;

    await auth.request(
      "/admin/solicitudes-agente/" + encodeURIComponent(identification) + "/" + action,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "aprobar" ? {} : { motivo: reason || "" })
      }
    );
    await refreshListAndCount();
    return true;
  }

  function renderRequests(requests) {
    tableBody.replaceChildren();
    requests.forEach(function (request) {
      var row = document.createElement("tr");
      row.dataset.agentIdentification = request.identificacion;
      var identity = document.createElement("td");
      var name = document.createElement("div");
      name.className = "user-name";
      name.textContent = [request.nombres, request.apellidos].filter(Boolean).join(" ");
      var email = document.createElement("div");
      email.className = "user-email";
      email.textContent = request.correo_electronico;
      identity.append(name, email);
      row.appendChild(identity);

      [
        request.identificacion,
        request.estado_aprobacion,
        formatDate(request.fecha_solicitud)
      ].forEach(function (value, index) {
        var cell = document.createElement("td");
        cell.textContent = value;
        if (index === 1) cell.className = "agent-request-state";
        row.appendChild(cell);
      });

      var actionsCell = document.createElement("td");
      actionsCell.className = "admin-action-group";
      var detailButton = document.createElement("button");
      detailButton.type = "button";
      detailButton.className = "btn btn-ghost user-edit-btn admin-action-btn admin-action-btn--neutral";
      detailButton.textContent = "Ver detalle";
      detailButton.addEventListener("click", function () {
        openRequest(request.identificacion, detailButton);
      });
      actionsCell.appendChild(detailButton);

      var transition = transitionFor(request.estado_aprobacion);
      if (transition) {
        var transitionButton = document.createElement("button");
        transitionButton.type = "button";
        transitionButton.className = "btn btn-ghost user-edit-btn admin-action-btn " +
          (transition.action === "revocar"
            ? "admin-action-btn--danger"
            : "admin-action-btn--neutral");
        transitionButton.textContent = transition.label;
        transitionButton.addEventListener("click", async function () {
          if (request.estado_aprobacion === "aprobado") {
            openRequest(request.identificacion, transitionButton);
            return;
          }
          transitionButton.disabled = true;
          try {
            await performTransition(
              request.identificacion,
              transition.action,
              "",
              Number(request.eventos_activos || 0)
            );
          } catch (error) {
            showMessage(listMessage, error.message, true);
          } finally {
            transitionButton.disabled = false;
          }
        });
        actionsCell.appendChild(transitionButton);
      }
      row.appendChild(actionsCell);
      tableBody.appendChild(row);
    });

    showMessage(
      listMessage,
      requests.length ? "" : "No hay solicitudes para el estado seleccionado.",
      false
    );
  }

  async function loadRequests() {
    showMessage(listMessage, "Cargando solicitudes...", false);
    var result = await auth.request(
      "/admin/solicitudes-agente?estado=" + encodeURIComponent(filter.value)
    );
    renderRequests(result.solicitudes || []);
  }

  function setDetail(field, value) {
    document.getElementById("detalle-agente-" + field).textContent =
      value === null || value === undefined || value === ""
        ? "No especificado"
        : value;
  }

  async function openRequest(identification, sourceButton) {
    currentRequest = null;
    originButton = sourceButton || null;
    originIdentification = identification;
    actions.hidden = true;
    actionMessage.hidden = true;
    reasonInput.value = "";
    detailPanel.hidden = false;
    showMessage(detailMessage, "Cargando detalle...", false);
    await ui.scrollToSection(detailPanel);

    try {
      var result = await auth.request(
        "/admin/solicitudes-agente/" + encodeURIComponent(identification)
      );
      currentRequest = result.solicitud;
      var request = currentRequest;
      setDetail("nombre", [request.nombres, request.apellidos].filter(Boolean).join(" "));
      setDetail("identificacion", request.identificacion);
      setDetail("correo", request.correo_electronico);
      setDetail("ciudad", request.ciudad);
      setDetail("telefonos", (request.telefonos || []).join(", "));
      setDetail("experiencia", request.experiencia);
      setDetail("comision", request.comision);
      setDetail("fecha", formatDate(request.fecha_solicitud));
      setDetail("estado", request.estado_aprobacion);
      setDetail("motivo", request.motivo_rechazo);

      var summary = "Eventos activos: " + Number(request.eventos_activos || 0) +
        " · Eventos totales: " + Number(request.eventos_total || 0);
      document.getElementById("detalle-agente-eventos-resumen").textContent = summary;

      var pending = request.estado_aprobacion === "pendiente";
      var approved = request.estado_aprobacion === "aprobado";
      var rejected = request.estado_aprobacion === "rechazado";
      document.getElementById("solicitud-agente-aceptar").hidden = !pending;
      document.getElementById("solicitud-agente-rechazar").hidden = !pending;
      document.getElementById("solicitud-agente-revocar").hidden = !approved;
      document.getElementById("solicitud-agente-reactivar").hidden = !rejected;
      document.getElementById("solicitud-agente-transferir").hidden =
        Number(request.eventos_total || 0) === 0;
      reasonInput.previousElementSibling.textContent = pending
        ? "Motivo de rechazo (opcional)"
        : "Motivo de revocación (opcional)";
      reasonInput.hidden = !pending && !approved;
      reasonInput.previousElementSibling.hidden = reasonInput.hidden;
      actions.hidden = !pending && !approved && !rejected;
      showMessage(detailMessage, "", false);
      await ui.scrollToSection(detailPanel);
    } catch (error) {
      showMessage(detailMessage, error.message, true);
    }
  }

  function closeDetail(shouldReturnToOrigin) {
    detailPanel.hidden = true;
    currentRequest = null;
    if (shouldReturnToOrigin === false) return;
    var row = Array.prototype.find.call(
      tableBody.querySelectorAll("tr"),
      function (item) {
        return item.dataset.agentIdentification === originIdentification;
      }
    );
    var target = row && row.querySelector("button");
    ui.scrollToSection(target || filter);
  }

  async function resolveFromDetail(action) {
    if (!currentRequest) return;
    if (action === "transferir") {
      window.EventixAdminAgentTransfer.open(
        currentRequest.identificacion,
        Number(currentRequest.eventos_total || 0),
        document.getElementById("solicitud-agente-transferir"),
        "requests"
      );
      return;
    }

    var buttonId = action === "aprobar" ? "aceptar" : action;
    var button = document.getElementById("solicitud-agente-" + buttonId);
    button.disabled = true;
    actionMessage.hidden = true;
    try {
      var completed = await performTransition(
        currentRequest.identificacion,
        action,
        reasonInput.value,
        Number(currentRequest.eventos_activos || 0)
      );
      if (completed) {
        closeDetail();
      }
    } catch (error) {
      showMessage(actionMessage, error.message, true);
    } finally {
      button.disabled = false;
    }
  }

  filter.addEventListener("change", function () {
    loadRequests().catch(function (error) {
      showMessage(listMessage, error.message, true);
    });
  });
  document.getElementById("solicitud-agente-aceptar").addEventListener("click", function () {
    resolveFromDetail("aprobar");
  });
  document.getElementById("solicitud-agente-rechazar").addEventListener("click", function () {
    resolveFromDetail("rechazar");
  });
  document.getElementById("solicitud-agente-revocar").addEventListener("click", function () {
    resolveFromDetail("revocar");
  });
  document.getElementById("solicitud-agente-reactivar").addEventListener("click", function () {
    resolveFromDetail("reactivar");
  });
  document.getElementById("solicitud-agente-transferir").addEventListener("click", function () {
    resolveFromDetail("transferir");
  });
  detailPanel.querySelectorAll("[data-close-agent-request]").forEach(function (button) {
    button.addEventListener("click", closeDetail);
  });

  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape" || detailPanel.hidden) return;
    if (window.EventixAdminAgentTransfer &&
        window.EventixAdminAgentTransfer.isOpen()) return;
    closeDetail();
  });

  window.addEventListener("eventix:agent-transfer-closed", function (event) {
    if (event.detail.returnList === "requests" &&
        event.detail.completed && currentRequest) {
      closeDetail(false);
    }
  });

  window.addEventListener("eventix:agent-events-reassigned", function (event) {
    refreshListAndCount().then(function () {
      if (event.detail.returnList !== "requests") return;
      var row = Array.prototype.find.call(
        tableBody.querySelectorAll("tr"),
        function (item) {
          return item.dataset.agentIdentification === event.detail.identificacion;
        }
      );
      ui.scrollToSection(row && row.querySelector("button") || filter);
      showMessage(
        listMessage,
        "Se reasignaron " + event.detail.eventosReasignados + " eventos correctamente.",
        false
      );
    }).catch(function (error) {
      showMessage(listMessage, error.message, true);
    });
  });

  loadRequests().catch(function (error) {
    showMessage(listMessage, error.message, true);
  });
})();
