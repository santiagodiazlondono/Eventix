document.addEventListener("DOMContentLoaded", async function () {
  var SERVICE_FEE_PER_TICKET = 4000;
  var quantity = 2;
  var eventId = new URLSearchParams(window.location.search).get("id");
  var confirmButton = document.querySelector(".btn-block");
  var zoneCards = document.querySelectorAll(".zone-card");
  var quantityNumber = document.querySelector(".qty-number");
  var quantityButtons = document.querySelectorAll(".qty-btn");
  var minusButton = quantityButtons[0];
  var plusButton = quantityButtons[1];
  var price = 0;
  var eventCode = "";
  var currentEvent = null;
  var selectedLocality = "General";
  var availableForLocality = 0;
  var isFinalized = false;

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
    minusButton.disabled = isFinalized || quantity <= 1;
    plusButton.disabled = isFinalized ||
      quantity >= Math.min(10, availableForLocality);
  }

  function selectLocality(locality) {
    var config = {
      General: {
        price: Number(currentEvent.precio_base),
        capacity: Number(currentEvent.disponible_general !== undefined
          ? currentEvent.disponible_general
          : currentEvent.capacidad_general)
      },
      VIP: {
        price: Number(currentEvent.precio_vip),
        capacity: Number(currentEvent.disponible_vip !== undefined
          ? currentEvent.disponible_vip
          : currentEvent.capacidad_vip)
      },
      Preferencial: {
        price: Number(currentEvent.precio_preferencial),
        capacity: Number(currentEvent.disponible_preferencial !== undefined
          ? currentEvent.disponible_preferencial
          : currentEvent.capacidad_preferencial)
      }
    }[locality];

    selectedLocality = locality;
    price = config.price;
    availableForLocality = config.capacity;
    quantity = Math.min(quantity, Math.max(availableForLocality, 1));
    zoneCards.forEach(function (card) {
      var active = card.dataset.zone === locality;
      card.classList.toggle("active", active);
      card.setAttribute("aria-pressed", String(active));
    });
    document.getElementById("selected-zone-label").textContent =
      "Precio " + locality;
    confirmButton.disabled = isFinalized || availableForLocality < 1;
    updateSummary();
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
    currentEvent = event;
    eventCode = event.codigo;

    document.title = event.nombre + " · Eventix";
    setText("event-title", event.nombre);
    setText("event-code", event.codigo);
    setText("event-teatro", event.teatro);
    setText("event-ciudad", [event.ciudad, event.departamento].filter(Boolean).join(", "));
    setText("event-inicio", formatDate(event.fecha_hora_inicio));
    setText("event-fin", formatDate(event.fecha_hora_fin_estimada));
    setText("event-capacidad", Number(event.capacidad_total).toLocaleString("es-CO") + " espectadores");
    setText("event-desc", event.descripcion || "Este evento no tiene descripción.");
    var eventImage = document.getElementById("event-img");
    if (event.url_imagen) {
      eventImage.src = event.url_imagen;
      eventImage.alt = "Imagen de " + event.nombre;
      document.getElementById("event-image-container").hidden = false;
    }

    [
      {
        name: "General",
        price: event.precio_base,
        capacity: event.disponible_general !== undefined
          ? event.disponible_general
          : event.capacidad_general
      },
      {
        name: "VIP",
        price: event.precio_vip,
        capacity: event.disponible_vip !== undefined
          ? event.disponible_vip
          : event.capacidad_vip
      },
      {
        name: "Preferencial",
        price: event.precio_preferencial,
        capacity: event.disponible_preferencial !== undefined
          ? event.disponible_preferencial
          : event.capacidad_preferencial
      }
    ].forEach(function (locality) {
      var key = locality.name.toLowerCase();
      var capacity = Number(locality.capacity);
      setText(
        "price-" + key,
        locality.price === null || locality.price === undefined
          ? "Precio no configurado"
          : formatCurrency(locality.price)
      );
      setText(
        "stock-" + key,
        capacity > 0
          ? capacity.toLocaleString("es-CO") + " disponibles"
          : "Agotada"
      );
      var card = document.querySelector('[data-zone="' + locality.name + '"]');
      card.disabled = isFinalized || capacity < 1;
      if (isFinalized) {
        card.setAttribute("aria-label", locality.name + ", reservas cerradas");
      } else if (card.disabled) {
        card.setAttribute("aria-label", locality.name + ", agotada");
      }
    });
    setText(
      "localidad-general",
      Number(event.capacidad_general).toLocaleString("es-CO") +
        " entradas · " + formatCurrency(event.precio_base)
    );
    setText(
      "localidad-vip",
      Number(event.capacidad_vip).toLocaleString("es-CO") +
        " entradas · " + (event.precio_vip ? formatCurrency(event.precio_vip) : "Precio no configurado")
    );
    setText(
      "localidad-preferencial",
      Number(event.capacidad_preferencial).toLocaleString("es-CO") +
        " entradas · " + (event.precio_preferencial ? formatCurrency(event.precio_preferencial) : "Precio no configurado")
    );

    var badge = document.getElementById("event-badge");
    badge.textContent = event.estado || "Estado por confirmar";
    var normalizedStatus = String(event.estado || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    isFinalized = ["finalizado", "finalizada"].includes(normalizedStatus.trim());
    var reservationStatus = document.getElementById("event-reservation-status");
    if (isFinalized) {
      reservationStatus.textContent = "Este evento ya finalizó. No se pueden reservar entradas.";
      reservationStatus.hidden = false;
      confirmButton.textContent = "Reservas cerradas";
    }
    if (normalizedStatus.includes("boleteria")) badge.classList.add("badge-boleteria");
    if (normalizedStatus.includes("programado")) badge.classList.add("badge-programado");
    if (normalizedStatus.includes("vivo")) badge.classList.add("badge-envivo");

    selectLocality("General");
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

  zoneCards.forEach(function (card) {
    card.addEventListener("click", function () {
      selectLocality(card.dataset.zone);
    });
  });

  confirmButton.addEventListener("click", async function () {
    if (isFinalized) return;
    confirmButton.disabled = true;
    confirmButton.textContent = "Procesando reserva...";
    try {
      var result = await window.Eventix.get("/reservas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          codigo_evento: eventCode,
          numero_entradas: quantity,
          localidad: selectedLocality
        })
      });
      window.alert(
        "Reserva creada para " + result.reserva.localidad +
          ". Número: " + result.reserva.id_reserva +
          (result.correo_enviado
            ? ". Enviamos el comprobante a tu correo."
            : ". No pudimos enviar el comprobante por correo.")
      );
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
