import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { createHash, randomUUID } from 'node:crypto';
import * as bcrypt from 'bcryptjs';

export interface AuthPrincipal {
  sub: string;
  email: string;
  tenantId: string;
  role: string;
  sid: string;
}
export interface JwtPayload {
  sub: string;
  tenantId: string;
  sid: string;
  purpose: 'access' | 'refresh';
  jti: string;
  exp?: number;
}
export const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');
export function authKeys(config: ConfigService) {
  const access = config.getOrThrow<string>('JWT_ACCESS_SECRET');
  const refresh = config.getOrThrow<string>('JWT_REFRESH_SECRET');
  if (access.length < 32 || refresh.length < 32 || access === refresh)
    throw new Error('Distinct JWT keys of at least 32 characters are required');
  return { access, refresh };
}
const issuer = 'farmaecon';
const audience = 'farmaecon-office';
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {
    authKeys(config);
  }
  async validateUser(email: string, password: string) {
    if (typeof email !== 'string' || typeof password !== 'string')
      throw new UnauthorizedException('Invalid credentials');
    const user = await this.prisma.findUserForLogin(email);
    if (!user || !(await bcrypt.compare(password, user.password)))
      throw new UnauthorizedException('Invalid credentials');
    return {
      id: user.id,
      email: user.email,
      tenantId: user.tenantId,
      role: user.role,
    };
  }
  private issue(
    user: { id: string; tenantId: string },
    sid: string,
    expiresAt: Date,
  ) {
    const keys = authKeys(this.config);
    const payload = { sub: user.id, tenantId: user.tenantId, sid };
    const refreshLifetime = Math.max(
      1,
      Math.floor((expiresAt.getTime() - Date.now()) / 1000),
    );
    return {
      accessToken: this.jwt.sign(
        { ...payload, purpose: 'access', jti: randomUUID() },
        {
          secret: keys.access,
          algorithm: 'HS256',
          issuer,
          audience,
          expiresIn: Math.min(900, refreshLifetime),
        },
      ),
      refreshToken: this.jwt.sign(
        { ...payload, purpose: 'refresh', jti: randomUUID() },
        {
          secret: keys.refresh,
          algorithm: 'HS256',
          issuer,
          audience,
          expiresIn: refreshLifetime,
        },
      ),
    };
  }
  async login(user: { id: string; tenantId: string }) {
    const sid = randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 86400000);
    const tokens = this.issue(user, sid, expiresAt);
    await this.prisma.withTenant(user.tenantId, (tx) =>
      tx.authSession.create({
        data: {
          id: sid,
          userId: user.id,
          tenantId: user.tenantId,
          refreshHash: hashToken(tokens.refreshToken),
          expiresAt,
        },
      }),
    );
    return tokens;
  }
  private verifyRefresh(token: string) {
    try {
      const p = this.jwt.verify<JwtPayload>(token, {
        secret: authKeys(this.config).refresh,
        algorithms: ['HS256'],
        issuer,
        audience,
      });
      if (p.purpose !== 'refresh' || !p.sid || !p.sub || !p.tenantId || !p.exp)
        throw new Error();
      return p;
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }
  async refreshTokens(token: string) {
    const p = this.verifyRefresh(token);
    const result = await this.prisma.withTenant(p.tenantId, async (tx) => {
      const session = await tx.authSession.findFirst({
        where: {
          id: p.sid,
          userId: p.sub,
          tenantId: p.tenantId,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      });
      if (!session)
        throw new UnauthorizedException('Session expired or revoked');
      const user = await tx.user.findFirst({
        where: { id: p.sub, tenantId: p.tenantId },
        select: { id: true, tenantId: true },
      });
      if (!user) throw new UnauthorizedException();
      const tokens = this.issue(user, p.sid, session.expiresAt);
      // Compare-and-swap makes refresh single use, including concurrent requests.
      const changed = await tx.authSession.updateMany({
        where: {
          id: p.sid,
          refreshHash: hashToken(token),
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { refreshHash: hashToken(tokens.refreshToken) },
      });
      if (changed.count !== 1) {
        await tx.authSession.updateMany({
          where: { id: p.sid },
          data: { revokedAt: new Date() },
        });
        return null; // Commit the revocation before reporting replay to the caller.
      }
      return tokens;
    });
    if (!result)
      throw new UnauthorizedException(
        'Refresh reuse detected; session revoked',
      );
    return result;
  }
  async logout(token: string) {
    const p = this.verifyRefresh(token);
    await this.prisma.withTenant(p.tenantId, (tx) =>
      tx.authSession.updateMany({
        where: { id: p.sid, userId: p.sub, tenantId: p.tenantId },
        data: { revokedAt: new Date() },
      }),
    );
  }
  async validateAccess(p: JwtPayload): Promise<AuthPrincipal> {
    if (
      p.purpose !== 'access' ||
      !p.exp ||
      p.exp <= Date.now() / 1000 ||
      !p.sid ||
      !p.sub ||
      !p.tenantId
    )
      throw new UnauthorizedException();
    return this.prisma.withTenant(p.tenantId, async (tx) => {
      const session = await tx.authSession.findFirst({
        where: {
          id: p.sid,
          userId: p.sub,
          tenantId: p.tenantId,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      });
      if (!session)
        throw new UnauthorizedException('Session expired or revoked');
      const user = await tx.user.findFirst({
        where: { id: p.sub, tenantId: p.tenantId },
        select: { id: true, email: true, tenantId: true, role: true },
      });
      if (!user) throw new UnauthorizedException();
      return {
        sub: user.id,
        email: user.email,
        tenantId: user.tenantId,
        role: user.role,
        sid: p.sid,
      };
    });
  }
}
