import type { PricingTokenPayload, PricingTokenSubscription } from '@/types';
import { usePricingTokenPayload } from './usePricingTokenPayload';

/**
 * React hook that returns the subscription carried by the current pricing token (contracted
 * pricing versions, plans, add-ons and `contractVersion`) and re-renders when the token changes.
 * Needs no connection to SPACE, so it works in token-only mode.
 *
 * @returns The subscription, or `null` if there is no valid token or the token was issued by a
 * SPACE version that does not include it.
 */
export function useSubscription(): PricingTokenSubscription | null {
  const payload = usePricingTokenPayload<PricingTokenPayload>();
  return payload?.subscription ?? null;
}
