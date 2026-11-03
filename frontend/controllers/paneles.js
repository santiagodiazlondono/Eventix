(function () {
  "use strict";

  var panels = window.EventixPanels;
  if (!panels) return;

  var currency = new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0
  });
  var dateTime = new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Bogota"
  });

  function cell(row, value, className) {
    var td = document.createElement("td");
    td.textContent = value == null ? "" : String(value);
    if (className) td.className = className;
    row.appendChild(td);
    return td;
  }

  function formatReservationDate(value) {
    return value ? dateTime.format(new Date(value)) : "Fecha por confirmar";
  }

  function showMessage(element, text) {
    if (!element) return;
    element.textContent = text;
    element.hidden = false;
  }

  async function loadClientReservations() {
    var body = document.getElementById("reservas-lista");
    if (!body) return;
    var message = document.getElementById("reservas-mensaje");
    body.replaceChildren();
    try {
      var result = await panels.getClientReservations();
      body.replaceChildren();
      (result.reservas || []).forEach(function (reservation) {
        var row = document.createElement("tr");
        cell(row, reservation.evento);
        cell(row, formatReservationDate(reservation.fecha_hora_reserva));
        cell(row, reservation.numero_entradas);
        cell(row, currency.format(Number(reservation.valor_total)));
        var statusCell = document.createElement("td");
        var statusBadge = document.createElement("span");
        var normalizedStatus = String(reservation.estado || "")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase();
        statusBadge.className = "estado estado-" +
          (normalizedStatus.includes("confirm")
            ? "confirmada"
            : normalizedStatus.includes("cancel")
              ? "cancelada"
              : "reservada");
        statusBadge.textContent = reservation.estado || "Sin estado";
        statusCell.appendChild(statusBadge);
        row.appendChild(statusCell);
        cell(row, reservation.localidad);
        body.appendChild(row);
      });
      if (message) {
        message.textContent = result.reservas.length
          ? ""
          : "Todavía no tienes reservas.";
        message.hidden = Boolean(result.reservas.length);
      }
    } catch (error) {
      showMessage(message, error.message);
    }
  }

  async function loadAgentReservations() {
    var body = document.getElementById("reservas-agente-lista");
    if (!body) return;
    var message = document.getElementById("reservas-agente-mensaje");
    var filterEvent = document.getElementById("filter-evento");
    var filterState = document.getElementById("filter-estado");
    body.replaceChildren();
    try {
      var results = await Promise.all([
        panels.getAgentReservations(),
        panels.getReservationStates()
      ]);
      var reservations = results[0].reservas || [];
      var states = results[1].estados || [];
      filterEvent.replaceChildren(new Option("Todos", ""));
      var eventNames = Array.from(new Set(reservations.map(function (item) {
        return item.evento;
      })));
      eventNames.forEach(function (name) {
        filterEvent.add(new Option(name, name));
      });
      filterState.replaceChildren(new Option("Todos", ""));
      states.forEach(function (state) {
        filterState.add(new Option(state.nombre, state.nombre));
      });

      function render() {
        var visible = reservations.filter(function (reservation) {
          return (!filterEvent.value || reservation.evento === filterEvent.value) &&
            (!filterState.value || reservation.estado === filterState.value);
        });
        body.replaceChildren();
        visible.forEach(function (reservation) {
          var row = document.createElement("tr");
          row.dataset.event = reservation.evento;
          cell(row, reservation.cliente, "font-weight-500");
          cell(row, reservation.evento, "text-muted");
          cell(row, reservation.numero_entradas, "font-mono");
          cell(row, currency.format(Number(reservation.valor_total)), "font-mono");
          cell(row, formatReservationDate(reservation.fecha_hora_reserva), "text-muted");
          var statusCell = document.createElement("td");
          var select = document.createElement("select");
          select.className = "agent-status-select";
          select.setAttribute("aria-label", "Actualizar estado de la reserva " + reservation.id_reserva);
          states.forEach(function (state) {
            select.add(new Option(state.nombre, state.nombre));
          });
          select.value = reservation.estado;
          select.addEventListener("change", async function () {
            select.disabled = true;
            try {
              await panels.setReservationState(reservation.id_reserva, select.value);
              reservation.estado = select.value;
              render();
            } catch (error) {
              showMessage(message, error.message);
              select.value = reservation.estado;
              select.disabled = false;
            }
          });
          statusCell.appendChild(select);
          row.appendChild(statusCell);
          body.appendChild(row);
        });
        if (message) {
          message.textContent = reservations.length
            ? ""
            : "No hay reservas registradas.";
          message.hidden = reservations.length > 0;
        }
      }

      filterEvent.addEventListener("change", render);
      filterState.addEventListener("change", render);
      render();
    } catch (error) {
      showMessage(message, error.message);
    }
  }

  function renderAdminReports(report) {
    var counts = report.resumen || {};
    document.querySelectorAll("[data-admin-metric]").forEach(function (item) {
      item.textContent = Number(counts[item.dataset.adminMetric] || 0).toLocaleString("es-CO");
    });
    document.querySelectorAll("[data-demo-report]").forEach(function (section) {
      section.hidden = true;
    });

    var roleCounts = [
      Number(counts.clientes || 0),
      Number(counts.agentes || 0),
      Number(counts.administradores || 0)
    ];
    var roleRows = document.querySelectorAll(".role-list .role-row");
    var totalRoles = roleCounts.reduce(function (sum, count) { return sum + count; }, 0);
    var totalBadge = document.querySelector(".total-badge");
    if (totalBadge) totalBadge.textContent = "Total: " + totalRoles.toLocaleString("es-CO");
    Array.prototype.slice.call(roleRows, 0, 3).forEach(function (row, index) {
      var count = row.querySelector(".role-count");
      var bar = row.querySelector(".progress-bar-fill");
      if (count) count.textContent = roleCounts[index].toLocaleString("es-CO");
      if (bar) {
        bar.style.width = (totalRoles ? roleCounts[index] / totalRoles * 100 : 0) + "%";
      }
    });

    var incomeByMonth = report.ingresosPorMes || [];
    var chart = document.querySelector(".chart-bars-container");
    if (chart) {
      var months = incomeByMonth.slice(0, 12).reverse();
      var maxRevenue = Math.max.apply(null, months.map(function (item) {
        return Number(item.ingresos);
      }).concat([1]));
      chart.replaceChildren();
      months.forEach(function (item) {
        var barItem = document.createElement("div");
        barItem.className = "chart-bar-item";
        var bar = document.createElement("div");
        bar.className = "chart-bar-fill";
        bar.style.height = (Number(item.ingresos) / maxRevenue * 100) + "%";
        var label = document.createElement("span");
        label.textContent = currency.format(Number(item.ingresos));
        bar.appendChild(label);
        var monthLabel = document.createElement("span");
        monthLabel.className = "chart-bar-label";
        monthLabel.textContent = item.mes + "/" + item.anio;
        barItem.append(bar, monthLabel);
        chart.appendChild(barItem);
      });
    }

    var tableBody = document.querySelector("[data-report-monthly]");
    if (tableBody) {
      tableBody.replaceChildren();
      var rows = new Map();
      var values = report.reservasPorEventoMes || [];
      var year = values.length ? values[0].anio : new Date().getFullYear();
      var reportTitle = tableBody.closest(".distribution-card")
        .querySelector(".distribution-header h2");
      if (reportTitle) {
        reportTitle.textContent = "Número de reservas por evento y por mes — " + year;
      }
      values.filter(function (item) { return item.anio === year; }).forEach(function (item) {
        var key = item.codigo;
        if (!rows.has(key)) {
          rows.set(key, { name: item.evento, months: Array(12).fill(0), total: 0 });
        }
        var event = rows.get(key);
        event.months[item.mes - 1] = Number(item.reservas);
        event.total += Number(item.reservas);
      });
      rows.forEach(function (event) {
        var row = document.createElement("tr");
        cell(row, event.name);
        event.months.forEach(function (count) { cell(row, count); });
        cell(row, event.total.toLocaleString("es-CO"), "admin-text-right admin-val-accent font-weight-bold");
        tableBody.appendChild(row);
      });
      if (!rows.size) {
        var empty = document.createElement("tr");
        cell(empty, "Todavía no hay reservas para reportar.", null).colSpan = 14;
        tableBody.appendChild(empty);
      }
    }
  }

  async function loadAdminReports() {
    var message = document.querySelector("[data-admin-report-message]");
    document.querySelectorAll("[data-demo-report]").forEach(function (section) {
      section.hidden = true;
    });
    var chart = document.querySelector(".chart-bars-container");
    if (chart) chart.replaceChildren();
    var tableBody = document.querySelector("[data-report-monthly]");
    if (tableBody) tableBody.replaceChildren();
    try {
      renderAdminReports(await panels.getAdminReports());
    } catch (error) {
      showMessage(message, error.message);
    }
  }

  if (document.body.dataset.panel === "cliente-reservas") loadClientReservations();
  if (document.body.dataset.panel === "agente-reservas") loadAgentReservations();
  if (document.body.dataset.panel === "admin") loadAdminReports();
})();
