'use strict';

const nodemailer = require('nodemailer');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function formatCurrency(value) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0
  }).format(Number(value));
}

async function sendReservationEmail(reservation, action) {
  const host = process.env.SMTP_HOST;
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  if (!host || !from) {
    return { sent: false, reason: 'SMTP_HOST y SMTP_FROM no están configurados.' };
  }

  const port = Number(process.env.SMTP_PORT || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { sent: false, reason: 'SMTP_PORT no es válido.' };
  }

  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (Boolean(user) !== Boolean(pass)) {
    return { sent: false, reason: 'SMTP_USER y SMTP_PASS deben configurarse juntos.' };
  }

  const created = action === 'created';
  const actionLabel = created ? 'creada' : 'cancelada';
  const subject = `Eventix: reserva ${actionLabel} #${reservation.id_reserva}`;
  const customerName = [reservation.nombres, reservation.apellidos].filter(Boolean).join(' ');
  const eventPlace = [reservation.teatro, reservation.ciudad].filter(Boolean).join(', ');
  const details = [
    `Hola ${customerName || 'cliente'},`,
    `Tu reserva #${reservation.id_reserva} fue ${actionLabel}.`,
    `Fecha de la operación: ${reservation.fecha_reserva}`,
    `Evento: ${reservation.evento}`,
    `Fecha del evento: ${reservation.fecha_evento}`,
    `Localidad: ${reservation.localidad}`,
    `Entradas: ${reservation.numero_entradas}`,
    `Valor total: ${formatCurrency(reservation.valor_total)}`,
    `Lugar: ${eventPlace || 'No especificado'}`
  ].join('\n');
  const html = `
    <div style="font-family:Arial,sans-serif;color:#172033;max-width:600px;margin:0 auto">
      <h1 style="color:#176b70">Eventix</h1>
      <h2>Reserva ${actionLabel}</h2>
      <p>Hola ${escapeHtml(customerName || 'cliente')},</p>
      <p>Este es el comprobante de la reserva <strong>#${escapeHtml(reservation.id_reserva)}</strong>.</p>
      <table style="border-collapse:collapse;width:100%">
        <tr><td style="padding:8px;border-bottom:1px solid #ddd">Fecha de la operación</td><td style="padding:8px;border-bottom:1px solid #ddd">${escapeHtml(reservation.fecha_reserva)}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #ddd">Evento</td><td style="padding:8px;border-bottom:1px solid #ddd">${escapeHtml(reservation.evento)}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #ddd">Fecha</td><td style="padding:8px;border-bottom:1px solid #ddd">${escapeHtml(reservation.fecha_evento)}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #ddd">Localidad</td><td style="padding:8px;border-bottom:1px solid #ddd">${escapeHtml(reservation.localidad)}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #ddd">Entradas</td><td style="padding:8px;border-bottom:1px solid #ddd">${escapeHtml(reservation.numero_entradas)}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #ddd">Valor total</td><td style="padding:8px;border-bottom:1px solid #ddd">${escapeHtml(formatCurrency(reservation.valor_total))}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #ddd">Lugar</td><td style="padding:8px;border-bottom:1px solid #ddd">${escapeHtml(eventPlace || 'No especificado')}</td></tr>
      </table>
      <p>Estado de la reserva: <strong>${created ? 'Registrada' : 'Cancelada'}</strong></p>
      <p style="color:#5d6678">Conserva este correo como comprobante de tu transacción.</p>
    </div>`;
  const transport = nodemailer.createTransport({
    host,
    port,
    secure: process.env.SMTP_SECURE === 'true' || port === 465,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    ...(user ? { auth: { user, pass } } : {})
  });

  await transport.sendMail({
    from,
    to: reservation.correo_electronico,
    subject,
    text: details,
    html
  });
  return { sent: true };
}

module.exports = { sendReservationEmail };
