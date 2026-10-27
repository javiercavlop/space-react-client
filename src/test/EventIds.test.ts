// @vitest-environment node
import { describe, it, expect, expectTypeOf, beforeAll, afterAll, afterEach } from 'vitest';
import { SpaceClient } from '../main/clients/SpaceClient';
import { EventIdWindow } from '../main/utils/EventIdWindow';
import type {
  ContractEventDetails,
  ResyncInfo,
  SpaceConfiguration,
  SpaceEventMeta,
} from '@/index';
import { MockSpaceEvents, waitUntil } from './utils/space/mockSpace';

const API_KEY = 'test-org-key';

const DETAILS: ContractEventDetails = {
  userId: 'user-1',
  organizationId: 'org-1',
  contractVersion: '4:x',
  services: ['acme'],
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('SpaceClient event ids, deduplication and resync (SPACE contract-event-ids)', () => {
  const space = new MockSpaceEvents(API_KEY);
  const clients: SpaceClient[] = [];

  function newClient(extra: Partial<SpaceConfiguration> = {}) {
    const client = new SpaceClient({
      url: space.url,
      apiKey: API_KEY,
      allowConnectionWithSpace: true,
      ...extra,
    });
    clients.push(client);
    return client;
  }

  function emitContract(payload: Record<string, unknown>) {
    space.io.of('/contracts').emit('message', payload);
  }

  async function recordNovations(client: SpaceClient) {
    const calls: { details: ContractEventDetails; meta: SpaceEventMeta }[] = [];
    client.on('contract_novated', (details, meta) => {
      calls.push({ details, meta });
    });
    await waitUntil(() => space.contractSockets.length === 1);
    return calls;
  }

  beforeAll(async () => {
    await space.start();
  });

  afterEach(async () => {
    clients.splice(0).forEach((c) => c.disconnectWebSocket());
    space.handshakes.length = 0;
    await waitUntil(() => space.contractSockets.length === 0);
  });

  afterAll(async () => {
    await space.stop();
  });

  it('Should pass eventId and occurredAt (parsed, raw kept) as the second listener argument', async () => {
    const client = newClient();
    const calls = await recordNovations(client);

    emitContract({
      code: 'CONTRACT_NOVATED',
      eventId: '019a2a6b-7c1e-7d3f-9b2a-5c4e8f1a2b3c',
      occurredAt: '2026-10-27T10:00:00.123Z',
      details: DETAILS,
    });
    await waitUntil(() => calls.length === 1);

    expect(calls[0].details).toEqual(DETAILS);
    expect(calls[0].meta.code).toBe('CONTRACT_NOVATED');
    expect(calls[0].meta.eventId).toBe('019a2a6b-7c1e-7d3f-9b2a-5c4e8f1a2b3c');
    expect(calls[0].meta.rawOccurredAt).toBe('2026-10-27T10:00:00.123Z');
    expect(calls[0].meta.occurredAt?.toISOString()).toBe('2026-10-27T10:00:00.123Z');
  });

  it('Should leave occurredAt undefined when it is missing or not a date', async () => {
    const client = newClient();
    const calls = await recordNovations(client);

    emitContract({ code: 'CONTRACT_NOVATED', details: DETAILS });
    emitContract({ code: 'CONTRACT_NOVATED', eventId: 'e-2', occurredAt: 'nope', details: DETAILS });
    await waitUntil(() => calls.length === 2);

    expect(calls[0].meta).toEqual({ code: 'CONTRACT_NOVATED' });
    expect(calls[1].meta.occurredAt).toBeUndefined();
    expect(calls[1].meta.rawOccurredAt).toBe('nope');
  });

  it('Should call the listener once for a repeated contract eventId', async () => {
    const client = newClient();
    const calls = await recordNovations(client);

    emitContract({ code: 'CONTRACT_NOVATED', eventId: 'a', details: DETAILS });
    emitContract({ code: 'CONTRACT_NOVATED', eventId: 'a', details: DETAILS });
    emitContract({ code: 'CONTRACT_NOVATED', eventId: 'b', details: DETAILS });
    await waitUntil(() => calls.length >= 2);
    await sleep(100);

    expect(calls.map((c) => c.meta.eventId)).toEqual(['a', 'b']);
  });

  it('Should drop a repeated eventId on the pricings namespace too', async () => {
    const client = newClient();
    const calls: { details: any; meta: SpaceEventMeta }[] = [];
    client.on('pricing_created', (details, meta) => {
      calls.push({ details, meta });
    });
    await new Promise<void>((resolve) => client.on('synchronized', () => resolve()));

    const event = {
      code: 'PRICING_CREATED',
      eventId: 'p-1',
      details: { serviceName: 'acme', pricingVersion: '2' },
    };
    space.io.of('/pricings').emit('message', event);
    space.io.of('/pricings').emit('message', event);
    await waitUntil(() => calls.length >= 1);
    await sleep(100);

    expect(calls).toHaveLength(1);
    expect(calls[0].details).toEqual({ serviceName: 'acme', pricingVersion: '2' });
    expect(calls[0].meta.eventId).toBe('p-1');
  });

  it('Should pass through events without eventId (older SPACE), even if identical', async () => {
    const client = newClient();
    const calls = await recordNovations(client);

    emitContract({ code: 'CONTRACT_NOVATED', details: DETAILS });
    emitContract({ code: 'CONTRACT_NOVATED', details: DETAILS });

    await waitUntil(() => calls.length === 2);
  });

  it('Should deliver repeats when deduplication is turned off', async () => {
    const client = newClient({ eventDeduplication: false });
    const calls = await recordNovations(client);

    emitContract({ code: 'CONTRACT_NOVATED', eventId: 'same', details: DETAILS });
    emitContract({ code: 'CONTRACT_NOVATED', eventId: 'same', details: DETAILS });

    await waitUntil(() => calls.length === 2);
  });

  it('Should forget the oldest ids beyond maxEntries', async () => {
    const client = newClient({ eventDeduplication: { maxEntries: 2 } });
    const calls = await recordNovations(client);

    for (const eventId of ['a', 'b', 'c', 'a', 'c']) {
      emitContract({ code: 'CONTRACT_NOVATED', eventId, details: DETAILS });
    }
    await waitUntil(() => calls.length >= 4);
    await sleep(100);

    // 'a' was evicted by 'c' (window of two: b, c); 'c' is still known.
    expect(calls.map((c) => c.meta.eventId)).toEqual(['a', 'b', 'c', 'a']);
  });

  it('Should emit resync on the first connection and after a reconnection', async () => {
    const client = newClient();
    const resyncs: ResyncInfo[] = [];
    client.on('resync', (info) => {
      resyncs.push(info);
    });
    await recordNovations(client);
    await waitUntil(() => resyncs.some((r) => r.namespace === 'contracts'));
    expect(resyncs).toContainEqual({ namespace: 'contracts', reconnect: false });

    resyncs.length = 0;
    space.contractSockets[0].conn.close();
    await waitUntil(
      () =>
        resyncs.some((r) => r.namespace === 'contracts') &&
        resyncs.some((r) => r.namespace === 'pricings'),
      6000,
    );
    expect(resyncs).toContainEqual({ namespace: 'contracts', reconnect: true });
    expect(resyncs).toContainEqual({ namespace: 'pricings', reconnect: true });
  }, 10000);

  it('Should type the listener arguments', () => {
    expectTypeOf<SpaceEventMeta['eventId']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<SpaceEventMeta['occurredAt']>().toEqualTypeOf<Date | undefined>();
    expectTypeOf<ResyncInfo['namespace']>().toEqualTypeOf<'contracts' | 'pricings'>();
    expectTypeOf<ResyncInfo['reconnect']>().toEqualTypeOf<boolean>();
  });
});

describe('EventIdWindow', () => {
  it('Should accept an id once and reject repeats', () => {
    const window = new EventIdWindow();
    expect(window.accept('x')).toBe(true);
    expect(window.accept('x')).toBe(false);
    expect(window.accept('y')).toBe(true);
    expect(window.size).toBe(2);
  });

  it('Should forget ids older than windowMs', () => {
    let now = 0;
    const window = new EventIdWindow({ windowMs: 1000 }, () => now);
    expect(window.accept('x')).toBe(true);
    now = 999;
    expect(window.accept('x')).toBe(false);
    now = 1001;
    expect(window.accept('x')).toBe(true);
  });

  it('Should keep at most maxEntries ids, dropping the oldest first', () => {
    const window = new EventIdWindow({ maxEntries: 3 });
    for (const id of ['1', '2', '3', '4']) {
      expect(window.accept(id)).toBe(true);
    }
    expect(window.size).toBe(3);
    expect(window.accept('1')).toBe(true);
    expect(window.accept('4')).toBe(false);
  });

  it('Should use sensible defaults and reject invalid options', () => {
    expect(EventIdWindow.DEFAULT_MAX_ENTRIES).toBe(10_000);
    expect(EventIdWindow.DEFAULT_WINDOW_MS).toBe(10 * 60_000);
    expect(() => new EventIdWindow({ maxEntries: 0 })).toThrow(RangeError);
    expect(() => new EventIdWindow({ windowMs: 0 })).toThrow(RangeError);
  });
});
