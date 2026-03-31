import { SignJWT, jwtVerify } from 'jose';
import { JWT_EXPIRY_HOURS } from '@swarmrelay/shared';

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET ?? 'change-me-in-production';
  return new TextEncoder().encode(secret);
}

export async function issueAgentToken(agentId: string, scopes: string[]): Promise<{ token: string; expiresAt: string }> {
  const expiresAt = new Date(Date.now() + JWT_EXPIRY_HOURS * 60 * 60 * 1000);
  const token = await new SignJWT({ agent_id: agentId, scopes })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer('swarmrelay.ai')
    .setExpirationTime(expiresAt)
    .sign(getSecret());
  return { token, expiresAt: expiresAt.toISOString() };
}

export async function verifyAgentToken(token: string): Promise<{ agentId: string; scopes: string[] }> {
  const { payload } = await jwtVerify(token, getSecret(), { issuer: 'swarmrelay.ai' });
  return {
    agentId: payload.agent_id as string,
    scopes: payload.scopes as string[],
  };
}
