import React from 'react';
import type { EventDeduplicationOptions } from './types/Events';

export type { SpaceClient } from './clients/SpaceClient';
export type { TokenService } from './services/token';

export type SpaceEvents =
  | 'synchronized'
  | 'pricing_created'
  | 'pricing_archived'
  | 'pricing_actived'
  | 'service_disabled'
  | ContractEvents
  | 'resync'
  | 'error';

/**
 * Contract events of the API key's organisation. They are delivered over the authenticated
 * `/contracts` namespace, so they only work when the client connects to SPACE with an API key.
 * Token-only apps (`allowConnectionWithSpace: false`) must learn about contract changes from their
 * backend (e.g. by fetching a fresh pricing token).
 */
export type ContractEvents =
  | 'contract_created'
  | 'contract_novated'
  | 'contract_deleted'
  | 'contract_renewed';

export interface SpaceConfiguration {
  url: string;
  apiKey: string;
  /**
   * Organisation of a member user key (`usr_...`). Sent with the handshake of the contract events
   * namespace (`{ apiKey, organizationId }`), which SPACE requires for user keys. Not needed for
   * organisation keys.
   */
  organizationId?: string;
  allowConnectionWithSpace: boolean
  /**
   * Drops repeated SPACE events by `eventId` (a consumer can receive one event more than once).
   * On by default, remembering the last 10,000 ids for up to 10 minutes; `false` turns it off.
   * Events without `eventId` (older SPACE) are always delivered.
   */
  eventDeduplication?: EventDeduplicationOptions | false;
}

export interface SpaceClientContext{
  client?: SpaceClient;
  tokenService: TokenService;
}

export type * from './types/Events';
export type * from './types/Token';