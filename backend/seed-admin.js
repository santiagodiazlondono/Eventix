require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { pool } = require('./app');

function parseArguments(argumentsList) {
  const options = {};
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (!argument.startsWith('--')) {
      throw new Error('Los argumentos deben usar el formato --nombre valor.');
    }
    const separator = argument.indexOf('=');
    if (separator > 0) {
      options[argument.slice(2, separator)] = argument.slice(separator + 1);
    } else {
      const value = argumentsList[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Falta un valor para ${argument}.`);
      }
      options[argument.slice(2)] = value;
      index += 1;
    }
  }
  return options;
}

async function seedAdmin() {
  const args = parseArguments(process.argv.slice(2));
  const email = String(args.email || process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = args.password || process.env.ADMIN_PASSWORD || '';
  const requestedCityId = args.city || process.env.ADMIN_ID_CIUDAD || '';
  const names = args.names || process.env.ADMIN_NOMBRES || 'Administrador';
  const surnames = args.surnames || process.env.ADMIN_APELLIDOS || 'Eventix';

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 150 ||
      typeof password !== 'string' ||
      Array.from(password).length < 8 ||
      Buffer.byteLength(password, 'utf8') < 8 ||
      Buffer.byteLength(password, 'utf8') > 72) {
    throw new Error('Configura un correo válido y una contraseña de 8 a 72 bytes.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      `SELECT p.identificacion, p.password_hash,
              ad.identificacion IS NOT NULL AS is_admin
       FROM persona p
       LEFT JOIN administrador ad ON ad.identificacion = p.identificacion
       WHERE LOWER(TRIM(p.correo_electronico)) = $1
       FOR UPDATE OF p`,
      [email]
    );

    if (existing.rowCount > 0) {
      const person = existing.rows[0];
      if (!person.is_admin) {
        throw new Error('El correo indicado ya pertenece a un usuario que no es administrador.');
      }
      if (!person.password_hash) {
        const passwordHash = await bcrypt.hash(password, 12);
        await client.query(
          `UPDATE persona
           SET password_hash = $1, auth_version = auth_version + 1
           WHERE identificacion = $2`,
          [passwordHash, person.identificacion]
        );
      }
      await client.query('COMMIT');
      console.log('La cuenta administradora ya existe; no se realizaron cambios.');
      return;
    }

    const cityId = requestedCityId
      ? Number(requestedCityId)
      : null;
    if (requestedCityId && (!Number.isSafeInteger(cityId) || cityId < 1)) {
      throw new Error('ADMIN_ID_CIUDAD debe ser un identificador válido.');
    }
    const city = await client.query(
      `SELECT id_ciudad
       FROM ciudad
       WHERE ($1::integer IS NULL OR id_ciudad = $1)
       ORDER BY id_ciudad
       LIMIT 1`,
      [cityId]
    );
    if (city.rowCount === 0) {
      throw new Error('No existe una ciudad disponible para asociar al administrador.');
    }

    const identification = args.id ||
      process.env.ADMIN_IDENTIFICACION ||
      `ADM-${crypto.randomBytes(8).toString('hex')}`;
    if (identification.length > 20 || !names.trim() || !surnames.trim()) {
      throw new Error('La identificación, los nombres o los apellidos no son válidos.');
    }
    const passwordHash = await bcrypt.hash(password, 12);
    await client.query(
      `INSERT INTO persona
         (identificacion, id_ciudad, nombres, apellidos, correo_electronico, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [identification, city.rows[0].id_ciudad, names.trim(), surnames.trim(), email, passwordHash]
    );
    await client.query(
      'INSERT INTO administrador (identificacion) VALUES ($1)',
      [identification]
    );
    await client.query('COMMIT');
    console.log('Cuenta administradora creada correctamente.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

seedAdmin()
  .catch((error) => {
    console.error('No fue posible preparar la cuenta administradora:', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
