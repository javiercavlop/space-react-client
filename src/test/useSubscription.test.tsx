import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { SpaceContext } from '@/contexts/SpaceContext';
import { TokenService } from '@/services/token';
import { useSubscription, type PricingTokenPayload, type PricingTokenSubscription } from '@/index';
import { createFakeJwt } from './utils/token/helpers';

const subscription: PricingTokenSubscription = {
  contractedServices: { acme: '2025-01-10' },
  subscriptionPlans: { acme: 'pro' },
  subscriptionAddOns: { acme: { extraStorage: 2 } },
  contractVersion: '4:2026-10-27T10:00:00.000Z',
};

function tokenWith(payload: Partial<PricingTokenPayload>, secondsAhead = 60) {
  return createFakeJwt({
    sub: 'user-1',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + secondsAhead,
    features: {},
    ...payload,
  } as Record<string, any>);
}

function Consumer() {
  const sub = useSubscription();
  return <div data-testid="sub">{sub ? JSON.stringify(sub) : 'NONE'}</div>;
}

function renderWith(ts: TokenService) {
  return render(
    <SpaceContext.Provider value={{ client: undefined, tokenService: ts }}>
      <Consumer />
    </SpaceContext.Provider>,
  );
}

describe('useSubscription hook', () => {
  it('returns null while there is no token', () => {
    renderWith(new TokenService());
    expect(screen.getByTestId('sub').textContent).toBe('NONE');
  });

  it('returns the subscription claim of the token and follows token updates', async () => {
    const ts = new TokenService();
    renderWith(ts);

    await act(async () => {
      ts.update(tokenWith({ subscription }));
    });
    expect(JSON.parse(screen.getByTestId('sub').textContent!)).toEqual(subscription);

    const upgraded = {
      ...subscription,
      subscriptionPlans: { acme: 'enterprise' },
      contractVersion: '5:x',
    };
    await act(async () => {
      ts.update(tokenWith({ subscription: upgraded }));
    });
    expect(JSON.parse(screen.getByTestId('sub').textContent!).subscriptionPlans.acme).toBe(
      'enterprise',
    );
  });

  it('returns null for tokens issued without the subscription claim (older SPACE)', async () => {
    const ts = new TokenService();
    renderWith(ts);

    await act(async () => {
      ts.update(tokenWith({}));
    });

    expect(screen.getByTestId('sub').textContent).toBe('NONE');
  });

  it('returns null once the token is expired', async () => {
    const ts = new TokenService();
    renderWith(ts);

    await act(async () => {
      ts.update(tokenWith({ subscription }, -10));
    });

    expect(screen.getByTestId('sub').textContent).toBe('NONE');
  });

  it('works in token-only mode (no SpaceClient)', async () => {
    const ts = new TokenService();
    renderWith(ts);
    await act(async () => {
      ts.update(tokenWith({ subscription }));
    });
    expect(screen.getByTestId('sub').textContent).not.toBe('NONE');
  });

  it('throws when used outside of SpaceProvider', () => {
    expect(() => render(<Consumer />)).toThrow();
  });
});

describe('TokenService.getSubscription', () => {
  it('returns the subscription claim or null', () => {
    const ts = new TokenService();
    expect(ts.getSubscription()).toBeNull();
    ts.update(tokenWith({ subscription }));
    expect(ts.getSubscription()).toEqual(subscription);
    ts.update(tokenWith({}));
    expect(ts.getSubscription()).toBeNull();
  });
});
