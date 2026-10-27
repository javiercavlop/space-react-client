import { describe, it, expect, expectTypeOf, beforeEach, vi } from 'vitest';
import { TokenService, pricingTokenUserId } from '@/services/token';
import type { PricingTokenPayload } from '@/types';
import { ORGANIZATION_ID, createFakeJwt, createJwt, newServerPayload } from './utils/token/helpers';

describe('Pricing token claims (space#80)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('reads the userId claim of tokens from new servers', () => {
    expect(pricingTokenUserId(newServerPayload('user-1'))).toBe('user-1');
  });

  it('returns the raw userId, not the percent-encoded part of the URN', () => {
    for (const userId of ['a:b', 'a%3Ab', 'with space', 'mail@example.com', 'a/b', 'ñandú']) {
      const payload = newServerPayload(userId);
      expect(payload.sub).not.toBe(userId);
      expect(pricingTokenUserId(payload)).toBe(userId);
    }
  });

  it('never parses sub when the token has a userId claim', () => {
    const payload = { ...newServerPayload('user-1'), sub: 'urn:space:other-org:someone-else' };
    expect(pricingTokenUserId(payload)).toBe('user-1');
  });

  it('falls back to sub for tokens from servers without the userId claim', () => {
    expect(pricingTokenUserId({ sub: 'j0hnD03', exp: 1, features: {} })).toBe('j0hnD03');
    expect(pricingTokenUserId({ sub: 'urn:space:x:y', exp: 1, features: {} })).toBe('urn:space:x:y');
    expect(pricingTokenUserId({ exp: 1, features: {} })).toBeNull();
  });

  it('rejects a userId claim that is not a string instead of falling back to sub', () => {
    const payload = { ...newServerPayload('user-1'), userId: 42 } as unknown as PricingTokenPayload;
    expect(() => pricingTokenUserId(payload)).toThrow(TypeError);
    expect(() => pricingTokenUserId(payload)).toThrow(/userId claim/);
  });

  it('TokenService.getUserId reads the stored token', () => {
    const service = new TokenService();
    expect(service.getUserId()).toBeNull();

    service.update(createJwt(newServerPayload('ñandú')));
    expect(service.getUserId()).toBe('ñandú');
    expect(service.getKey('organizationId')).toBe(ORGANIZATION_ID);

    const now = Math.floor(Date.now() / 1000);
    service.update(createFakeJwt({ sub: 'j0hnD03', exp: now + 60, features: {} }));
    expect(service.getUserId()).toBe('j0hnD03');

    service.update(createJwt(newServerPayload('user-1', -60)));
    expect(service.getUserId()).toBeNull();
  });

  it('decodes base64url payloads with UTF-8 claims, as SPACE encodes them', () => {
    const payload = { ...newServerPayload('ñandú'), note: '~~~???' };
    const token = createJwt(payload);
    // The payload segment uses the URL-safe alphabet and the userId is not Latin-1 ASCII.
    expect(token.split('.')[1]).toMatch(/[-_]/);

    const service = new TokenService();
    service.update(token);
    expect(service.getPayload()).toEqual(payload);
    expect(service.getUserId()).toBe('ñandú');
  });

  it('types the new claims as optional', () => {
    expectTypeOf<PricingTokenPayload['userId']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<PricingTokenPayload['organizationId']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<PricingTokenPayload['aud']>().toEqualTypeOf<string | string[] | undefined>();
    expectTypeOf<PricingTokenPayload['iss']>().toEqualTypeOf<string | undefined>();
    expectTypeOf(pricingTokenUserId).returns.toEqualTypeOf<string | null>();
  });
});
