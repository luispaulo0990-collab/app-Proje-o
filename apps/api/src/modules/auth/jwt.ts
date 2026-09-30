import { SignJWT, jwtVerify } from 'jose';
import type { Role } from '@unita/contracts';

export interface AccessTokenClaims {
  sub: string;
  role: Role;
  name: string;
}

const ISSUER = 'unita-projecoes';
const AUDIENCE = 'unita-projecoes-web';

export class JwtService {
  private readonly key: Uint8Array;

  constructor(
    secret: string,
    private readonly ttlSeconds: number,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  get expiresIn(): number {
    return this.ttlSeconds;
  }

  sign(claims: AccessTokenClaims): Promise<string> {
    return new SignJWT({ role: claims.role, name: claims.name })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.sub)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${this.ttlSeconds}s`)
      .sign(this.key);
  }

  async verify(token: string): Promise<AccessTokenClaims> {
    const { payload } = await jwtVerify(token, this.key, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    });
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.role !== 'string' ||
      typeof payload.name !== 'string'
    ) {
      throw new Error('Token malformado');
    }
    return { sub: payload.sub, role: payload.role as Role, name: payload.name };
  }
}
