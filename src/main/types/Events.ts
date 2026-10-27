export interface EventMessage {
  code: string;
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
  details: ContractEventDetails;
}
