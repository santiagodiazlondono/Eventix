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

  function showMessage(element, text, isError) {
    if (!element) return;
    element.textContent = text;
    element.hidden = false;
    element.dataset.type = isError ? "error" : "success";
  }

  function redirectAgentToLogin(error) {
    if (error.status !== 401 && error.status !== 403) return false;
    window.location.replace(
      "Login.html?mensaje=" + encodeURIComponent(error.message)
    );
    return true;
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
        cell(row, reservation.evento).dataset.label = "Evento";
        cell(row, formatReservationDate(reservation.fecha_hora_reserva)).dataset.label = "Fecha reserva";
        cell(row, reservation.numero_entradas).dataset.label = "Entradas";
        cell(row, currency.format(Number(reservation.valor_total))).dataset.label = "Valor total";
        var statusCell = document.createElement("td");
        statusCell.dataset.label = "Estado";
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
        cell(row, reservation.localidad).dataset.label = "Localidad";
        var actions = document.createElement("td");
        actions.className = "acciones";
        actions.dataset.label = "Acciones";
        if (!normalizedStatus.includes("cancel") && !normalizedStatus.includes("anulad")) {
          var cancelButton = document.createElement("button");
          cancelButton.type = "button";
          cancelButton.className = "boton-cancelar";
          cancelButton.textContent = "Cancelar";
          cancelButton.addEventListener("click", async function () {
            if (!window.confirm("¿Quieres cancelar esta reserva?")) return;
            cancelButton.disabled = true;
            try {
              var cancellation = await panels.cancelClientReservation(reservation.id_reserva);
              await loadClientReservations();
              showMessage(
                message,
                cancellation.correo_enviado
                  ? "Reserva cancelada. Enviamos el comprobante a tu correo."
                  : "Reserva cancelada, pero no fue posible enviar el comprobante por correo.",
                !cancellation.correo_enviado
              );
            } catch (error) {
              cancelButton.disabled = false;
              window.alert(error.message);
            }
          });
          actions.appendChild(cancelButton);
        } else {
          actions.textContent = "—";
        }
        row.appendChild(actions);
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

  function loadAgentReservations() {
    var body = document.getElementById("reservas-agente-lista");
    if (!body) return;

    var REFRESH_MS = 15000;
    var message = document.getElementById("reservas-agente-mensaje");
    var count = document.getElementById("reservas-conteo");
    var occupancyBody = document.getElementById("ocupacion-agente-lista");
    var occupancyMessage = document.getElementById("ocupacion-agente-mensaje");
    var filterEvent = document.getElementById("filter-evento");
    var filterState = document.getElementById("filter-estado");
    var liveStatus = document.getElementById("reservas-actualizado");
    var refreshButton = document.getElementById("reservas-actualizar");
    var clock = new Intl.DateTimeFormat("es-CO", {
      timeStyle: "medium",
      timeZone: "America/Bogota"
    });
    var eventDate = new Intl.DateTimeFormat("es-CO", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "America/Bogota"
    });

    var reservations = [];
    var events = [];
    var states = [];
    var signature = null;
    var lastUpdate = null;
    var loading = false;
    var saving = 0;
    var listRenderPending = false;

    function formatNumber(value) {
      return Number(value || 0).toLocaleString("es-CO");
    }

    function normalizeText(value) {
      return String(value || "")
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .trim();
    }

    function isCancelled(state) {
      var normalized = normalizeText(state);
      return normalized.includes("cancel") || normalized.includes("anulad");
    }

    function percentage(sold, capacity) {
      return capacity > 0 ? Math.min(sold / capacity * 100, 100) : 0;
    }

    function percentageLabel(sold, capacity) {
      if (capacity <= 0) return "—";
      var value = sold / capacity * 100;
      if (value > 0 && value < 1) return "<1 %";
      return Math.round(value) + " %";
    }

    function setText(id, value) {
      var element = document.getElementById(id);
      if (element) element.textContent = value;
    }

    function setLive(state, text) {
      if (!liveStatus) return;
      liveStatus.dataset.state = state;
      liveStatus.textContent = text;
    }

    function setTableMessage(element, text, isError) {
      if (!element) return;
      element.textContent = text;
      element.hidden = !text;
      element.dataset.type = isError ? "error" : "info";
    }

    function fillSelect(select, placeholder, options) {
      var selected = select.value;
      select.replaceChildren(new Option(placeholder, ""));
      options.forEach(function (option) {
        select.add(new Option(option.label, option.value));
      });
      select.value = options.some(function (option) {
        return String(option.value) === selected;
      }) ? selected : "";
    }

    function syncFilters() {
      var names = {};
      events.forEach(function (event) {
        names[event.evento] = (names[event.evento] || 0) + 1;
      });
      fillSelect(filterEvent, "Todos mis eventos", events.map(function (event) {
        return {
          value: event.codigo,
          label: names[event.evento] > 1
            ? event.evento + " · " + event.codigo
            : event.evento
        };
      }));
      fillSelect(filterState, "Todos", states.map(function (state) {
        return { value: state.nombre, label: state.nombre };
      }));
    }

    function visibleEvents() {
      return events.filter(function (event) {
        return !filterEvent.value || event.codigo === filterEvent.value;
      });
    }

    function soldTickets(event) {
      return Number(event.vendidas_general) + Number(event.vendidas_vip) +
        Number(event.vendidas_preferencial);
    }

    function eventBadgeClass(state) {
      var normalized = normalizeText(state);
      if (normalized.includes("boleteria")) return "badge-boleteria";
      if (normalized.includes("programado")) return "badge-programado";
      if (normalized.includes("vivo")) return "badge-envivo";
      return "";
    }

    function occupancyCell(row, sold, capacity, isTotal) {
      var td = document.createElement("td");
      var wrapper = document.createElement("div");
      wrapper.className = "agent-occupancy" + (isTotal ? " agent-occupancy--total" : "");
      var text = document.createElement("span");
      text.className = "agent-occupancy-text";
      text.textContent = formatNumber(sold) + " / " + formatNumber(capacity);
      var share = document.createElement("small");
      share.textContent = " · " + percentageLabel(sold, capacity);
      text.appendChild(share);
      var track = document.createElement("div");
      track.className = "progress-bar-bg";
      track.setAttribute("aria-hidden", "true");
      var fill = document.createElement("div");
      fill.className = "progress-bar-fill" +
        (percentage(sold, capacity) >= 90 ? " progress-bar-fill--warn" : "");
      fill.style.width = percentage(sold, capacity) + "%";
      track.appendChild(fill);
      wrapper.append(text, track);
      td.appendChild(wrapper);
      row.appendChild(td);
    }

    function renderSummary(selected) {
      var totals = selected.reduce(function (sum, event) {
        sum.active += Number(event.reservas_activas);
        sum.cancelled += Number(event.reservas_canceladas);
        sum.sold += soldTickets(event);
        sum.capacity += Number(event.capacidad_total);
        sum.revenue += Number(event.ingresos);
        return sum;
      }, { active: 0, cancelled: 0, sold: 0, capacity: 0, revenue: 0 });

      setText(
        "resumen-alcance",
        filterEvent.value && selected.length ? selected[0].evento : "Todos mis eventos"
      );
      setText("resumen-reservas", formatNumber(totals.active));
      setText(
        "resumen-canceladas",
        formatNumber(totals.cancelled) +
          (totals.cancelled === 1 ? " cancelada" : " canceladas")
      );
      setText("resumen-entradas", formatNumber(totals.sold));
      setText(
        "resumen-capacidad",
        "de " + formatNumber(totals.capacity) + " entradas · quedan " +
          formatNumber(Math.max(totals.capacity - totals.sold, 0))
      );
      setText("resumen-ocupacion", percentageLabel(totals.sold, totals.capacity));
      var bar = document.getElementById("resumen-ocupacion-barra");
      if (bar) bar.style.width = percentage(totals.sold, totals.capacity) + "%";
      setText("resumen-ingresos", currency.format(totals.revenue));
    }

    function renderOccupancy(selected) {
      occupancyBody.replaceChildren();
      selected.forEach(function (event) {
        var row = document.createElement("tr");
        var nameCell = document.createElement("td");
        var name = document.createElement("span");
        name.className = "agent-event-name";
        name.textContent = event.evento;
        var meta = document.createElement("span");
        meta.className = "agent-event-meta";
        meta.textContent = event.codigo + " · " + (event.fecha_hora_inicio
          ? eventDate.format(new Date(event.fecha_hora_inicio))
          : "Fecha por confirmar");
        nameCell.append(name, meta);
        row.appendChild(nameCell);

        var stateCell = document.createElement("td");
        var badge = document.createElement("span");
        badge.className = "badge " + eventBadgeClass(event.estado);
        badge.textContent = event.estado || "Sin estado";
        stateCell.appendChild(badge);
        row.appendChild(stateCell);

        occupancyCell(row, Number(event.vendidas_general), Number(event.capacidad_general));
        occupancyCell(row, Number(event.vendidas_vip), Number(event.capacidad_vip));
        occupancyCell(row, Number(event.vendidas_preferencial), Number(event.capacidad_preferencial));
        occupancyCell(row, soldTickets(event), Number(event.capacidad_total), true);

        var reservationsCell = cell(row, formatNumber(event.reservas_activas), "font-mono");
        if (Number(event.reservas_canceladas) > 0) {
          var cancelled = document.createElement("span");
          cancelled.className = "agent-event-meta";
          cancelled.textContent = "+" + formatNumber(event.reservas_canceladas) +
            (Number(event.reservas_canceladas) === 1 ? " cancelada" : " canceladas");
          reservationsCell.appendChild(cancelled);
        }
        cell(row, currency.format(Number(event.ingresos)), "font-mono");
        occupancyBody.appendChild(row);
      });
      setTableMessage(
        occupancyMessage,
        events.length ? "" : "Todavía no tienes eventos publicados."
      );
    }

    function renderReservations() {
      listRenderPending = false;
      var ownReservations = reservations.filter(function (reservation) {
        return !filterEvent.value || reservation.codigo === filterEvent.value;
      });
      var visible = ownReservations.filter(function (reservation) {
        return !filterState.value || reservation.estado === filterState.value;
      });
      body.replaceChildren();
      visible.forEach(function (reservation) {
        var row = document.createElement("tr");
        row.dataset.event = reservation.codigo;
        if (isCancelled(reservation.estado)) row.className = "agent-row-cancelled";
        cell(row, reservation.cliente, "font-weight-500");
        cell(row, reservation.evento, "text-muted");
        cell(row, reservation.localidad);
        cell(row, reservation.numero_entradas, "font-mono");
        cell(row, currency.format(Number(reservation.valor_total)), "font-mono");
        cell(row, formatReservationDate(reservation.fecha_hora_reserva), "text-muted");
        var statusCell = document.createElement("td");
        statusCell.className = "admin-action-group";
        var select = document.createElement("select");
        select.className = "agent-status-select admin-action-btn admin-action-btn--neutral";
        select.setAttribute("aria-label", "Actualizar estado de la reserva " + reservation.id_reserva);
        states.forEach(function (state) {
          select.add(new Option(state.nombre, state.nombre));
        });
        select.value = reservation.estado;
        select.addEventListener("change", async function () {
          select.disabled = true;
          saving++;
          try {
            await panels.setReservationState(reservation.id_reserva, select.value);
            reservation.estado = select.value;
          } catch (error) {
            saving--;
            if (redirectAgentToLogin(error)) return;
            setTableMessage(message, error.message, true);
            select.value = reservation.estado;
            select.disabled = false;
            return;
          }
          saving--;
          renderReservations();
          // El cambio de estado altera la ocupación y los ingresos.
          signature = null;
          await refresh(true);
        });
        statusCell.appendChild(select);
        row.appendChild(statusCell);
        body.appendChild(row);
      });

      if (count) {
        count.textContent = reservations.length
          ? "Mostrando " + formatNumber(visible.length) + " de " +
            formatNumber(ownReservations.length) + " reservas"
          : "";
      }
      setTableMessage(
        message,
        visible.length
          ? ""
          : reservations.length
            ? "No hay reservas que coincidan con los filtros."
            : "No hay reservas registradas."
      );
    }

    function editingStatus() {
      var active = document.activeElement;
      return Boolean(active && body.contains(active) &&
        active.classList.contains("agent-status-select"));
    }

    function renderAll(fromPolling) {
      var selected = visibleEvents();
      renderSummary(selected);
      renderOccupancy(selected);
      // No se reemplaza la lista mientras el agente tiene abierto un selector de estado.
      if (fromPolling && editingStatus()) {
        listRenderPending = true;
        return;
      }
      renderReservations();
    }

    async function refresh(manual) {
      if (loading || (!manual && saving > 0)) return;
      loading = true;
      if (refreshButton) refreshButton.disabled = true;
      try {
        if (!states.length) {
          states = (await panels.getReservationStates()).estados || [];
        }
        var result = await panels.getAgentReservations();
        var nextSignature = JSON.stringify([result.reservas, result.eventos]);
        lastUpdate = new Date();
        if (nextSignature !== signature) {
          signature = nextSignature;
          reservations = result.reservas || [];
          events = result.eventos || [];
          syncFilters();
          renderAll(!manual);
        } else if (listRenderPending && !editingStatus()) {
          renderReservations();
        }
        setLive(
          "live",
          "Actualizado a las " + clock.format(lastUpdate) +
            " · se actualiza cada " + (REFRESH_MS / 1000) + " s"
        );
      } catch (error) {
        if (redirectAgentToLogin(error)) return;
        setLive(
          "error",
          "No se pudo actualizar: " + error.message +
            (lastUpdate ? " Datos de las " + clock.format(lastUpdate) + "." : "")
        );
        if (!lastUpdate) setTableMessage(message, error.message, true);
      } finally {
        loading = false;
        if (refreshButton) refreshButton.disabled = false;
      }
    }

    filterEvent.addEventListener("change", function () {
      renderAll(false);
    });
    filterState.addEventListener("change", renderReservations);
    body.addEventListener("focusout", function () {
      window.setTimeout(function () {
        if (listRenderPending && !editingStatus()) renderReservations();
      }, 0);
    });
    if (refreshButton) {
      refreshButton.addEventListener("click", function () {
        refresh(true);
      });
    }
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) refresh(false);
    });
    window.setInterval(function () {
      if (!document.hidden) refresh(false);
    }, REFRESH_MS);

    refresh(true);
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
