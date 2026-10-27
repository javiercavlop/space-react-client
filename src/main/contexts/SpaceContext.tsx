import React, { createContext, useEffect, useMemo } from "react";
import { SpaceClientContext, SpaceConfiguration } from "@/types";
import { SpaceClient as SpaceClientClass } from "../clients/SpaceClient";
import { TokenService } from "@/services/token";

// Context provides the SpaceClient instance
export const SpaceContext = createContext<SpaceClientContext | undefined>(undefined);

/**
 * SpaceProvider initializes and provides the SpaceClient instance to children.
 */
export const SpaceProvider = ({
  config,
  children,
}: { config: SpaceConfiguration, children: React.ReactNode }): React.JSX.Element => {
  // Memorize the client to avoid unnecessary re-instantiation
  const context = useMemo(() => {

    const denyConnectionWithSpace: boolean = config.allowConnectionWithSpace === false;

    const client = denyConnectionWithSpace ? undefined : new SpaceClientClass(config);
    let tokenService: TokenService | undefined;
    if (!client) {
      tokenService = new TokenService();
    }else{
      tokenService = client.token;
    }

    return {
      client: client,
      tokenService: tokenService,
    };
  }, [config.url, config.apiKey, config.organizationId, config.allowConnectionWithSpace]);

  useEffect(() => {
    return () => {
      if (context.client && typeof context.client.disconnectWebSocket === 'function') {
        context.client.disconnectWebSocket();
      }
    };
  }, [context.client]);

  return <SpaceContext.Provider value={context}>{children}</SpaceContext.Provider>;
};
