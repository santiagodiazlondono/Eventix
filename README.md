# Eventix

Eventix es un prototipo de una plataforma web para descubrir eventos y reservar entradas. El proyecto presenta una interfaz de boletería en español y un backend básico que puede enviar un correo de confirmación para una reserva.

> **Estado del proyecto:** prototipo académico en desarrollo. Los eventos y sus precios son datos estáticos de demostración. La reserva no procesa pagos, no guarda información en una base de datos ni descuenta inventario.

## Funcionalidades implementadas

- Página de inicio con eventos destacados, próximos eventos y navegación por secciones.
- Carrusel de seis eventos con controles, indicadores, avance automático y soporte para la preferencia de movimiento reducido del navegador.
- Búsqueda y filtros en la lista de próximos eventos por ciudad, categoría, fecha, estado y texto.
- Vista de detalle con información y precios según la zona seleccionada.
- Selector de cantidad de entradas de 1 a 10 y cálculo del subtotal, cargo de servicio y total.
- Endpoint de backend que envía por correo electrónico los datos de la reserva recibidos.

El cargo de servicio y los precios son valores ilustrativos definidos en el frontend; no representan una transacción real.

## Tecnologías

- **Frontend:** HTML, CSS y JavaScript nativo.
- **Backend:** Node.js, Express, CORS y Nodemailer.
- **Correo:** transporte SMTP de Gmail configurado en el backend.

No se utiliza un framework de frontend ni una base de datos. El repositorio actualmente no incluye un `package.json` ni un archivo de dependencias.

## Estructura del proyecto

```text
Eventix/
├── backend/
│   └── server.js                 # API Express y envío de correo
├── frontend/
│   ├── assets/
│   │   ├── eventos/              # Ilustraciones de eventos
│   │   └── iconos/               # Iconos e imágenes de interfaz
│   ├── controllers/
│   │   ├── carrusel.js            # Comportamiento del carrusel
│   │   ├── detalle-evento.js      # Datos, precios y reserva
│   │   └── filtros.js             # Búsqueda y filtros de eventos
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
- Una cuenta y configuración SMTP válidas si se desea probar el envío de correos.
- Una extensión o servidor estático para servir el frontend. Por ejemplo, se puede abrir `frontend/views/index.html` con **Live Server** en Visual Studio Code.

## Ejecución local

### 1. Iniciar el frontend

Abre la carpeta del proyecto en Visual Studio Code, inicia Live Server sobre `frontend/views/index.html` y navega por la página servida. También puedes usar cualquier servidor HTTP estático configurado para servir los archivos de `frontend/`.

No es recomendable abrir el HTML directamente como archivo (`file://`): servirlo por HTTP evita restricciones del navegador y facilita las solicitudes al backend.

### 2. Preparar e iniciar el backend

En una terminal, desde la raíz del proyecto:

```bash
cd backend
npm init -y
npm install express cors nodemailer
node server.js
```

El servidor escucha en el puerto `5000` y se enlaza a `0.0.0.0`. La ruta disponible es:

```text
POST /api/reservar
```

El cuerpo esperado es JSON:

```json
{
  "emailCliente": "cliente@ejemplo.com",
  "eventoTitulo": "Noche Sinfónica de Verano",
  "cantidad": 2,
  "total": "$178.000"
}
```

Cuando Nodemailer logra enviar el mensaje, el endpoint responde con estado HTTP `200` y un objeto con `status: "ok"`. Si falla el envío, responde con estado HTTP `500` y `status: "error"`.

### 3. Conectar el frontend al backend

El controlador de detalle realiza la solicitud desde el navegador a una dirección IP privada configurada directamente en `frontend/controllers/detalle-evento.js`. Para usar otra máquina o entorno, actualiza esa URL con la dirección y el puerto donde sea accesible el backend. El navegador que sirve la página debe poder conectarse a dicho host.

## Eventos de demostración

La página principal contiene seis tarjetas de eventos. La vista de detalle tiene datos dinámicos para estos identificadores:

| Identificador | Evento |
| --- | --- |
| `noche-sinfonica` | Noche Sinfónica de Verano |
| `jardin-espejos` | Obra: El Jardín de los Espejos |
| `stand-up` | Stand Up: Noche de Comedia |

Se abre un detalle pasando el identificador en la URL, por ejemplo:

```text
detalle-evento.html?id=jardin-espejos
```

Si el identificador no existe o se omite, la vista carga Noche Sinfónica de Verano.

## Limitaciones actuales y siguientes pasos

- Los datos de eventos están escritos directamente en los archivos HTML y JavaScript; no hay API de catálogo.
- El backend envía una notificación por correo, pero no registra reservas ni valida disponibilidad o precios.
- No hay integración de pagos, autenticación, cuentas, panel administrativo ni historial de reservas.
- El enlace de reserva de algunas tarjetas conduce a la vista predeterminada; solo los tres identificadores de la tabla cargan datos de detalle propios.
- Algunos enlaces de navegación (por ejemplo, catálogo, inicio de sesión y registro) apuntan a páginas que todavía no están incluidas en el proyecto.
- El endpoint de correo acepta los datos enviados por el cliente y no debe considerarse un flujo de compra seguro para producción.

## Seguridad antes de usar o publicar

- **No publiques ni compartas credenciales SMTP.** El backend actual contiene configuración de Gmail en el código fuente. Si esas credenciales son reales o estuvieron expuestas, revócalas o rótalas y migra la configuración a variables de entorno antes de continuar. El código actual todavía no implementa esa lectura desde el entorno.
- Restringe CORS a los orígenes que realmente utilizará la aplicación; actualmente está habilitado para cualquier origen.
- Antes de producción, valida y sanitiza los datos del endpoint en el servidor, y calcula allí precios y totales en lugar de confiar en los valores enviados por el navegador.
- Implementa almacenamiento persistente, control de inventario, autenticación y un proveedor de pagos si el proyecto evoluciona a una boletería real.

## Contexto académico

Proyecto Integrador, IV semestre, Facultad de Ingeniería de Sistemas, UCEVA (2026).

Autores: Santiago Rodríguez Díaz, Santiago Díaz Londoño, Noemiguel Moreno y Brayan Castaño.
