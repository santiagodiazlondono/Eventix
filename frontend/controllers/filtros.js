/* =========================================================
   EVENTIX · Filtro de eventos
   Filtra la sección "Próximos eventos" por:
     ciudad · categoría · fecha (mes o rango) · estado · texto
   Los datos se leen de los atributos data-* de cada evento,
   así que al agregar eventos al HTML los filtros se actualizan solos.
   ========================================================= */
(function () {
  "use strict";

  var items = Array.prototype.slice.call(document.querySelectorAll(".event-item"));
  if (!items.length) return;

  var dialog = document.getElementById("filter-dialog");
  var openBtn = document.getElementById("open-filters");
  var countBadge = openBtn.querySelector(".filter-count");
  var applyBtn = document.getElementById("apply-filters");
  var resultsBar = document.querySelector(".results-bar");
  var resultsCount = document.querySelector(".results-count");
  var activeList = document.querySelector(".active-filters");
  var emptyState = document.querySelector(".empty-state");
  var chips = Array.prototype.slice.call(document.querySelectorAll(".chip[data-estado]"));

  var fCiudad = document.getElementById("f-ciudad");
  var fCategoria = document.getElementById("f-categoria");
  var fCuando = document.getElementById("f-cuando");
  var fDesde = document.getElementById("f-desde");
  var fHasta = document.getElementById("f-hasta");
  var rangeBox = dialog.querySelector(".filter-range");

  var EMPTY = { ciudad: "", categoria: "", cuando: "", desde: "", hasta: "", estado: "", q: "" };
  var state = Object.assign({}, EMPTY);

  /* ---------- utilidades ---------- */
  function normalize(text) {
    return (text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  }

  function unique(values) {
    return values.filter(function (v, i) { return values.indexOf(v) === i; }).sort();
  }

  var monthFmt = new Intl.DateTimeFormat("es-CO", { month: "long", year: "numeric", timeZone: "UTC" });
  var dayFmt = new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", timeZone: "UTC" });

  function monthLabel(ym) {
    var txt = monthFmt.format(new Date(ym + "-01T00:00:00Z"));
    return txt.charAt(0).toUpperCase() + txt.slice(1);
  }
  function dayLabel(iso) {
    return dayFmt.format(new Date(iso + "T00:00:00Z")).replace(".", "");
  }

  function addOptions(select, values, labelFn) {
    values.forEach(function (v) {
      var opt = document.createElement("option");
      opt.value = v;
      opt.textContent = labelFn ? labelFn(v) : v;
      select.appendChild(opt);
    });
  }

  /* ---------- opciones a partir de los eventos ---------- */
  addOptions(fCiudad, unique(items.map(function (li) { return li.dataset.ciudad; })));
  addOptions(fCategoria, unique(items.map(function (li) { return li.dataset.categoria; })));
  var months = unique(items.map(function (li) { return li.dataset.fecha.slice(0, 7); }));
  months.forEach(function (ym) {
    var opt = document.createElement("option");
    opt.value = ym;
    opt.textContent = monthLabel(ym);
    fCuando.insertBefore(opt, fCuando.querySelector('option[value="rango"]'));
  });

  /* ---------- lógica de coincidencia ---------- */
  function matches(li, f) {
    var d = li.dataset;
    if (f.ciudad && d.ciudad !== f.ciudad) return false;
    if (f.categoria && d.categoria !== f.categoria) return false;
    if (f.estado && d.estado !== f.estado) return false;
    if (f.cuando && f.cuando !== "rango" && d.fecha.slice(0, 7) !== f.cuando) return false;
    if (f.cuando === "rango") {
      if (f.desde && d.fecha < f.desde) return false;
      if (f.hasta && d.fecha > f.hasta) return false;
    }
    if (f.q) {
      var haystack = normalize(d.titulo + " " + d.ciudad + " " + d.categoria + " " + li.textContent);
      if (haystack.indexOf(normalize(f.q)) === -1) return false;
    }
    return true;
  }

  function countFor(f) {
    return items.filter(function (li) { return matches(li, f); }).length;
  }

  function plural(n) {
    return n === 1 ? "1 evento" : n + " eventos";
  }

  /* ---------- pintar resultados ---------- */
  function describeDate(f) {
    if (!f.cuando) return "";
    if (f.cuando !== "rango") return monthLabel(f.cuando);
    if (f.desde && f.hasta) return dayLabel(f.desde) + " – " + dayLabel(f.hasta);
    if (f.desde) return "Desde " + dayLabel(f.desde);
    if (f.hasta) return "Hasta " + dayLabel(f.hasta);
    return "";
  }

  function render() {
    var shown = 0;
    items.forEach(function (li) {
      var ok = matches(li, state);
      li.hidden = !ok;
      if (ok) shown++;
    });

    // Etiquetas de filtros activos (se pueden quitar una por una)
    var tags = [];
    if (state.q) tags.push({ key: "q", label: "“" + state.q + "”" });
    if (state.ciudad) tags.push({ key: "ciudad", label: state.ciudad });
    if (state.categoria) tags.push({ key: "categoria", label: state.categoria });
    var dateTxt = describeDate(state);
    if (dateTxt) tags.push({ key: "fecha", label: dateTxt });

    activeList.innerHTML = "";
    tags.forEach(function (t) {
      var li = document.createElement("li");
      var b = document.createElement("button");
      b.type = "button";
      b.className = "filter-tag";
      b.dataset.remove = t.key;
      b.setAttribute("aria-label", "Quitar filtro " + t.label);
      b.innerHTML = '<span></span><svg aria-hidden="true"><use href="#i-close"/></svg>';
      b.firstChild.textContent = t.label;
      li.appendChild(b);
      activeList.appendChild(li);
    });
    if (tags.length > 1) {
      var liAll = document.createElement("li");
      liAll.innerHTML = '<button type="button" class="link-clear" data-clear-filters>Quitar todos</button>';
      activeList.appendChild(liAll);
    }

    var filtering = tags.length > 0 || state.estado;
    resultsBar.hidden = !filtering;
    resultsCount.textContent = "Mostrando " + shown + " de " + plural(items.length);
    emptyState.hidden = shown !== 0;

    countBadge.hidden = tags.length === 0;
    countBadge.textContent = tags.length;
    openBtn.classList.toggle("is-active", tags.length > 0);

    chips.forEach(function (chip) {
      var on = chip.dataset.estado === state.estado;
      chip.classList.toggle("is-active", on);
      chip.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  /* ---------- panel (dialog) ---------- */
  function readDraft() {
    return Object.assign({}, state, {
      ciudad: fCiudad.value,
      categoria: fCategoria.value,
      cuando: fCuando.value,
      desde: fCuando.value === "rango" ? fDesde.value : "",
      hasta: fCuando.value === "rango" ? fHasta.value : ""
    });
  }

  function updateDraftUI() {
    rangeBox.hidden = fCuando.value !== "rango";
    fHasta.min = fDesde.value || "";
    var n = countFor(readDraft());
    applyBtn.textContent = n === 0 ? "Sin resultados" : "Ver " + plural(n);
    applyBtn.disabled = n === 0;
  }

  function fillDraft() {
    fCiudad.value = state.ciudad;
    fCategoria.value = state.categoria;
    fCuando.value = state.cuando;
    fDesde.value = state.desde;
    fHasta.value = state.hasta;
    updateDraftUI();
  }

  openBtn.hidden = false;                 // el botón solo aparece si hay JavaScript
  openBtn.addEventListener("click", function () {
    fillDraft();
    dialog.showModal();
  });

  dialog.addEventListener("change", updateDraftUI);
  dialog.addEventListener("input", updateDraftUI);

  dialog.querySelector("[data-reset-draft]").addEventListener("click", function () {
    fCiudad.value = fCategoria.value = fCuando.value = fDesde.value = fHasta.value = "";
    updateDraftUI();
  });

  dialog.addEventListener("close", function () {
    if (dialog.returnValue === "apply") {
      state = readDraft();
      render();
      document.getElementById("eventos").scrollIntoView({ behavior: "smooth" });
    }
    openBtn.focus();
  });

  // Cerrar al hacer clic fuera del panel
  dialog.addEventListener("click", function (e) {
    if (e.target === dialog) dialog.close("cancel");
  });

  /* ---------- estados rápidos (chips) ---------- */
  chips.forEach(function (chip) {
    chip.addEventListener("click", function () {
      state.estado = chip.dataset.estado;
      render();
    });
  });

  /* ---------- quitar filtros ---------- */
  document.addEventListener("click", function (e) {
    var tag = e.target.closest("[data-remove]");
    if (tag) {
      var key = tag.dataset.remove;
      if (key === "fecha") { state.cuando = state.desde = state.hasta = ""; }
      else { state[key] = ""; }
      render();
      openBtn.focus();
      return;
    }
    if (e.target.closest("[data-clear-filters]")) {
      state = Object.assign({}, EMPTY);
      render();
      openBtn.focus();
    }
  });

  /* ---------- buscador del hero ---------- */
  var heroForm = document.getElementById("hero-search");
  if (heroForm) {
    heroForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var date = heroForm.elements.fecha.value;
      state = Object.assign({}, EMPTY, {
        q: heroForm.elements.q.value.trim(),
        ciudad: heroForm.elements.ciudad.value,
        cuando: date ? "rango" : "",
        desde: date
      });
      render();
      document.getElementById("eventos").scrollIntoView({ behavior: "smooth" });
    });
  }

  /* ---------- tarjetas de "Eventos por ciudad" ---------- */
  Array.prototype.forEach.call(document.querySelectorAll(".city[data-ciudad]"), function (link) {
    link.addEventListener("click", function (e) {
      e.preventDefault();
      state = Object.assign({}, EMPTY, { ciudad: link.dataset.ciudad });
      render();
      document.getElementById("eventos").scrollIntoView({ behavior: "smooth" });
    });
  });

  render();
})();
