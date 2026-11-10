(function () {
  "use strict";

  function get(path) {
    return window.EventixAuth.request(path);
  }

  function send(path, method, data) {
    return window.EventixAuth.request(path, {
      method: method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
  }

  window.EventixPanels = {
    getClientReservations: function () {
      return get("/reservas");
    },
    cancelClientReservation: function (id, reason) {
      return send("/reservas/" + encodeURIComponent(id), "DELETE", {
        motivo: reason || ""
      });
    },
    getAgentReservations: function () {
      return get("/agente/reservas");
    },
    getReservationStates: function () {
      return get("/agente/estados-reserva");
    },
    setReservationState: function (id, state, reason) {
      return send("/agente/reservas/" + encodeURIComponent(id), "PATCH", {
        estado: state,
        motivo: reason || ""
      });
    },
    getAdminReports: function () {
      return get("/admin/reportes");
    }
  };
})();
