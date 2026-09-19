import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService, authKeys } from '../auth.service';
import type { JwtPayload } from '../auth.service';
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService, private readonly auth: AuthService) {
    super({ jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), ignoreExpiration: false,
      secretOrKey: authKeys(config).access, algorithms: ['HS256'], issuer: 'farmaecon', audience: 'farmaecon-office' });
  }
  validate(payload: JwtPayload) { return this.auth.validateAccess(payload); }
}
