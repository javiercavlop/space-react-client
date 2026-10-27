import type { PricingTokenPayload, PricingTokenSubscription } from '@/types';

function parseJwt(token: string) {
  return JSON.parse(atob(token.split('.')[1]));
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
