/* Controlador del catálogo: filtro por estado + búsqueda en vivo */
(function () {
   'use strict';
 
   var chips = document.querySelectorAll('.chip');
   var cards = document.querySelectorAll('.event-card');
   var search = document.getElementById('search');
   var counter = document.getElementById('results-count');
   var grid = document.getElementById('event-grid');
   var empty = document.getElementById('empty-state');
   var clearBtn = document.getElementById('clear-filters');
   var current = 'todos';
 
   function normalize(t) {
     return t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
   }
 
   function apply() {
     var q = normalize(search.value.trim());
     var shown = 0;
 
     cards.forEach(function (card) {
       var okStatus = current === 'todos' || card.dataset.status === current;
       var okText = !q || normalize(card.textContent).indexOf(q) !== -1;
       var visible = okStatus && okText;
       card.hidden = !visible;
       if (visible) shown++;
     });
 
     counter.textContent = shown + (shown === 1 ? ' evento' : ' eventos');
     grid.hidden = shown === 0;
     empty.hidden = shown !== 0;
   }
 
   chips.forEach(function (chip) {
     chip.addEventListener('click', function () {
       chips.forEach(function (c) {
         c.classList.remove('is-active');
         c.setAttribute('aria-pressed', 'false');
       });
       chip.classList.add('is-active');
       chip.setAttribute('aria-pressed', 'true');
       current = chip.dataset.filter;
       apply();
     });
   });
 
   search.addEventListener('input', apply);
 
   clearBtn.addEventListener('click', function () {
     search.value = '';
     chips[0].click();
   });
 
   apply();
 })();