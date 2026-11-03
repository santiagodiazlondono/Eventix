# Backend de Eventix

API REST con Express y PostgreSQL para consultar eventos, registrar e iniciar sesión como cliente y crear/consultar reservas. `server.js` inicia el servidor y `app.js` define la API.

## Requisitos

- Node.js 20 o posterior.
- Una base PostgreSQL con las tablas del esquema Eventix (`Pais`, `Departamento`, `Ciudad`, `Persona`, `PersonaTelefono`, `Cliente`, `Agente`, `Administrador`, `EstadoEvento`, `EstadoReserva`, `Evento` y `Reserva`).
- En `Persona`: las columnas `password_hash` y `auth_version`. También se pueden agregar con:

```sql
ALTER TABLE persona ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE persona ADD COLUMN IF NOT EXISTS auth_version INTEGER NOT NULL DEFAULT 0;
```

La tabla `EstadoReserva` debe contener un estado `Reservada` o `Confirmada`.
La tabla `EstadoEvento` debe contener un estado `Programado`.

## Migraciones

Ejecuta una sola vez y en orden en el SQL Editor de Neon las migraciones [`migrations/001_event_locality_capacities.sql`](migrations/001_event_locality_capacities.sql) y [`migrations/002_reservation_locality.sql`](migrations/002_reservation_locality.sql). La primera agrega las capacidades por localidad, asigna los aforos existentes a General y deja VIP/Preferencial en cero para los eventos ya creados. La segunda agrega la localidad a las reservas existentes (las asigna a General). Los eventos nuevos requieren un aforo positivo en cada una de las tres localidades; `capacidad_total` siempre es la suma.

## Configuración

Desde esta carpeta instala las dependencias y crea el archivo local de entorno:

```powershell
npm.cmd install
Copy-Item .env.example .env
```

Configura `DATABASE_URL` con la cadena de conexión de Neon rotada, `JWT_SECRET` con una clave aleatoria de al menos 32 caracteres y `CORS_ORIGINS` con el origen real del frontend. No compartas ni subas `.env` al repositorio.

Genera un secreto local con:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Mientras no estén listos el registro y el inicio de sesión de agentes, el archivo `.env.example` habilita el modo local temporal para desarrollo. Al crear `backend/.env`, conserva estas opciones:

```env
NODE_ENV=development
ENABLE_LOCAL_AGENT_MODE=true
```

Cada persona que clone el repositorio puede usar el modo desde su propio `localhost` después de configurar su `.env` y reiniciar el backend; no necesita activar otra opción si `NODE_ENV=development`. Para proteger la base de datos, publicar y consultar eventos sin sesión solo se permite desde una conexión local y requiere que exista un agente en la tabla `Agente`; opcionalmente, define `LOCAL_AGENT_IDENTIFICACION` para elegir un agente existente. No funciona en producción ni desde otros equipos de la red. Puedes deshabilitarlo en desarrollo con `ENABLE_LOCAL_AGENT_MODE=false`.

Inicia la API:

```powershell
npm.cmd start
```

El servidor escucha en el puerto `5000` de forma predeterminada. `GET /api/health` comprueba la conexión a la base de datos.

Para comprobar la sintaxis de los dos archivos de servidor, ejecuta `npm.cmd run check`.

## Rutas

| Método | Ruta | Acceso | Descripción |
| --- | --- | --- | --- |
| `GET` | `/api/health` | Público | Estado del servicio y conexión a PostgreSQL. |
| `GET` | `/api/dev/agent-mode` | Público | Indica si el modo temporal de agente está habilitado para la conexión local. |
| `GET` | `/api/ciudades` | Público | Ciudades y departamentos para el registro. |
| `GET` | `/api/paises` | Público | Países disponibles para la ubicación del evento. |
| `GET` | `/api/paises/:id_pais/departamentos` | Público | Departamentos del país indicado. |
| `GET` | `/api/departamentos/:id_departamento/ciudades` | Público | Ciudades del departamento indicado. |
| `GET` | `/api/eventos` | Público | Eventos que no estén cancelados. |
| `GET` | `/api/eventos/:codigo` | Público | Detalle de un evento. |
| `GET` | `/api/agente/eventos` | Agente o modo local | Eventos publicados por el agente autenticado. |
| `PUT` | `/api/agente/eventos/:codigo` | Agente o modo local | Actualiza los datos y la ubicación de un evento propio. |
| `PATCH` | `/api/agente/eventos/:codigo/estado` | Agente o modo local | Cambia el estado de un evento propio. |
| `DELETE` | `/api/agente/eventos/:codigo` | Agente o modo local | Elimina un evento propio si aún no tiene reservas. |
| `GET` | `/api/estados-evento` | Público | Estados disponibles para eventos. |
| `POST` | `/api/eventos` | Agente o modo local | Publica un evento en estado `Programado`. |
| `POST` | `/api/auth/registro` | Público | Crea una cuenta de cliente. |
| `POST` | `/api/auth/login` | Público | Inicia sesión con correo y contraseña. |
| `POST` | `/api/auth/logout` | Público | Cierra la sesión eliminando la cookie. |
| `GET` | `/api/auth/me` | Sesión | Devuelve la cuenta autenticada. |
| `GET` | `/api/reservas` | Cliente | Consulta las reservas del cliente autenticado. |
| `POST` | `/api/reservas` | Cliente | Crea una reserva y comprueba la capacidad. |

El registro recibe `identificacion`, `nombre_completo`, `correo`, `numero_telefono`, `id_ciudad`, `direccion` y `contrasena`. El inicio de sesión recibe `correo` y `contrasena`. Ambos establecen una cookie de sesión `HttpOnly`; las solicitudes del navegador deben incluir credenciales.

Para crear una reserva se envía `codigo_evento`, `numero_entradas` (de 1 a 10) y la `localidad` (`General`, `VIP` o `Preferencial`). El servidor calcula el total con el precio de esa localidad más $4.000 de servicio por entrada, verifica su capacidad dentro de una transacción y no acepta un total enviado por el navegador.

Para publicar un evento, el agente envía `codigo_evento`, `id_ciudad`, `nombre_evento`, `descripcion`, `teatro`, `fecha_hora_inicio`, `fecha_hora_fin_estimada`, `precio_base`, `precio_vip`, `precio_preferencial`, `capacidad_general`, `capacidad_vip`, `capacidad_preferencial` y, de forma opcional, `observaciones`/`url_imagen`. General usa `precio_base`. El backend verifica que las tres capacidades sean positivas y sumen `capacidad_total`; asocia el evento al agente de la sesión, no a una identificación enviada por el cliente.

Como el esquema almacena las fechas en `TIMESTAMP` sin zona horaria, la API las interpreta como hora local de Colombia (`America/Bogota`).

Los errores se devuelven como JSON con una propiedad `error`. Las cuentas usan contraseñas hash y las rutas de reservas requieren una sesión de cliente.
