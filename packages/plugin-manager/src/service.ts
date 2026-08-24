import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import type {
  NativePluginManagerV1,
  PluginManagerRunResultV1,
} from './manager.js';

export interface PluginManagerServiceOptionsV1 {
  manager: Pick<NativePluginManagerV1, 'readiness' | 'runOnce'>;
  host?: string;
  port?: number;
  pollIntervalMs?: number;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

export interface PluginManagerServiceV1 {
  start(): Promise<{ host: string; port: number }>;
  stop(): Promise<void>;
  runOnce(): Promise<PluginManagerRunResultV1>;
}

function json(
  response: ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(`${JSON.stringify(body)}\n`);
}

function route(request: IncomingMessage): string {
  return new URL(request.url ?? '/', 'http://plugin-manager.internal').pathname;
}

export function createPluginManagerServiceV1(
  options: PluginManagerServiceOptionsV1,
): PluginManagerServiceV1 {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 8788;
  const pollIntervalMs = options.pollIntervalMs ?? 5_000;
  const logger = options.logger ?? console;
  let timer: NodeJS.Timeout | undefined;
  let polling = false;
  let stopping = false;
  let listening = false;

  const poll = async (): Promise<PluginManagerRunResultV1> => {
    if (polling || stopping) return { status: 'idle' };
    polling = true;
    try {
      const result = await options.manager.runOnce();
      if (result.status !== 'idle' && result.status !== 'awaiting_approval') {
        logger.info(`plugin_manager_result:${result.status}`);
      }
      return result;
    } finally {
      polling = false;
    }
  };

  const server = createServer(async (request, response) => {
    const path = route(request);
    if (request.method === 'GET' && path === '/_manager/health') {
      json(response, 200, { status: 'live' });
      return;
    }
    if (request.method === 'GET' && path === '/_manager/ready') {
      try {
        const capability = await options.manager.readiness();
        json(response, 200, {
          status: 'ready',
          managerVersion: capability.managerVersion,
          managerState: capability.state,
        });
      } catch {
        json(response, 503, {
          status: 'not_ready',
          reasonCode: 'host_control_unavailable',
        });
      }
      return;
    }
    json(response, 404, { status: 'not_found' });
  });

  return {
    async start() {
      stopping = false;
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => {
          server.off('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          server.off('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, host);
      });
      listening = true;
      await poll().catch(() => logger.warn('plugin_manager_initial_poll_failed'));
      timer = setInterval(() => {
        void poll().catch(() => logger.warn('plugin_manager_poll_failed'));
      }, pollIntervalMs);
      timer.unref();
      return { host, port };
    },
    async stop() {
      stopping = true;
      if (timer) clearInterval(timer);
      timer = undefined;
      if (!listening) return;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      listening = false;
    },
    runOnce: poll,
  };
}
