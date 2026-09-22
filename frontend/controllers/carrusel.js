/* =========================================================
   EVENTIX · Carrusel "En cartelera"
   - Avanza solo cada 5 segundos.
   - Se pausa mientras el cursor está encima, cuando se navega
     con el teclado dentro del carrusel, al tocarlo en el celular,
     cuando no está visible en pantalla o la pestaña está oculta.
   - La barra de progreso muestra cuánto falta para el siguiente evento.
   - Si el usuario prefiere reducir el movimiento, no avanza solo.
   Sin este archivo el carrusel sigue funcionando (deslizar, flechas y puntos).
   ========================================================= */
(function () {
  "use strict";

  var carousel = document.querySelector(".carousel");
  if (!carousel) return;

  var track = carousel.querySelector(".carousel-track");
  var slides = Array.prototype.slice.call(track.querySelectorAll(".slide"));
  var dots = Array.prototype.slice.call(carousel.querySelectorAll(".carousel-dots a"));
  var bar = carousel.querySelector(".carousel-progress span");
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var index = 0;
  var pauseReasons = {};   // hover, focus, touch, offscreen, hidden
  var scrollTimer = null;

  carousel.classList.add("is-enhanced");

  /* ---------- utilidades ---------- */
  function slideWidth() {
    return slides.length > 1 ? slides[1].offsetLeft - slides[0].offsetLeft : track.clientWidth;
  }

  function updateDots() {
    dots.forEach(function (dot, i) {
      if (i === index) dot.setAttribute("aria-current", "true");
      else dot.removeAttribute("aria-current");
    });
  }

  function restartProgress() {
    if (!bar || reduceMotion) return;
    bar.classList.remove("is-running");
    void bar.offsetWidth;            // fuerza a reiniciar la animación CSS
    bar.classList.add("is-running");
  }

  function goTo(i) {
    index = (i + slides.length) % slides.length;
    track.scrollTo({ left: index * slideWidth(), behavior: reduceMotion ? "auto" : "smooth" });
    updateDots();
    restartProgress();
  }

  /* ---------- pausa y reanudación ---------- */
  function setPaused(reason, value) {
    if (value) pauseReasons[reason] = true;
    else delete pauseReasons[reason];
    carousel.classList.toggle("is-paused", Object.keys(pauseReasons).length > 0);
  }

  carousel.addEventListener("mouseenter", function () { setPaused("hover", true); });
  carousel.addEventListener("mouseleave", function () { setPaused("hover", false); });
  carousel.addEventListener("focusin", function () { setPaused("focus", true); });
  carousel.addEventListener("focusout", function (e) {
    if (!carousel.contains(e.relatedTarget)) setPaused("focus", false);
  });

  /* En pantallas táctiles: pausa al tocar y reanuda 6 s después de soltar */
  var touchTimer = null;
  carousel.addEventListener("touchstart", function () {
    clearTimeout(touchTimer);
    setPaused("touch", true);
  }, { passive: true });
  carousel.addEventListener("touchend", function () {
    touchTimer = setTimeout(function () { setPaused("touch", false); }, 6000);
  });

  document.addEventListener("visibilitychange", function () {
    setPaused("hidden", document.hidden);
  });

  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      setPaused("offscreen", !entries[0].isIntersecting);
    }, { threshold: 0.35 }).observe(carousel);
  }

  /* ---------- avance automático ----------
     La barra de progreso dura 5 s (CSS). Cuando termina, pasa al siguiente.
     Al pausar, la animación se detiene y el tiempo restante se conserva. */
  if (bar && !reduceMotion) {
    bar.addEventListener("animationend", function () { goTo(index + 1); });
    restartProgress();
  }

  /* ---------- flechas y puntos: desplazan solo el carrusel ---------- */
  carousel.addEventListener("click", function (e) {
    var link = e.target.closest(".slide-arrow, .carousel-dots a");
    if (!link) return;
    var target = document.getElementById(link.getAttribute("href").slice(1));
    var i = slides.indexOf(target);
    if (i === -1) return;
    e.preventDefault();              // evita que la página salte hacia el ancla
    goTo(i);
  });

  /* ---------- si el usuario desliza a mano, sincroniza puntos y progreso ---------- */
  track.addEventListener("scroll", function () {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(function () {
      var i = Math.round(track.scrollLeft / slideWidth());
      if (i !== index) {
        index = i;
        updateDots();
        restartProgress();
      }
    }, 120);
  }, { passive: true });

  updateDots();
})();
