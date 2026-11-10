# Backend de Eventix

API REST con Express y PostgreSQL para gestionar cuentas de clientes, agentes y administradores, eventos y reservas. `server.js` inicia el servidor y `app.js` define la API.

## Requisitos

- Node.js 20 o posterior.
- Una base PostgreSQL con las tablas del esquema Eventix (`Pais`, `Departamento`, `Ciudad`, `Persona`, `PersonaTelefono`, `Cliente`, `Agente`, `Administrador`, `EstadoEvento`, `EstadoReserva`, `Evento` y `Reserva`).
- La tabla `Persona` almacena `password_hash` y `auth_version`. Los roles se obtienen de las tablas subtipo `Cliente`, `Agente` y `Administrador`.

## Migraciones

Ejecuta en orden en el SQL Editor de Neon las migraciones [`001_event_locality_capacities.sql`](migrations/001_event_locality_capacities.sql), [`002_reservation_locality.sql`](migrations/002_reservation_locality.sql), [`003_auth_and_reservation_states.sql`](migrations/003_auth_and_reservation_states.sql), [`004_agent_approval.sql`](migrations/004_agent_approval.sql) y [`005_profile_account_deletion.sql`](migrations/005_profile_account_deletion.sql). Son idempotentes. La primera agrega capacidades por localidad; la segunda añade localidad a las reservas existentes; la tercera asegura columnas de sesión, correo único ignorando mayúsculas/minúsculas y estados `Confirmada`/`Cancelada`; la cuarta agrega estado y metadatos de resolución de solicitudes de agente; la quinta permite desactivar y anonimizar cuentas sin borrar reservas ni eventos relacionados. Los agentes existentes quedan aprobados para conservar su acceso. No elimina datos.

## Configuración

Desde esta carpeta instala las dependencias y crea el archivo local de entorno:

```powershell
npm.cmd install
Copy-Item .env.example .env
```

Configura `DATABASE_URL` con la cadena de conexión de Neon, `JWT_SECRET` con una clave aleatoria de al menos 32 caracteres y `CORS_ORIGINS` con el origen real del frontend. `JWT_EXPIRES_IN` define la duración de sesión (por ejemplo, `1h` o `7d`). No compartas ni subas `.env` al repositorio.

Para enviar comprobantes de reservas, configura en `.env` las credenciales SMTP del proveedor de correo: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` y `SMTP_FROM`. El ejemplo está preparado para Gmail; usa una contraseña de aplicación de Google, no la contraseña normal de la cuenta. Si el proveedor no requiere autenticación, deja `SMTP_USER` y `SMTP_PASS` vacíos. Sin una configuración SMTP válida las reservas se guardan, pero la API devuelve `correo_enviado: false` y muestra un aviso al cliente.

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
| `GET` | `/api/agente/eventos` | Agente | Lista eventos y permite editar solo los propios. |
| `PUT` | `/api/agente/eventos/:codigo` | Agente | Actualiza los datos y la ubicación de un evento propio. |
| `PATCH` | `/api/agente/eventos/:codigo/estado` | Agente | Cambia el estado de un evento propio. |
| `DELETE` | `/api/agente/eventos/:codigo` | Agente | Elimina un evento propio si aún no tiene reservas. |
| `GET` | `/api/estados-evento` | Público | Estados disponibles para eventos. |
| `POST` | `/api/eventos` | Agente | Publica un evento en estado `Programado`. |
| `POST` | `/api/auth/registro` | Público | Crea una cuenta de cliente o agente. |
| `POST` | `/api/auth/login` | Público | Inicia sesión con correo y contraseña. |
| `POST` | `/api/auth/logout` | Público | Cierra la sesión eliminando la cookie `HttpOnly`. |
| `GET` | `/api/auth/me` | Sesión | Devuelve la cuenta autenticada. |
| `GET/PUT/DELETE` | `/api/perfil` | Sesión | Consulta/actualiza el perfil propio o desactiva la cuenta conservando su historial. |
| `GET` | `/api/reservas` | Cliente | Consulta las reservas del cliente autenticado. |
| `POST` | `/api/reservas` | Cliente | Crea una reserva y comprueba la capacidad. |
| `DELETE` | `/api/reservas/:id` | Cliente | Cancela una reserva propia sin borrar su historial. |
| `GET` | `/api/admin/reportes` | Administrador | Devuelve conteos, reservas por evento/mes e ingresos mensuales. |
| `GET/POST` | `/api/admin/usuarios` | Administrador | Lista cuentas y crea clientes, agentes o administradores. |
| `PUT/DELETE` | `/api/admin/usuarios/:identificacion` | Administrador | Actualiza o elimina una cuenta respetando reservas, eventos y el último administrador. |
| `GET` | `/api/admin/catalogos/paises` | Administrador | Lista países con sus departamentos. |
| `GET` | `/api/admin/catalogos/departamentos` | Administrador | Lista departamentos con país y cantidad de ciudades. |
| `GET` | `/api/admin/catalogos/ciudades` | Administrador | Lista ciudades con su departamento y país. |
| `POST` | `/api/admin/catalogos/:tipo` | Administrador | Crea país, departamento o ciudad (`tipo`: `paises`, `departamentos` o `ciudades`). |
| `PUT/DELETE` | `/api/admin/catalogos/:tipo/:id` | Administrador | Actualiza o elimina un elemento geográfico. No permite borrar elementos con registros asociados. |

El registro recibe `identificacion`, `nombre_completo`, `correo`, `numero_telefono`, `id_ciudad`, `direccion`, `contrasena` y `rol` (`cliente` o `agente`). La contraseña debe tener al menos 8 caracteres. El inicio de sesión recibe `correo` y `contrasena`; las sesiones usan una cookie `HttpOnly`, `SameSite=Lax` y `Secure` en producción. Las solicitudes del navegador incluyen credenciales.

La eliminación desde el perfil requiere la contraseña actual. Desactiva el acceso, anonimiza nombre, correo, dirección y teléfono, y conserva las relaciones con reservas/eventos para mantener el historial. La identificación y ciudad se mantienen como referencias internas; no es posible eliminar al último administrador activo.

Para crear una reserva se envía `codigo_evento`, `numero_entradas` (de 1 a 10) y la `localidad` (`General`, `VIP` o `Preferencial`). El servidor calcula el total con el precio de esa localidad más $4.000 de servicio por entrada, verifica su capacidad dentro de una transacción y no acepta un total enviado por el navegador. No permite reservar eventos cancelados, finalizados o que ya hayan iniciado.

Al crear o cancelar una reserva, el backend envía un comprobante al correo asociado a la cuenta. La operación en la base de datos se confirma antes del envío para que un problema SMTP no revierta ni duplique el cambio; si falla el correo, se informa explícitamente en la respuesta.

Para publicar un evento, el agente envía `codigo_evento`, `id_ciudad`, `nombre_evento`, `descripcion`, `teatro`, `fecha_hora_inicio`, `fecha_hora_fin_estimada`, `precio_base`, `precio_vip`, `precio_preferencial`, `capacidad_general`, `capacidad_vip`, `capacidad_preferencial` y, de forma opcional, `observaciones`/`url_imagen`. General usa `precio_base`. El backend verifica que las tres capacidades sean positivas y sumen `capacidad_total`; asocia el evento al agente de la sesión, no a una identificación enviada por el cliente.

Como el esquema almacena las fechas en `TIMESTAMP` sin zona horaria, la API las interpreta como hora local de Colombia (`America/Bogota`).

Los errores se devuelven como JSON con una propiedad `error`. Las contraseñas usan bcrypt y las consultas parametrizadas. Los endpoints de reservas y reportes están limitados por rol en el backend; la protección de vistas del navegador es una capa de UX, no reemplaza esa autorización.
