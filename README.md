# 🚀 SPACE Client SDK for React

The **SPACE React SDK** provides fully-typed React/TypeScript **components, hooks, and utilities** to seamlessly integrate your web apps with SPACE.  

With this SDK you can:

- ⚡ **Connect** a React application to a **SPACE** instance (HTTP + WebSocket).
- 🔑 Generate and manage **Pricing Tokens** directly in the client.
- 🧩 **Activate/deactivate UI components** declaratively with the `<Feature>` component.
- 🔔 **Subscribe to SPACE pricing events** to keep your UI in sync.  

> [!WARNING]
> This SDK is intended for research and experimentation. For production usage, see **[License & Disclaimer](#-license--disclaimer)**.

---

## ⚠️ Important Note

- **Feature evaluation is always based on the Pricing Token.**  
  `space-react-client` does not call SPACE directly to check features; instead, it uses the Pricing Token stored in the browser’s `localStorage`.  
  (See [SPACE communication protocol](../../introduction.mdx) for more details on how pricing tokens work.)

---

## 📦 Installation

Install with your package manager of choice:

```bash
npm install space-react-client
# or
yarn add space-react-client
# or
pnpm add space-react-client
```

**Peer dependencies:**

- `react >= 18`
- `react-dom >= 18`

---

## ⚡ Quick Start

The minimal setup to connect to SPACE, load a user’s Pricing Token, and render UI conditionally with `<Feature>`.

### 1. Wrap your app with `SpaceProvider`

```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { SpaceProvider } from 'space-react-client';
import App from './App';

const config = {
  url: 'http://localhost:5403', // Your SPACE instance URL
  apiKey: 'YOUR_API_KEY',       // API key issued by SPACE
  allowConnectionWithSpace: true,
};

createRoot(document.getElementById('root')!)
  .render(
    <SpaceProvider config={config}>
      <App />
    </SpaceProvider>
  );
```

> [!WARNING]
> Setting `allowConnectionWithSpace: false` disables all connections to SPACE.  
> This means you can still evaluate features from a token, but **event listeners (e.g., pricing_created, pricing_archived, etc.) as well as methods like `setUserId` and `generateUserPricingToken` will not work.** 

### 2. Identify the user and load a Pricing Token

```tsx
import { useEffect } from 'react';
import { useSpaceClient } from 'space-react-client';

export function TokenBootstrapper() {
  const spaceClient = useSpaceClient();

  useEffect(() => {
    spaceClient.setUserId('user-123')
      .then(() => console.log("User's pricing token set"))
      .catch(console.error);

    // Listen for SPACE sync events
    const onSync = () => console.log('Connected & synchronized with SPACE');
    spaceClient.on('synchronized', onSync);

    return () => spaceClient.off('synchronized', onSync);
  }, [spaceClient]);

  return <YourComponent />;
}
```

### 3. Gate UI with `<Feature>`

```tsx
import { Feature, On, Default, Loading, ErrorFallback } from 'space-react-client';

export function MeetingButton() {
  return (
    <Feature id="zoom-meetings">
      <On>
        {/* Rendered when feature is enabled */}
        <button>Start meeting</button>
      </On>
      <Default>
        {/* Rendered when feature is disabled */}
        <button disabled>Upgrade to enable meetings</button>
      </Default>
      <Loading>
        {/* Rendered while evaluating */}
        <span>Checking your plan…</span>
      </Loading>
      <ErrorFallback>
        {/* Rendered on error */}
        <span>Could not verify your feature access.</span>
      </ErrorFallback>
    </Feature>
  );
}
```

---

### 🔄 Alternative: Token-only mode (no live connection)

Set `allowConnectionWithSpace: false` to disable the WebSocket client.  
You can then inject a Pricing Token from your backend:

```tsx
import { useEffect } from 'react';
import { useTokenService } from 'space-react-client';

export function InjectTokenFromServer() {
  const tokenService = useTokenService();

  useEffect(() => {
    fetch('/api/my-pricing-token')
      .then(res => res.text()) // token as string
      .then(token => tokenService.update(token))
      .catch(console.error);
  }, [tokenService]);

  return <YourComponent />;
}
```

---

## 📚 API Reference

### Providers

- **`SpaceProvider({ config, children })`**  
  Initializes the client and provides context.  

  - **Props:**  
    - `config: SpaceConfiguration`  
      - `url: string` — SPACE instance URL  
      - `apiKey: string` — Authentication key emitted by SPACE
      - `organizationId?: string` — Only for member user keys (`usr_...`): sent with the contract events handshake
      - `allowConnectionWithSpace: boolean` — If `false`, event listeners take no effect (default: `true`)
    - `children: React.ReactNode`  

---

### Hooks

- **`useSpaceClient(): SpaceClient`**  
  Access the connected SPACE client. Throws if not available.  

- **`useTokenService(): TokenService`**  
  Manage Pricing Tokens in context. Available even if live connection is disabled.  

- **`usePricingTokenPayload<T>(): T | null`**  
  The decoded payload of the current Pricing Token (`null` if missing or expired). Re-renders on token updates.  

- **`useSubscription(): PricingTokenSubscription | null`**  
  The subscription carried by the current Pricing Token: `{ contractedServices, subscriptionPlans, subscriptionAddOns, contractVersion }`. Re-renders on token updates and needs no connection to SPACE, so it works in token-only mode. Returns `null` without a valid token, or when the token was issued by a SPACE version that does not include the `subscription` claim.  

  ```tsx
  import { useSubscription } from 'space-react-client';

  export function CurrentPlan() {
    const subscription = useSubscription();
    if (!subscription) return <span>No plan information</span>;
    return (
      <span>
        Plan {subscription.subscriptionPlans['acme']} (pricing {subscription.contractedServices['acme']})
      </span>
    );
  }
  ```

---

### UI Components

- **`<Feature id="feature-id">…</Feature>`**  
  Declarative feature gating.  

  - **Subcomponents:**  
    - `<On>` — Rendered when feature evaluates to `true`.  
    - `<Default>` — Rendered when feature evaluates to `false`.  
    - `<Loading>` — Rendered while evaluating.  
    - `<ErrorFallback>` — Rendered on errors (invalid id, expired token, etc).  

> [!WARNING]
> The `feature-id` is a string in the format `saasName-featureName`, always in lowercase.
> For example, to reference the **pets feature from PetClinic**, the resulting feature-id would be: `petclinic-pets`.

---

### Client API

`SpaceClient` is instantiated by `SpaceProvider`.  

**Methods:**

- `on(event, callback)` — Listen to SPACE events.  
- `off(event?, callback?)` — Remove listeners. **If no args, removes all listeners**.
- `setUserId(userId)` — Set user for evaluations, **generates a pricing token, and stores it**.
- `generateUserPricingToken()` — Generate and **return** a fresh Pricing Token for the user configured with `setUserId`. It **does not store** the token.

**✅ Supported Events**

- **`synchronized`** — Client is connected and synced with SPACE.  
- **`pricing_created`** — A new pricing was added.  
- **`pricing_activated`** — A pricing moved from archived → active.  
- **`pricing_archived`** — A pricing moved from active → archived.  
- **`service_disabled`** — A service was disabled.  
- **`contract_created`**, **`contract_novated`**, **`contract_deleted`**, **`contract_renewed`** — A contract of the API key's organisation was created, changed subscription, was deleted or renewed.  
- **`error`** — Connection or processing error (including a rejected API key on the contract events namespace).  

Pricing events (`pricing_*`, `service_disabled`) include the following object:  

```typescript
{
  serviceName: string;       // REQUIRED: The name of the service that triggered the event
  pricingVersion?: string;   // OPTIONAL: The version of the pricing involved
}
```

Contract events include:

```typescript
{
  userId: string;
  organizationId: string;
  contractVersion: string | null; // version of the contract after the change; null for contract_deleted
  services: string[];      // services affected
}
```

> [!IMPORTANT]
> Contract events travel over SPACE's authenticated `/contracts` namespace. The client opens it only when you register the first contract listener, and closes it when the last one is removed. The handshake carries `{ apiKey }` for an organisation key, or `{ apiKey, organizationId }` when the configuration has `organizationId` (SPACE requires it for member user keys, `usr_...`). They therefore **only work when the client connects to SPACE with an API key** (`allowConnectionWithSpace: true`).
>
> **Token-only apps** (`allowConnectionWithSpace: false`, the recommended production setup, since the browser holds no SPACE key) do not receive contract events. Let your backend listen to them with [`space-node-client`](https://github.com/Alex-GF/space-node-client) (`client.on('contract_novated', ...)`) and push a fresh Pricing Token to the user's sessions (or have the page refetch it after a plan change). `useSubscription()` and `<Feature>` update as soon as `tokenService.update(newToken)` runs.

```tsx
// Only with allowConnectionWithSpace: true and an API key in the browser (development, internal tools).
spaceClient.on('contract_novated', ({ userId }) => {
  if (userId === currentUserId) spaceClient.setUserId(userId); // reloads the Pricing Token
});
```

```tsx
// Token-only: your backend tells the page that the contract changed (SSE, WebSocket, polling, ...).
const tokenService = useTokenService();
useEffect(() => {
  const events = new EventSource('/api/my-contract-events');
  events.onmessage = async () => tokenService.update(await (await fetch('/api/my-pricing-token')).text());
  return () => events.close();
}, [tokenService]);
```

---

### Token Service

**Methods:**

- `update(token)` — Validates & stores a pricing token.  
- `getPayload()` — Return parsed token payload.  
- `getSubscription()` — Return the token's `subscription` claim, or `null`.  
- `getUserId()` — Return the userId the token was issued for (see below), or `null`.  
- `evaluateFeature(featureId)` — Returns `true | false | null`.  

Token expectations:  
- `exp: number` — UNIX expiration.  
- `features: Record<string, { eval: boolean; limit?: number | null; used?: number | null }>`  
- `subscription?: { contractedServices, subscriptionPlans, subscriptionAddOns, contractVersion }` — optional; present in tokens from SPACE versions with the subscription-change API (typed as `PricingTokenPayload` / `PricingTokenSubscription`).  
- `userId?`, `organizationId?`, `aud?`, `iss?` — optional; present in tokens from SPACE versions with per-organization userIds (capability `contract-userid-per-org`).  

#### Token claims: `userId`, `organizationId`, `aud`, `iss`

A userId is unique only within its organization, so SPACE versions with per-organization userIds issue tokens with these claims:

| Claim | Value |
| --- | --- |
| `sub` | `urn:space:<organizationId>:<percent-encoded userId>`. Opaque: do not parse it. |
| `userId` | The userId as stored in SPACE (not encoded). |
| `organizationId` | The organization of the contract. |
| `aud` | The organization the token is for (same value as `organizationId`). |
| `iss` | The SPACE server: its `JWT_ISSUER`, `space` by default. |

Tokens of older SPACE versions only have the bare userId in `sub`, so the new claims are optional in `PricingTokenPayload`. `tokenService.getUserId()` and `pricingTokenUserId(payload)` return the `userId` claim and fall back to `sub` only when the token has no `userId` claim (an older server); they never parse the URN. Code that used `payload.sub` as the userId should switch to them:

```tsx
import { pricingTokenUserId, usePricingTokenPayload } from 'space-react-client';

const payload = usePricingTokenPayload();
const userId = payload ? pricingTokenUserId(payload) : null;
```

The token payload is decoded as base64url UTF-8 JSON (as every JWT is encoded), so userIds outside Latin-1 come out intact.

#### Verifying pricing tokens (opt-in)

`tokenService.update(token)` decodes a token; it does not check its signature, and it does not need to when the token comes straight from your own backend over HTTPS. Apps that receive tokens through a channel they do not control (another frame via `postMessage`, a token kept in storage, a third-party embed) can verify them first with the public keys SPACE publishes. Verification is a separate entry point, so apps that do not import it do not bundle it (nor its dependency, [`jose`](https://github.com/panva/jose)):

```tsx
import { PricingTokenVerifier } from 'space-react-client/verify';

// One verifier per SPACE, reused (it caches the keys).
const verifier = new PricingTokenVerifier({ url: 'https://space.example.com', organizationId: 'my-org-id' });

const payload = await verifier.verify(token); // throws if the token cannot be trusted
tokenService.update(token);
```

It needs SPACE with the capability `pricing-token-jwks` (tokens signed with ES256, public keys at `GET {url}/api/v1/.well-known/jwks.json`, no API key; SPACE's CORS settings, `ALLOWED_ORIGINS`, must allow your origin). It checks:

- the ES256 signature by a key of the JWKS, chosen by the token's `kid`; any other `alg` (`HS256`, `none`, ...) is rejected, and so is a token with a `jwk`, `jku`, `x5u` or `x5c` header;
- `exp`, required (`clockToleranceSeconds`, default 0);
- `iss` (`issuer`, default `space`, the `JWT_ISSUER` of your SPACE);
- `aud` and `organizationId`: the expected organization, required in the options or per call (`verifier.verify(token, { organizationId })`).

The keys are cached for the `max-age` of the JWKS response (5 minutes from SPACE) and fetched again, at most once per `refetchCooldownMs` (30 s), when a token names an unknown `kid`. Errors: `PricingTokenSignatureError`, `PricingTokenExpiredError`, `PricingTokenAudienceError`, `PricingTokenIssuerError`, `PricingTokenUnknownKeyError`, and `PricingTokenVerificationError` (their base class) with `code` `PRICING_TOKEN_INVALID` or `PRICING_TOKEN_JWKS_UNAVAILABLE`; `SpaceFeatureUnsupportedError` (`capability: 'pricing-token-jwks'`) when SPACE does not publish its keys.

A check in the browser does not replace the checks of your backend: code running in the page can be changed by whoever controls the page. Authorize requests on the server (for example with `space-node-client`'s `verifyPricingToken`).

---

## 🛡️ Security Considerations

- **Do not expose SPACE API keys in production.**  
  Instead, issue Pricing Tokens from your backend and deliver them to the client.  
- Tokens are validated client-side with the `exp` claim. Rotate or shorten TTLs as needed.  
- To check the signature of a token in the browser, use the opt-in `space-react-client/verify` entry point (see [Verifying pricing tokens](#verifying-pricing-tokens-opt-in)).  

---

## ⚙️ Development & Tooling

The project uses the following main tools and technologies:

<div style="display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'center', marginTop: '1rem'">

![TypeScript](https://img.shields.io/badge/-TypeScript-3178C6?logo=typescript&logoColor=white&style=for-the-badge)
![Rollup](https://img.shields.io/badge/-Rollup-EC4A3F?logo=rollup.js&logoColor=white&style=for-the-badge)
![Vitest](https://img.shields.io/badge/-Vitest-6E9F18?logo=vitest&logoColor=white&style=for-the-badge)
![Testing Library](https://img.shields.io/badge/-Testing%20Library-E33332?logo=testinglibrary&logoColor=white&style=for-the-badge)
![Axios](https://img.shields.io/badge/-Axios-5A29E4?logo=axios&logoColor=white&style=for-the-badge)
![Socket.io](https://img.shields.io/badge/-Socket.io-010101?logo=socketdotio&logoColor=white&style=for-the-badge)

</div>

---

## 📄 License & Disclaimer

This project is licensed under the **MIT License**. See [LICENSE](https://github.com/Alex-GF/space-react-client/blob/main/LICENSE).  

> [!WARNING]
> This SDK is part of **ongoing research** in pricing-driven devops.
> It is still in an early stage and not intended for production use.

---

## ❓ FAQ

**Q:** Do I need SPACE running to use this?  
**A:** Yes, for live connectivity. In token-only mode, you just need a Pricing Token from your backend.  

**Q:** Why does `useSpaceClient` throw?  
**A:** Likely because you’re outside `SpaceProvider`, or `allowConnectionWithSpace` is `false`.  

**Q:** What’s the format for feature IDs?  
**A:** A **feature id** must:  

- Always include a dash (`-`).  
- Match exactly the keys present in the Pricing Token payload.  

The format is built internally as: `saasName-featureName`, all in lowercase.

For example, if you want to instantiate the feature `pets` from the SaaS **PetClinic**, the feature id would be: `petclinic-pets`.