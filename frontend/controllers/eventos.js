(function () {
  "use strict";

  var hostname = window.location.hostname || "localhost";
  var apiBase = window.EVENTIX_API_URL || window.location.protocol + "//" + hostname + ":5000/api";
  var dateTimeFormat = new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Bogota"
  });
  var dateFormat = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "America/Bogota"
  });

  function normalize(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  function slug(value) {
    return normalize(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  function formatDate(value) {
    return value ? dateTimeFormat.format(new Date(value)) : "Fecha por confirmar";
  }

  function eventDate(value) {
    return value ? dateFormat.format(new Date(value)) : "";
  }

  function formatCurrency(value) {
    return "$" + Number(value).toLocaleString("es-CO");
  }

  function statusClass(status) {
    var value = slug(status);
    if (value.includes("boleteria")) return "badge-boleteria";
    if (value.includes("programado")) return "badge-programado";
    if (value.includes("vivo")) return "badge-envivo";
    return "";
  }

  function icon(name) {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("aria-hidden", "true");
    var use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#i-" + name);
    svg.appendChild(use);
    return svg;
  }

  function venue(event) {
    return [event.teatro, event.ciudad, event.departamento].filter(Boolean).join(", ") || "Lugar por confirmar";
  }

  function detailUrl(event) {
    return "detalle-evento.html?id=" + encodeURIComponent(event.codigo);
  }

  function createBadge(status) {
    var badge = document.createElement("span");
    badge.className = "badge " + statusClass(status);
    badge.textContent = status || "Estado por confirmar";
    return badge;
  }

  function createHomeCard(event) {
    var item = document.createElement("li");
    item.className = "event-item";
    item.dataset.ciudad = event.ciudad || "";
    item.dataset.fecha = eventDate(event.fecha_hora_inicio);
    item.dataset.estado = slug(event.estado);
    item.dataset.titulo = event.nombre || "";

    var card = document.createElement("article");
    card.className = "event-card";
    var thumb = document.createElement("div");
    thumb.className = "event-thumb";
    var code = document.createElement("span");
    code.className = "event-kind";
    code.textContent = event.codigo;
    thumb.appendChild(code);

    var body = document.createElement("div");
    body.className = "event-body";
    var title = document.createElement("h3");
    var link = document.createElement("a");
    link.href = detailUrl(event);
    link.textContent = event.nombre;
    title.appendChild(link);

    var location = document.createElement("p");
    location.className = "event-meta";
    location.append(icon("pin"), document.createTextNode(venue(event)));

    var date = document.createElement("p");
    date.className = "event-meta";
    date.append(icon("cal"), document.createTextNode(formatDate(event.fecha_hora_inicio)));

    var footer = document.createElement("div");
    footer.className = "event-foot";
    var price = document.createElement("span");
    price.className = "event-price";
    price.textContent = formatCurrency(event.precio_base);
    footer.append(price, createBadge(event.estado));
    body.append(title, location, date, footer);
    card.append(thumb, body);
    item.appendChild(card);
    return item;
  }

  function createCatalogCard(event) {
    var item = document.createElement("li");
    item.className = "event-card";
    item.dataset.status = slug(event.estado);

    var link = document.createElement("a");
    link.className = "event-link";
    link.href = detailUrl(event);
    link.setAttribute("aria-label", "Ver detalle: " + event.nombre);

    var thumb = document.createElement("div");
    thumb.className = "event-thumb";
    var code = document.createElement("span");
    code.className = "event-kind";
    code.textContent = event.codigo;
    thumb.append(code, createBadge(event.estado));

    var body = document.createElement("div");
    body.className = "event-body";
    var title = document.createElement("h2");
    title.className = "event-name";
    title.textContent = event.nombre;

    var location = document.createElement("p");
    location.className = "event-meta";
    location.append(icon("pin"), document.createTextNode(venue(event)));

    var date = document.createElement("p");
    date.className = "event-meta";
    date.append(icon("cal"), document.createTextNode(formatDate(event.fecha_hora_inicio)));

    var footer = document.createElement("div");
    footer.className = "event-foot";
    var from = document.createElement("span");
    from.className = "event-from";
    from.textContent = "Por entrada";
    var price = document.createElement("span");
    price.className = "event-price";
    price.textContent = formatCurrency(event.precio_base);
    footer.append(from, price);
    body.append(title, location, date, footer);
    link.append(thumb, body);
    item.appendChild(link);
    return item;
  }

  function updateCityOptions(cities) {
    var select = document.querySelector("#hero-search select[name='ciudad']");
    if (!select) return;

    select.replaceChildren(new Option("Todas las ciudades", ""));
    cities.forEach(function (city) {
      select.add(new Option(city.ciudad, city.ciudad));
    });
  }

  async function get(path, options) {
    var response = await fetch(apiBase + path, Object.assign({
      credentials: "include",
      headers: { Accept: "application/json" }
    }, options || {}));
    var result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "No fue posible consultar el servidor.");
    }
    return result;
  }

  window.Eventix = { apiBase: apiBase, get: get };

  var lists = Array.prototype.slice.call(document.querySelectorAll("[data-event-list]"));
  if (!lists.length) return;

  lists.forEach(function (list) {
    list.replaceChildren();
    list.hidden = true;
  });

  get("/eventos")
    .then(function (result) {
      var events = result.eventos || [];
      lists.forEach(function (list) {
        var renderer = list.dataset.eventList === "inicio" ? createHomeCard : createCatalogCard;
        events.forEach(function (event) {
          list.appendChild(renderer(event));
        });
        list.hidden = events.length === 0;
      });

      var message = document.getElementById("eventos-mensaje");
      if (message) {
        message.textContent = events.length
          ? ""
          : "Todavía no hay eventos registrados disponibles.";
        message.hidden = events.length > 0;
      }

      var count = document.getElementById("results-count");
      if (count) {
        count.textContent = events.length + (events.length === 1 ? " evento" : " eventos");
      }

      window.dispatchEvent(new CustomEvent("eventix:eventos-cargados", {
        detail: { eventos: events }
      }));
      get("/ciudades")
        .then(function (cityResult) {
          updateCityOptions(cityResult.ciudades || []);
        })
        .catch(function (error) {
          console.error("No se pudieron cargar las ciudades:", error);
        });
    })
    .catch(function (error) {
      console.error("No se pudieron cargar los eventos de la base de datos:", error);
      lists.forEach(function (list) {
        list.replaceChildren();
        list.hidden = true;
      });

      var message = document.getElementById("eventos-mensaje");
      if (message) {
        message.textContent = "No se pudo conectar con el backend. Comprueba que esté iniciado y vuelve a cargar la página.";
        message.hidden = false;
      }

      var count = document.getElementById("results-count");
      if (count) count.textContent = "No se pudieron cargar los eventos.";
      window.dispatchEvent(new CustomEvent("eventix:eventos-error", { detail: { error: error } }));
    });
})();
