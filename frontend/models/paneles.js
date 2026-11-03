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
    getAgentReservations: function () {
      return get("/agente/reservas");
    },
    getReservationStates: function () {
      return get("/agente/estados-reserva");
    },
    setReservationState: function (id, state) {
      return send("/agente/reservas/" + encodeURIComponent(id), "PATCH", {
        estado: state
      });
    },
    getAdminReports: function () {
      return get("/admin/reportes");
    }
  };
})();
