// @vitest-environment node
import { describe, it, expect, expectTypeOf, beforeAll, afterAll, afterEach } from 'vitest';
import { SpaceClient } from '../main/clients/SpaceClient';
import type { ContractEventDetails, SpaceEvents } from '@/index';
import { MockSpaceEvents, waitUntil } from './utils/space/mockSpace';

const API_KEY = 'test-org-key';
const USER_KEY = 'usr_member-key';

describe('SpaceClient contract events against a mocked SPACE', () => {
  const space = new MockSpaceEvents(API_KEY, USER_KEY);
  const clients: SpaceClient[] = [];

  function newClient(apiKey = API_KEY, organizationId?: string) {
    const client = new SpaceClient({
      url: space.url,
      apiKey,
      organizationId,
      allowConnectionWithSpace: true,
    });
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
    // Organisation keys: only the key goes in the handshake.
    expect(space.handshakes[0]).toEqual({ apiKey: API_KEY });

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

  it('Should send organizationId in the handshake for member user keys', async () => {
    const client = newClient(USER_KEY, 'org-1');
    const received = new Promise<ContractEventDetails>((resolve) =>
      client.on('contract_created', (data) => resolve(data)),
    );
    await waitUntil(() => space.contractSockets.length === 1);

    expect(space.handshakes[0]).toEqual({ apiKey: USER_KEY, organizationId: 'org-1' });
    const details = { userId: 'u', organizationId: 'org-1', contractVersion: '1:x', services: [] };
    space.emitContractEvent('CONTRACT_CREATED', details);
    expect(await received).toEqual(details);
  });

  it('Should report a user-key handshake without organizationId as an error event', async () => {
    const client = newClient(USER_KEY);
    const error = new Promise<any>((resolve) => client.on('error', (e) => resolve(e)));
    client.on('contract_novated', () => undefined);

    expect((await error).message).toMatch(/organizationId/);
  });

  it('Should deliver contract_deleted with a null contractVersion', async () => {
    const client = newClient();
    const received = new Promise<ContractEventDetails>((resolve) =>
      client.on('contract_deleted', (data) => resolve(data)),
    );
    await waitUntil(() => space.contractSockets.length === 1);

    const details: ContractEventDetails = {
      userId: 'user-1',
      organizationId: 'org-1',
      contractVersion: null,
      services: ['acme'],
    };
    space.emitContractEvent('CONTRACT_DELETED', details);

    expect((await received).contractVersion).toBeNull();
    expectTypeOf<ContractEventDetails['contractVersion']>().toEqualTypeOf<string | null>();
  });

  it('Should keep the namespace open while any contract listener remains', async () => {
    const client = newClient();
    const a = () => undefined;
    const b = () => undefined;
    client.on('contract_novated', a);
    client.on('contract_novated', b);
    client.on('contract_created', a);
    await waitUntil(() => space.contractSockets.length === 1);

    client.off('contract_novated', a);
    client.off('contract_created');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(space.contractSockets).toHaveLength(1);

    client.off('contract_novated', b);
    await waitUntil(() => space.contractSockets.length === 0);
  });

  it('Should track contract listeners itself, not through the emitter internals', async () => {
    const client = newClient();
    client.on('contract_renewed', () => undefined);
    await waitUntil(() => space.contractSockets.length === 1);

    // Whatever TinyEmitter keeps privately must not matter.
    (client as any).emitter.e = {};
    client.off('pricing_created');
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(space.contractSockets).toHaveLength(1);
  });
});
