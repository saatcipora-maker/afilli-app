import app from "./app";
import { logger } from "./lib/logger";
import { bootstrapAdministrator } from './lib/admin-bootstrap';
import { getWriterCleanupHealth } from './lib/writer-cleanup-health';

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  // Read-only warning, not a cleanup job or a scheduler.
  void getWriterCleanupHealth().then(health => {
    if (health.warnings.length) logger.warn({ writerCleanup: health }, 'Yazar temizliği işletmen denetimi gerektiriyor');
  }).catch(() => {
    logger.warn({ warning: 'cleanup_monitoring_unavailable' }, 'Yazar temizliği durumu okunamadı; şema ve bağlantıyı denetleyin');
  });
  void bootstrapAdministrator().catch((error: unknown) => {
    logger.error({ errorType: error instanceof Error ? error.name : 'Unknown' }, 'İlk yönetici kurulumu tamamlanamadı; yönetici işlemleri kapalı kalır');
  });
});
