import { TinyEmitter } from 'tiny-emitter';
import type {
  ContractEvents,
  ResyncInfo,
  SpaceEventMeta,
  SpaceEvents,
  SpaceConfiguration,
} from '@/types';
import { EventIdWindow } from '@/utils/EventIdWindow';
import axios, { AxiosInstance } from 'axios';
import { TokenService } from '@/services/token';
import { io, Socket } from 'socket.io-client';

const CONTRACT_EVENTS: ContractEvents[] = [
  'contract_created',
  'contract_novated',
  'contract_deleted',
  'contract_renewed',
];

const SUPPORTED_EVENTS: SpaceEvents[] = [
  'synchronized',
  'pricing_created',
  'pricing_archived',
  'pricing_actived',
  'service_disabled',
  ...CONTRACT_EVENTS,
  'resync',
  'error',
];

function isContractEvent(event: string): event is ContractEvents {
  return (CONTRACT_EVENTS as string[]).includes(event);
}

/**
 * SpaceClient handles API and WebSocket communication with SPACE.
 * It allows event subscription and provides feature evaluation methods.
 */
export class SpaceClient {
  private readonly httpUrl: string;
  private readonly wsUrl: string;
  private readonly socketClient: Socket;
  /**
   * The WebSocket namespace specifically for pricing-related events.
   */
  private readonly pricingSocketNamespace: Socket;
  /**
   * The authenticated WebSocket namespace for contract events of the API key's organisation.
   * Opened lazily, when the first contract event listener is registered.
   */
  private contractSocketNamespace: Socket | null = null;
  private readonly apiKey: string;
  /** Organisation of a member user key, sent with the `/contracts` handshake. */
  private readonly organizationId?: string;
  /**
   * Callbacks registered for each contract event, kept here (not read from the emitter) to know
   * when the `/contracts` namespace is still needed.
   */
  private readonly contractListeners = new Map<ContractEvents, Set<(...args: any[]) => void>>();
  /** The `eventId`s seen recently, shared by both namespaces; `null` when deduplication is off. */
  private readonly eventIds: EventIdWindow | null;
  /** Whether each namespace connected before, to tell a reconnection from the first connection. */
  private readonly connectedBefore: Record<ResyncInfo['namespace'], boolean> = {
    pricings: false,
    contracts: false,
  };
  private readonly axios: AxiosInstance;
  private readonly emitter: any;
  public readonly token: TokenService;
  private userId: string | null = null;

  constructor(config: SpaceConfiguration) {
    const normalizedUrl = config.url.endsWith('/') ? config.url.slice(0, -1) : config.url;
    const parsedUrl = new URL(normalizedUrl);
    const basePath = parsedUrl.pathname === '/' ? '' : parsedUrl.pathname.replace(/\/+$/, '');
    const socketPath = `${basePath}/events`;

    this.httpUrl = `${normalizedUrl}/api/v1`;
    this.wsUrl = `${parsedUrl.protocol === 'https:' ? 'wss:' : 'ws:'}//${parsedUrl.host}${basePath}`;
    this.socketClient = io(this.wsUrl, {
      path: socketPath,
      transports: ['websocket'],
    });
    this.pricingSocketNamespace = this.socketClient.io.socket('/pricings');
    this.apiKey = config.apiKey;
    this.organizationId = config.organizationId;
    const dedup = config.eventDeduplication;
    this.eventIds =
      dedup === false || dedup?.enabled === false ? null : new EventIdWindow(dedup ?? {});
    this.emitter = new TinyEmitter();
    this.token = new TokenService();

    this.axios = axios.create({
      baseURL: this.httpUrl,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': `${this.apiKey}`,
      },
    });

    this.connectWebSocket();
  }

  disconnectWebSocket() {
    this.contractSocketNamespace?.disconnect();
    if (this.pricingSocketNamespace.connected) {
      this.pricingSocketNamespace.disconnect();
      this.emitter.off(); // Remove all listeners
      this.contractListeners.clear();
    }
  }

  /**
   * Connects to the SPACE WebSocket and handles incoming events.
   */
  connectWebSocket() {
    this.pricingSocketNamespace.on('connect', () => {
      console.log('Connected to SPACE');
      this.emitter.emit('synchronized', 'WebSocket connection established');
      this.emitResync('pricings');
    });

    this.pricingSocketNamespace.on('message', (data: any) => {
      const meta = this.acceptEvent(data);
      if (!meta) return;
      const event = (data.code as SpaceEvents).toLowerCase();
      this.emitter.emit(event, data.details, meta);
    });

    this.pricingSocketNamespace.on('connect_error', (error: any) => {
      this.emitter.emit('error', error);
    });
  }

  /**
   * Opens the authenticated `/contracts` namespace, sending `{ apiKey }` (organisation keys) or
   * `{ apiKey, organizationId }` (member user keys) in the handshake.
   */
  private connectContractSocket() {
    if (!this.contractSocketNamespace) {
      this.contractSocketNamespace = this.socketClient.io.socket('/contracts', {
        auth:
          this.organizationId !== undefined
            ? { apiKey: this.apiKey, organizationId: this.organizationId }
            : { apiKey: this.apiKey },
      });

      this.contractSocketNamespace.on('connect', () => {
        this.emitResync('contracts');
      });

      this.contractSocketNamespace.on('message', (data: any) => {
        const meta = this.acceptEvent(data);
        if (!meta) return;
        const event = String(data?.code ?? '').toLowerCase();
        if (isContractEvent(event)) {
          this.emitter.emit(event, data.details, meta);
        }
      });

      this.contractSocketNamespace.on('connect_error', (error: any) => {
        this.emitter.emit('error', error);
      });
    }

    if (!this.contractSocketNamespace.connected && !this.contractSocketNamespace.active) {
      this.contractSocketNamespace.connect();
    }
  }

  /**
   * Reads the top-level fields of an event, or returns `null` if it repeats an `eventId` seen in
   * the deduplication window. Events without `eventId` are always accepted.
   */
  private acceptEvent(data: any): SpaceEventMeta | null {
    const meta: SpaceEventMeta = { code: String(data?.code ?? '') };
    if (typeof data?.eventId === 'string' && data.eventId !== '') {
      if (this.eventIds && !this.eventIds.accept(data.eventId)) {
        return null;
      }
      meta.eventId = data.eventId;
    }
    if (typeof data?.occurredAt === 'string') {
      meta.rawOccurredAt = data.occurredAt;
      const occurredAt = new Date(data.occurredAt);
      if (!Number.isNaN(occurredAt.getTime())) {
        meta.occurredAt = occurredAt;
      }
    }
    return meta;
  }

  private emitResync(namespace: ResyncInfo['namespace']) {
    const info: ResyncInfo = { namespace, reconnect: this.connectedBefore[namespace] };
    this.connectedBefore[namespace] = true;
    this.emitter.emit('resync', info);
  }

  private hasContractListeners(): boolean {
    for (const callbacks of this.contractListeners.values()) {
      if (callbacks.size > 0) return true;
    }
    return false;
  }

  /**
   * Listen to SPACE and connection events.
   * @param event The event key to listen for.
   * @param callback The callback function to execute when the event is emitted.
   * @example
   * ```typescript
   * spaceClient.on('pricing_created', (data) => {
   *   console.log('Pricing created:', data);
   * });
   * ```
   *
   * Contract events (`contract_created`, `contract_novated`, `contract_deleted`,
   * `contract_renewed`) open the authenticated `/contracts` namespace on first use and carry
   * `{ userId, organizationId, contractVersion, services }` (`contractVersion` is `null` for
   * `contract_deleted`). They require connecting with an API key that SPACE accepts for that
   * namespace (member user keys also need `organizationId` in the configuration); token-only apps should get contract changes from their
   * backend instead.
   *
   * Pricing and contract listeners also receive a `SpaceEventMeta` (`code`, `eventId`,
   * `occurredAt`) as a second argument; a repeated `eventId` is not delivered again. `resync`
   * fires each time a namespace connects, with a `ResyncInfo`: SPACE does not replay events, so
   * after a reconnection re-read what you hold.
   * @throws Will throw an error if the event is not recognized.
   * @throws Will throw an error if the callback is not a function.
   */
  on(event: 'resync', callback: (info: ResyncInfo) => void): void;
  on(event: SpaceEvents, callback: (data: any, meta: SpaceEventMeta) => void): void;
  on(event: SpaceEvents, callback: (...args: any[]) => void): void {
    if (typeof callback !== 'function') {
      throw new Error(`Callback for event '${event}' must be a function.`);
    }

    if (SUPPORTED_EVENTS.indexOf(event) === -1) {
      throw new Error(`Event '${event}' is not recognized.`);
    }

    this.emitter.on(event, callback);

    if (isContractEvent(event)) {
      const callbacks = this.contractListeners.get(event) ?? new Set();
      callbacks.add(callback);
      this.contractListeners.set(event, callbacks);
      this.connectContractSocket();
    }
  }

  /**
   * Removes event listeners.
   * @param event (optional) The event to remove listeners for. If omitted, removes all listeners.
   * @param callback (optional) The specific callback to remove.
   */
  public off(event?: SpaceEvents, callback?: (...args: any[]) => void) {
    if (event && callback) {
      this.emitter.off(event, callback);
      if (isContractEvent(event)) this.contractListeners.get(event)?.delete(callback);
    } else if (event) {
      this.emitter.off(event);
      if (isContractEvent(event)) this.contractListeners.delete(event);
    } else {
      this.emitter.off();
      this.contractListeners.clear();
    }

    if (!event || !this.hasContractListeners()) {
      this.contractSocketNamespace?.disconnect();
    }
  }

  /**
   * Sets the user ID for the client and loads the pricing token for that user.
   * @param userId The user ID to set for the client.
   * @returns A promise that resolves when the user ID is set and the pricing token is generated.
   * @throws Will throw an error if the user ID is not a non-empty string.
   * @example
   * ```typescript
   * await spaceClient.setUserId('user123');
   * ```
   */
  async setUserId(userId: string): Promise<void> {
    if (typeof userId !== 'string' || userId.trim() === '') {
      throw new Error('User ID must be a non-empty string.');
    }
    this.userId = userId;

    const userPricingToken = await this.generateUserPricingToken();

    this.token.update(userPricingToken);
  }

  /**
   * Performs a request to SPACE to retrieve a new pricing token for the user with the given userId.
   * @param userId The user ID for which to evaluate the feature.
   * @returns A promise that resolves to the pricing token.
   * @throws Will throw an error if the request fails.
   */
  async generateUserPricingToken(): Promise<string> {
    if (!this.userId) {
      throw new Error(
        'User ID is not set. Please set the user ID with `setUserId(userId)` before trying to generate a pricing token.',
      );
    }

    return this.axios
      .post(`/features/${this.userId}/pricing-token`)
      .then((response) => {
        return response.data.pricingToken;
      })
      .catch((error) => {
        console.error(`Error generating pricing token for user ${this.userId}:`, error);
        throw error;
      });
  }
}
