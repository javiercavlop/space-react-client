import type { PricingTokenPayload, PricingTokenSubscription } from '@/types';

/** The payload of a JWT: base64url (RFC 7515), UTF-8 JSON. Not verified. */
function parseJwt(token: string) {
  const segment = token.split('.')[1] ?? '';
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/**
 * The userId a pricing token was issued for.
 *
 * Reads the `userId` claim. Only tokens without it (issued by SPACE versions that predate
 * per-organization userIds, where `sub` is the bare userId) fall back to `sub`. `sub` is never
 * parsed: on newer servers it is an opaque `urn:space:...` subject. This does not verify the token.
 *
 * @returns The userId, or `null` if the token has neither claim.
 * @throws TypeError if the token has a `userId` claim that is not a string.
 */
export function pricingTokenUserId(payload: Partial<PricingTokenPayload>): string | null {
  const { userId } = payload;
  if (userId !== undefined && userId !== null) {
    if (typeof userId !== 'string') {
      throw new TypeError('The userId claim of the pricing token is not a string');
    }
    return userId;
  }
  return typeof payload.sub === 'string' ? payload.sub : null;
}

/**
 * Checks if the current pricing token is expired based on the 'exp' claim.
 * @returns True if the token is expired or not set, false otherwise.
 */
function isTokenExpired(tokenPayload: Record<string, any>): boolean {
  if (typeof tokenPayload.exp !== 'number') {
    return true;
  }
  // 'exp' is in seconds since epoch
  const now = Math.floor(Date.now() / 1000);
  return now >= tokenPayload.exp;
}

export class TokenService {
  private tokenPayload: Record<string, any> | null = null;
  private listeners: Set<() => void> = new Set();

  /**
   * Retrieves the stored pricing token's payload.
   * @returns The stored pricing token payload.
   */
  getPayload() {
    if (!this._validToken()) {
      return null;
    }

    return this.tokenPayload;
  }

  /**
   * Retrieves an attribute from the stored pricing token payload and returns it.
   * @param key - A key of the stored pricing token whose is going to be retrieved.
   * @return The value of the key in the stored pricing token payload.
   */
  getKey(key: string) {
    if (!this._validToken()) {
      return null;
    }

    return this.tokenPayload![key];
  }

  /**
   * Retrieves the subscription the stored pricing token was issued for (claim `subscription`).
   * @returns The subscription, or `null` if there is no valid token or the token does not carry it
   * (tokens issued by SPACE versions without the subscription claim).
   */
  getSubscription(): PricingTokenSubscription | null {
    if (!this._validToken()) {
      return null;
    }

    return (this.tokenPayload as PricingTokenPayload).subscription ?? null;
  }

  /**
   * Retrieves the userId the stored pricing token was issued for (see `pricingTokenUserId`).
   * @returns The userId, or `null` if there is no valid token.
   */
  getUserId(): string | null {
    if (!this._validToken()) {
      return null;
    }

    return pricingTokenUserId(this.tokenPayload as PricingTokenPayload);
  }

  /**
   * Updates the stored pricing token with the payload of a new one.
   * @param token - Pricing token string
   */
  update(token: string): void {
    const parsedToken = parseJwt(token);

    this.tokenPayload = parsedToken;
    this._notify();
  }

  evaluateFeature(featureId: string): boolean | null {
    if (!this._validToken()) {
      return false;
    }

    // Check if the feature exists in the token payload
    if (this.tokenPayload?.features?.[featureId]) {
      return this.tokenPayload!.features[featureId].eval;
    } else {
      console.warn(`Feature '${featureId}' not found in token payload.`);
      return null;
    }
  }

  private _validToken(): boolean {
    if (!this.tokenPayload) {
      console.warn('Token payload is not set. Please call TokenService.update first.');
      return false;
    }

    if (isTokenExpired(this.tokenPayload)) {
      console.warn('Pricing token is expired. Please update it the pricing token.');
      return false;
    }

    return true;
  }

  /**
   * Subscribe to pricing token updates. Returns an unsubscribe function.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Notify all listeners that the token has changed. */
  private _notify() {
    this.listeners.forEach((l) => {
      try {
        l();
      } catch (e) {
        console.error(e);
      }
    });
  }
}
