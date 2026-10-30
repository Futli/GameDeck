import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

// src/http и dist/http на одной глубине, поэтому путь подходит обоим.
const defaultClientDir = fileURLToPath(new URL('../../../client/dist', import.meta.url));

/**
 * В продакшене сервер сам отдаёт собранный клиент: один порт для страницы, API и WebSocket.
 * В разработке клиент отдаёт Vite (порт 5173), а этот код ничего не делает: папки dist ещё нет.
 */
export async function registerClient(app: FastifyInstance, clientDir = defaultClientDir): Promise<void> {
  if (!existsSync(clientDir)) {
    app.log.info({ clientDir }, 'client build not found, serving API only');
    return;
  }
  await app.register(fastifyStatic, { root: clientDir });

  // SPA: любой неизвестный GET вне /api отдаёт index.html, дальше разбирается клиент.
  app.setNotFoundHandler((request, reply) => {
    if (request.method === 'GET' && !request.url.startsWith('/api/')) return reply.sendFile('index.html');
    return reply.code(404).send({ error: 'NOT_FOUND' });
  });
}
