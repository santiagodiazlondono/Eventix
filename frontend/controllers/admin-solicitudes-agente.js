(function () {
  "use strict";

  var auth = window.EventixAuth;
  var tableBody = document.getElementById("solicitudes-agente-lista");
  if (!auth || !tableBody) return;

  var filter = document.getElementById("filtro-solicitudes-agente");
  var listMessage = document.getElementById("solicitudes-agente-mensaje");
  var modal = document.getElementById("modal-solicitud-agente");
  var detailMessage = document.getElementById("solicitud-agente-detalle-mensaje");
  var actionMessage = document.getElementById("solicitud-agente-accion-mensaje");
  var actions = document.getElementById("solicitud-agente-acciones");
  var reasonInput = document.getElementById("motivo-solicitud-agente");
  var currentRequest = null;

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

  function renderRequests(requests) {
    tableBody.replaceChildren();
    requests.forEach(function (request) {
      var row = document.createElement("tr");
      var nameCell = document.createElement("td");
      var name = document.createElement("div");
      name.className = "user-name";
      name.textContent = [request.nombres, request.apellidos].filter(Boolean).join(" ");
      var email = document.createElement("div");
      email.className = "user-email";
      email.textContent = request.correo_electronico;
      nameCell.append(name, email);
      row.appendChild(nameCell);

      [request.identificacion, request.estado_aprobacion, formatDate(request.fecha_solicitud)]
        .forEach(function (value, index) {
          var cell = document.createElement("td");
          cell.textContent = value;
          if (index === 1) cell.className = "agent-request-state";
          row.appendChild(cell);
        });

      var actionCell = document.createElement("td");
      actionCell.className = "admin-text-right";
      var detailButton = document.createElement("button");
      detailButton.type = "button";
      detailButton.className = "btn btn-ghost user-edit-btn";
      detailButton.textContent = "Ver detalle";
      detailButton.addEventListener("click", function () {
        openRequest(request.identificacion);
      });
      actionCell.appendChild(detailButton);
      row.appendChild(actionCell);
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

  async function openRequest(identification) {
    currentRequest = null;
    actions.hidden = true;
    actionMessage.hidden = true;
    reasonInput.value = "";
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    showMessage(detailMessage, "Cargando detalle...", false);

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

      var isPending = request.estado_aprobacion === "pendiente";
      document.getElementById("solicitud-agente-aceptar").hidden = !isPending;
      document.getElementById("solicitud-agente-rechazar").hidden = !isPending;
      document.getElementById("solicitud-agente-revocar").hidden =
        request.estado_aprobacion !== "aprobado";
      reasonInput.previousElementSibling.textContent = isPending
        ? "Motivo de rechazo (opcional)"
        : "Motivo de revocación (opcional)";
      reasonInput.hidden = !isPending && request.estado_aprobacion !== "aprobado";
      reasonInput.previousElementSibling.hidden = reasonInput.hidden;
      actions.hidden = !isPending && request.estado_aprobacion !== "aprobado";
      showMessage(detailMessage, "", false);
    } catch (error) {
      showMessage(detailMessage, error.message, true);
    }
  }

  function closeRequest() {
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    currentRequest = null;
  }

  async function resolveRequest(action) {
    if (!currentRequest) return;
    var isRevocation = action === "revocar";
    var confirmation = action === "aprobar"
      ? "¿Aceptar la solicitud y habilitar el acceso de agente?"
      : isRevocation
        ? "¿Revocar el acceso de este agente?"
        : "¿Rechazar esta solicitud?";
    if (!window.confirm(confirmation)) return;

    var buttons = Array.prototype.slice.call(actions.querySelectorAll("button"));
    buttons.forEach(function (button) { button.disabled = true; });
    actionMessage.hidden = true;
    try {
      var payload = action === "aprobar"
        ? {}
        : { motivo: reasonInput.value };
      await auth.request(
        "/admin/solicitudes-agente/" +
          encodeURIComponent(currentRequest.identificacion) + "/" + action,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        }
      );
      closeRequest();
      try {
        await loadRequests();
        await auth.refreshPendingAgentCount();
      } catch (error) {
        showMessage(
          listMessage,
          "La solicitud se actualizó, pero no se pudo refrescar la lista: " + error.message,
          true
        );
      }
    } catch (error) {
      showMessage(actionMessage, error.message, true);
    } finally {
      buttons.forEach(function (button) { button.disabled = false; });
    }
  }

  filter.addEventListener("change", function () {
    loadRequests().catch(function (error) {
      showMessage(listMessage, error.message, true);
    });
  });
  document.getElementById("solicitud-agente-aceptar").addEventListener("click", function () {
    resolveRequest("aprobar");
  });
  document.getElementById("solicitud-agente-rechazar").addEventListener("click", function () {
    resolveRequest("rechazar");
  });
  document.getElementById("solicitud-agente-revocar").addEventListener("click", function () {
    resolveRequest("revocar");
  });
  modal.querySelectorAll("[data-close-agent-request]").forEach(function (button) {
    button.addEventListener("click", closeRequest);
  });
  modal.addEventListener("click", function (event) {
    if (event.target === modal) closeRequest();
  });

  loadRequests().catch(function (error) {
    showMessage(listMessage, error.message, true);
  });
})();
