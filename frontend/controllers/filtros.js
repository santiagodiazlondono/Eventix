(function () {
  "use strict";

  var list = document.querySelector('[data-event-list="inicio"]');
  if (!list) return;

  var dialog = document.getElementById("filter-dialog");
  var openButton = document.getElementById("open-filters");
  var countBadge = openButton.querySelector(".filter-count");
  var applyButton = document.getElementById("apply-filters");
  var resultsBar = document.querySelector(".results-bar");
  var resultsCount = document.querySelector(".results-count");
  var activeList = document.querySelector(".active-filters");
  var emptyState = document.querySelector(".empty-state");
  var chipsList = document.querySelector(".events-toolbar .chips");
  var citySelect = document.getElementById("f-ciudad");
  var dateSelect = document.getElementById("f-cuando");
  var fromInput = document.getElementById("f-desde");
  var untilInput = document.getElementById("f-hasta");
  var rangeBox = dialog.querySelector(".filter-range");
  var items = [];
  var loaded = false;
  var state = { ciudad: "", cuando: "", desde: "", hasta: "", estado: "", q: "" };

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

  function unique(values) {
    return Array.from(new Set(values.filter(Boolean))).sort(function (a, b) {
      return a.localeCompare(b, "es");
    });
  }

  function monthLabel(month) {
    var value = new Intl.DateTimeFormat("es-CO", {
      month: "long",
      year: "numeric",
      timeZone: "UTC"
    }).format(new Date(month + "-01T00:00:00Z"));
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  function dayLabel(date) {
    return new Intl.DateTimeFormat("es-CO", {
      day: "numeric",
      month: "short",
      timeZone: "UTC"
    }).format(new Date(date + "T00:00:00Z")).replace(".", "");
  }

  function addOptions(select, values, label) {
    values.forEach(function (value) {
      select.add(new Option(label ? label(value) : value, value));
    });
  }

  function matches(item, filters) {
    var data = item.dataset;
    if (filters.ciudad && data.ciudad !== filters.ciudad) return false;
    if (filters.estado && data.estado !== filters.estado) return false;
    if (filters.cuando && filters.cuando !== "rango" &&
        data.fecha.slice(0, 7) !== filters.cuando) return false;
    if (filters.cuando === "rango") {
      if (filters.desde && data.fecha < filters.desde) return false;
      if (filters.hasta && data.fecha > filters.hasta) return false;
    }
    if (filters.q && !normalize(data.titulo + " " + data.ciudad + " " + item.textContent)
      .includes(normalize(filters.q))) return false;
    return true;
  }

  function countFor(filters) {
    return items.filter(function (item) { return matches(item, filters); }).length;
  }

  function describeDate(filters) {
    if (!filters.cuando) return "";
    if (filters.cuando !== "rango") return monthLabel(filters.cuando);
    if (filters.desde && filters.hasta) return dayLabel(filters.desde) + " – " + dayLabel(filters.hasta);
    if (filters.desde) return "Desde " + dayLabel(filters.desde);
    if (filters.hasta) return "Hasta " + dayLabel(filters.hasta);
    return "";
  }

  function render() {
    var shown = 0;
    items.forEach(function (item) {
      item.hidden = !matches(item, state);
      if (!item.hidden) shown++;
    });

    var tags = [];
    if (state.q) tags.push({ key: "q", label: "“" + state.q + "”" });
    if (state.ciudad) tags.push({ key: "ciudad", label: state.ciudad });
    var dateDescription = describeDate(state);
    if (dateDescription) tags.push({ key: "fecha", label: dateDescription });

    activeList.replaceChildren();
    tags.forEach(function (tag) {
      var item = document.createElement("li");
      var button = document.createElement("button");
      button.type = "button";
      button.className = "filter-tag";
      button.dataset.remove = tag.key;
      button.setAttribute("aria-label", "Quitar filtro " + tag.label);
      var text = document.createElement("span");
      text.textContent = tag.label;
      button.appendChild(text);
      item.appendChild(button);
      activeList.appendChild(item);
    });
    if (tags.length > 1) {
      var clearItem = document.createElement("li");
      var clearButton = document.createElement("button");
      clearButton.type = "button";
      clearButton.className = "link-clear";
      clearButton.dataset.clearFilters = "";
      clearButton.textContent = "Quitar todos";
      clearItem.appendChild(clearButton);
      activeList.appendChild(clearItem);
    }

    var hasFilters = tags.length > 0 || state.estado;
    resultsBar.hidden = !hasFilters;
    resultsCount.textContent = "Mostrando " + shown + " de " + items.length + " eventos";
    emptyState.hidden = !loaded || items.length === 0 || shown !== 0;
    countBadge.hidden = tags.length === 0;
    countBadge.textContent = tags.length;
    openButton.classList.toggle("is-active", tags.length > 0);

    chipsList.querySelectorAll(".chip").forEach(function (chip) {
      var active = chip.dataset.estado === state.estado;
      chip.classList.toggle("is-active", active);
      chip.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function readDraft() {
    return Object.assign({}, state, {
      ciudad: citySelect.value,
      cuando: dateSelect.value,
      desde: dateSelect.value === "rango" ? fromInput.value : "",
      hasta: dateSelect.value === "rango" ? untilInput.value : ""
    });
  }

  function updateDraft() {
    rangeBox.hidden = dateSelect.value !== "rango";
    untilInput.min = fromInput.value || "";
    var count = countFor(readDraft());
    applyButton.textContent = count === 0 ? "Sin resultados" : "Ver " + count + (count === 1 ? " evento" : " eventos");
    applyButton.disabled = count === 0;
  }

  function fillDraft() {
    citySelect.value = state.ciudad;
    dateSelect.value = state.cuando;
    fromInput.value = state.desde;
    untilInput.value = state.hasta;
    updateDraft();
  }

  openButton.hidden = false;
  openButton.addEventListener("click", function () {
    fillDraft();
    dialog.showModal();
  });
  dialog.addEventListener("change", updateDraft);
  dialog.addEventListener("input", updateDraft);

  dialog.querySelector("[data-reset-draft]").addEventListener("click", function () {
    citySelect.value = dateSelect.value = fromInput.value = untilInput.value = "";
    updateDraft();
  });
  dialog.addEventListener("close", function () {
    if (dialog.returnValue === "apply") {
      state = readDraft();
      render();
      document.getElementById("eventos").scrollIntoView({ behavior: "smooth" });
    }
    openButton.focus();
  });
  dialog.addEventListener("click", function (event) {
    if (event.target === dialog) dialog.close("cancel");
  });

  chipsList.addEventListener("click", function (event) {
    var chip = event.target.closest(".chip");
    if (!chip) return;
    state.estado = chip.dataset.estado;
    render();
  });

  document.addEventListener("click", function (event) {
    var removeButton = event.target.closest("[data-remove]");
    if (removeButton) {
      if (removeButton.dataset.remove === "fecha") {
        state.cuando = state.desde = state.hasta = "";
      } else {
        state[removeButton.dataset.remove] = "";
      }
      render();
      openButton.focus();
    } else if (event.target.closest("[data-clear-filters]")) {
      state = { ciudad: "", cuando: "", desde: "", hasta: "", estado: "", q: "" };
      render();
      openButton.focus();
    }
  });

  var heroForm = document.getElementById("hero-search");
  if (heroForm) {
    heroForm.addEventListener("submit", function (event) {
      event.preventDefault();
      var date = heroForm.elements.fecha.value;
      state = {
        q: heroForm.elements.q.value.trim(),
        ciudad: heroForm.elements.ciudad.value,
        cuando: date ? "rango" : "",
        desde: date,
        hasta: "",
        estado: ""
      };
      render();
      document.getElementById("eventos").scrollIntoView({ behavior: "smooth" });
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll(".city[data-ciudad]"), function (link) {
    link.addEventListener("click", function (event) {
      event.preventDefault();
      state.ciudad = link.dataset.ciudad;
      render();
      document.getElementById("eventos").scrollIntoView({ behavior: "smooth" });
    });
  });

  window.addEventListener("eventix:eventos-cargados", function (event) {
    items = Array.prototype.slice.call(list.querySelectorAll(".event-item"));
    var cities = unique(items.map(function (item) { return item.dataset.ciudad; }));
    addOptions(citySelect, cities);

    var months = unique(items.map(function (item) { return item.dataset.fecha.slice(0, 7); }));
    var rangeOption = dateSelect.querySelector('option[value="rango"]');
    months.forEach(function (month) {
      dateSelect.insertBefore(new Option(monthLabel(month), month), rangeOption);
    });

    var statuses = new Map();
    event.detail.eventos.forEach(function (item) {
      if (item.estado) statuses.set(slug(item.estado), item.estado);
    });
    statuses.forEach(function (label, value) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "chip";
      button.dataset.estado = value;
      button.setAttribute("aria-pressed", "false");
      button.textContent = label;
      chipsList.appendChild(button);
    });

    loaded = true;
    render();
  });

  window.addEventListener("eventix:eventos-error", function () {
    items = [];
    loaded = false;
    emptyState.hidden = true;
  });
})();
