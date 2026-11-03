# Backend de Eventix

API REST con Express y PostgreSQL para gestionar cuentas de clientes, agentes y administradores, eventos y reservas. `server.js` inicia el servidor y `app.js` define la API.

## Requisitos

- Node.js 20 o posterior.
- Una base PostgreSQL con las tablas del esquema Eventix (`Pais`, `Departamento`, `Ciudad`, `Persona`, `PersonaTelefono`, `Cliente`, `Agente`, `Administrador`, `EstadoEvento`, `EstadoReserva`, `Evento` y `Reserva`).
- La tabla `Persona` almacena `password_hash` y `auth_version`. Los roles se obtienen de las tablas subtipo `Cliente`, `Agente` y `Administrador`.

## Migraciones

Ejecuta en orden en el SQL Editor de Neon las migraciones [`001_event_locality_capacities.sql`](migrations/001_event_locality_capacities.sql), [`002_reservation_locality.sql`](migrations/002_reservation_locality.sql) y [`003_auth_and_reservation_states.sql`](migrations/003_auth_and_reservation_states.sql). Son idempotentes. La primera agrega capacidades por localidad; la segunda añade localidad a las reservas existentes; la tercera asegura columnas de sesión, correo único ignorando mayúsculas/minúsculas y estados `Confirmada`/`Cancelada`. No elimina datos.

## Configuración

Desde esta carpeta instala las dependencias y crea el archivo local de entorno:

```powershell
npm.cmd install
Copy-Item .env.example .env
```

Configura `DATABASE_URL` con la cadena de conexión de Neon, `JWT_SECRET` con una clave aleatoria de al menos 32 caracteres y `CORS_ORIGINS` con el origen real del frontend. `JWT_EXPIRES_IN` define la duración de sesión (por ejemplo, `1h` o `7d`). No compartas ni subas `.env` al repositorio.

Genera un secreto local con:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

El registro público acepta únicamente los roles `cliente` y `agente`. La cuenta `administrador` se crea exclusivamente con el seed descrito abajo. Todas las rutas de agente requieren una sesión real; no hay modo de agente local que omita la autenticación.

Inicia la API:

```powershell
npm.cmd start
```

El servidor escucha en el puerto `5000` de forma predeterminada. `GET /api/health` comprueba la conexión a la base de datos.

Para comprobar la sintaxis del servidor y el seed, ejecuta `npm.cmd run check`.

## Primer administrador

Define `ADMIN_EMAIL` y `ADMIN_PASSWORD` en el `.env` local (contraseña de 8 a 72 bytes) y, opcionalmente, `ADMIN_IDENTIFICACION`, `ADMIN_ID_CIUDAD`, `ADMIN_NOMBRES` y `ADMIN_APELLIDOS`. Si no se indica ciudad, se usa una existente; si no se indica identificación, se genera una aleatoria. Ejecuta:

```powershell
npm.cmd run seed:admin
```

El seed es transaccional e idempotente. Si el correo ya pertenece a un administrador, no modifica su contraseña; si pertenece a otro rol, aborta. El registro del administrador no es público.

## Rutas

| Método | Ruta | Acceso | Descripción |
| --- | --- | --- | --- |
| `GET` | `/api/health` | Público | Estado del servicio y conexión a PostgreSQL. |
| `GET` | `/api/ciudades` | Público | Ciudades y departamentos para el registro. |
| `GET` | `/api/paises` | Público | Países disponibles para la ubicación del evento. |
| `GET` | `/api/paises/:id_pais/departamentos` | Público | Departamentos del país indicado. |
| `GET` | `/api/departamentos/:id_departamento/ciudades` | Público | Ciudades del departamento indicado. |
| `GET` | `/api/eventos` | Público | Eventos que no estén cancelados. |
| `GET` | `/api/eventos/:codigo` | Público | Detalle de un evento. |
| `GET` | `/api/agente/eventos` | Agente | Consulta todos los eventos; permite editar los propios. |
| `PUT` | `/api/agente/eventos/:codigo` | Agente | Actualiza un evento propio. |
| `POST` | `/api/eventos` | Agente | Publica un evento en estado `Programado`. |
| `GET` | `/api/agente/reservas` | Agente | Consulta todas las reservas. |
| `GET` | `/api/agente/estados-reserva` | Agente | Consulta estados disponibles. |
| `PATCH` | `/api/agente/reservas/:id` | Agente | Actualiza el estado de una reserva. |
| `POST` | `/api/auth/register` | Público | Crea una cuenta de cliente o agente. |
| `POST` | `/api/auth/registro` | Público | Alias compatible para registrar una cuenta. |
| `POST` | `/api/auth/login` | Público | Inicia sesión con correo y contraseña. |
| `POST` | `/api/auth/logout` | Público | Cierra la sesión eliminando la cookie `HttpOnly`. |
| `GET` | `/api/auth/me` | Sesión | Devuelve la cuenta autenticada. |
| `GET` | `/api/reservas` | Cliente | Consulta las reservas del cliente autenticado. |
| `POST` | `/api/reservas` | Cliente | Crea una reserva y comprueba la capacidad. |
| `GET` | `/api/admin/reportes` | Administrador | Devuelve conteos, reservas por evento/mes e ingresos mensuales. |

El registro recibe `identificacion`, `nombre_completo`, `correo`, `numero_telefono`, `id_ciudad`, `direccion`, `contrasena` y `rol` (`cliente` o `agente`). La contraseña debe tener al menos 8 caracteres. El inicio de sesión recibe `correo` y `contrasena`; las sesiones usan una cookie `HttpOnly`, `SameSite=Lax` y `Secure` en producción. Las solicitudes del navegador incluyen credenciales.

Para crear una reserva se envía `codigo_evento`, `numero_entradas` (de 1 a 10) y la `localidad` (`General`, `VIP` o `Preferencial`). El servidor calcula el total con el precio de esa localidad más $4.000 de servicio por entrada, verifica su capacidad dentro de una transacción y no acepta un total enviado por el navegador.

Para publicar un evento, el agente envía `codigo_evento`, `id_ciudad`, `nombre_evento`, `descripcion`, `teatro`, `fecha_hora_inicio`, `fecha_hora_fin_estimada`, `precio_base`, `precio_vip`, `precio_preferencial`, `capacidad_general`, `capacidad_vip`, `capacidad_preferencial` y, de forma opcional, `observaciones`/`url_imagen`. General usa `precio_base`. El backend verifica que las tres capacidades sean positivas y sumen `capacidad_total`; asocia el evento al agente de la sesión, no a una identificación enviada por el cliente.

Como el esquema almacena las fechas en `TIMESTAMP` sin zona horaria, la API las interpreta como hora local de Colombia (`America/Bogota`).

Los errores se devuelven como JSON con una propiedad `error`. Las contraseñas usan bcrypt y las consultas parametrizadas. Los endpoints de reservas y reportes están limitados por rol en el backend; la protección de vistas del navegador es una capa de UX, no reemplaza esa autorización.
