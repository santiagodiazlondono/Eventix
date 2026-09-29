document.addEventListener('DOMContentLoaded', () => {
  // Base de datos de eventos local
  const eventosDB = {
    'noche-sinfonica': {
      codigo: 'EVT-0142',
      titulo: 'Noche Sinfónica de Verano',
      badge: 'En boletería',
      badgeClass: 'badge-boleteria',
      teatro: 'Teatro Municipal',
      ciudad: 'Tuluá, Valle del Cauca',
      inicio: '14 nov 2026, 8:00 p. m.',
      fin: '14 nov 2026, 10:30 p. m.',
      capacidad: '450 espectadores',
      descripcion: 'La Orquesta Filarmónica del Valle presenta un repertorio de piezas clásicas y contemporáneas bajo las estrellas, en una velada pensada para toda la familia. Puertas abiertas una hora antes del inicio.',
      imagen: '../assets/eventos/noche-sinfonica.svg',
      precios: {
        preferencial: 85000,
        vip: 140000,
        general: 55000
      }
    },
    'jardin-espejos': {
      codigo: 'EVT-0189',
      titulo: 'Obra: El Jardín de los Espejos',
      badge: 'En boletería',
      badgeClass: 'badge-boleteria',
      teatro: 'Teatro Jorge Isaacs',
      ciudad: 'Cali, Valle del Cauca',
      inicio: '12 dic 2026, 7:30 p. m.',
      fin: '12 dic 2026, 9:30 p. m.',
      capacidad: '600 espectadores',
      descripcion: 'Una familia descubre que los espejos de su jardín muestran lo que cada uno calla. Un drama emocionante cargado de humor sutil apto para mayores de 12 años.',
      imagen: '../assets/eventos/jardin-espejos.svg',
      precios: {
        preferencial: 60000,
        vip: 95000,
        general: 40000
      }
    },
    'stand-up': {
      codigo: 'EVT-0201',
      titulo: 'Stand Up: Noche de Comedia',
      badge: 'En vivo',
      badgeClass: 'badge-envivo',
      teatro: 'Auditorio Uceva',
      ciudad: 'Tuluá, Valle del Cauca',
      inicio: '08 nov 2026, 7:00 p. m.',
      fin: '08 nov 2026, 9:00 p. m.',
      capacidad: '300 espectadores',
      descripcion: 'Cuatro comediantes del Valle suben al escenario con rutinas sobre la vida universitaria, la familia y las anécdotas cotidianas.',
      imagen: '../assets/eventos/stand-up.svg',
      precios: {
        preferencial: 45000,
        vip: 70000,
        general: 30000
      }
    }
  };

  // 1. Obtener ID del evento desde la URL (?id=...)
  const urlParams = new URLSearchParams(window.location.search);
  const eventoId = urlParams.get('id') || 'noche-sinfonica';
  const evento = eventosDB[eventoId] || eventosDB['noche-sinfonica'];

  // 2. Renderizar datos en la vista
  document.title = `${evento.titulo} · Eventix`;

  const badgeEl = document.getElementById('event-badge');
  if (badgeEl) {
    badgeEl.textContent = evento.badge;
    badgeEl.className = `badge ${evento.badgeClass}`;
  }

  document.getElementById('event-title').textContent = evento.titulo;
  document.getElementById('event-code').textContent = evento.codigo;
  document.getElementById('event-teatro').textContent = evento.teatro;
  document.getElementById('event-ciudad').textContent = evento.ciudad;
  document.getElementById('event-inicio').textContent = evento.inicio;
  document.getElementById('event-fin').textContent = evento.fin;
  document.getElementById('event-capacidad').textContent = evento.capacidad;
  document.getElementById('event-desc').textContent = evento.descripcion;

  const bannerImg = document.getElementById('event-img');
  if (bannerImg) {
    bannerImg.src = evento.imagen;
    bannerImg.alt = evento.titulo;
  }

  // Precios base por zona
  document.querySelector('[data-zone="preferencial"] .zone-price').textContent = formatCurrency(evento.precios.preferencial);
  document.querySelector('[data-zone="vip"] .zone-price').textContent = formatCurrency(evento.precios.vip);
  document.querySelector('[data-zone="general"] .zone-price').textContent = formatCurrency(evento.precios.general);

  // 3. Lógica de cálculo interactivo
  const SERVICE_FEE_PER_TICKET = 4000;
  let currentZone = 'preferencial';
  let currentPrice = evento.precios[currentZone];
  let quantity = 2;

  const zoneCards = document.querySelectorAll('.zone-card');
  const qtyNumberEl = document.querySelector('.qty-number');
  const btnMinus = document.querySelectorAll('.qty-btn')[0];
  const btnPlus = document.querySelectorAll('.qty-btn')[1];

  const basePriceEl = document.getElementById('base-price-val');
  const subtotalLabelEl = document.getElementById('subtotal-label');
  const subtotalValEl = document.getElementById('subtotal-val');
  const serviceValEl = document.getElementById('service-val');
  const grandTotalValEl = document.getElementById('grand-total-val');
  const btnConfirmar = document.querySelector('.btn-block');

  function formatCurrency(amount) {
    return '$' + amount.toLocaleString('es-CO');
  }

  function updateSummary() {
    const subtotal = currentPrice * quantity;
    const totalServices = SERVICE_FEE_PER_TICKET * quantity;
    const grandTotal = subtotal + totalServices;

    qtyNumberEl.textContent = quantity;
    basePriceEl.textContent = formatCurrency(currentPrice);
    subtotalLabelEl.textContent = `Entradas (x${quantity})`;
    subtotalValEl.textContent = formatCurrency(subtotal);
    serviceValEl.textContent = formatCurrency(totalServices);
    grandTotalValEl.textContent = formatCurrency(grandTotal);

    btnMinus.disabled = quantity <= 1;
    btnMinus.style.opacity = quantity <= 1 ? '0.4' : '1';
    btnMinus.style.cursor = quantity <= 1 ? 'not-allowed' : 'pointer';
  }

  // Selección de zonas
  zoneCards.forEach(card => {
    card.addEventListener('click', () => {
      zoneCards.forEach(c => c.classList.remove('active'));
      card.classList.add('active');

      const selectedZone = card.dataset.zone;
      if (evento.precios[selectedZone]) {
        currentZone = selectedZone;
        currentPrice = evento.precios[selectedZone];
        updateSummary();
      }
    });
  });

  // Botones de cantidad
  btnMinus.addEventListener('click', () => {
    if (quantity > 1) {
      quantity--;
      updateSummary();
    }
  });

  btnPlus.addEventListener('click', () => {
    if (quantity < 10) {
      quantity++;
      updateSummary();
    }
  });

  updateSummary();

 
 // 4. CONEXIÓN CON EL BACKEND EN NODE.JS (Envío de correo)
  
btnConfirmar.addEventListener('click', async () => {
 
  const emailDestino = prompt("Ingresa tu correo electrónico para recibir la confirmación:", "tu_correo@gmail.com");

  if (!emailDestino) return; 

  btnConfirmar.disabled = true;
  btnConfirmar.textContent = "Procesando reserva...";

  const reservaData = {
    emailCliente: emailDestino,
    eventoTitulo: evento.titulo,
    cantidad: quantity,
    total: grandTotalValEl.textContent
  };

  try {
    // Petición al servidor Express en el puerto 5000
    const respuesta = await fetch('http://192.168.1.5:5000/api/reservar', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(reservaData)
    });

    const resultado = await respuesta.json();

    if (resultado.status === 'ok') {
      alert(`¡Reserva confirmada con éxito!\n\nSe ha enviado un correo con el comprobante a: ${emailDestino}`);
    } else {
      alert('Ocurrió un error al procesar el envío del correo desde el servidor.');
    }
  } catch (error) {
    console.error('Error al conectar con Node.js:', error);
    alert('No se pudo conectar con el servidor backend. Asegúrate de ejecutar "node server.js" en la terminal.');
  } finally {
    btnConfirmar.disabled = false;
    btnConfirmar.textContent = "Confirmar reserva";
  }
});
});