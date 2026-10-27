import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server as SocketIOServer, type Socket } from 'socket.io';

/**
 * A minimal in-process stand-in for the SPACE event server: Socket.IO on `/events` with the public
 * `/pricings` namespace and the authenticated `/contracts` namespace (org key in `auth.apiKey`).
 */
export class MockSpaceEvents {
  public io!: SocketIOServer;
  public readonly handshakes: { apiKey?: string; organizationId?: string }[] = [];
  public contractSockets: Socket[] = [];
  private server = http.createServer((_req, res) => {
    res.writeHead(404);
    res.end();
  });

  /**
   * @param validApiKey The organisation key accepted alone.
   * @param userApiKey A member user key (`usr_...`), accepted only with `auth.organizationId`.
   */
  constructor(
    private readonly validApiKey: string,
    private readonly userApiKey?: string,
  ) {}

  get url(): string {
    const { port } = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  async start(): Promise<void> {
    this.io = new SocketIOServer(this.server, { path: '/events', transports: ['websocket'] });
    this.io.of('/pricings');
    const contracts = this.io.of('/contracts');
    contracts.use((socket, next) => {
      const apiKey = socket.handshake.auth?.apiKey;
      const organizationId = socket.handshake.auth?.organizationId;
      this.handshakes.push(organizationId === undefined ? { apiKey } : { apiKey, organizationId });
      if (this.userApiKey !== undefined && apiKey === this.userApiKey) {
        return organizationId
          ? next()
          : next(new Error('organizationId is required for user keys'));
      }
      if (apiKey !== this.validApiKey) {
        return next(new Error('Invalid API key'));
      }
      next();
    });
    contracts.on('connection', (socket) => {
      this.contractSockets.push(socket);
      socket.on('disconnect', () => {
        this.contractSockets = this.contractSockets.filter((s) => s !== socket);
      });
    });
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', () => resolve()));
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.io.close(() => resolve()));
    if (this.server.listening) {
      await new Promise<void>((resolve) => this.server.close(() => resolve()));
    }
  }

  emitContractEvent(code: string, details: object) {
    this.io.of('/contracts').emit('message', { code, details });
  }

  emitPricingEvent(code: string, details: Record<string, unknown>) {
    this.io.of('/pricings').emit('message', { code, details });
  }
}

export function waitUntil(predicate: () => boolean, ms = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > ms) return reject(new Error('Timed out'));
      setTimeout(check, 10);
    };
    check();
  });
}
