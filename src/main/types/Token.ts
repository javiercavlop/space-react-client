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
  /** The userId of the contract. */
  sub?: string;
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
