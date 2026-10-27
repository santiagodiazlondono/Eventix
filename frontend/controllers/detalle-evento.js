document.addEventListener("DOMContentLoaded", async function () {
  var SERVICE_FEE_PER_TICKET = 4000;
  var quantity = 2;
  var eventId = new URLSearchParams(window.location.search).get("id");
  var confirmButton = document.querySelector(".btn-block");
  var zone = document.querySelector(".zone-card");
  var quantityNumber = document.querySelector(".qty-number");
  var quantityButtons = document.querySelectorAll(".qty-btn");
  var minusButton = quantityButtons[0];
  var plusButton = quantityButtons[1];
  var price = 0;
  var eventCode = "";

  function setText(id, value) {
    var element = document.getElementById(id);
    if (element) element.textContent = value || "No disponible";
  }

  function formatCurrency(amount) {
    return "$" + Number(amount).toLocaleString("es-CO");
  }

  function formatDate(value) {
    return value
      ? new Intl.DateTimeFormat("es-CO", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "America/Bogota"
      }).format(new Date(value))
      : "No especificada";
  }

  function updateSummary() {
    var subtotal = price * quantity;
    var serviceTotal = SERVICE_FEE_PER_TICKET * quantity;
    quantityNumber.textContent = quantity;
    setText("base-price-val", formatCurrency(price));
    setText("subtotal-label", "Entradas (x" + quantity + ")");
    setText("subtotal-val", formatCurrency(subtotal));
    setText("service-val", formatCurrency(serviceTotal));
    setText("grand-total-val", formatCurrency(subtotal + serviceTotal));
    minusButton.disabled = quantity <= 1;
    plusButton.disabled = quantity >= 10;
  }

  if (!eventId) {
    setText("event-title", "Evento no especificado");
    setText("event-desc", "Vuelve al catálogo y selecciona un evento registrado.");
    confirmButton.disabled = true;
    return;
  }

  try {
    var result = await window.Eventix.get("/eventos/" + encodeURIComponent(eventId));
    var event = result.evento;
    eventCode = event.codigo;
    price = Number(event.precio_base);

    document.title = event.nombre + " · Eventix";
    setText("event-title", event.nombre);
    setText("event-code", event.codigo);
    setText("event-teatro", event.teatro);
    setText("event-ciudad", [event.ciudad, event.departamento].filter(Boolean).join(", "));
    setText("event-inicio", formatDate(event.fecha_hora_inicio));
    setText("event-fin", formatDate(event.fecha_hora_fin_estimada));
    setText("event-capacidad", Number(event.capacidad_total).toLocaleString("es-CO") + " espectadores");
    setText("event-desc", event.descripcion || "Este evento no tiene descripción.");
    setText("event-price", formatCurrency(price));
    setText("event-stock", "Aforo total: " + Number(event.capacidad_total).toLocaleString("es-CO"));

    var badge = document.getElementById("event-badge");
    badge.textContent = event.estado || "Estado por confirmar";
    var normalizedStatus = String(event.estado || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    if (normalizedStatus.includes("boleteria")) badge.classList.add("badge-boleteria");
    if (normalizedStatus.includes("programado")) badge.classList.add("badge-programado");
    if (normalizedStatus.includes("vivo")) badge.classList.add("badge-envivo");

    updateSummary();
  } catch (error) {
    console.error("No se pudo cargar el detalle del evento:", error);
    setText("event-title", "No se pudo cargar el evento");
    setText("event-desc", error.message);
    confirmButton.disabled = true;
    return;
  }

  minusButton.addEventListener("click", function () {
    if (quantity > 1) {
      quantity--;
      updateSummary();
    }
  });

  plusButton.addEventListener("click", function () {
    if (quantity < 10) {
      quantity++;
      updateSummary();
    }
  });

  confirmButton.addEventListener("click", async function () {
    confirmButton.disabled = true;
    confirmButton.textContent = "Procesando reserva...";
    try {
      var result = await window.Eventix.get("/reservas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          codigo_evento: eventCode,
          numero_entradas: quantity
        })
      });
      window.alert("Reserva creada. Número: " + result.reserva.id_reserva);
    } catch (error) {
      if (error.message.includes("iniciar sesión")) {
        window.alert("Para reservar, primero inicia sesión con una cuenta de cliente.");
      } else {
        window.alert(error.message);
      }
    } finally {
      confirmButton.disabled = false;
      confirmButton.textContent = "Confirmar reserva";
    }
  });
});
