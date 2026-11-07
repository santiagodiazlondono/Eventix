(function () {
  "use strict";

  function scrollToSection(element) {
    if (!element) return Promise.resolve();

    return new Promise(function (resolve) {
      window.requestAnimationFrame(function () {
        var reducedMotion = window.matchMedia(
          "(prefers-reduced-motion: reduce)"
        ).matches;
        element.scrollIntoView({
          behavior: reducedMotion ? "auto" : "smooth",
          block: "start"
        });
        if (typeof element.focus === "function") {
          element.focus({ preventScroll: true });
        }
        resolve();
      });
    });
  }

  window.EventixUI = { scrollToSection: scrollToSection };
})();
