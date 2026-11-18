import { createRemoteJWKSet, jwtVerify } from "jose";

export function createSupabaseAuthenticator(supabaseUrl: string) {
  const issuer = `${supabaseUrl.replace(/\/+$/, "")}/auth/v1`;
  const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));

  return async (authorization: string | undefined): Promise<string | null> => {
    const token = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
    if (!token) return null;
    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer, audience: "authenticated", requiredClaims: ["sub", "exp"],
      });
      return payload.sub ?? null;
    } catch {
      return null;
    }
  };
}
