require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const express = require('express');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

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
       WHERE p.identificacion = $1`,
      [claims.sub]
    );

    const person = result.rows[0];
    if (!person || person.auth_version !== claims.ver || person.role !== claims.role) {
      res.status(401).json({ error: 'La sesión expiró o no es válida.' });
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
  if (!code || code.length > 50 || !Number.isSafeInteger(stateId) || stateId < 1) {
    res.status(400).json({ error: 'El código o estado del evento no es válido.' });
    return;
  }

  const result = await pool.query(
    `UPDATE evento e
     SET id_estado_evento = ee.id_estado_evento
     FROM estadoevento ee
     WHERE e.codigo_evento = $1
       AND e.identificacion_agente = $2
       AND ee.id_estado_evento = $3
     RETURNING e.codigo_evento AS codigo, ee.id_estado_evento, ee.nombre AS estado`,
    [code, req.user.identificacion, stateId]
  );
  if (result.rowCount === 0) {
    const ownedEvent = await pool.query(
      `SELECT 1 FROM evento
       WHERE codigo_evento = $1 AND identificacion_agente = $2`,
      [code, req.user.identificacion]
    );
    if (ownedEvent.rowCount === 0) {
      res.status(404).json({ error: 'No se encontró el evento o no tienes permiso para modificarlo.' });
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
      `SELECT codigo_evento
       FROM evento
       WHERE codigo_evento = $1 AND identificacion_agente = $2
       FOR UPDATE`,
      [code, req.user.identificacion]
    );
    if (event.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'No se encontró el evento o no tienes permiso para eliminarlo.' });
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
      `SELECT codigo_evento
       FROM evento
       WHERE codigo_evento = $1 AND identificacion_agente = $2
       FOR UPDATE`,
      [code, req.user.identificacion]
    );
    if (eventResult.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'No se encontró el evento o no tienes permiso para editarlo.' });
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
        'INSERT INTO agente (identificacion) VALUES ($1)',
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
    const token = createToken(user);

    await client.query('COMMIT');
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
     WHERE LOWER(TRIM(p.correo_electronico)) = $1`,
    [email]
  );
  const person = result.rows[0];

  if (!person || !person.password_hash || !person.role ||
      !(await bcrypt.compare(password, person.password_hash))) {
    res.status(401).json({ error: 'Credenciales inválidas' });
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

app.get('/api/agente/reservas', authenticate, authorize('agente'), asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT r.id_reserva, r.fecha_hora_reserva, r.valor_total,
            r.numero_entradas, r.localidad, er.id_estado_reserva,
            er.nombre AS estado, e.codigo_evento AS codigo,
            e.nombre_evento AS evento, p.nombres || ' ' || p.apellidos AS cliente
     FROM reserva r
     JOIN estadoreserva er ON er.id_estado_reserva = r.id_estado_reserva
     JOIN evento e ON e.codigo_evento = r.codigo_evento
     JOIN persona p ON p.identificacion = r.identificacion_cliente
     ORDER BY r.fecha_hora_reserva DESC`
  );
  res.json({ reservas: result.rows });
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
  if (!reservationId || reservationId < 1 || !state || state.length > 50) {
    res.status(400).json({ error: 'El identificador o el estado de la reserva no es válido.' });
    return;
  }

  const result = await pool.query(
    `WITH selected_state AS (
       SELECT id_estado_reserva
       FROM estadoreserva
       WHERE LOWER(TRIM(nombre)) = LOWER(TRIM($2))
       ORDER BY id_estado_reserva
       LIMIT 1
     )
     UPDATE reserva r
     SET id_estado_reserva = selected_state.id_estado_reserva
     FROM selected_state
     WHERE r.id_reserva = $1
     RETURNING r.id_reserva, r.id_estado_reserva`,
    [reservationId, state]
  );
  if (result.rowCount === 0) {
    res.status(404).json({ error: 'No se encontró la reserva o el estado solicitado.' });
    return;
  }
  res.json({ reserva: result.rows[0] });
}));

app.get('/api/admin/reportes', authenticate, authorize('administrador'), asyncRoute(async (req, res) => {
  const [counts, reservationsByEventMonth, revenueByMonth] = await Promise.all([
    pool.query(
      `SELECT (SELECT COUNT(*) FROM cliente)::int AS clientes,
              (SELECT COUNT(*) FROM agente)::int AS agentes,
              (SELECT COUNT(*) FROM administrador)::int AS administradores,
              (SELECT COUNT(*) FROM reserva)::int AS reservas,
              (SELECT COUNT(*) FROM evento)::int AS eventos`
    ),
    pool.query(
      `SELECT e.codigo_evento AS codigo, e.nombre_evento AS evento,
              EXTRACT(YEAR FROM r.fecha_hora_reserva)::int AS anio,
              EXTRACT(MONTH FROM r.fecha_hora_reserva)::int AS mes,
              COUNT(*)::int AS reservas,
              COALESCE(SUM(r.valor_total), 0)::numeric AS ingresos
       FROM reserva r
       JOIN evento e ON e.codigo_evento = r.codigo_evento
       GROUP BY e.codigo_evento, e.nombre_evento,
                EXTRACT(YEAR FROM r.fecha_hora_reserva),
                EXTRACT(MONTH FROM r.fecha_hora_reserva)
       ORDER BY anio DESC, mes DESC, evento`
    ),
    pool.query(
      `SELECT EXTRACT(YEAR FROM fecha_hora_reserva)::int AS anio,
              EXTRACT(MONTH FROM fecha_hora_reserva)::int AS mes,
              COUNT(*)::int AS reservas,
              COALESCE(SUM(valor_total), 0)::numeric AS ingresos
       FROM reserva
       GROUP BY EXTRACT(YEAR FROM fecha_hora_reserva),
                EXTRACT(MONTH FROM fecha_hora_reserva)
       ORDER BY anio DESC, mes DESC`
    )
  ]);
  res.json({
    resumen: counts.rows[0],
    reservasPorEventoMes: reservationsByEventMonth.rows,
    ingresosPorMes: revenueByMonth.rows
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

    if (['cancelado', 'cancelada', 'anulado', 'anulada'].includes(
      String(event.estado).trim().toLowerCase()
    )) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'No se pueden reservar entradas para un evento cancelado.' });
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

    await client.query('COMMIT');
    res.status(201).json({
      reserva: {
        ...reservationResult.rows[0],
        codigo_evento: codigo,
        localidad: locality,
        servicio_por_entrada: serviceFeePerTicket
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
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
