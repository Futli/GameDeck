import { buildApp } from './app.js';
import { config } from './config.js';

const { app } = buildApp({
  logger: { level: config.logLevel },
  disconnectGraceMs: config.disconnectGraceMs,
});

// Корректная остановка по Ctrl+C / systemd: закрыть сокеты, затем HTTP.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    void app.close().then(() => process.exit(0));
  });
}

try {
  await app.listen({ host: config.host, port: config.port });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
