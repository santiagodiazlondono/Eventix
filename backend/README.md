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
| `GET` | `/api/ciudades` | Público | Ciudades y departamentos para el registro. |
| `GET` | `/api/eventos` | Público | Eventos que no estén cancelados. |
| `GET` | `/api/eventos/:codigo` | Público | Detalle de un evento. |
| `POST` | `/api/auth/registro` | Público | Crea una cuenta de cliente. |
| `POST` | `/api/auth/login` | Público | Inicia sesión con correo y contraseña. |
| `POST` | `/api/auth/logout` | Público | Cierra la sesión eliminando la cookie. |
| `GET` | `/api/auth/me` | Sesión | Devuelve la cuenta autenticada. |
| `GET` | `/api/reservas` | Cliente | Consulta las reservas del cliente autenticado. |
| `POST` | `/api/reservas` | Cliente | Crea una reserva y comprueba la capacidad. |

El registro recibe `identificacion`, `nombre_completo`, `correo`, `numero_telefono`, `id_ciudad`, `direccion` y `contrasena`. El inicio de sesión recibe `correo` y `contrasena`. Ambos establecen una cookie de sesión `HttpOnly`; las solicitudes del navegador deben incluir credenciales.

Para crear una reserva se envía `codigo_evento` y `numero_entradas` (de 1 a 10). El servidor calcula el total con `Evento.precio_base` más $4.000 de servicio por entrada; no acepta un total enviado por el navegador. La capacidad se verifica dentro de una transacción.

Como el esquema almacena las fechas en `TIMESTAMP` sin zona horaria, la API las interpreta como hora local de Colombia (`America/Bogota`).

Los errores se devuelven como JSON con una propiedad `error`. Las cuentas usan contraseñas hash y las rutas de reservas requieren una sesión de cliente.
