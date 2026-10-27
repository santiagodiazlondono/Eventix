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

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false
});

function createToken(person) {
  return jwt.sign(
    {
      sub: person.identificacion,
      role: person.role,
      ver: person.auth_version
    },
    jwtSecret,
    { expiresIn: '1h' }
  );
}

function setAuthCookie(res, token) {
  res.cookie('eventix_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 1000,
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

function requireClient(req, res, next) {
  if (req.user.role !== 'cliente') {
    res.status(403).json({ error: 'Esta operación está disponible para clientes.' });
    return;
  }

  next();
}

function parseInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

const eventSelect = `
  SELECT e.codigo_evento AS codigo,
         e.nombre_evento AS nombre,
         e.descripcion,
         e.teatro,
         e.fecha_hora_inicio AT TIME ZONE 'America/Bogota' AS fecha_hora_inicio,
         e.fecha_hora_fin_estimada AT TIME ZONE 'America/Bogota' AS fecha_hora_fin_estimada,
         e.capacidad_total,
         e.precio_base,
         ci.nombre AS ciudad,
         d.nombre AS departamento,
         ee.nombre AS estado
  FROM evento e
  JOIN ciudad ci ON ci.id_ciudad = e.id_ciudad
  JOIN departamento d ON d.id_departamento = ci.id_departamento
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

app.get('/api/eventos', asyncRoute(async (req, res) => {
  const result = await pool.query(
    `${eventSelect}
     WHERE LOWER(TRIM(ee.nombre)) NOT IN ('cancelado', 'cancelada', 'anulado', 'anulada')
     ORDER BY e.fecha_hora_inicio ASC`
  );
  res.json({ eventos: result.rows });
}));

app.get('/api/eventos/:codigo', asyncRoute(async (req, res) => {
  const result = await pool.query(
    `${eventSelect}
     WHERE e.codigo_evento = $1`,
    [req.params.codigo]
  );

  if (result.rowCount === 0) {
    res.status(404).json({ error: 'No se encontró el evento solicitado.' });
    return;
  }

  res.json({ evento: result.rows[0] });
}));

app.post('/api/auth/registro', authLimiter, asyncRoute(async (req, res) => {
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
    contrasena: password
  } = body;

  const email = String(correo || emailAddress || '').trim().toLowerCase();
  const id = String(identificacion || body.num_identificacion || '').trim();
  const cityId = parseInteger(cityIdValue);
  const nameParts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  const names = String(givenNames || nameParts.shift() || '').trim();
  const surnames = String(apellidos || nameParts.join(' ')).trim();

  if (!id || id.length > 20 || !names || names.length > 100 ||
      !surnames || surnames.length > 100 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 150 ||
      !Number.isSafeInteger(cityId) || cityId < 1 ||
      !password || typeof password !== 'string' || password.length < 8 || password.length > 72 ||
      !phone || String(phone).trim().length > 20 ||
      (direccion && String(direccion).trim().length > 150)) {
    res.status(400).json({ error: 'Revisa los datos del registro e inténtalo de nuevo.' });
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
    await client.query(
      'INSERT INTO cliente (identificacion) VALUES ($1)',
      [id]
    );

    const user = {
      identificacion: id,
      nombres: names,
      apellidos: surnames,
      correo_electronico: email,
      role: 'cliente',
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
}));

app.post('/api/auth/login', authLimiter, asyncRoute(async (req, res) => {
  const body = req.body || {};
  const email = String(body.correo || body.correo_electronico || '').trim().toLowerCase();
  const password = body.contrasena;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      typeof password !== 'string' || !password || password.length > 72) {
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
     WHERE LOWER(p.correo_electronico) = $1`,
    [email]
  );
  const person = result.rows[0];

  if (!person || !person.password_hash || !person.role ||
      !(await bcrypt.compare(password, person.password_hash))) {
    res.status(401).json({ error: 'El correo o la contraseña son incorrectos.' });
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
  res.json({ usuario: { ...result.rows[0], role: req.user.role } });
}));

app.get('/api/reservas', authenticate, requireClient, asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT r.id_reserva, r.fecha_hora_reserva, r.valor_total,
            r.numero_entradas, er.nombre AS estado,
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

app.post('/api/reservas', authenticate, requireClient, asyncRoute(async (req, res) => {
  const body = req.body || {};
  const codigo = String(body.codigo_evento || '').trim();
  const quantity = parseInteger(body.numero_entradas);

  if (!codigo || codigo.length > 50 || !quantity || quantity < 1 || quantity > 10) {
    res.status(400).json({ error: 'El código de evento o la cantidad de entradas no es válida.' });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const eventResult = await client.query(
      `SELECT e.codigo_evento, e.precio_base, e.capacidad_total,
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

    if (Number(event.precio_base) < 0 || Number(event.capacidad_total) < 0) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'El evento tiene una configuración de precio o capacidad inválida.' });
      return;
    }

    const reservedResult = await client.query(
      `SELECT COALESCE(SUM(r.numero_entradas), 0)::int AS cantidad
       FROM reserva r
       JOIN estadoreserva er ON er.id_estado_reserva = r.id_estado_reserva
       WHERE r.codigo_evento = $1
         AND LOWER(TRIM(er.nombre)) NOT IN ('cancelada', 'cancelado', 'anulada', 'anulado')`,
      [codigo]
    );
    const available = Number(event.capacidad_total) - reservedResult.rows[0].cantidad;
    if (quantity > available) {
      await client.query('ROLLBACK');
      res.status(409).json({
        error: 'No hay suficientes entradas disponibles.',
        disponibles: Math.max(available, 0)
      });
      return;
    }

    const reservationState = await client.query(
      `SELECT id_estado_reserva
       FROM estadoreserva
       WHERE LOWER(TRIM(nombre)) IN ('reservada', 'confirmada', 'confirmado')
       ORDER BY CASE LOWER(TRIM(nombre))
         WHEN 'reservada' THEN 0
         WHEN 'confirmada' THEN 1
         ELSE 2
       END
       LIMIT 1`
    );
    if (reservationState.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(503).json({
        error: 'Configura al menos un estado de reserva: Reservada o Confirmada.'
      });
      return;
    }

    const reservationResult = await client.query(
      `INSERT INTO reserva
         (identificacion_cliente, codigo_evento, id_estado_reserva, valor_total, numero_entradas)
       VALUES (
         $1,
         $2,
         $3,
         ($4::numeric * $5) + ($6::numeric * $5),
         $5
       )
       RETURNING id_reserva, fecha_hora_reserva, valor_total, numero_entradas`,
      [
        req.user.identificacion,
        codigo,
        reservationState.rows[0].id_estado_reserva,
        event.precio_base,
        quantity,
        serviceFeePerTicket
      ]
    );

    await client.query('COMMIT');
    res.status(201).json({
      reserva: {
        ...reservationResult.rows[0],
        codigo_evento: codigo,
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
