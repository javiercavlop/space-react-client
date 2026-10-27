// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { SpaceClient } from '../main/clients/SpaceClient';
import type { ContractEventDetails, SpaceEvents } from '@/index';
import { MockSpaceEvents, waitUntil } from './utils/space/mockSpace';

const API_KEY = 'test-org-key';

describe('SpaceClient contract events against a mocked SPACE', () => {
  const space = new MockSpaceEvents(API_KEY);
  const clients: SpaceClient[] = [];

  function newClient(apiKey = API_KEY) {
    const client = new SpaceClient({ url: space.url, apiKey, allowConnectionWithSpace: true });
    clients.push(client);
    return client;
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

  it('Should accept the contract event names', () => {
    const client = newClient();
    const names: SpaceEvents[] = [
      'contract_created',
      'contract_novated',
      'contract_deleted',
      'contract_renewed',
    ];
    for (const name of names) {
      expect(() => client.on(name, () => undefined)).not.toThrow();
    }
  });

  it('Should still reject unknown events', () => {
    const client = newClient();
    expect(() => client.on('contract_exploded' as SpaceEvents, () => undefined)).toThrow(
      /not recognized/,
    );
  });

  it('Should only open the authenticated contracts namespace once a contract listener exists', async () => {
    const client = newClient();
    await new Promise<void>((resolve) => client.on('synchronized', () => resolve()));
    expect(space.handshakes).toHaveLength(0);

    const received = new Promise<ContractEventDetails>((resolve) =>
      client.on('contract_novated', (data) => resolve(data)),
    );
    await waitUntil(() => space.contractSockets.length === 1);
    expect(space.handshakes[0].apiKey).toBe(API_KEY);

    const details = {
      userId: 'user-1',
      organizationId: 'org-1',
      contractVersion: '4:x',
      services: ['acme'],
    };
    space.emitContractEvent('CONTRACT_NOVATED', details);

    expect(await received).toEqual(details);
  });

  it('Should keep delivering pricing events', async () => {
    const client = newClient();
    const received = new Promise((resolve) => client.on('pricing_created', (d) => resolve(d)));
    await new Promise<void>((resolve) => client.on('synchronized', () => resolve()));

    space.emitPricingEvent('PRICING_CREATED', { serviceName: 'acme', pricingVersion: '2' });

    expect(await received).toEqual({ serviceName: 'acme', pricingVersion: '2' });
  });

  it('Should report a rejected API key on the contracts namespace as an error event', async () => {
    const client = newClient('wrong-key');
    const error = new Promise<any>((resolve) => client.on('error', (e) => resolve(e)));
    client.on('contract_created', () => undefined);

    expect((await error).message).toBe('Invalid API key');
  });

  it('Should close the contracts namespace when the last contract listener is removed', async () => {
    const client = newClient();
    const cb = () => undefined;
    client.on('contract_deleted', cb);
    await waitUntil(() => space.contractSockets.length === 1);

    client.off('contract_deleted', cb);

    await waitUntil(() => space.contractSockets.length === 0);
  });

  it('Should close the contracts namespace on disconnectWebSocket()', async () => {
    const client = newClient();
    await new Promise<void>((resolve) => client.on('synchronized', () => resolve()));
    client.on('contract_renewed', () => undefined);
    await waitUntil(() => space.contractSockets.length === 1);

    client.disconnectWebSocket();

    await waitUntil(() => space.contractSockets.length === 0);
  });
});
