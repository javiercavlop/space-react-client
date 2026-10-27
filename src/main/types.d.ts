import React from 'react';

export type { SpaceClient } from './clients/SpaceClient';
export type { TokenService } from './services/token';

export type SpaceEvents =
  | 'synchronized'
  | 'pricing_created'
  | 'pricing_archived'
  | 'pricing_actived'
  | 'service_disabled'
  | ContractEvents
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
  allowConnectionWithSpace: boolean
}

export interface SpaceClientContext{
  client?: SpaceClient;
  tokenService: TokenService;
}

export type * from './types/Events';
export type * from './types/Token';