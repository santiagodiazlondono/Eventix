# Eventix

Eventix es un prototipo de una plataforma web para descubrir eventos y reservar entradas. Incluye una interfaz en español y una API REST con PostgreSQL para eventos, cuentas de clientes y reservas.

> **Estado del proyecto:** prototipo académico en desarrollo. El inicio, el catálogo y el detalle consultan los eventos registrados en Neon. La API puede guardar reservas y descontar la capacidad disponible, pero no procesa pagos.

## Funcionalidades implementadas

- Página de inicio y catálogo con eventos cargados desde la base de datos.
- Búsqueda y filtros de eventos por ciudad, fecha, estado y texto.
- Vista de detalle con información y precio base consultados desde la base de datos.
- Selector de cantidad de entradas de 1 a 10 y cálculo del subtotal, cargo de servicio y total.
- API para consultar eventos y ciudades, registrar e iniciar sesión como cliente y crear/consultar reservas.
- Validación de capacidad y cálculo de precios en el servidor.

El cargo de servicio ($4.000 por entrada) es ilustrativo; no representa una transacción real.

## Tecnologías

- **Frontend:** HTML, CSS y JavaScript nativo.
- **Backend:** Node.js, Express y PostgreSQL (Neon).
- **Seguridad:** contraseñas con hash, sesiones mediante cookie `HttpOnly`, validación de entradas y CORS configurable.

El frontend usa HTML, CSS y JavaScript nativo. Las dependencias del backend y los endpoints están descritos en [backend/README.md](backend/README.md).

## Estructura del proyecto

```text
Eventix/
├── backend/
│   ├── app.js                    # Rutas y lógica de la API
│   ├── server.js                 # Inicio del servidor
│   ├── package.json              # Dependencias y comandos
│   └── .env.example              # Variables de entorno de ejemplo
├── frontend/
│   ├── assets/
│   │   ├── eventos/              # Ilustraciones de eventos
│   │   └── iconos/               # Iconos e imágenes de interfaz
│   ├── controllers/
│   │   ├── eventos.js             # Consulta y renderizado de la API
│   │   ├── catalogo.js            # Búsqueda y filtro del catálogo
│   │   ├── detalle-evento.js      # Detalle y reserva
│   │   └── filtros.js             # Filtros de la página principal
│   ├── css/
│   │   ├── perfil.css             # Estilos del perfil de cliente
│   │   └── styles.css             # Estilos de la aplicación
│   └── views/
│       ├── index.html              # Página de inicio
│       ├── detalle-evento.html     # Vista de reserva/detalle
│       └── perfil.html             # Perfil del cliente
└── README.md
```

## Requisitos

- Un navegador moderno.
- Node.js y npm para ejecutar el backend.
- Una base PostgreSQL configurada con el esquema de Eventix.
- Una extensión o servidor estático para servir el frontend. Por ejemplo, se puede abrir `frontend/views/index.html` con **Live Server** en Visual Studio Code.

## Ejecución local

### 1. Iniciar el frontend

Abre la carpeta del proyecto en Visual Studio Code, inicia Live Server sobre `frontend/views/index.html` y navega por la página servida. También puedes usar cualquier servidor HTTP estático configurado para servir los archivos de `frontend/`.

No es recomendable abrir el HTML directamente como archivo (`file://`): servirlo por HTTP evita restricciones del navegador y facilita las solicitudes al backend.

### 2. Preparar e iniciar el backend

En una terminal de PowerShell:

```powershell
Set-Location backend
npm.cmd install
Copy-Item .env.example .env
```

Completa `DATABASE_URL` con la cadena de conexión de Neon, crea un `JWT_SECRET` aleatorio de al menos 32 caracteres y configura `CORS_ORIGINS` con el origen desde el que servirás el frontend. No compartas ni subas `.env` al repositorio. Luego inicia el servidor:

```powershell
npm.cmd start
```

El servidor escucha en el puerto `5000` de forma predeterminada. Las rutas disponibles y los formatos de solicitud están en [backend/README.md](backend/README.md).

## Eventos desde la base de datos

El inicio y el catálogo muestran los eventos que devuelve `GET /api/eventos`. Para abrir un detalle, cada tarjeta usa el código `codigo_evento` guardado en la base de datos:

```text
detalle-evento.html?id=CODIGO_DEL_EVENTO
```

Si no hay eventos registrados, las listas se muestran vacías. Si la API no está disponible, la página indica que no pudo conectarse en lugar de mostrar tarjetas de ejemplo.

## Limitaciones actuales y siguientes pasos

- No hay integración de pagos ni panel administrativo protegido.
- Los formularios de inicio de sesión y registro todavía no están conectados a la API; las reservas requieren una sesión autenticada.

## Seguridad antes de usar o publicar

- **Rota las credenciales que compartiste en el chat y las credenciales de correo que estuvieron en el historial del repositorio.** Aunque se retiraron del archivo actual, pueden seguir presentes en el historial de Git. Usa únicamente variables locales en `.env`.
- Configura `CORS_ORIGINS` para los orígenes reales del frontend antes de publicar el servicio.
- La API no procesa pagos; una reserva no equivale a una compra pagada.

## Contexto académico

Proyecto Integrador, IV semestre, Facultad de Ingeniería de Sistemas, UCEVA (2026).

Autores: Santiago Rodríguez Díaz, Santiago Díaz Londoño, Noemiguel Moreno y Brayan Castaño.
