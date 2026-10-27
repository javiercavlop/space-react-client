/**
 * Opt-in verification of pricing tokens in the browser: `import { PricingTokenVerifier } from
 * 'space-react-client/verify'`. Kept out of the main entry point so that apps that only read tokens
 * do not bundle `jose`.
 */
import {
  createLocalJWKSet,
  decodeProtectedHeader,
  jwtVerify,
  type JSONWebKeySet,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';
import type { PricingTokenPayload } from './types/Token';

/**
 * Thrown when the connected SPACE does not implement a feature the call depends on. `capability`
 * is the `X-Space-Capabilities` token of the missing feature (`pricing-token-jwks` here).
 */
export class SpaceFeatureUnsupportedError extends Error {
  public readonly code = 'SPACE_FEATURE_UNSUPPORTED';

  constructor(
    public readonly capability: string,
    message?: string
  ) {
    super(message ?? `The connected SPACE does not support "${capability}"`);
    this.name = 'SpaceFeatureUnsupportedError';
  }
}

/** The `code` of a {@link PricingTokenVerificationError}. */
export type PricingTokenVerificationErrorCode =
  | 'PRICING_TOKEN_INVALID'
  | 'PRICING_TOKEN_SIGNATURE_INVALID'
  | 'PRICING_TOKEN_EXPIRED'
  | 'PRICING_TOKEN_WRONG_AUDIENCE'
  | 'PRICING_TOKEN_WRONG_ISSUER'
  | 'PRICING_TOKEN_UNKNOWN_KID'
  | 'PRICING_TOKEN_JWKS_UNAVAILABLE';

/**
 * Thrown by `PricingTokenVerifier.verify` when a pricing token
 * cannot be trusted. The subclasses name the usual reasons; this class itself is used for malformed
 * tokens, algorithms other than ES256, `jwk`/`jku`/`x5u`/`x5c` headers, missing or invalid claims
 * (`PRICING_TOKEN_INVALID`) and for a JWKS that could not be fetched
 * (`PRICING_TOKEN_JWKS_UNAVAILABLE`).
 */
export class PricingTokenVerificationError extends Error {
  constructor(
    public readonly code: PricingTokenVerificationErrorCode,
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'PricingTokenVerificationError';
  }
}

/** The signature does not match the published key the token names (forged or tampered token). */
export class PricingTokenSignatureError extends PricingTokenVerificationError {
  constructor(cause?: unknown) {
    super('PRICING_TOKEN_SIGNATURE_INVALID', 'The pricing token signature is invalid', cause);
    this.name = 'PricingTokenSignatureError';
  }
}

/** The token expired (`exp`, after the configured clock tolerance). */
export class PricingTokenExpiredError extends PricingTokenVerificationError {
  constructor(
    /** When the token expired, if it says so. */
    public readonly expiredAt: Date | undefined,
    cause?: unknown
  ) {
    super('PRICING_TOKEN_EXPIRED', 'The pricing token has expired', cause);
    this.name = 'PricingTokenExpiredError';
  }
}

/** The token was issued for another organization (`aud` or `organizationId`). */
export class PricingTokenAudienceError extends PricingTokenVerificationError {
  constructor(
    /** The organization the token had to be issued for. */
    public readonly expected: string,
    /** The `aud` or `organizationId` the token carries (may be missing). */
    public readonly actual: unknown,
    cause?: unknown
  ) {
    super('PRICING_TOKEN_WRONG_AUDIENCE', `The pricing token was not issued for organization ${expected}`, cause);
    this.name = 'PricingTokenAudienceError';
  }
}

/** The token was issued by another server (`iss`). */
export class PricingTokenIssuerError extends PricingTokenVerificationError {
  constructor(
    public readonly expected: string,
    public readonly actual: unknown,
    cause?: unknown
  ) {
    super('PRICING_TOKEN_WRONG_ISSUER', `The pricing token was not issued by ${expected}`, cause);
    this.name = 'PricingTokenIssuerError';
  }
}

/**
 * The token names a `kid` that SPACE does not publish, even after fetching the JWKS again: a key
 * that was removed (rotation or leaked key) or a token that SPACE did not sign.
 */
export class PricingTokenUnknownKeyError extends PricingTokenVerificationError {
  constructor(
    public readonly kid: string,
    cause?: unknown
  ) {
    super('PRICING_TOKEN_UNKNOWN_KID', `SPACE does not publish the key "${kid}" of this pricing token`, cause);
    this.name = 'PricingTokenUnknownKeyError';
  }
}


/** The `X-Space-Capabilities` token of SPACE versions that sign pricing tokens with ES256 and publish a JWKS. */
export const PRICING_TOKEN_JWKS = 'pricing-token-jwks';

/** The `iss` of pricing tokens when SPACE has no `JWT_ISSUER` configured. */
export const DEFAULT_PRICING_TOKEN_ISSUER = 'space';

/** Headers that point at or carry a key. SPACE never sends them, and a verifier must never use them. */
const FORBIDDEN_HEADERS = ['jwk', 'jku', 'x5u', 'x5c'];

const DEFAULT_CACHE_MAX_AGE_MS = 300_000;
const DEFAULT_REFETCH_COOLDOWN_MS = 30_000;

export interface PricingTokenVerifierOptions {
  /** The URL of SPACE, as passed to `connect` (the JWKS is read from `{url}/api/v1/.well-known/jwks.json`). */
  url?: string;
  /** The JWKS URL itself, instead of deriving it from `url`. */
  jwksUrl?: string;
  /**
   * The organization tokens must be issued for (`aud` and `organizationId`). Required, here or on
   * every `verify` call: a userId is only unique within its organization.
   */
  organizationId?: string;
  /** The expected `iss`: the `JWT_ISSUER` of your SPACE. Default `space`. */
  issuer?: string;
  /** Leeway for `exp`/`nbf`/`iat`, in seconds. Default 0. */
  clockToleranceSeconds?: number;
  /**
   * Minimum time between two JWKS fetches triggered by an unknown `kid`, in milliseconds. Default
   * 30 seconds, so that tokens with made-up `kid`s cannot make the verifier hammer SPACE.
   */
  refetchCooldownMs?: number;
  /** Timeout of the JWKS request, in milliseconds. Default 5000. */
  timeout?: number;
  /** The `fetch` to use. Default `globalThis.fetch`. */
  fetch?: typeof fetch;
  /** Clock of the JWKS cache and the refetch cooldown, in ms since epoch (tests). Default `Date.now`. */
  now?: () => number;
}

/** Per-call options of {@link PricingTokenVerifier.verify}. */
export interface VerifyPricingTokenOptions {
  /** The organization the token must be issued for; overrides the one of the verifier. */
  organizationId?: string;
  /** The expected `iss`; overrides the one of the verifier. */
  issuer?: string;
  /** Leeway for `exp`/`nbf`, in seconds; overrides the one of the verifier. */
  clockToleranceSeconds?: number;
}

interface CachedJwks {
  getKey: JWTVerifyGetKey;
  kids: Set<string>;
  fetchedAt: number;
  expiresAt: number;
}

/**
 * Verifies pricing tokens with the public keys SPACE publishes (JWKS, capability
 * `pricing-token-jwks`): ES256 only, the key chosen by `kid` among the published ones (never from
 * `jwk`/`jku`/`x5u`/`x5c` headers), `exp`, `iss` and `aud`/`organizationId`.
 *
 * The JWKS is cached for the `max-age` of its response (5 minutes without one) and fetched again
 * when a token names an unknown `kid` (a rotation), at most once per `refetchCooldownMs`. Keep one
 * verifier per SPACE and reuse it.
 */
export class PricingTokenVerifier {
  private readonly jwksUrl: string;
  private readonly organizationId?: string;
  private readonly issuer: string;
  private readonly clockToleranceSeconds: number;
  private readonly refetchCooldownMs: number;
  private readonly timeout: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private cached: CachedJwks | null = null;
  /** When the JWKS was last requested; an unknown `kid` only refetches it after the cooldown. */
  private lastFetchAt = Number.NEGATIVE_INFINITY;
  private inflight: Promise<CachedJwks> | null = null;

  constructor(options: PricingTokenVerifierOptions) {
    if (options.jwksUrl) {
      this.jwksUrl = options.jwksUrl;
    } else if (options.url) {
      this.jwksUrl = `${options.url.replace(/\/+$/, '')}/api/v1/.well-known/jwks.json`;
    } else {
      throw new TypeError('PricingTokenVerifier needs the url of SPACE (or jwksUrl)');
    }
    this.organizationId = options.organizationId;
    this.issuer = options.issuer ?? DEFAULT_PRICING_TOKEN_ISSUER;
    this.clockToleranceSeconds = options.clockToleranceSeconds ?? 0;
    this.refetchCooldownMs = options.refetchCooldownMs ?? DEFAULT_REFETCH_COOLDOWN_MS;
    this.timeout = options.timeout ?? 5000;
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.now = options.now ?? Date.now;
  }

  /**
   * Verifies `token` and returns its payload.
   *
   * @throws TypeError without an organizationId (here or in the constructor).
   * @throws PricingTokenSignatureError, PricingTokenExpiredError, PricingTokenAudienceError,
   *   PricingTokenIssuerError, PricingTokenUnknownKeyError, or PricingTokenVerificationError for
   *   any other reason the token cannot be trusted or the JWKS cannot be fetched.
   * @throws SpaceFeatureUnsupportedError (`pricing-token-jwks`) when SPACE does not publish the keys
   *   of its tokens (older versions, or a server in legacy HS256 mode).
   */
  public async verify(token: string, options: VerifyPricingTokenOptions = {}): Promise<PricingTokenPayload> {
    const organizationId = options.organizationId ?? this.organizationId;
    if (!organizationId) {
      throw new TypeError('verifying a pricing token needs the organizationId it must be issued for');
    }
    const issuer = options.issuer ?? this.issuer;
    const clockTolerance = options.clockToleranceSeconds ?? this.clockToleranceSeconds;
    const kid = checkHeader(token);

    let jwks = await this.getJwks();
    if (!jwks.kids.has(kid) && this.now() - this.lastFetchAt >= this.refetchCooldownMs) {
      jwks = await this.getJwks(true);
    }
    if (!jwks.kids.has(kid)) {
      throw new PricingTokenUnknownKeyError(kid);
    }

    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, jwks.getKey, {
        algorithms: ['ES256'],
        issuer,
        audience: organizationId,
        clockTolerance,
        requiredClaims: ['exp', 'sub'],
      }));
    } catch (error) {
      throw translate(error, kid, token, organizationId, issuer);
    }

    if (payload.organizationId !== organizationId) {
      throw new PricingTokenAudienceError(organizationId, payload.organizationId);
    }
    return payload as unknown as PricingTokenPayload;
  }

  /** Forgets the cached JWKS, so that the next verification fetches it again. */
  public clearCache(): void {
    this.cached = null;
  }

  private async getJwks(force = false): Promise<CachedJwks> {
    if (!force && this.cached && this.now() < this.cached.expiresAt) {
      return this.cached;
    }
    if (this.inflight) {
      return this.inflight;
    }
    this.inflight = this.fetchJwks().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async fetchJwks(): Promise<CachedJwks> {
    this.lastFetchAt = this.now();
    let response: Response;
    let body: unknown;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
    const timer = controller ? setTimeout(() => controller.abort(), this.timeout) : undefined;
    try {
      response = await this.fetchImpl(this.jwksUrl, {
        method: 'GET',
        headers: { Accept: 'application/jwk-set+json, application/json' },
        // Public endpoint: never send cookies or other credentials.
        credentials: 'omit',
        signal: controller?.signal,
      });
      body = response.status === 200 ? await response.json().catch(() => undefined) : undefined;
    } catch (error) {
      throw new PricingTokenVerificationError(
        'PRICING_TOKEN_JWKS_UNAVAILABLE',
        `Could not fetch the pricing token keys from ${this.jwksUrl}`,
        error
      );
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }

    // Every SPACE response carries X-Space-Capabilities (S0; SPACE exposes it to browsers through
    // CORS). A server that does not list pricing-token-jwks is older or in legacy HS256 mode; one
    // without the header at all predates S0. A 5xx without the header may come from a proxy, so it
    // is reported as unavailable.
    const rawCapabilities = response.headers.get('x-space-capabilities');
    const capabilities = (rawCapabilities ?? '').split(',').map((t) => t.trim().toLowerCase());
    const unsupported =
      rawCapabilities === null ? response.status < 500 : !capabilities.includes(PRICING_TOKEN_JWKS);
    if (unsupported) {
      throw new SpaceFeatureUnsupportedError(
        PRICING_TOKEN_JWKS,
        'The connected SPACE does not publish the keys of its pricing tokens (pricing-token-jwks): it is older, or signs them with the legacy HS256'
      );
    }
    if (response.status !== 200 || !isJwks(body)) {
      throw new PricingTokenVerificationError(
        'PRICING_TOKEN_JWKS_UNAVAILABLE',
        `SPACE answered ${response.status} to ${this.jwksUrl}`
      );
    }

    const keys = body.keys.filter(isEs256SigningKey);
    const fetchedAt = this.now();
    const cached: CachedJwks = {
      getKey: createLocalJWKSet({ keys }),
      kids: new Set(keys.map((k) => k.kid as string)),
      fetchedAt,
      expiresAt: fetchedAt + cacheMaxAgeMs(response.headers.get('cache-control')),
    };
    this.cached = cached;
    return cached;
  }
}

/** Checks the protected header before any key is looked up, and returns its `kid`. */
function checkHeader(token: string): string {
  let header: Record<string, unknown>;
  try {
    if (typeof token !== 'string' || token.split('.').length !== 3) {
      throw new Error('not a JWS in compact serialization');
    }
    header = decodeProtectedHeader(token) as Record<string, unknown>;
  } catch (error) {
    throw new PricingTokenVerificationError('PRICING_TOKEN_INVALID', 'The pricing token is malformed', error);
  }
  if (header.alg !== 'ES256') {
    throw new PricingTokenVerificationError(
      'PRICING_TOKEN_INVALID',
      `Pricing tokens must be signed with ES256, not ${JSON.stringify(header.alg)}`
    );
  }
  const forbidden = FORBIDDEN_HEADERS.find(name => name in header);
  if (forbidden) {
    throw new PricingTokenVerificationError(
      'PRICING_TOKEN_INVALID',
      `The pricing token has a "${forbidden}" header; keys are only taken from the JWKS of SPACE`
    );
  }
  if (typeof header.kid !== 'string' || header.kid === '') {
    throw new PricingTokenVerificationError('PRICING_TOKEN_INVALID', 'The pricing token names no key (kid)');
  }
  return header.kid;
}

function translate(error: unknown, kid: string, token: string, organizationId: string, issuer: string): Error {
  const code = (error as { code?: string })?.code;
  const claim = (error as { claim?: string })?.claim;
  if (code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED') {
    return new PricingTokenSignatureError(error);
  }
  if (code === 'ERR_JWKS_NO_MATCHING_KEY') {
    return new PricingTokenUnknownKeyError(kid, error);
  }
  const payload = (error as { payload?: JWTPayload })?.payload ?? unverifiedPayload(token);
  if (code === 'ERR_JWT_EXPIRED') {
    const exp = payload?.exp;
    return new PricingTokenExpiredError(typeof exp === 'number' ? new Date(exp * 1000) : undefined, error);
  }
  if (code === 'ERR_JWT_CLAIM_VALIDATION_FAILED' && claim === 'aud') {
    return new PricingTokenAudienceError(organizationId, payload?.aud, error);
  }
  if (code === 'ERR_JWT_CLAIM_VALIDATION_FAILED' && claim === 'iss') {
    return new PricingTokenIssuerError(issuer, payload?.iss, error);
  }
  return new PricingTokenVerificationError(
    'PRICING_TOKEN_INVALID',
    `The pricing token is invalid: ${(error as Error)?.message ?? String(error)}`,
    error
  );
}

/** Only used to fill in error details once the signature has been checked. */
function unverifiedPayload(token: string): JWTPayload | undefined {
  try {
    const base64 = (token.split('.')[1] ?? '').replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0))));
  } catch {
    return undefined;
  }
}

function isJwks(value: unknown): value is JSONWebKeySet {
  return !!value && typeof value === 'object' && Array.isArray((value as { keys?: unknown }).keys);
}

function isEs256SigningKey(key: unknown): key is JSONWebKeySet['keys'][number] {
  if (!key || typeof key !== 'object') {
    return false;
  }
  const k = key as Record<string, unknown>;
  return (
    k.kty === 'EC' &&
    k.crv === 'P-256' &&
    typeof k.kid === 'string' &&
    (k.alg === undefined || k.alg === 'ES256') &&
    (k.use === undefined || k.use === 'sig') &&
    k.d === undefined
  );
}

/** `max-age` of a Cache-Control header in ms; 0 for `no-store`/`no-cache`; 5 minutes if absent. */
export function cacheMaxAgeMs(header: unknown): number {
  if (typeof header !== 'string' || header.trim() === '') {
    return DEFAULT_CACHE_MAX_AGE_MS;
  }
  const directives = header.toLowerCase().split(',').map(d => d.trim());
  if (directives.includes('no-store') || directives.includes('no-cache')) {
    return 0;
  }
  const maxAge = directives.find(d => d.startsWith('max-age='));
  if (maxAge) {
    const seconds = Number(maxAge.slice('max-age='.length));
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1000;
    }
  }
  return DEFAULT_CACHE_MAX_AGE_MS;
}
