require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { sendReservationEmail } = require('./email');

const app = express();
const port = Number(process.env.PORT) || 5000;
const serviceFeePerTicket = 4000;
const jwtSecret = process.env.JWT_SECRET;
const jwtExpiresIn = process.env.JWT_EXPIRES_IN || '1h';
const jwtCookieMaxAge = (() => {
  const match = /^([1-9]\d*)(s|m|h|d)$/.exec(jwtExpiresIn);
  if (!match) {
    throw new Error('JWT_EXPIRES_IN debe tener el formato 15m, 1h o 7d.');
  }
  const units = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return Number(match[1]) * units[match[2]];
})();
const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
);

if (!process.env.DATABASE_URL) {
  throw new Error('Falta configurar DATABASE_URL en el archivo .env.');
}

if (!jwtSecret || jwtSecret.length < 32) {
  throw new Error('JWT_SECRET debe tener al menos 32 caracteres.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

pool.on('error', (error) => {
  console.error('Error inesperado en una conexión inactiva de PostgreSQL:', error.message);
});

app.disable('x-powered-by');
app.use(helmet());
app.use(cookieParser());
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) {
      callback(null, true);
      return;
    }

    const error = new Error('Origen no permitido por la configuración de CORS.');
    error.status = 403;
    callback(error);
  },
  credentials: true
}));
app.use((req, res, next) => {
  const origin = req.get('origin');
  const changesState = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
  if (changesState && origin && !allowedOrigins.has(origin)) {
    res.status(403).json({ error: 'Origen no permitido.' });
    return;
  }
  next();
});
app.use(express.json({ limit: '16kb' }));

const authRateLimitOptions = {
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false
};
const registerLimiter = rateLimit(authRateLimitOptions);
const loginLimiter = rateLimit(authRateLimitOptions);

function createToken(person) {
  return jwt.sign(
    {
      sub: person.identificacion,
      role: person.role,
      ver: person.auth_version
    },
    jwtSecret,
    { expiresIn: jwtExpiresIn }
  );
}

function setAuthCookie(res, token) {
  res.cookie('eventix_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: jwtCookieMaxAge,
    path: '/api'
  });
}

function publicPerson(person) {
  return {
    identificacion: person.identificacion,
    nombres: person.nombres,
    apellidos: person.apellidos,
    correo_electronico: person.correo_electronico,
    role: person.role
  };
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function getAgentAccessError(role, approvalState) {
  if (role !== 'agente' || approvalState === 'aprobado') {
    return null;
  }
  if (approvalState === 'pendiente') {
    return { status: 403, message: 'Tu solicitud está pendiente de aprobación.' };
  }
  if (approvalState === 'rechazado') {
    return { status: 403, message: 'Tu solicitud fue rechazada.' };
  }
  return { status: 403, message: 'El acceso de agente no está aprobado.' };
}

async function authenticate(req, res, next) {
  const authorization = req.get('authorization');
  const token = req.cookies?.eventix_token ||
    (authorization && authorization.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : null);

  if (!token) {
    res.status(401).json({ error: 'Debes iniciar sesión para continuar.' });
    return;
  }

  let claims;
  try {
    claims = jwt.verify(token, jwtSecret);
  } catch {
    res.status(401).json({ error: 'La sesión expiró o no es válida.' });
    return;
  }

  try {
    const result = await pool.query(
      `SELECT p.auth_version,
              a.estado_aprobacion,
              CASE
                WHEN c.identificacion IS NOT NULL THEN 'cliente'
                WHEN a.identificacion IS NOT NULL THEN 'agente'
                WHEN ad.identificacion IS NOT NULL THEN 'administrador'
                ELSE NULL
              END AS role
       FROM persona p
       LEFT JOIN cliente c ON c.identificacion = p.identificacion
       LEFT JOIN agente a ON a.identificacion = p.identificacion
       LEFT JOIN administrador ad ON ad.identificacion = p.identificacion
       WHERE p.identificacion = $1
         AND p.cuenta_eliminada_at IS NULL`,
      [claims.sub]
    );

    const person = result.rows[0];
    if (!person || person.auth_version !== claims.ver || person.role !== claims.role) {
      res.status(401).json({ error: 'La sesión expiró o no es válida.' });
      return;
    }

    const accessError = getAgentAccessError(person.role, person.estado_aprobacion);
    if (accessError) {
      res.clearCookie('eventix_token', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/api'
      });
      res.status(accessError.status).json({ error: accessError.message });
      return;
    }

    req.user = { identificacion: claims.sub, role: person.role };
    next();
  } catch (error) {
    next(error);
  }
}

function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: 'No tienes permiso para realizar esta operación.' });
      return;
    }

    next();
  };
}

function parseInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function isValidLocalDateTime(value) {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) {
    return false;
  }

  const [date, time] = value.split('T');
  const [year, month, day] = date.split('-').map(Number);
  const [hours, minutes, seconds = 0] = time.split(':').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds));

  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day &&
    hours < 24 &&
    minutes < 60 &&
    seconds < 60;
}

// Motivo opcional de una cancelación: null si no se envía, undefined si no es válido.
function parseCancellationReason(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return undefined;
  const reason = value.trim();
  if (reason.length > 500) return undefined;
  return reason || null;
}

function parsePrice(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 99999999.99) {
    return null;
  }
  return Math.round(parsed * 100) / 100;
}

const eventSelect = `
  SELECT e.codigo_evento AS codigo,
         e.id_ciudad,
         ci.id_departamento,
         d.id_pais,
         e.nombre_evento AS nombre,
         e.descripcion,
         e.teatro,
         e.observaciones,
         e.fecha_hora_inicio AT TIME ZONE 'America/Bogota' AS fecha_hora_inicio,
         e.fecha_hora_fin_estimada AT TIME ZONE 'America/Bogota' AS fecha_hora_fin_estimada,
         e.capacidad_total,
         e.precio_base,
         e.capacidad_general,
         e.capacidad_vip,
         e.capacidad_preferencial,
         e.precio_vip,
         e.precio_preferencial,
         e.url_imagen,
         ee.id_estado_evento,
         ci.nombre AS ciudad,
         d.nombre AS departamento,
         p.nombre AS pais,
         ee.nombre AS estado
  FROM evento e
  JOIN ciudad ci ON ci.id_ciudad = e.id_ciudad
  JOIN departamento d ON d.id_departamento = ci.id_departamento
  JOIN pais p ON p.id_pais = d.id_pais
  JOIN estadoevento ee ON ee.id_estado_evento = e.id_estado_evento
`;

app.get('/api/health', asyncRoute(async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok' });
}));

app.get('/api/ciudades', asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT ci.id_ciudad, ci.nombre AS ciudad, d.nombre AS departamento
     FROM ciudad ci
     JOIN departamento d ON d.id_departamento = ci.id_departamento
     ORDER BY ci.nombre, d.nombre`
  );
  res.json({ ciudades: result.rows });
}));

app.get('/api/paises', asyncRoute(async (req, res) => {
  const result = await pool.query(
    'SELECT id_pais, nombre FROM pais ORDER BY nombre'
  );
  res.json({ paises: result.rows });
}));

app.get('/api/paises/:id_pais/departamentos', asyncRoute(async (req, res) => {
  const countryId = parseInteger(req.params.id_pais);
  if (!Number.isSafeInteger(countryId) || countryId < 1) {
    res.status(400).json({ error: 'El país seleccionado no es válido.' });
    return;
  }
  const result = await pool.query(
    `SELECT id_departamento, nombre
     FROM departamento
     WHERE id_pais = $1
     ORDER BY nombre`,
    [countryId]
  );
  res.json({ departamentos: result.rows });
}));

app.get('/api/departamentos/:id_departamento/ciudades', asyncRoute(async (req, res) => {
  const departmentId = parseInteger(req.params.id_departamento);
  if (!Number.isSafeInteger(departmentId) || departmentId < 1) {
    res.status(400).json({ error: 'El departamento seleccionado no es válido.' });
    return;
  }
  const result = await pool.query(
    `SELECT id_ciudad, nombre
     FROM ciudad
     WHERE id_departamento = $1
     ORDER BY nombre`,
    [departmentId]
  );
  res.json({ ciudades: result.rows });
}));

app.get('/api/eventos', asyncRoute(async (req, res) => {
  const result = await pool.query(
    `${eventSelect}
     WHERE LOWER(TRIM(ee.nombre)) NOT IN ('cancelado', 'cancelada', 'anulado', 'anulada')
     ORDER BY e.fecha_hora_inicio ASC`
  );
  res.json({ eventos: result.rows });
}));

app.get('/api/eventos/:codigo', asyncRoute(async (req, res) => {
  const detailSelect = eventSelect.replace(
    'e.url_imagen,',
    `e.url_imagen,
         GREATEST(e.capacidad_general - COALESCE(locality_reservations.general, 0), 0)::int AS disponible_general,
         GREATEST(e.capacidad_vip - COALESCE(locality_reservations.vip, 0), 0)::int AS disponible_vip,
         GREATEST(e.capacidad_preferencial - COALESCE(locality_reservations.preferencial, 0), 0)::int AS disponible_preferencial,`
  );
  const result = await pool.query(
    `${detailSelect}
     LEFT JOIN LATERAL (
       SELECT
         COALESCE(SUM(r.numero_entradas) FILTER (WHERE r.localidad = 'General'), 0)::int AS general,
         COALESCE(SUM(r.numero_entradas) FILTER (WHERE r.localidad = 'VIP'), 0)::int AS vip,
         COALESCE(SUM(r.numero_entradas) FILTER (WHERE r.localidad = 'Preferencial'), 0)::int AS preferencial
       FROM reserva r
       JOIN estadoreserva er ON er.id_estado_reserva = r.id_estado_reserva
       WHERE r.codigo_evento = e.codigo_evento
         AND LOWER(TRIM(er.nombre)) NOT IN ('cancelada', 'cancelado', 'anulada', 'anulado')
     ) locality_reservations ON TRUE
     WHERE e.codigo_evento = $1`,
    [req.params.codigo]
  );

  if (result.rowCount === 0) {
    res.status(404).json({ error: 'No se encontró el evento solicitado.' });
    return;
  }

  res.json({ evento: result.rows[0] });
}));

app.get('/api/agente/eventos', authenticate, authorize('agente'), asyncRoute(async (req, res) => {
  const agentEventSelect = eventSelect.replace(
    'e.url_imagen,',
    `e.url_imagen,
         e.identificacion_agente = $1 AS puede_editar,
         COALESCE(reservas.reservadas, 0) AS entradas_reservadas,`
  );
  const result = await pool.query(
    `${agentEventSelect}
     LEFT JOIN LATERAL (
       SELECT COALESCE(SUM(r.numero_entradas), 0)::int AS reservadas
       FROM reserva r
       JOIN estadoreserva er ON er.id_estado_reserva = r.id_estado_reserva
       WHERE r.codigo_evento = e.codigo_evento
         AND LOWER(TRIM(er.nombre)) NOT IN ('cancelada', 'cancelado', 'anulada', 'anulado')
     ) reservas ON TRUE
     ORDER BY e.fecha_hora_inicio DESC`,
    [req.user.identificacion]
  );
  res.json({ eventos: result.rows });
}));

app.get('/api/estados-evento', asyncRoute(async (req, res) => {
  const result = await pool.query(
    'SELECT id_estado_evento, nombre FROM estadoevento ORDER BY nombre'
  );
  res.json({ estados: result.rows });
}));

app.patch('/api/agente/eventos/:codigo/estado', authenticate, authorize('agente'), asyncRoute(async (req, res) => {
  const code = String(req.params.codigo || '').trim();
  const stateId = parseInteger(req.body && req.body.id_estado_evento);
  const reason = parseCancellationReason(req.body && req.body.motivo);
  if (!code || code.length > 50 || !Number.isSafeInteger(stateId) || stateId < 1) {
    res.status(400).json({ error: 'El código o estado del evento no es válido.' });
    return;
  }
  if (reason === undefined) {
    res.status(400).json({ error: 'El motivo debe ser un texto de máximo 500 caracteres.' });
    return;
  }

  // Al cancelar se guarda el motivo y la fecha; al salir de Cancelado se limpian.
  const result = await pool.query(
    `UPDATE evento e
     SET id_estado_evento = ee.id_estado_evento,
         motivo_cancelacion = CASE
           WHEN LOWER(TRIM(ee.nombre)) IN ('cancelado', 'cancelada', 'anulado', 'anulada')
             THEN COALESCE($4, e.motivo_cancelacion)
           ELSE NULL
         END,
         fecha_cancelacion = CASE
           WHEN LOWER(TRIM(ee.nombre)) IN ('cancelado', 'cancelada', 'anulado', 'anulada')
             THEN COALESCE(e.fecha_cancelacion, CURRENT_TIMESTAMP)
           ELSE NULL
         END
     FROM estadoevento ee
     WHERE e.codigo_evento = $1
       AND e.identificacion_agente = $2
       AND ee.id_estado_evento = $3
     RETURNING e.codigo_evento AS codigo, ee.id_estado_evento, ee.nombre AS estado,
               e.motivo_cancelacion, e.fecha_cancelacion`,
    [code, req.user.identificacion, stateId, reason]
  );
  if (result.rowCount === 0) {
    const event = await pool.query(
      `SELECT identificacion_agente
       FROM evento
       WHERE codigo_evento = $1`,
      [code]
    );
    if (event.rowCount === 0) {
      res.status(404).json({ error: 'No se encontró el evento solicitado.' });
      return;
    }
    if (event.rows[0].identificacion_agente !== req.user.identificacion) {
      res.status(403).json({ error: 'No tienes permiso para modificar este evento.' });
      return;
    }
    res.status(400).json({ error: 'El estado seleccionado no existe.' });
    return;
  }

  res.json({ evento: result.rows[0] });
}));

app.delete('/api/agente/eventos/:codigo', authenticate, authorize('agente'), asyncRoute(async (req, res) => {
  const code = String(req.params.codigo || '').trim();
  if (!code || code.length > 50) {
    res.status(400).json({ error: 'El código del evento no es válido.' });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const event = await client.query(
      `SELECT codigo_evento, identificacion_agente
       FROM evento
       WHERE codigo_evento = $1
       FOR UPDATE`,
      [code]
    );
    if (event.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'No se encontró el evento solicitado.' });
      return;
    }
    if (event.rows[0].identificacion_agente !== req.user.identificacion) {
      await client.query('ROLLBACK');
      res.status(403).json({ error: 'No tienes permiso para eliminar este evento.' });
      return;
    }

    const reservations = await client.query(
      'SELECT 1 FROM reserva WHERE codigo_evento = $1 LIMIT 1',
      [code]
    );
    if (reservations.rowCount > 0) {
      await client.query('ROLLBACK');
      res.status(409).json({
        error: 'No se puede eliminar un evento con reservas. Cambia su estado a Cancelado para conservar el historial.'
      });
      return;
    }

    await client.query(
      `DELETE FROM evento
       WHERE codigo_evento = $1 AND identificacion_agente = $2`,
      [code, req.user.identificacion]
    );
    await client.query('COMMIT');
    res.status(204).end();
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23503') {
      res.status(409).json({
        error: 'No se puede eliminar el evento porque existen registros asociados.'
      });
      return;
    }
    throw error;
  } finally {
    client.release();
  }
}));

app.put('/api/agente/eventos/:codigo', authenticate, authorize('agente'), asyncRoute(async (req, res) => {
  const body = req.body || {};
  const code = String(req.params.codigo || '').trim();
  const name = typeof body.nombre_evento === 'string' ? body.nombre_evento.trim() : '';
  const description = typeof body.descripcion === 'string' ? body.descripcion.trim() : '';
  const theater = typeof body.teatro === 'string' ? body.teatro.trim() : '';
  const observations = typeof body.observaciones === 'string' ? body.observaciones.trim() : '';
  const imageUrl = typeof body.url_imagen === 'string' ? body.url_imagen.trim() : '';
  const countryId = parseInteger(body.id_pais);
  const departmentId = parseInteger(body.id_departamento);
  const cityId = parseInteger(body.id_ciudad);
  const start = body.fecha_hora_inicio;
  const end = body.fecha_hora_fin_estimada;
  const generalCapacity = parseInteger(body.capacidad_general);
  const vipCapacity = parseInteger(body.capacidad_vip);
  const preferredCapacity = parseInteger(body.capacidad_preferencial);
  const totalCapacity = generalCapacity + vipCapacity + preferredCapacity;
  const basePrice = parsePrice(body.precio_base);
  const vipPrice = parsePrice(body.precio_vip);
  const preferredPrice = parsePrice(body.precio_preferencial);

  if (!code || code.length > 50 ||
      !name || name.length > 150 ||
      !description || description.length > 10000 ||
      !theater || theater.length > 150 ||
      !Number.isSafeInteger(countryId) || countryId < 1 ||
      !Number.isSafeInteger(departmentId) || departmentId < 1 ||
      !Number.isSafeInteger(cityId) || cityId < 1 ||
      !isValidLocalDateTime(start) ||
      !isValidLocalDateTime(end) ||
      end <= start ||
      !Number.isSafeInteger(generalCapacity) || generalCapacity < 0 ||
      !Number.isSafeInteger(vipCapacity) || vipCapacity < 0 ||
      !Number.isSafeInteger(preferredCapacity) || preferredCapacity < 0 ||
      totalCapacity < 1 || totalCapacity > 2147483647 ||
      basePrice === null || vipPrice === null || preferredPrice === null ||
      observations.length > 5000 ||
      imageUrl.length > 255 ||
      (imageUrl && !/^https?:\/\/\S+$/i.test(imageUrl))) {
    res.status(400).json({
      error: 'Revisa los datos del evento, la ubicación, las fechas, los precios y las capacidades.'
    });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const eventResult = await client.query(
      `SELECT codigo_evento, identificacion_agente
       FROM evento
       WHERE codigo_evento = $1
       FOR UPDATE`,
      [code]
    );
    if (eventResult.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'No se encontró el evento solicitado.' });
      return;
    }
    if (eventResult.rows[0].identificacion_agente !== req.user.identificacion) {
      await client.query('ROLLBACK');
      res.status(403).json({ error: 'No tienes permiso para editar este evento.' });
      return;
    }

    const cityResult = await client.query(
      `SELECT 1
       FROM ciudad ci
       JOIN departamento d ON d.id_departamento = ci.id_departamento
       WHERE ci.id_ciudad = $1
         AND d.id_departamento = $2
         AND d.id_pais = $3`,
      [cityId, departmentId, countryId]
    );
    if (cityResult.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'La ciudad no corresponde al departamento y país seleccionados.' });
      return;
    }

    const reservedResult = await client.query(
      `SELECT
         COALESCE(SUM(r.numero_entradas) FILTER (WHERE r.localidad = 'General'), 0)::int AS general,
         COALESCE(SUM(r.numero_entradas) FILTER (WHERE r.localidad = 'VIP'), 0)::int AS vip,
         COALESCE(SUM(r.numero_entradas) FILTER (WHERE r.localidad = 'Preferencial'), 0)::int AS preferencial
       FROM reserva r
       JOIN estadoreserva er ON er.id_estado_reserva = r.id_estado_reserva
       WHERE r.codigo_evento = $1
         AND LOWER(TRIM(er.nombre)) NOT IN ('cancelada', 'cancelado', 'anulada', 'anulado')`,
      [code]
    );
    const reserved = reservedResult.rows[0];
    if (generalCapacity < Number(reserved.general) ||
        vipCapacity < Number(reserved.vip) ||
        preferredCapacity < Number(reserved.preferencial)) {
      await client.query('ROLLBACK');
      res.status(409).json({
        error: 'No puedes reducir la capacidad de una localidad por debajo de las entradas ya reservadas.'
      });
      return;
    }

    const updateResult = await client.query(
      `UPDATE evento
       SET id_ciudad = $1,
           nombre_evento = $2,
           descripcion = $3,
           teatro = $4,
           fecha_hora_inicio = $5::timestamp,
           fecha_hora_fin_estimada = $6::timestamp,
           capacidad_total = $7,
           precio_base = $8,
           observaciones = $9,
           precio_vip = $10,
           precio_preferencial = $11,
           capacidad_general = $12,
           capacidad_vip = $13,
           capacidad_preferencial = $14,
           url_imagen = $15
       WHERE codigo_evento = $16 AND identificacion_agente = $17
       RETURNING codigo_evento AS codigo, nombre_evento AS nombre,
                 id_ciudad, teatro, capacidad_total, capacidad_general,
                 capacidad_vip, capacidad_preferencial, precio_base,
                 precio_vip, precio_preferencial`,
      [
        cityId, name, description, theater, start, end, totalCapacity,
        basePrice, observations || null, vipPrice, preferredPrice,
        generalCapacity, vipCapacity, preferredCapacity, imageUrl || null,
        code, req.user.identificacion
      ]
    );

    await client.query('COMMIT');
    res.json({ evento: updateResult.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

app.post('/api/eventos', authenticate, authorize('agente'), asyncRoute(async (req, res) => {
  const body = req.body || {};
  const code = typeof body.codigo_evento === 'string' ? body.codigo_evento.trim() : '';
  const name = typeof body.nombre_evento === 'string' ? body.nombre_evento.trim() : '';
  const description = typeof body.descripcion === 'string' ? body.descripcion.trim() : '';
  const theater = typeof body.teatro === 'string' ? body.teatro.trim() : '';
  const observations = typeof body.observaciones === 'string' ? body.observaciones.trim() : '';
  const imageUrl = typeof body.url_imagen === 'string' ? body.url_imagen.trim() : '';
  const cityId = parseInteger(body.id_ciudad);
  const start = body.fecha_hora_inicio;
  const end = body.fecha_hora_fin_estimada;
  const totalCapacity = parseInteger(body.capacidad_total);
  const generalCapacity = parseInteger(body.capacidad_general);
  const vipCapacity = parseInteger(body.capacidad_vip);
  const preferredCapacity = parseInteger(body.capacidad_preferencial);
  const basePrice = parsePrice(body.precio_base);
  const vipPrice = parsePrice(body.precio_vip);
  const preferredPrice = parsePrice(body.precio_preferencial);

  if (!code || code.length > 50 ||
      !name || name.length > 150 ||
      !description || description.length > 10000 ||
      !theater || theater.length > 150 ||
      !Number.isSafeInteger(cityId) || cityId < 1 || cityId > 2147483647 ||
      !isValidLocalDateTime(start) ||
      !isValidLocalDateTime(end) ||
      end <= start ||
      !Number.isSafeInteger(totalCapacity) || totalCapacity < 3 || totalCapacity > 2147483647 ||
      !Number.isSafeInteger(generalCapacity) || generalCapacity < 1 || generalCapacity > 2147483647 ||
      !Number.isSafeInteger(vipCapacity) || vipCapacity < 1 || vipCapacity > 2147483647 ||
      !Number.isSafeInteger(preferredCapacity) || preferredCapacity < 1 || preferredCapacity > 2147483647 ||
      generalCapacity + vipCapacity + preferredCapacity !== totalCapacity ||
      basePrice === null || vipPrice === null || preferredPrice === null ||
      observations.length > 5000 ||
      imageUrl.length > 255 ||
      (imageUrl && !/^https?:\/\/\S+$/i.test(imageUrl))) {
    res.status(400).json({
      error: 'Revisa los datos: completa las tres localidades con aforo mayor a cero, verifica que su suma sea la capacidad total y que los precios y fechas sean válidos.'
    });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const city = await client.query(
      'SELECT 1 FROM ciudad WHERE id_ciudad = $1',
      [cityId]
    );
    if (city.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'La ciudad seleccionada no existe.' });
      return;
    }

    const validDates = await client.query(
      `SELECT $1::timestamp > (CURRENT_TIMESTAMP AT TIME ZONE 'America/Bogota') AS start_is_future,
              $2::timestamp > $1::timestamp AS end_after_start`,
      [start, end]
    );
    if (!validDates.rows[0].start_is_future || !validDates.rows[0].end_after_start) {
      await client.query('ROLLBACK');
      res.status(400).json({
        error: 'La fecha de inicio debe estar en el futuro y la fecha de finalización debe ser posterior.'
      });
      return;
    }

    const state = await client.query(
      `SELECT id_estado_evento
       FROM estadoevento
       WHERE LOWER(TRIM(nombre)) = 'programado'
       LIMIT 1`
    );
    if (state.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(503).json({
        error: 'Configura el estado "Programado" en la tabla EstadoEvento antes de publicar eventos.'
      });
      return;
    }

    const event = await client.query(
      `INSERT INTO evento (
         codigo_evento,
         id_ciudad,
         id_estado_evento,
         identificacion_agente,
         nombre_evento,
         descripcion,
         teatro,
         fecha_hora_inicio,
         fecha_hora_fin_estimada,
         capacidad_total,
         precio_base,
         observaciones,
         precio_vip,
         precio_preferencial,
         capacidad_general,
         capacidad_vip,
         capacidad_preferencial,
         url_imagen
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7,
         $8::timestamp, $9::timestamp, $10, $11, $12, $13, $14, $15, $16, $17, $18
       )
       RETURNING codigo_evento AS codigo, nombre_evento AS nombre,
                 capacidad_total, capacidad_general, capacidad_vip,
                 capacidad_preferencial, precio_base, precio_vip,
                 precio_preferencial`,
      [
        code,
        cityId,
        state.rows[0].id_estado_evento,
        req.user.identificacion,
        name,
        description || null,
        theater,
        start,
        end,
        totalCapacity,
        basePrice,
        observations || null,
        vipPrice,
        preferredPrice,
        generalCapacity,
        vipCapacity,
        preferredCapacity,
        imageUrl || null
      ]
    );

    await client.query('COMMIT');
    res.status(201).json({ evento: event.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') {
      res.status(409).json({ error: 'Ya existe un evento con ese código.' });
      return;
    }
    throw error;
  } finally {
    client.release();
  }
}));

const registerHandler = asyncRoute(async (req, res) => {
  const body = req.body || {};
  const {
    identificacion,
    nombre_completo: fullName,
    nombres: givenNames,
    apellidos,
    correo,
    correo_electronico: emailAddress,
    numero_telefono: phone,
    id_ciudad: cityIdValue,
    direccion,
    contrasena: password,
    rol: requestedRole,
    role: requestedEnglishRole
  } = body;

  const email = String(correo || emailAddress || '').trim().toLowerCase();
  const role = String(requestedRole || requestedEnglishRole || 'cliente').trim().toLowerCase();
  const id = String(identificacion || body.num_identificacion || '').trim();
  const cityId = parseInteger(cityIdValue);
  const nameParts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  const names = String(givenNames || nameParts.shift() || '').trim();
  const surnames = String(apellidos || nameParts.join(' ')).trim();

  let validationError = null;
  if (role === 'administrador') {
    validationError = 'No es posible registrar una cuenta de administrador.';
  } else if (!['cliente', 'agente'].includes(role)) {
    validationError = 'Selecciona un tipo de cuenta válido.';
  } else if (!id || id.length > 20) {
    validationError = 'Ingresa una identificación de hasta 20 caracteres.';
  } else if (!names || !surnames) {
    validationError = 'Ingresa tu nombre y apellido.';
  } else if (names.length > 100 || surnames.length > 100) {
    validationError = 'El nombre y el apellido deben tener máximo 100 caracteres cada uno.';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 150) {
    validationError = 'Ingresa un correo electrónico válido de máximo 150 caracteres.';
  } else if (!Number.isSafeInteger(cityId) || cityId < 1) {
    validationError = 'Selecciona una ciudad válida.';
  } else if (typeof password !== 'string' ||
      Array.from(password).length < 8 ||
      Buffer.byteLength(password, 'utf8') < 8 ||
      Buffer.byteLength(password, 'utf8') > 72) {
    validationError = 'La contraseña debe tener al menos 8 caracteres y máximo 72 bytes.';
  } else if (!phone || String(phone).trim().length > 20) {
    validationError = 'Ingresa un teléfono de hasta 20 caracteres.';
  } else if (direccion && String(direccion).trim().length > 150) {
    validationError = 'La dirección no puede superar los 150 caracteres.';
  }

  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const city = await client.query(
      'SELECT 1 FROM ciudad WHERE id_ciudad = $1',
      [cityId]
    );
    if (city.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'La ciudad seleccionada no existe.' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await client.query(
      `INSERT INTO persona
         (identificacion, id_ciudad, nombres, apellidos, correo_electronico, calle, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, cityId, names, surnames, email, direccion ? String(direccion).trim() : null, passwordHash]
    );
    await client.query(
      'INSERT INTO personatelefono (identificacion, telefono) VALUES ($1, $2)',
      [id, String(phone).trim()]
    );
    if (role === 'cliente') {
      await client.query(
        'INSERT INTO cliente (identificacion, cantidad_puntos) VALUES ($1, 0)',
        [id]
      );
    } else {
      await client.query(
        `INSERT INTO agente (identificacion, estado_aprobacion)
         VALUES ($1, 'pendiente')`,
        [id]
      );
    }

    const user = {
      identificacion: id,
      nombres: names,
      apellidos: surnames,
      correo_electronico: email,
      role,
      auth_version: 0
    };

    await client.query('COMMIT');
    if (role === 'agente') {
      res.status(201).json({
        solicitud_enviada: true,
        mensaje: 'Solicitud enviada, pendiente de aprobación.'
      });
      return;
    }

    const token = createToken(user);
    setAuthCookie(res, token);
    res.status(201).json({ usuario: publicPerson(user) });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') {
      res.status(409).json({ error: 'La identificación o el correo ya están registrados.' });
      return;
    }
    throw error;
  } finally {
    client.release();
  }
});

app.post(['/api/auth/register', '/api/auth/registro'], registerLimiter, registerHandler);

app.post('/api/auth/login', loginLimiter, asyncRoute(async (req, res) => {
  const body = req.body || {};
  const email = String(body.correo || body.correo_electronico || '').trim().toLowerCase();
  const password = body.contrasena;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      typeof password !== 'string' || !password ||
      Buffer.byteLength(password, 'utf8') > 72) {
    res.status(400).json({ error: 'Ingresa un correo y una contraseña válidos.' });
    return;
  }

  const result = await pool.query(
    `SELECT p.identificacion, p.nombres, p.apellidos, p.correo_electronico,
            p.password_hash, p.auth_version,
            a.estado_aprobacion,
            CASE
              WHEN c.identificacion IS NOT NULL THEN 'cliente'
              WHEN a.identificacion IS NOT NULL THEN 'agente'
              WHEN ad.identificacion IS NOT NULL THEN 'administrador'
              ELSE NULL
            END AS role
     FROM persona p
     LEFT JOIN cliente c ON c.identificacion = p.identificacion
     LEFT JOIN agente a ON a.identificacion = p.identificacion
     LEFT JOIN administrador ad ON ad.identificacion = p.identificacion
     WHERE LOWER(TRIM(p.correo_electronico)) = $1
       AND p.cuenta_eliminada_at IS NULL`,
    [email]
  );
  const person = result.rows[0];

  if (!person || !person.password_hash || !person.role ||
      !(await bcrypt.compare(password, person.password_hash))) {
    res.status(401).json({ error: 'Credenciales inválidas' });
    return;
  }

  const accessError = getAgentAccessError(person.role, person.estado_aprobacion);
  if (accessError) {
    res.status(accessError.status).json({ error: accessError.message });
    return;
  }

  setAuthCookie(res, createToken(person));
  res.json({ usuario: publicPerson(person) });
}));

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('eventix_token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api'
  });
  res.status(204).end();
});

app.get('/api/auth/me', authenticate, asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT identificacion, nombres, apellidos, correo_electronico
     FROM persona
     WHERE identificacion = $1`,
    [req.user.identificacion]
  );
  if (result.rowCount === 0) {
    res.status(401).json({ error: 'La sesión expiró o no es válida.' });
    return;
  }
  res.json({ usuario: publicPerson({ ...result.rows[0], role: req.user.role }) });
}));

app.get('/api/perfil', authenticate, asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT p.identificacion, p.nombres, p.apellidos,
            p.correo_electronico, p.calle, p.id_ciudad,
            ci.nombre AS ciudad, d.nombre AS departamento,
            country.nombre AS pais, phone.telefono,
            $2::text AS role
     FROM persona p
     LEFT JOIN ciudad ci ON ci.id_ciudad = p.id_ciudad
     LEFT JOIN departamento d ON d.id_departamento = ci.id_departamento
     LEFT JOIN pais country ON country.id_pais = d.id_pais
     LEFT JOIN LATERAL (
       SELECT telefono
       FROM personatelefono
       WHERE identificacion = p.identificacion
       ORDER BY telefono
       LIMIT 1
     ) phone ON TRUE
     WHERE p.identificacion = $1
       AND p.cuenta_eliminada_at IS NULL`,
    [req.user.identificacion, req.user.role]
  );
  if (result.rowCount === 0) {
    res.status(404).json({ error: 'No se encontró la información del perfil.' });
    return;
  }
  res.json({ perfil: result.rows[0] });
}));

app.put('/api/perfil', authenticate, asyncRoute(async (req, res) => {
  const body = req.body || {};
  const names = typeof body.nombres === 'string' ? body.nombres.trim() : '';
  const surnames = typeof body.apellidos === 'string' ? body.apellidos.trim() : '';
  const email = typeof body.correo_electronico === 'string'
    ? body.correo_electronico.trim().toLowerCase()
    : '';
  const phone = typeof body.telefono === 'string' ? body.telefono.trim() : '';
  const address = typeof body.calle === 'string' ? body.calle.trim() : '';
  const cityId = parseInteger(body.id_ciudad);

  if (!names || names.length > 100 || !surnames || surnames.length > 100 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 150 ||
      !phone || phone.length > 20 || address.length > 150 ||
      !Number.isSafeInteger(cityId) || cityId < 1) {
    res.status(400).json({
      error: 'Revisa nombres, apellidos, correo, teléfono, dirección y ciudad.'
    });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const account = await client.query(
      `SELECT identificacion
       FROM persona
       WHERE identificacion = $1
         AND cuenta_eliminada_at IS NULL
       FOR UPDATE`,
      [req.user.identificacion]
    );
    if (account.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'La cuenta ya no está disponible.' });
      return;
    }

    const city = await client.query(
      'SELECT 1 FROM ciudad WHERE id_ciudad = $1',
      [cityId]
    );
    if (city.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'La ciudad seleccionada no existe.' });
      return;
    }

    await client.query(
      `UPDATE persona
       SET nombres = $1,
           apellidos = $2,
           correo_electronico = $3,
           calle = $4,
           id_ciudad = $5
       WHERE identificacion = $6`,
      [names, surnames, email, address || null, cityId, req.user.identificacion]
    );
    await client.query(
      'DELETE FROM personatelefono WHERE identificacion = $1',
      [req.user.identificacion]
    );
    await client.query(
      'INSERT INTO personatelefono (identificacion, telefono) VALUES ($1, $2)',
      [req.user.identificacion, phone]
    );
    await client.query('COMMIT');

    res.json({
      perfil: {
        identificacion: req.user.identificacion,
        nombres: names,
        apellidos: surnames,
        correo_electronico: email,
        telefono: phone,
        calle: address || null,
        id_ciudad: cityId,
        role: req.user.role
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') {
      res.status(409).json({ error: 'El correo electrónico ya está registrado.' });
      return;
    }
    throw error;
  } finally {
    client.release();
  }
}));

app.delete('/api/perfil', authenticate, asyncRoute(async (req, res) => {
  const password = req.body && req.body.contrasena;
  if (typeof password !== 'string' || !password ||
      Buffer.byteLength(password, 'utf8') > 72) {
    res.status(400).json({ error: 'Ingresa tu contraseña para confirmar la eliminación.' });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const accountResult = await client.query(
      `SELECT p.password_hash,
              CASE
                WHEN ad.identificacion IS NOT NULL THEN 'administrador'
                WHEN a.identificacion IS NOT NULL THEN 'agente'
                WHEN c.identificacion IS NOT NULL THEN 'cliente'
                ELSE NULL
              END AS role
       FROM persona p
       LEFT JOIN administrador ad ON ad.identificacion = p.identificacion
       LEFT JOIN agente a ON a.identificacion = p.identificacion
       LEFT JOIN cliente c ON c.identificacion = p.identificacion
       WHERE p.identificacion = $1
         AND p.cuenta_eliminada_at IS NULL
       FOR UPDATE OF p`,
      [req.user.identificacion]
    );
    const account = accountResult.rows[0];
    if (!account || account.role !== req.user.role) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'La cuenta ya no está disponible.' });
      return;
    }
    if (!account.password_hash || !(await bcrypt.compare(password, account.password_hash))) {
      await client.query('ROLLBACK');
      res.status(401).json({ error: 'La contraseña no es correcta.' });
      return;
    }

    if (account.role === 'administrador') {
      await client.query('LOCK TABLE administrador IN EXCLUSIVE MODE');
      const admins = await client.query(
        `SELECT COUNT(*)::int AS total
         FROM administrador ad
         JOIN persona p ON p.identificacion = ad.identificacion
         WHERE p.cuenta_eliminada_at IS NULL`
      );
      if (admins.rows[0].total <= 1) {
        await client.query('ROLLBACK');
        res.status(409).json({
          error: 'No puedes eliminar la cuenta del último administrador activo.'
        });
        return;
      }
    }

    const anonymizedEmail = `eliminada+${crypto.randomUUID()}@eventix.invalid`;
    await client.query(
      `UPDATE persona
       SET nombres = 'Cuenta eliminada',
           apellidos = '',
           correo_electronico = $1,
           calle = NULL,
           password_hash = NULL,
           cuenta_eliminada_at = CURRENT_TIMESTAMP,
           auth_version = auth_version + 1
       WHERE identificacion = $2`,
      [anonymizedEmail, req.user.identificacion]
    );
    await client.query(
      'DELETE FROM personatelefono WHERE identificacion = $1',
      [req.user.identificacion]
    );
    await client.query('COMMIT');

    res.clearCookie('eventix_token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api'
    });
    res.status(204).end();
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

app.get('/api/agente/reservas', authenticate, authorize('agente'), asyncRoute(async (req, res) => {
  // fecha_hora_reserva es TIMESTAMP sin zona y se llena con CURRENT_TIMESTAMP
  // en una base configurada en UTC; se convierte para enviar el instante real.
  const [reservations, occupancy] = await Promise.all([
    pool.query(
      `SELECT r.id_reserva,
              r.fecha_hora_reserva AT TIME ZONE 'UTC' AS fecha_hora_reserva,
              r.valor_total, r.numero_entradas, r.localidad,
              er.id_estado_reserva, er.nombre AS estado,
              e.codigo_evento AS codigo, e.nombre_evento AS evento,
              TRIM(p.nombres || ' ' || p.apellidos) AS cliente
       FROM reserva r
       JOIN estadoreserva er ON er.id_estado_reserva = r.id_estado_reserva
       JOIN evento e ON e.codigo_evento = r.codigo_evento
       JOIN persona p ON p.identificacion = r.identificacion_cliente
       WHERE e.identificacion_agente = $1
       ORDER BY r.fecha_hora_reserva DESC, r.id_reserva DESC`,
      [req.user.identificacion]
    ),
    // Ocupación y ventas por evento. Las reservas canceladas no ocupan cupo
    // ni cuentan como ingreso; se informan aparte.
    pool.query(
      `SELECT e.codigo_evento AS codigo, e.nombre_evento AS evento,
              ee.nombre AS estado,
              e.fecha_hora_inicio AT TIME ZONE 'America/Bogota' AS fecha_hora_inicio,
              e.capacidad_total, e.capacidad_general,
              e.capacidad_vip, e.capacidad_preferencial,
              COALESCE(ventas.vendidas_general, 0)::int AS vendidas_general,
              COALESCE(ventas.vendidas_vip, 0)::int AS vendidas_vip,
              COALESCE(ventas.vendidas_preferencial, 0)::int AS vendidas_preferencial,
              COALESCE(ventas.reservas_activas, 0)::int AS reservas_activas,
              COALESCE(ventas.reservas_canceladas, 0)::int AS reservas_canceladas,
              COALESCE(ventas.ingresos, 0)::numeric AS ingresos
       FROM evento e
       JOIN estadoevento ee ON ee.id_estado_evento = e.id_estado_evento
       LEFT JOIN LATERAL (
         SELECT
           SUM(x.numero_entradas) FILTER (WHERE x.activa AND x.localidad = 'General') AS vendidas_general,
           SUM(x.numero_entradas) FILTER (WHERE x.activa AND x.localidad = 'VIP') AS vendidas_vip,
           SUM(x.numero_entradas) FILTER (WHERE x.activa AND x.localidad = 'Preferencial') AS vendidas_preferencial,
           COUNT(*) FILTER (WHERE x.activa) AS reservas_activas,
           COUNT(*) FILTER (WHERE NOT x.activa) AS reservas_canceladas,
           SUM(x.valor_total) FILTER (WHERE x.activa) AS ingresos
         FROM (
           SELECT r.numero_entradas, r.localidad, r.valor_total,
                  LOWER(TRIM(er.nombre)) NOT IN ('cancelada', 'cancelado', 'anulada', 'anulado') AS activa
           FROM reserva r
           JOIN estadoreserva er ON er.id_estado_reserva = r.id_estado_reserva
           WHERE r.codigo_evento = e.codigo_evento
         ) x
       ) ventas ON TRUE
       WHERE e.identificacion_agente = $1
       ORDER BY e.fecha_hora_inicio, e.codigo_evento`,
      [req.user.identificacion]
    )
  ]);
  res.set('Cache-Control', 'no-store');
  res.json({
    reservas: reservations.rows,
    eventos: occupancy.rows,
    actualizado_en: new Date().toISOString()
  });
}));

app.get('/api/agente/estados-reserva', authenticate, authorize('agente'), asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT id_estado_reserva, nombre
     FROM estadoreserva
     ORDER BY id_estado_reserva`
  );
  res.json({ estados: result.rows });
}));

app.patch('/api/agente/reservas/:id', authenticate, authorize('agente'), asyncRoute(async (req, res) => {
  const reservationId = parseInteger(req.params.id);
  const state = typeof req.body?.estado === 'string' ? req.body.estado.trim() : '';
  const reason = parseCancellationReason(req.body?.motivo);
  if (!reservationId || reservationId < 1 || !state || state.length > 50) {
    res.status(400).json({ error: 'El identificador o el estado de la reserva no es válido.' });
    return;
  }
  if (reason === undefined) {
    res.status(400).json({ error: 'El motivo debe ser un texto de máximo 500 caracteres.' });
    return;
  }

  // Al cancelar se guarda el motivo y la fecha; al reactivar se limpian.
  const result = await pool.query(
    `WITH selected_state AS (
       SELECT id_estado_reserva,
              LOWER(TRIM(nombre)) IN ('cancelada', 'cancelado', 'anulada', 'anulado') AS cancelada
       FROM estadoreserva
       WHERE LOWER(TRIM(nombre)) = LOWER(TRIM($2))
       ORDER BY id_estado_reserva
       LIMIT 1
     )
     UPDATE reserva r
     SET id_estado_reserva = selected_state.id_estado_reserva,
         motivo_cancelacion = CASE
           WHEN selected_state.cancelada THEN COALESCE($4, r.motivo_cancelacion)
           ELSE NULL
         END,
         fecha_cancelacion = CASE
           WHEN selected_state.cancelada THEN COALESCE(r.fecha_cancelacion, CURRENT_TIMESTAMP)
           ELSE NULL
         END
     FROM selected_state, evento e
     WHERE r.id_reserva = $1
       AND e.codigo_evento = r.codigo_evento
       AND e.identificacion_agente = $3
     RETURNING r.id_reserva, r.id_estado_reserva, r.motivo_cancelacion, r.fecha_cancelacion`,
    [reservationId, state, req.user.identificacion, reason]
  );
  if (result.rowCount === 0) {
    res.status(404).json({ error: 'No se encontró la reserva o el estado solicitado.' });
    return;
  }
  res.json({ reserva: result.rows[0] });
}));

const adminUserRoles = new Set(['cliente', 'agente', 'administrador']);

function validateAdminUser(body, isNew) {
  const identification = String(body.identificacion || '').trim();
  const names = String(body.nombres || '').trim();
  const surnames = String(body.apellidos || '').trim();
  const email = String(body.correo_electronico || '').trim().toLowerCase();
  const phone = String(body.telefono || '').trim();
  const address = String(body.calle || '').trim();
  const role = String(body.role || '').trim().toLowerCase();
  const cityId = parseInteger(body.id_ciudad);
  const password = body.contrasena;

  if ((!identification && isNew) || identification.length > 20 ||
      !names || names.length > 100 || !surnames || surnames.length > 100 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 150 ||
      !phone || phone.length > 20 || address.length > 150 ||
      !adminUserRoles.has(role) || !Number.isSafeInteger(cityId) || cityId < 1 ||
      (isNew && (typeof password !== 'string' ||
        Array.from(password).length < 8 ||
        Buffer.byteLength(password, 'utf8') < 8 ||
        Buffer.byteLength(password, 'utf8') > 72)) ||
      (!isNew && password !== undefined && password !== '' &&
        (typeof password !== 'string' ||
          Array.from(password).length < 8 ||
          Buffer.byteLength(password, 'utf8') < 8 ||
          Buffer.byteLength(password, 'utf8') > 72))) {
    return { error: 'Revisa identificación, nombres, apellidos, correo, teléfono, ciudad, rol y contraseña.' };
  }

  return {
    identification,
    names,
    surnames,
    email,
    phone,
    address,
    role,
    cityId,
    password: password || ''
  };
}

function accountRoleSql(alias) {
  return `CASE
    WHEN ${alias}.identificacion IS NOT NULL THEN 'administrador'
    WHEN agent.identificacion IS NOT NULL THEN 'agente'
    WHEN client.identificacion IS NOT NULL THEN 'cliente'
    ELSE NULL
  END`;
}

const agentApprovalStates = new Set(['pendiente', 'aprobado', 'rechazado', 'todas']);

const agentRequestSelect = `
  SELECT a.identificacion, p.nombres, p.apellidos,
         p.correo_electronico, ci.nombre AS ciudad,
         ARRAY(
           SELECT telefono
           FROM personatelefono
           WHERE identificacion = p.identificacion
           ORDER BY telefono
         ) AS telefonos,
         a.experiencia, a.comision, a.estado_aprobacion,
         a.fecha_solicitud, a.fecha_resolucion, a.resuelto_por,
         a.motivo_rechazo,
         COALESCE(event_counts.eventos_total, 0)::integer AS eventos_total,
         COALESCE(event_counts.eventos_activos, 0)::integer AS eventos_activos
  FROM agente a
  JOIN persona p ON p.identificacion = a.identificacion
  LEFT JOIN ciudad ci ON ci.id_ciudad = p.id_ciudad
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::integer AS eventos_total,
           COUNT(*) FILTER (
             WHERE LOWER(TRIM(ee.nombre)) NOT IN ('cancelado', 'cancelada', 'anulado', 'anulada')
           )::integer AS eventos_activos
    FROM evento e
    JOIN estadoevento ee ON ee.id_estado_evento = e.id_estado_evento
    WHERE e.identificacion_agente = a.identificacion
  ) event_counts ON TRUE`;

app.get('/api/admin/solicitudes-agente/contador', authenticate, authorize('administrador'), asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT COUNT(*)::integer AS pendientes
     FROM agente a
     JOIN persona p ON p.identificacion = a.identificacion
     WHERE a.estado_aprobacion = 'pendiente'
       AND p.cuenta_eliminada_at IS NULL`
  );
  res.json({ pendientes: result.rows[0].pendientes });
}));

app.get('/api/admin/solicitudes-agente', authenticate, authorize('administrador'), asyncRoute(async (req, res) => {
  const state = req.query.estado === undefined
    ? 'pendiente'
    : String(req.query.estado).trim().toLowerCase();
  if (!agentApprovalStates.has(state)) {
    res.status(400).json({ error: 'El estado solicitado no es válido.' });
    return;
  }

  const result = await pool.query(
    `${agentRequestSelect}
     WHERE p.cuenta_eliminada_at IS NULL
       AND ($1::text IS NULL OR a.estado_aprobacion = $1)
     ORDER BY a.fecha_solicitud DESC, a.identificacion`,
    [state === 'todas' ? null : state]
  );
  res.json({ solicitudes: result.rows });
}));

app.get('/api/admin/solicitudes-agente/:identificacion', authenticate, authorize('administrador'), asyncRoute(async (req, res) => {
  const identification = String(req.params.identificacion || '').trim();
  if (!identification || identification.length > 20) {
    res.status(400).json({ error: 'La identificación no es válida.' });
    return;
  }

  const result = await pool.query(
    `${agentRequestSelect}
     WHERE a.identificacion = $1
       AND p.cuenta_eliminada_at IS NULL`,
    [identification]
  );
  if (result.rowCount === 0) {
    res.status(404).json({ error: 'No se encontró la solicitud de agente.' });
    return;
  }
  res.json({ solicitud: result.rows[0] });
}));

app.get('/api/admin/usuarios/:identificacion/eventos', authenticate, authorize('administrador'), asyncRoute(async (req, res) => {
  const identification = String(req.params.identificacion || '').trim();
  if (!identification || identification.length > 20) {
    res.status(400).json({ error: 'La identificación no es válida.' });
    return;
  }

  const result = await pool.query(
    `SELECT e.codigo_evento AS codigo, e.nombre_evento AS nombre,
            e.fecha_hora_inicio, ee.nombre AS estado,
            COUNT(r.id_reserva)::integer AS reservas
     FROM evento e
     JOIN estadoevento ee ON ee.id_estado_evento = e.id_estado_evento
     LEFT JOIN reserva r ON r.codigo_evento = e.codigo_evento
     WHERE e.identificacion_agente = $1
     GROUP BY e.codigo_evento, ee.nombre
     ORDER BY e.fecha_hora_inicio DESC, e.codigo_evento`,
    [identification]
  );
  res.json({ eventos: result.rows });
}));

async function resolveAgentApproval(req, res, nextState, expectedState, nextHandler) {
  const identification = String(req.params.identificacion || '').trim();
  if (!identification || identification.length > 20) {
    res.status(400).json({ error: 'La identificación no es válida.' });
    return;
  }

  let reason = null;
  if (nextState === 'rechazado') {
    const suppliedReason = req.body && req.body.motivo;
    if (suppliedReason !== undefined && typeof suppliedReason !== 'string') {
      res.status(400).json({ error: 'El motivo debe ser texto.' });
      return;
    }
    reason = typeof suppliedReason === 'string' ? suppliedReason.trim() : null;
    if (reason && reason.length > 1000) {
      res.status(400).json({ error: 'El motivo no puede superar 1000 caracteres.' });
      return;
    }
    reason = reason || null;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE agente
       SET estado_aprobacion = $2,
           fecha_resolucion = CURRENT_TIMESTAMP,
           resuelto_por = $3,
           motivo_rechazo = $4
       WHERE identificacion = $1
         AND estado_aprobacion = $5
       RETURNING identificacion, estado_aprobacion,
                 fecha_resolucion, resuelto_por, motivo_rechazo`,
      [identification, nextState, req.user.identificacion, reason, expectedState]
    );

    if (result.rowCount === 0) {
      const current = await client.query(
        'SELECT estado_aprobacion FROM agente WHERE identificacion = $1',
        [identification]
      );
      await client.query('ROLLBACK');
      if (current.rowCount === 0) {
        res.status(404).json({ error: 'No se encontró la solicitud de agente.' });
      } else {
        res.status(409).json({ error: 'La solicitud ya fue resuelta o el acceso ya cambió.' });
      }
      return;
    }

    await client.query('COMMIT');
    res.json({ solicitud: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    nextHandler(error);
  } finally {
    client.release();
  }
}

app.post('/api/admin/solicitudes-agente/:identificacion/aprobar', authenticate, authorize('administrador'), asyncRoute(async (req, res, next) => {
  await resolveAgentApproval(req, res, 'aprobado', 'pendiente', next);
}));

app.post('/api/admin/solicitudes-agente/:identificacion/rechazar', authenticate, authorize('administrador'), asyncRoute(async (req, res, next) => {
  await resolveAgentApproval(req, res, 'rechazado', 'pendiente', next);
}));

app.post('/api/admin/solicitudes-agente/:identificacion/revocar', authenticate, authorize('administrador'), asyncRoute(async (req, res, next) => {
  await resolveAgentApproval(req, res, 'rechazado', 'aprobado', next);
}));

app.post('/api/admin/solicitudes-agente/:identificacion/reactivar', authenticate, authorize('administrador'), asyncRoute(async (req, res, next) => {
  await resolveAgentApproval(req, res, 'aprobado', 'rechazado', next);
}));

app.post('/api/admin/agentes/:identificacion/reasignar-eventos', authenticate, authorize('administrador'), asyncRoute(async (req, res) => {
  const sourceId = String(req.params.identificacion || '').trim();
  const body = req.body || {};
  const destinationId = typeof body.identificacion_destino === 'string'
    ? body.identificacion_destino.trim()
    : '';
  const selectedCodes = body.codigos_evento;
  if (!sourceId || sourceId.length > 20 ||
      !destinationId || destinationId.length > 20 ||
      sourceId === destinationId ||
      (selectedCodes !== undefined &&
        (!Array.isArray(selectedCodes) || selectedCodes.length === 0 ||
          selectedCodes.length > 500 ||
          selectedCodes.some((code) => typeof code !== 'string' || !code.trim() || code.trim().length > 50) ||
          new Set(selectedCodes.map((code) => code.trim())).size !== selectedCodes.length))) {
    res.status(400).json({ error: 'El agente de destino o la selección de eventos no es válida.' });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const agents = await client.query(
      `SELECT identificacion, estado_aprobacion
       FROM agente
       WHERE identificacion = ANY($1::varchar[])
       ORDER BY identificacion
       FOR UPDATE`,
      [[sourceId, destinationId]]
    );
    const source = agents.rows.find((agent) => agent.identificacion === sourceId);
    const destination = agents.rows.find((agent) => agent.identificacion === destinationId);
    if (!source || !destination) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'No se encontró el agente de origen o destino.' });
      return;
    }
    if (destination.estado_aprobacion !== 'aprobado') {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'El agente de destino debe estar aprobado.' });
      return;
    }

    const ownedEvents = await client.query(
      `SELECT codigo_evento
       FROM evento
       WHERE identificacion_agente = $1
         AND ($2::varchar[] IS NULL OR codigo_evento = ANY($2::varchar[]))
       ORDER BY codigo_evento
       FOR UPDATE`,
      [sourceId, selectedCodes === undefined ? null : selectedCodes.map((code) => code.trim())]
    );
    if (selectedCodes !== undefined && ownedEvents.rowCount !== selectedCodes.length) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'Uno o más eventos no pertenecen al agente de origen.' });
      return;
    }
    if (ownedEvents.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'El agente de origen no tiene eventos para reasignar.' });
      return;
    }

    const codes = ownedEvents.rows.map((event) => event.codigo_evento);
    const reassigned = await client.query(
      `UPDATE evento
       SET identificacion_agente = $2
       WHERE identificacion_agente = $1
         AND codigo_evento = ANY($3::varchar[])
       RETURNING codigo_evento`,
      [sourceId, destinationId, codes]
    );
    if (reassigned.rowCount !== codes.length) {
      throw new Error('No fue posible reasignar todos los eventos seleccionados.');
    }

    const remaining = await client.query(
      `SELECT COUNT(*)::integer AS total
       FROM evento
       WHERE identificacion_agente = $1
         AND codigo_evento = ANY($2::varchar[])`,
      [sourceId, codes]
    );
    if (remaining.rows[0].total !== 0) {
      throw new Error('La reasignación dejó eventos vinculados al agente de origen.');
    }

    await client.query('COMMIT');
    res.json({
      eventos_reasignados: reassigned.rowCount,
      codigos_evento: reassigned.rows.map((event) => event.codigo_evento)
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

app.get('/api/admin/usuarios', authenticate, authorize('administrador'), asyncRoute(async (req, res) => {
  const role = req.query.rol ? String(req.query.rol).trim().toLowerCase() : null;
  if (role && !adminUserRoles.has(role)) {
    res.status(400).json({ error: 'El rol solicitado no es válido.' });
    return;
  }

  const result = await pool.query(
    `WITH usuarios AS (
       SELECT p.identificacion, p.nombres, p.apellidos,
              p.correo_electronico, p.calle, p.id_ciudad,
              ci.nombre AS ciudad,
              d.nombre AS departamento,
              country.nombre AS pais,
              phone.telefono,
              ${accountRoleSql('admin')} AS role,
              agent.estado_aprobacion,
              COALESCE(event_counts.eventos_total, 0)::integer AS eventos_total,
              COALESCE(event_counts.eventos_activos, 0)::integer AS eventos_activos
       FROM persona p
       LEFT JOIN cliente client ON client.identificacion = p.identificacion
       LEFT JOIN agente agent ON agent.identificacion = p.identificacion
       LEFT JOIN administrador admin ON admin.identificacion = p.identificacion
       LEFT JOIN ciudad ci ON ci.id_ciudad = p.id_ciudad
       LEFT JOIN departamento d ON d.id_departamento = ci.id_departamento
       LEFT JOIN pais country ON country.id_pais = d.id_pais
       LEFT JOIN LATERAL (
         SELECT telefono
         FROM personatelefono
         WHERE identificacion = p.identificacion
         ORDER BY telefono
         LIMIT 1
       ) phone ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::integer AS eventos_total,
                COUNT(*) FILTER (
                  WHERE LOWER(TRIM(event_state.nombre)) NOT IN ('cancelado', 'cancelada', 'anulado', 'anulada')
                )::integer AS eventos_activos
         FROM evento agent_event
         JOIN estadoevento event_state
           ON event_state.id_estado_evento = agent_event.id_estado_evento
         WHERE agent_event.identificacion_agente = agent.identificacion
       ) event_counts ON TRUE
       WHERE p.cuenta_eliminada_at IS NULL
       )
     SELECT * FROM usuarios
     WHERE role IS NOT NULL AND ($1::text IS NULL OR role = $1)
     ORDER BY nombres, apellidos, identificacion`,
    [role]
  );
  res.json({ usuarios: result.rows });
}));

app.post('/api/admin/usuarios', authenticate, authorize('administrador'), asyncRoute(async (req, res) => {
  const user = validateAdminUser(req.body || {}, true);
  if (user.error) {
    res.status(400).json({ error: user.error });
    return;
  }
  const passwordHash = await bcrypt.hash(user.password, 12);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const city = await client.query('SELECT 1 FROM ciudad WHERE id_ciudad = $1', [user.cityId]);
    if (city.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'La ciudad seleccionada no existe.' });
      return;
    }

    await client.query(
      `INSERT INTO persona
         (identificacion, id_ciudad, nombres, apellidos, correo_electronico,
          calle, password_hash, auth_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 0)`,
      [
        user.identification, user.cityId, user.names, user.surnames,
        user.email, user.address || null, passwordHash
      ]
    );
    await client.query(
      'INSERT INTO personatelefono (identificacion, telefono) VALUES ($1, $2)',
      [user.identification, user.phone]
    );
    if (user.role === 'cliente') {
      await client.query(
        'INSERT INTO cliente (identificacion, cantidad_puntos) VALUES ($1, 0)',
        [user.identification]
      );
    } else if (user.role === 'agente') {
      await client.query(
        `INSERT INTO agente
           (identificacion, estado_aprobacion, fecha_resolucion, resuelto_por)
         VALUES ($1, 'aprobado', CURRENT_TIMESTAMP, $2)`,
        [user.identification, req.user.identificacion]
      );
    } else {
      await client.query(
        'INSERT INTO administrador (identificacion) VALUES ($1)',
        [user.identification]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({
      usuario: {
        identificacion: user.identification,
        nombres: user.names,
        apellidos: user.surnames,
        correo_electronico: user.email,
        role: user.role
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') {
      res.status(409).json({ error: 'La identificación o el correo ya están registrados.' });
      return;
    }
    throw error;
  } finally {
    client.release();
  }
}));

app.put('/api/admin/usuarios/:identificacion', authenticate, authorize('administrador'), asyncRoute(async (req, res) => {
  const user = validateAdminUser({
    ...(req.body || {}),
    identificacion: req.params.identificacion
  }, false);
  if (user.error || !user.identification) {
    res.status(400).json({ error: user.error || 'La identificación no es válida.' });
    return;
  }
  const passwordHash = user.password ? await bcrypt.hash(user.password, 12) : null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const currentResult = await client.query(
      `SELECT p.identificacion,
              CASE
                WHEN admin.identificacion IS NOT NULL THEN 'administrador'
                WHEN agent.identificacion IS NOT NULL THEN 'agente'
                WHEN customer.identificacion IS NOT NULL THEN 'cliente'
                ELSE NULL
              END AS role
       FROM persona p
       LEFT JOIN administrador admin ON admin.identificacion = p.identificacion
       LEFT JOIN agente agent ON agent.identificacion = p.identificacion
       LEFT JOIN cliente customer ON customer.identificacion = p.identificacion
       WHERE p.identificacion = $1
         AND p.cuenta_eliminada_at IS NULL
       FOR UPDATE OF p`,
      [user.identification]
    );
    const current = currentResult.rows[0];
    if (!current || !current.role) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'No se encontró una cuenta válida con esa identificación.' });
      return;
    }

    const roleChanged = current.role !== user.role;
    if (roleChanged && user.identification === req.user.identificacion) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'No puedes cambiar tu propio rol administrativo.' });
      return;
    }
    if (roleChanged && current.role === 'administrador') {
      await client.query('LOCK TABLE administrador IN EXCLUSIVE MODE');
      const admins = await client.query(
        `SELECT COUNT(*)::int AS total
         FROM administrador ad
         JOIN persona p ON p.identificacion = ad.identificacion
         WHERE p.cuenta_eliminada_at IS NULL`
      );
      if (admins.rows[0].total <= 1) {
        await client.query('ROLLBACK');
        res.status(409).json({ error: 'No puedes quitar el rol del último administrador.' });
        return;
      }
    }
    if (roleChanged && current.role === 'cliente') {
      const reservations = await client.query(
        'SELECT 1 FROM reserva WHERE identificacion_cliente = $1 LIMIT 1',
        [user.identification]
      );
      if (reservations.rowCount > 0) {
        await client.query('ROLLBACK');
        res.status(409).json({ error: 'No se puede cambiar el rol de un cliente con reservas asociadas.' });
        return;
      }
    }
    if (roleChanged && current.role === 'agente') {
      const events = await client.query(
        'SELECT 1 FROM evento WHERE identificacion_agente = $1 LIMIT 1',
        [user.identification]
      );
      if (events.rowCount > 0) {
        await client.query('ROLLBACK');
        res.status(409).json({ error: 'No se puede cambiar el rol de un agente con eventos asociados.' });
        return;
      }
    }

    const city = await client.query('SELECT 1 FROM ciudad WHERE id_ciudad = $1', [user.cityId]);
    if (city.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'La ciudad seleccionada no existe.' });
      return;
    }

    await client.query(
      `UPDATE persona
       SET id_ciudad = $1,
           nombres = $2,
           apellidos = $3,
           correo_electronico = $4,
           calle = $5,
           password_hash = COALESCE($6, password_hash),
           auth_version = auth_version + CASE WHEN $7 THEN 1 ELSE 0 END
       WHERE identificacion = $8`,
      [
        user.cityId, user.names, user.surnames, user.email, user.address || null,
        passwordHash, roleChanged || Boolean(passwordHash), user.identification
      ]
    );
    await client.query(
      'DELETE FROM personatelefono WHERE identificacion = $1',
      [user.identification]
    );
    await client.query(
      'INSERT INTO personatelefono (identificacion, telefono) VALUES ($1, $2)',
      [user.identification, user.phone]
    );

    if (roleChanged) {
      const oldTable = current.role === 'cliente'
        ? 'cliente'
        : current.role === 'agente' ? 'agente' : 'administrador';
      const newTable = user.role === 'cliente'
        ? 'cliente'
        : user.role === 'agente' ? 'agente' : 'administrador';
      await client.query(`DELETE FROM ${oldTable} WHERE identificacion = $1`, [user.identification]);
      if (newTable === 'cliente') {
        await client.query(
          'INSERT INTO cliente (identificacion, cantidad_puntos) VALUES ($1, 0)',
          [user.identification]
        );
      } else if (newTable === 'agente') {
        await client.query(
          `INSERT INTO agente
             (identificacion, estado_aprobacion, fecha_resolucion, resuelto_por)
           VALUES ($1, 'aprobado', CURRENT_TIMESTAMP, $2)`,
          [user.identification, req.user.identificacion]
        );
      } else {
        await client.query(
          'INSERT INTO administrador (identificacion) VALUES ($1)',
          [user.identification]
        );
      }
    }
    await client.query('COMMIT');
    res.json({
      usuario: {
        identificacion: user.identification,
        nombres: user.names,
        apellidos: user.surnames,
        correo_electronico: user.email,
        role: user.role
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') {
      res.status(409).json({ error: 'El correo electrónico ya está registrado.' });
      return;
    }
    throw error;
  } finally {
    client.release();
  }
}));

app.delete('/api/admin/usuarios/:identificacion', authenticate, authorize('administrador'), asyncRoute(async (req, res) => {
  const identification = String(req.params.identificacion || '').trim();
  if (!identification || identification.length > 20) {
    res.status(400).json({ error: 'La identificación no es válida.' });
    return;
  }
  if (identification === req.user.identificacion) {
    res.status(409).json({ error: 'No puedes eliminar la cuenta con la que tienes esta sesión.' });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const accountResult = await client.query(
      `SELECT CASE
                WHEN admin.identificacion IS NOT NULL THEN 'administrador'
                WHEN agent.identificacion IS NOT NULL THEN 'agente'
                WHEN customer.identificacion IS NOT NULL THEN 'cliente'
                ELSE NULL
              END AS role
       FROM persona p
       LEFT JOIN administrador admin ON admin.identificacion = p.identificacion
       LEFT JOIN agente agent ON agent.identificacion = p.identificacion
       LEFT JOIN cliente customer ON customer.identificacion = p.identificacion
       WHERE p.identificacion = $1
         AND p.cuenta_eliminada_at IS NULL
       FOR UPDATE OF p`,
      [identification]
    );
    const account = accountResult.rows[0];
    if (!account || !account.role) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'No se encontró una cuenta válida con esa identificación.' });
      return;
    }
    if (account.role === 'administrador') {
      await client.query('LOCK TABLE administrador IN EXCLUSIVE MODE');
      const admins = await client.query(
        `SELECT COUNT(*)::int AS total
         FROM administrador ad
         JOIN persona p ON p.identificacion = ad.identificacion
         WHERE p.cuenta_eliminada_at IS NULL`
      );
      if (admins.rows[0].total <= 1) {
        await client.query('ROLLBACK');
        res.status(409).json({ error: 'No puedes eliminar el último administrador.' });
        return;
      }
    }
    if (account.role === 'cliente') {
      const reservations = await client.query(
        'SELECT 1 FROM reserva WHERE identificacion_cliente = $1 LIMIT 1',
        [identification]
      );
      if (reservations.rowCount > 0) {
        await client.query('ROLLBACK');
        res.status(409).json({ error: 'No se puede eliminar un cliente con reservas asociadas.' });
        return;
      }
    }
    if (account.role === 'agente') {
      const events = await client.query(
        'SELECT COUNT(*)::integer AS total FROM evento WHERE identificacion_agente = $1',
        [identification]
      );
      if (events.rows[0].total > 0) {
        await client.query('ROLLBACK');
        res.status(409).json({
          codigo: 'TIENE_EVENTOS',
          eventos: events.rows[0].total,
          error: 'Reasigna los eventos asociados antes de eliminar este agente.'
        });
        return;
      }
    }

    const subtype = account.role === 'cliente'
      ? 'cliente'
      : account.role === 'agente' ? 'agente' : 'administrador';
    await client.query(`DELETE FROM ${subtype} WHERE identificacion = $1`, [identification]);
    await client.query('DELETE FROM personatelefono WHERE identificacion = $1', [identification]);
    await client.query('DELETE FROM persona WHERE identificacion = $1', [identification]);
    await client.query('COMMIT');
    res.status(204).end();
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23503') {
      res.status(409).json({ error: 'No se puede eliminar la cuenta porque tiene registros asociados.' });
      return;
    }
    throw error;
  } finally {
    client.release();
  }
}));

const adminCatalogTypes = {
  paises: { table: 'pais', id: 'id_pais', parent: null },
  departamentos: { table: 'departamento', id: 'id_departamento', parent: 'id_pais' },
  ciudades: { table: 'ciudad', id: 'id_ciudad', parent: 'id_departamento' }
};

function validateCatalogName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  return name && name.length <= 100 ? name : null;
}

app.get('/api/admin/catalogos/paises', authenticate, authorize('administrador'), asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT p.id_pais, p.nombre,
            COUNT(d.id_departamento)::int AS cantidad_departamentos
     FROM pais p
     LEFT JOIN departamento d ON d.id_pais = p.id_pais
     GROUP BY p.id_pais, p.nombre
     ORDER BY p.nombre`
  );
  res.json({ paises: result.rows });
}));

app.get('/api/admin/catalogos/departamentos', authenticate, authorize('administrador'), asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT d.id_departamento, d.nombre, d.id_pais,
            p.nombre AS pais, COUNT(c.id_ciudad)::int AS cantidad_ciudades
     FROM departamento d
     JOIN pais p ON p.id_pais = d.id_pais
     LEFT JOIN ciudad c ON c.id_departamento = d.id_departamento
     GROUP BY d.id_departamento, d.nombre, d.id_pais, p.nombre
     ORDER BY p.nombre, d.nombre`
  );
  res.json({ departamentos: result.rows });
}));

app.get('/api/admin/catalogos/ciudades', authenticate, authorize('administrador'), asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT c.id_ciudad, c.nombre, c.id_departamento,
            d.nombre AS departamento, d.id_pais, p.nombre AS pais
     FROM ciudad c
     JOIN departamento d ON d.id_departamento = c.id_departamento
     JOIN pais p ON p.id_pais = d.id_pais
     ORDER BY p.nombre, d.nombre, c.nombre`
  );
  res.json({ ciudades: result.rows });
}));

app.post('/api/admin/catalogos/:tipo', authenticate, authorize('administrador'), asyncRoute(async (req, res) => {
  const definition = adminCatalogTypes[req.params.tipo];
  const name = validateCatalogName(req.body && req.body.nombre);
  if (!definition || !name) {
    res.status(400).json({ error: 'El tipo de catálogo o el nombre no es válido (máximo 100 caracteres).' });
    return;
  }
  const parentId = definition.parent
    ? parseInteger(req.body && req.body[definition.parent])
    : null;
  if (definition.parent && (!Number.isSafeInteger(parentId) || parentId < 1)) {
    res.status(400).json({ error: 'Selecciona el catálogo superior correspondiente.' });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`LOCK TABLE ${definition.table} IN EXCLUSIVE MODE`);
    if (definition.parent) {
      const parentTable = definition.parent === 'id_pais' ? 'pais' : 'departamento';
      const parentIdColumn = definition.parent;
      const parent = await client.query(
        `SELECT 1 FROM ${parentTable} WHERE ${parentIdColumn} = $1`,
        [parentId]
      );
      if (parent.rowCount === 0) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: 'El catálogo superior seleccionado no existe.' });
        return;
      }
    }

    const duplicate = await client.query(
      `SELECT 1 FROM ${definition.table}
       WHERE LOWER(TRIM(nombre)) = LOWER(TRIM($1))${
         definition.parent ? ` AND ${definition.parent} = $2` : ''
       }
       LIMIT 1`,
      definition.parent ? [name, parentId] : [name]
    );
    if (duplicate.rowCount > 0) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'Ya existe un registro con ese nombre en el catálogo seleccionado.' });
      return;
    }

    const columns = definition.parent ? `nombre, ${definition.parent}` : 'nombre';
    const values = definition.parent ? [name, parentId] : [name];
    const placeholders = definition.parent ? '$1, $2' : '$1';
    const result = await client.query(
      `INSERT INTO ${definition.table} (${columns})
       VALUES (${placeholders})
       RETURNING ${definition.id}, nombre`,
      values
    );
    await client.query('COMMIT');
    res.status(201).json({ registro: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') {
      res.status(409).json({ error: 'Ya existe un registro con ese nombre en el catálogo seleccionado.' });
      return;
    }
    throw error;
  } finally {
    client.release();
  }
}));

app.put('/api/admin/catalogos/:tipo/:id', authenticate, authorize('administrador'), asyncRoute(async (req, res) => {
  const definition = adminCatalogTypes[req.params.tipo];
  const id = parseInteger(req.params.id);
  const name = validateCatalogName(req.body && req.body.nombre);
  const parentId = definition && definition.parent
    ? parseInteger(req.body && req.body[definition.parent])
    : null;
  if (!definition || !Number.isSafeInteger(id) || id < 1 || !name ||
      (definition.parent && (!Number.isSafeInteger(parentId) || parentId < 1))) {
    res.status(400).json({ error: 'El catálogo, identificador, nombre o catálogo superior no es válido.' });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`LOCK TABLE ${definition.table} IN EXCLUSIVE MODE`);
    const existing = await client.query(
      `SELECT 1 FROM ${definition.table} WHERE ${definition.id} = $1 FOR UPDATE`,
      [id]
    );
    if (existing.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'No se encontró el registro del catálogo.' });
      return;
    }
    if (definition.parent) {
      const parentTable = definition.parent === 'id_pais' ? 'pais' : 'departamento';
      const parent = await client.query(
        `SELECT 1 FROM ${parentTable} WHERE ${definition.parent} = $1`,
        [parentId]
      );
      if (parent.rowCount === 0) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: 'El catálogo superior seleccionado no existe.' });
        return;
      }
    }
    const duplicate = await client.query(
      `SELECT 1 FROM ${definition.table}
       WHERE LOWER(TRIM(nombre)) = LOWER(TRIM($1))
         AND ${definition.id} <> $2${
           definition.parent ? ` AND ${definition.parent} = $3` : ''
         }
       LIMIT 1`,
      definition.parent ? [name, id, parentId] : [name, id]
    );
    if (duplicate.rowCount > 0) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'Ya existe un registro con ese nombre en el catálogo seleccionado.' });
      return;
    }

    const result = await client.query(
      `UPDATE ${definition.table}
       SET nombre = $1${definition.parent ? `, ${definition.parent} = $2` : ''}
       WHERE ${definition.id} = ${definition.parent ? '$3' : '$2'}
       RETURNING ${definition.id}, nombre${definition.parent ? `, ${definition.parent}` : ''}`,
      definition.parent ? [name, parentId, id] : [name, id]
    );
    await client.query('COMMIT');
    res.json({ registro: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') {
      res.status(409).json({ error: 'Ya existe un registro con ese nombre en el catálogo seleccionado.' });
      return;
    }
    throw error;
  } finally {
    client.release();
  }
}));

app.delete('/api/admin/catalogos/:tipo/:id', authenticate, authorize('administrador'), asyncRoute(async (req, res) => {
  const definition = adminCatalogTypes[req.params.tipo];
  const id = parseInteger(req.params.id);
  if (!definition || !Number.isSafeInteger(id) || id < 1) {
    res.status(400).json({ error: 'El catálogo o identificador no es válido.' });
    return;
  }
  try {
    const result = await pool.query(
      `DELETE FROM ${definition.table}
       WHERE ${definition.id} = $1
       RETURNING ${definition.id}`,
      [id]
    );
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'No se encontró el registro del catálogo.' });
      return;
    }
    res.status(204).end();
  } catch (error) {
    if (error.code === '23503') {
      res.status(409).json({
        error: 'No se puede eliminar porque existen departamentos, ciudades, usuarios o eventos asociados.'
      });
      return;
    }
    throw error;
  }
}));

// Fragmentos SQL de los reportes. fecha_hora_reserva es TIMESTAMP sin zona y se
// llena en UTC; para agrupar por mes se pasa a la hora de Colombia.
const reportReservationInstant = "(r.fecha_hora_reserva AT TIME ZONE 'UTC')";
const reportReservationLocal = `(${reportReservationInstant} AT TIME ZONE 'America/Bogota')`;
const reportActiveReservation =
  "LOWER(TRIM(er.nombre)) NOT IN ('cancelada', 'cancelado', 'anulada', 'anulado')";
const reportCancelledEvent =
  "LOWER(TRIM(ee.nombre)) IN ('cancelado', 'cancelada', 'anulado', 'anulada')";

app.get('/api/admin/reportes', authenticate, authorize('administrador'), asyncRoute(async (req, res) => {
  // Los ingresos y los conteos por mes solo incluyen reservas no canceladas.
  const [
    counts, reservationsByEventMonth, revenueByMonth, averages,
    eventsByAgent, eventsByCity, reservationHistory,
    cancelledReservations, cancelledEvents
  ] = await Promise.all([
    pool.query(
      `SELECT (SELECT COUNT(*) FROM cliente c JOIN persona p ON p.identificacion = c.identificacion
               WHERE p.cuenta_eliminada_at IS NULL)::int AS clientes,
              (SELECT COUNT(*) FROM agente a JOIN persona p ON p.identificacion = a.identificacion
               WHERE p.cuenta_eliminada_at IS NULL)::int AS agentes,
              (SELECT COUNT(*) FROM administrador ad JOIN persona p ON p.identificacion = ad.identificacion
               WHERE p.cuenta_eliminada_at IS NULL)::int AS administradores,
              (SELECT COUNT(*) FROM reserva)::int AS reservas,
              (SELECT COUNT(*) FROM reserva r
               JOIN estadoreserva er ON er.id_estado_reserva = r.id_estado_reserva
               WHERE ${reportActiveReservation})::int AS reservas_activas,
              (SELECT COUNT(*) FROM evento)::int AS eventos,
              (SELECT COUNT(*) FROM evento e
               JOIN estadoevento ee ON ee.id_estado_evento = e.id_estado_evento
               WHERE ${reportCancelledEvent})::int AS eventos_cancelados`
    ),
    pool.query(
      `SELECT e.codigo_evento AS codigo, e.nombre_evento AS evento,
              EXTRACT(YEAR FROM ${reportReservationLocal})::int AS anio,
              EXTRACT(MONTH FROM ${reportReservationLocal})::int AS mes,
              COUNT(*)::int AS reservas,
              COALESCE(SUM(r.valor_total), 0)::numeric AS ingresos
       FROM reserva r
       JOIN estadoreserva er ON er.id_estado_reserva = r.id_estado_reserva
       JOIN evento e ON e.codigo_evento = r.codigo_evento
       WHERE ${reportActiveReservation}
       GROUP BY e.codigo_evento, e.nombre_evento,
                EXTRACT(YEAR FROM ${reportReservationLocal}),
                EXTRACT(MONTH FROM ${reportReservationLocal})
       ORDER BY anio DESC, mes DESC, evento`
    ),
    pool.query(
      `SELECT EXTRACT(YEAR FROM ${reportReservationLocal})::int AS anio,
              EXTRACT(MONTH FROM ${reportReservationLocal})::int AS mes,
              COUNT(*)::int AS reservas,
              COALESCE(SUM(r.valor_total), 0)::numeric AS ingresos
       FROM reserva r
       JOIN estadoreserva er ON er.id_estado_reserva = r.id_estado_reserva
       WHERE ${reportActiveReservation}
       GROUP BY EXTRACT(YEAR FROM ${reportReservationLocal}),
                EXTRACT(MONTH FROM ${reportReservationLocal})
       ORDER BY anio DESC, mes DESC`
    ),
    // Promedios: ingresos entre los agentes que tienen eventos y entre los
    // clientes que tienen al menos una reserva no cancelada.
    pool.query(
      `WITH ventas AS (
         SELECT r.valor_total, r.identificacion_cliente
         FROM reserva r
         JOIN estadoreserva er ON er.id_estado_reserva = r.id_estado_reserva
         WHERE ${reportActiveReservation}
       ),
       totales AS (
         SELECT COALESCE(SUM(valor_total), 0)::numeric AS ingresos_totales,
                COUNT(DISTINCT identificacion_cliente)::int AS clientes_con_reservas,
                (SELECT COUNT(DISTINCT identificacion_agente) FROM evento)::int AS agentes_con_eventos
         FROM ventas
       )
       SELECT ingresos_totales, clientes_con_reservas, agentes_con_eventos,
              COALESCE(ROUND(ingresos_totales / NULLIF(agentes_con_eventos, 0), 2), 0)::numeric
                AS promedio_por_agente,
              COALESCE(ROUND(ingresos_totales / NULLIF(clientes_con_reservas, 0), 2), 0)::numeric
                AS promedio_por_cliente
       FROM totales`
    ),
    pool.query(
      `SELECT e.identificacion_agente AS identificacion,
              TRIM(p.nombres || ' ' || p.apellidos) AS agente,
              COUNT(*)::int AS eventos
       FROM evento e
       JOIN persona p ON p.identificacion = e.identificacion_agente
       GROUP BY e.identificacion_agente, p.nombres, p.apellidos
       ORDER BY eventos DESC, agente`
    ),
    pool.query(
      `SELECT ci.id_ciudad, ci.nombre AS ciudad, d.nombre AS departamento,
              COUNT(*)::int AS eventos
       FROM evento e
       JOIN ciudad ci ON ci.id_ciudad = e.id_ciudad
       JOIN departamento d ON d.id_departamento = ci.id_departamento
       GROUP BY ci.id_ciudad, ci.nombre, d.nombre
       ORDER BY eventos DESC, ciudad`
    ),
    pool.query(
      `SELECT r.id_reserva, r.identificacion_cliente,
              TRIM(p.nombres || ' ' || p.apellidos) AS cliente,
              e.nombre_evento AS evento,
              ${reportReservationInstant} AS fecha_hora_reserva,
              er.nombre AS estado, r.valor_total, r.numero_entradas, r.localidad
       FROM reserva r
       JOIN estadoreserva er ON er.id_estado_reserva = r.id_estado_reserva
       JOIN persona p ON p.identificacion = r.identificacion_cliente
       JOIN evento e ON e.codigo_evento = r.codigo_evento
       ORDER BY r.fecha_hora_reserva DESC, r.id_reserva DESC
       LIMIT 300`
    ),
    pool.query(
      `SELECT r.id_reserva,
              TRIM(p.nombres || ' ' || p.apellidos) AS cliente,
              e.nombre_evento AS evento,
              ${reportReservationInstant} AS fecha_hora_reserva,
              r.fecha_cancelacion, r.motivo_cancelacion AS motivo, r.valor_total
       FROM reserva r
       JOIN estadoreserva er ON er.id_estado_reserva = r.id_estado_reserva
       JOIN persona p ON p.identificacion = r.identificacion_cliente
       JOIN evento e ON e.codigo_evento = r.codigo_evento
       WHERE NOT (${reportActiveReservation})
       ORDER BY r.fecha_cancelacion DESC NULLS LAST, r.fecha_hora_reserva DESC, r.id_reserva DESC
       LIMIT 50`
    ),
    pool.query(
      `SELECT e.codigo_evento AS codigo, e.nombre_evento AS evento,
              ci.nombre AS ciudad,
              e.fecha_hora_inicio AT TIME ZONE 'America/Bogota' AS fecha_hora_inicio,
              e.fecha_cancelacion, e.motivo_cancelacion AS motivo,
              TRIM(p.nombres || ' ' || p.apellidos) AS agente
       FROM evento e
       JOIN estadoevento ee ON ee.id_estado_evento = e.id_estado_evento
       JOIN ciudad ci ON ci.id_ciudad = e.id_ciudad
       JOIN persona p ON p.identificacion = e.identificacion_agente
       WHERE ${reportCancelledEvent}
       ORDER BY e.fecha_cancelacion DESC NULLS LAST, e.fecha_hora_inicio DESC, e.codigo_evento
       LIMIT 50`
    )
  ]);
  const summary = counts.rows[0];
  res.set('Cache-Control', 'no-store');
  res.json({
    resumen: {
      ...summary,
      reservas_canceladas: summary.reservas - summary.reservas_activas
    },
    reservasPorEventoMes: reservationsByEventMonth.rows,
    ingresosPorMes: revenueByMonth.rows,
    promedios: averages.rows[0],
    eventosPorAgente: eventsByAgent.rows,
    eventosPorCiudad: eventsByCity.rows,
    historialReservas: reservationHistory.rows,
    reservasCanceladas: cancelledReservations.rows,
    eventosCancelados: cancelledEvents.rows
  });
}));

app.get('/api/reservas', authenticate, authorize('cliente'), asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT r.id_reserva, r.fecha_hora_reserva, r.valor_total,
            r.numero_entradas, r.localidad, er.nombre AS estado,
            e.codigo_evento AS codigo, e.nombre_evento AS evento,
            e.fecha_hora_inicio, e.teatro, ci.nombre AS ciudad
     FROM reserva r
     JOIN estadoreserva er ON er.id_estado_reserva = r.id_estado_reserva
     JOIN evento e ON e.codigo_evento = r.codigo_evento
     JOIN ciudad ci ON ci.id_ciudad = e.id_ciudad
     WHERE r.identificacion_cliente = $1
     ORDER BY r.fecha_hora_reserva DESC`,
    [req.user.identificacion]
  );
  res.json({ reservas: result.rows });
}));

async function getReservationEmailDetails(client, reservationId) {
  const result = await client.query(
    `SELECT r.id_reserva,
            TO_CHAR(r.fecha_hora_reserva, 'DD/MM/YYYY HH24:MI') AS fecha_reserva,
            r.valor_total::text AS valor_total,
            r.numero_entradas, r.localidad, er.nombre AS estado,
            p.nombres, p.apellidos, p.correo_electronico,
            e.nombre_evento AS evento,
            TO_CHAR(e.fecha_hora_inicio, 'DD/MM/YYYY HH24:MI') AS fecha_evento,
            e.teatro, ci.nombre AS ciudad
     FROM reserva r
     JOIN estadoreserva er ON er.id_estado_reserva = r.id_estado_reserva
     JOIN persona p ON p.identificacion = r.identificacion_cliente
     JOIN evento e ON e.codigo_evento = r.codigo_evento
     JOIN ciudad ci ON ci.id_ciudad = e.id_ciudad
     WHERE r.id_reserva = $1`,
    [reservationId]
  );
  if (result.rowCount !== 1) {
    throw new Error('No fue posible obtener los datos del comprobante de la reserva.');
  }
  return result.rows[0];
}

async function deliverReservationEmail(reservation, action) {
  try {
    const result = await sendReservationEmail(reservation, action);
    if (!result.sent) {
      console.warn('Comprobante de reserva no enviado:', result.reason);
    }
    return result.sent;
  } catch (error) {
    console.error('Error al enviar el comprobante de reserva:', error.message);
    return false;
  }
}

app.post('/api/reservas', authenticate, authorize('cliente'), asyncRoute(async (req, res) => {
  const body = req.body || {};
  const codigo = String(body.codigo_evento || '').trim();
  const quantity = parseInteger(body.numero_entradas);
  const localityValues = {
    general: 'General',
    vip: 'VIP',
    preferencial: 'Preferencial'
  };
  const locality = localityValues[String(body.localidad || 'General').trim().toLowerCase()];

  if (!codigo || codigo.length > 50 || !quantity || quantity < 1 || quantity > 10 ||
      !locality) {
    res.status(400).json({
      error: 'El código, la localidad o la cantidad de entradas no es válida.'
    });
    return;
  }

  const client = await pool.connect();
  let reservation;
  let emailDetails;
  try {
    await client.query('BEGIN');
    const eventResult = await client.query(
      `SELECT e.codigo_evento, e.precio_base, e.precio_vip, e.precio_preferencial,
              e.capacidad_general, e.capacidad_vip, e.capacidad_preferencial,
              e.fecha_hora_inicio > (CURRENT_TIMESTAMP AT TIME ZONE 'America/Bogota') AS vigente,
              ee.nombre AS estado
       FROM evento e
       JOIN estadoevento ee ON ee.id_estado_evento = e.id_estado_evento
       WHERE e.codigo_evento = $1
       FOR UPDATE OF e`,
      [codigo]
    );
    const event = eventResult.rows[0];
    if (!event) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'No se encontró el evento solicitado.' });
      return;
    }

    const eventStatus = String(event.estado).trim().toLowerCase();
    if (['cancelado', 'cancelada', 'anulado', 'anulada'].includes(eventStatus)) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'No se pueden reservar entradas para un evento cancelado.' });
      return;
    }

    if (['finalizado', 'finalizada'].includes(eventStatus)) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'No se pueden reservar entradas para un evento finalizado.' });
      return;
    }

    if (!event.vigente) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'No se pueden reservar entradas para un evento que ya inició.' });
      return;
    }

    const localityConfig = {
      General: {
        price: Number(event.precio_base),
        capacity: Number(event.capacidad_general)
      },
      VIP: {
        price: Number(event.precio_vip),
        capacity: Number(event.capacidad_vip)
      },
      Preferencial: {
        price: Number(event.precio_preferencial),
        capacity: Number(event.capacidad_preferencial)
      }
    }[locality];
    if (!Number.isFinite(localityConfig.price) || localityConfig.price < 0 ||
        !Number.isSafeInteger(localityConfig.capacity) || localityConfig.capacity < 0) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'El evento tiene una configuración de precio o capacidad inválida.' });
      return;
    }

    const reservedResult = await client.query(
      `SELECT COALESCE(SUM(r.numero_entradas), 0)::int AS cantidad
       FROM reserva r
       JOIN estadoreserva er ON er.id_estado_reserva = r.id_estado_reserva
       WHERE r.codigo_evento = $1
         AND r.localidad = $2
         AND LOWER(TRIM(er.nombre)) NOT IN ('cancelada', 'cancelado', 'anulada', 'anulado')`,
      [codigo, locality]
    );
    const available = localityConfig.capacity - reservedResult.rows[0].cantidad;
    if (quantity > available) {
      await client.query('ROLLBACK');
      res.status(409).json({
        error: 'No hay suficientes entradas disponibles en la localidad ' + locality + '.',
        disponibles: Math.max(available, 0)
      });
      return;
    }

    const reservationState = await client.query(
      `SELECT id_estado_reserva
       FROM estadoreserva
       WHERE LOWER(TRIM(nombre)) IN ('reservada', 'confirmada', 'confirmado', 'pendiente')
       ORDER BY CASE LOWER(TRIM(nombre))
         WHEN 'pendiente' THEN 0
         WHEN 'reservada' THEN 1
         WHEN 'confirmada' THEN 2
         WHEN 'confirmado' THEN 2
         ELSE 3
       END
       LIMIT 1`
    );
    if (reservationState.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(503).json({
        error: 'Configura al menos un estado de reserva: Pendiente, Reservada o Confirmada.'
      });
      return;
    }

    const reservationResult = await client.query(
      `INSERT INTO reserva
         (identificacion_cliente, codigo_evento, id_estado_reserva, valor_total, numero_entradas, localidad)
       VALUES (
         $1,
         $2,
         $3,
         ($4::numeric * $5) + ($6::numeric * $5),
         $5,
         $7
       )
       RETURNING id_reserva, fecha_hora_reserva, valor_total, numero_entradas, localidad`,
      [
        req.user.identificacion,
        codigo,
        reservationState.rows[0].id_estado_reserva,
        localityConfig.price,
        quantity,
        serviceFeePerTicket,
        locality
      ]
    );

    emailDetails = await getReservationEmailDetails(
      client,
      reservationResult.rows[0].id_reserva
    );
    await client.query('COMMIT');
    reservation = {
      ...reservationResult.rows[0],
      codigo_evento: codigo,
      localidad: locality,
      servicio_por_entrada: serviceFeePerTicket
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const emailSent = await deliverReservationEmail(emailDetails, 'created');
  res.status(201).json({
    reserva: reservation,
    correo_enviado: emailSent,
    ...(emailSent ? {} : {
      aviso: 'La reserva se creó, pero no fue posible enviar el comprobante por correo.'
    })
  });
}));

app.delete('/api/reservas/:id', authenticate, authorize('cliente'), asyncRoute(async (req, res) => {
  const reservationId = parseInteger(req.params.id);
  const reason = parseCancellationReason(req.body && req.body.motivo);
  if (!reservationId || reservationId < 1) {
    res.status(400).json({ error: 'El identificador de la reserva no es válido.' });
    return;
  }
  if (reason === undefined) {
    res.status(400).json({ error: 'El motivo debe ser un texto de máximo 500 caracteres.' });
    return;
  }

  const client = await pool.connect();
  let reservation;
  try {
    await client.query('BEGIN');
    const currentReservation = await client.query(
      `SELECT r.id_reserva, er.nombre AS estado
       FROM reserva r
       JOIN estadoreserva er ON er.id_estado_reserva = r.id_estado_reserva
       WHERE r.id_reserva = $1
         AND r.identificacion_cliente = $2
       FOR UPDATE OF r`,
      [reservationId, req.user.identificacion]
    );
    if (currentReservation.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'No se encontró la reserva solicitada.' });
      return;
    }

    if (['cancelada', 'cancelado', 'anulada', 'anulado'].includes(
      String(currentReservation.rows[0].estado).trim().toLowerCase()
    )) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'La reserva ya está cancelada.' });
      return;
    }

    const cancelledState = await client.query(
      `SELECT id_estado_reserva
       FROM estadoreserva
       WHERE LOWER(TRIM(nombre)) IN ('cancelada', 'cancelado', 'anulada', 'anulado')
       ORDER BY CASE LOWER(TRIM(nombre))
         WHEN 'cancelada' THEN 0
         WHEN 'cancelado' THEN 1
         WHEN 'anulada' THEN 2
         ELSE 3
       END
       LIMIT 1`
    );
    if (cancelledState.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(503).json({
        error: 'Configura el estado Cancelada antes de cancelar reservas.'
      });
      return;
    }

    await client.query(
      `UPDATE reserva
       SET id_estado_reserva = $1,
           motivo_cancelacion = $3,
           fecha_cancelacion = CURRENT_TIMESTAMP
       WHERE id_reserva = $2`,
      [cancelledState.rows[0].id_estado_reserva, reservationId, reason]
    );
    reservation = await getReservationEmailDetails(client, reservationId);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const emailSent = await deliverReservationEmail(reservation, 'cancelled');
  res.json({
    reserva: reservation,
    correo_enviado: emailSent,
    ...(emailSent ? {} : {
      aviso: 'La reserva se canceló, pero no fue posible enviar el comprobante por correo.'
    })
  });
}));

app.use((req, res) => {
  res.status(404).json({ error: 'La ruta solicitada no existe.' });
});

app.use((error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'El cuerpo de la solicitud debe ser JSON válido.' });
    return;
  }

  console.error('Error en la API:', error.message);
  res.status(error.status || 500).json({
    error: error.status ? error.message : 'Ocurrió un error interno en el servidor.'
  });
});

module.exports = { app, pool, port };
