export interface EventMessage {
  code: string;
  /** Sent by SPACE versions with the `contract-event-ids` capability. */
  eventId?: string;
  /** Sent by SPACE versions with the `contract-event-ids` capability (ISO 8601). */
  occurredAt?: string;
  details: {
    serviceName: string;
    pricingVersion?: string;
  };
}

/**
 * Data of the contract events (`contract_created`, `contract_novated`, `contract_deleted`,
 * `contract_renewed`).
 */
export interface ContractEventDetails {
  userId: string;
  organizationId: string;
  /** The `contractVersion` after the change; `null` for `contract_deleted`. */
  contractVersion: string | null;
  services: string[];
}

export interface ContractEventMessage {
  code: 'CONTRACT_CREATED' | 'CONTRACT_NOVATED' | 'CONTRACT_DELETED' | 'CONTRACT_RENEWED';
  /** Sent by SPACE versions with the `contract-event-ids` capability. */
  eventId?: string;
  /** Sent by SPACE versions with the `contract-event-ids` capability (ISO 8601). */
  occurredAt?: string;
  details: ContractEventDetails;
}

/**
 * Top-level fields of a SPACE event other than `details`, passed to every pricing and contract
 * listener as its second argument. `eventId` and `occurredAt` are `undefined` with SPACE versions
 * without the `contract-event-ids` capability.
 */
export interface SpaceEventMeta {
  /** The event code as sent by SPACE, e.g. `CONTRACT_NOVATED`. */
  code: string;
  /**
   * Identifies the event: every copy of one event has the same `eventId`. The client already drops
   * repeats it has seen. Compare it for equality only, never to order events.
   */
  eventId?: string;
  /**
   * When SPACE stored the change, parsed from `rawOccurredAt`; `undefined` if missing or not a
   * valid date. It comes from the clock of the SPACE instance.
   */
  occurredAt?: Date;
  /** `occurredAt` exactly as SPACE sent it. */
  rawOccurredAt?: string;
}

/**
 * Passed to `resync` listeners each time a namespace connects. SPACE does not replay events, so
 * after a reconnection re-read what you hold (e.g. a fresh pricing token).
 */
export interface ResyncInfo {
  namespace: 'contracts' | 'pricings';
  /** `false` on the namespace's first connection, `true` when it connected again. */
  reconnect: boolean;
}

/**
 * Options of the per-client deduplication of SPACE events by `eventId`.
 */
export interface EventDeduplicationOptions {
  /** Set to `false` to deliver every copy (default `true`). */
  enabled?: boolean;
  /** At most this many ids are remembered; the oldest go first (default 10,000). */
  maxEntries?: number;
  /** An id is forgotten this long after it was first seen, in milliseconds (default 10 minutes). */
  windowMs?: number;
}
