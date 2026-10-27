export const TEST_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJmZWF0dXJlcyI6eyJ6b29tLW1lZXRpbmdzIjp7ImV2YWwiOnRydWUsImxpbWl0Ijp7Inpvb20tbWF4QXNzaXN0YW50c1Blck1lZXRpbmciOjEwMH0sInVzZWQiOnsiem9vbS1tYXhBc3Npc3RhbnRzUGVyTWVldGluZyI6MTB9fSwiem9vbS1hdXRvbWF0ZWRDYXB0aW9ucyI6eyJldmFsIjpmYWxzZSwibGltaXQiOm51bGwsInVzZWQiOm51bGx9fSwic3ViIjoiajBobkQwMyIsImV4cCI6MTY4NzcwNTk1MSwic3Vic2NyaXB0aW9uQ29udGV4dCI6eyJ6b29tLW1heEFzc2lzdGFudHNQZXJNZWV0aW5nIjoxMH0sImlhdCI6MTY4NzcwNTg2NCwicHJpY2luZ0NvbnRleHQiOnsibWVldGluZ3MiOnsiZGVzY3JpcHRpb24iOiJIb3N0IGFuZCBqb2luIHJlYWwtdGltZSB2aWRlbyBtZWV0aW5ncyB3aXRoIEhEIGF1ZGlvLCBzY3JlZW4gc2hhcmluZywgY2hhdCwgYW5kIGNvbGxhYm9yYXRpb24gdG9vbHMuIFNjaGVkdWxlIG9yIHN0YXJ0IG1lZXRpbmdzIGluc3RhbnRseSwgd2l0aCBzdXBwb3J0IGZvciB1cCB0byBYIHBhcnRpY2lwYW50cyBkZXBlbmRpbmcgb24geW91ciBwbGFuLiIsInZhbHVlVHlwZSI6IkJPT0xFQU4iLCJkZWZhdWx0VmFsdWUiOmZhbHNlLCJ2YWx1ZSI6dHJ1ZSwidHlwZSI6IkRPTUFJTiIsImV4cHJlc3Npb24iOiJwcmljaW5nQ29udGV4dFsnZmVhdHVyZXMnXVsnem9vbS1tZWV0aW5ncyddICYmIHByaWNpbmdDb250ZXh0Wyd1c2FnZUxpbWl0cyddW3pvb20tbWF4QXNzaXN0YW50c1Blck1lZXRpbmddID4gc3Vic2NyaXB0aW9uQ29udGV4dFt6b29tLW1heEFzc2lzdGFudHNQZXJNZWV0aW5nXSIsInNlcnZlckV4cHJlc3Npb24iOiJwcmljaW5nQ29udGV4dFsnZmVhdHVyZXMnXVsnem9vbS1tZWV0aW5ncyddICYmIHByaWNpbmdDb250ZXh0Wyd1c2FnZUxpbWl0cyddW3pvb20tbWF4QXNzaXN0YW50c1Blck1lZXRpbmddID49IHN1YnNjcmlwdGlvbkNvbnRleHRbem9vbS1tYXhBc3Npc3RhbnRzUGVyTWVldGluZ10iLCJyZW5kZXIiOiJBVVRPIn19fQ.SG_6u4soKz431e8sk2FCP8eoy1NLW-lXV8Sn7t74j2s';
/*

 TOKEN PAYLOAD:
 
 {
  "features": {
    "zoom-meetings": {
      "eval": true,
      "limit": {
        "zoom-maxAssistantsPerMeeting": 100
      },
      "used": {
        "zoom-maxAssistantsPerMeeting": 10
      }
    },
    "zoom-automatedCaptions": {
      "eval": false,
      "limit": null,
      "used": null
    }
  },
  "sub": "j0hnD03",
  "exp": 1687705951,
  "subscriptionContext": {
    "zoom-maxAssistantsPerMeeting": 10
  },
  "iat": 1687705864,
  "pricingContext": {
    "meetings": {
      "description": "Host and join real-time video meetings with HD audio, screen sharing, chat, and collaboration tools. Schedule or start meetings instantly, with support for up to X participants depending on your plan.",
      "valueType": "BOOLEAN",
      "defaultValue": false,
      "value": true,
      "type": "DOMAIN",
      "expression": "pricingContext['features']['zoom-meetings'] && pricingContext['usageLimits'][zoom-maxAssistantsPerMeeting] > subscriptionContext[zoom-maxAssistantsPerMeeting]",
      "serverExpression": "pricingContext['features']['zoom-meetings'] && pricingContext['usageLimits'][zoom-maxAssistantsPerMeeting] >= subscriptionContext[zoom-maxAssistantsPerMeeting]",
      "render": "AUTO"
    }
  }
}

*/

/** Helper to update the 'exp' field of a JWT token to a future date.
 * @param token - The JWT string
 * @param secondsAhead - How many seconds in the future to set 'exp'
 * @returns The new JWT string with updated 'exp'
 */
export function updateJwtExp(token: string, secondsAhead: number): string {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT');
  const payload = JSON.parse(atob(parts[1]));
  payload.exp = Math.floor(Date.now() / 1000) + secondsAhead;
  const newPayload = btoa(JSON.stringify(payload));
  return `${parts[0]}.${newPayload}.${parts[2]}`;
}

// Helper to create a fake JWT
export function createFakeJwt(payload: Record<string, number | object | string>) {    
  return `header.${btoa(JSON.stringify(payload))}.signature`;
}
/**
 * Helper to create an unsigned JWT the way a JOSE library encodes it: base64url (no padding) of
 * the UTF-8 JSON, unlike `createFakeJwt`, which only handles Latin-1 and standard base64.
 */
export function createJwt(payload: Record<string, unknown>, header: Record<string, unknown> = { alg: 'ES256', kid: 'k1' }) {
  const encode = (value: unknown) => {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    let binary = '';
    bytes.forEach((b) => (binary += String.fromCharCode(b)));
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  return `${encode(header)}.${encode(payload)}.signature`;
}

export const ORGANIZATION_ID = '6630a1b2c3d4e5f6a7b8c9d0';

/**
 * Payload of a token issued by SPACE with per-organization userIds (space#80): `sub` is an opaque
 * URN, the userId is in its own claim, plus `organizationId`, `aud` and `iss`. Older servers only
 * send the bare userId in `sub` (see TEST_TOKEN above).
 */
export function newServerPayload(userId: string, secondsAhead = 60) {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: `urn:space:${ORGANIZATION_ID}:${encodeURIComponent(userId)}`,
    userId,
    organizationId: ORGANIZATION_ID,
    aud: ORGANIZATION_ID,
    iss: 'space',
    iat: now,
    exp: now + secondsAhead,
    features: { 'zoom-meetings': { eval: true } },
  };
}
