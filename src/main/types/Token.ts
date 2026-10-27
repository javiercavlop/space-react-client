/**
 * The subscription a pricing token was issued for (claim `subscription`, added by SPACE with the
 * subscription-change API). Older tokens do not carry it.
 */
export interface PricingTokenSubscription {
  /** Service name -> pricing version of the contract. */
  contractedServices: Record<string, string>;
  /** Service name -> subscribed plan. */
  subscriptionPlans: Record<string, string>;
  /** Service name -> { add-on name -> quantity }. */
  subscriptionAddOns: Record<string, Record<string, number>>;
  /** The `contractVersion` of the contract when the token was issued. */
  contractVersion: string;
}

export interface PricingTokenFeatureEvaluation {
  eval: boolean;
  used?: Record<string, number | boolean> | null;
  limit?: Record<string, number | boolean> | null;
  error?: { code: string; message: string } | null;
}

/**
 * The decoded payload of a SPACE pricing token.
 */
export interface PricingTokenPayload {
  /**
   * The subject of the token. Opaque: do not parse it and do not use it as the userId. SPACE
   * versions with per-organization userIds (capability `contract-userid-per-org`) send
   * `urn:space:<organizationId>:<percent-encoded userId>`; older versions send the bare userId.
   * Use `pricingTokenUserId(payload)` or `TokenService.getUserId()` to get the userId.
   */
  sub?: string;
  /**
   * The userId of the contract, as stored in SPACE (not encoded). Absent in tokens issued by SPACE
   * versions without per-organization userIds, whose `sub` is the userId.
   */
  userId?: string;
  /** The organization of the contract. A userId is only unique within its organization. */
  organizationId?: string;
  /** Audience: the organization the token was issued for (equal to `organizationId`). */
  aud?: string | string[];
  /** Issuer: the SPACE server (its `JWT_ISSUER`, `space` by default). */
  iss?: string;
  /** Issued at (seconds since epoch). */
  iat?: number;
  /** Expiration (seconds since epoch). */
  exp: number;
  /** Evaluation of every feature of the contract, keyed by feature id. */
  features: Record<string, PricingTokenFeatureEvaluation>;
  pricingContext?: Record<string, any>;
  subscriptionContext?: Record<string, any>;
  /** Present only in tokens issued by SPACE versions that include the subscription. */
  subscription?: PricingTokenSubscription;
  /** Other claims are kept as they come; narrow them before use. */
  [claim: string]: unknown;
}
