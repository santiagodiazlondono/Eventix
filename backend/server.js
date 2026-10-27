const { app, pool, port } = require('./app');

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`API de Eventix escuchando en el puerto ${port}.`);
});

async function shutdown() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);