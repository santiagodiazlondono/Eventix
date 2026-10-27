(function () {
  "use strict";

  var chipsList = document.querySelector(".chips");
  var search = document.getElementById("search");
  var counter = document.getElementById("results-count");
  var grid = document.getElementById("event-grid");
  var empty = document.getElementById("empty-state");
  var clearButton = document.getElementById("clear-filters");
  var currentStatus = "";
  var cards = [];
  var eventsLoaded = false;

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

  function render() {
    var query = normalize(search.value);
    var shown = 0;
    cards.forEach(function (card) {
      var matchesStatus = !currentStatus || card.dataset.status === currentStatus;
      var matchesText = !query || normalize(card.textContent).includes(query);
      card.hidden = !matchesStatus || !matchesText;
      if (!card.hidden) shown++;
    });

    counter.textContent = shown + (shown === 1 ? " evento" : " eventos");
    grid.hidden = !eventsLoaded || shown === 0;
    empty.hidden = !eventsLoaded || shown > 0;
    if (eventsLoaded && cards.length === 0) {
      empty.querySelector("h2").textContent = "Aún no hay eventos";
      empty.querySelector("p").textContent = "Los eventos registrados aparecerán aquí.";
      clearButton.hidden = true;
    } else {
      empty.querySelector("h2").textContent = "Sin resultados";
      empty.querySelector("p").textContent = "No encontramos eventos con esos filtros. Prueba con otra búsqueda.";
      clearButton.hidden = false;
    }
  }

  function setActiveChip(selectedChip) {
    chipsList.querySelectorAll(".chip").forEach(function (chip) {
      var active = chip === selectedChip;
      chip.classList.toggle("is-active", active);
      chip.setAttribute("aria-pressed", active ? "true" : "false");
    });
    currentStatus = selectedChip.dataset.filter === "todos"
      ? ""
      : selectedChip.dataset.filter;
    render();
  }

  chipsList.addEventListener("click", function (event) {
    var chip = event.target.closest(".chip");
    if (chip) setActiveChip(chip);
  });

  search.addEventListener("input", render);
  clearButton.addEventListener("click", function () {
    search.value = "";
    setActiveChip(chipsList.querySelector('[data-filter="todos"]'));
  });

  window.addEventListener("eventix:eventos-cargados", function (event) {
    var statuses = new Map();
    event.detail.eventos.forEach(function (item) {
      if (item.estado) statuses.set(slug(item.estado), item.estado);
    });

    statuses.forEach(function (label, value) {
      var item = document.createElement("li");
      var button = document.createElement("button");
      button.type = "button";
      button.className = "chip";
      button.dataset.filter = value;
      button.setAttribute("aria-pressed", "false");
      button.textContent = label;
      item.appendChild(button);
      chipsList.appendChild(item);
    });

    cards = Array.prototype.slice.call(grid.querySelectorAll(".event-card"));
    eventsLoaded = true;
    render();
  });

  window.addEventListener("eventix:eventos-error", function () {
    cards = [];
    eventsLoaded = false;
    grid.hidden = true;
    empty.hidden = true;
  });
})();
