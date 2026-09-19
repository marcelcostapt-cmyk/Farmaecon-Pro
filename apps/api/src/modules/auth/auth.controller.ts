import { Controller, Post, Body, UseGuards, Get, Request, HttpCode } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import type { AuthPrincipal } from './auth.service';
import { IsString, MinLength } from 'class-validator';
import { ok } from '../../shared/types/api-response.type';
class RefreshDto { @IsString() @MinLength(1) refreshToken: string; }
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @UseGuards(AuthGuard('local'))
  @Post('login') @HttpCode(200)
  async login(@Request() req: { user: { id: string; tenantId: string } }) { return ok(await this.auth.login(req.user)); }
  @Post('refresh') @HttpCode(200)
  async refresh(@Body() dto: RefreshDto) { return ok(await this.auth.refreshTokens(dto.refreshToken)); }
  @Post('logout') @HttpCode(200)
  async logout(@Body() dto: RefreshDto) { await this.auth.logout(dto.refreshToken); return ok({ revoked: true }); }
  @UseGuards(AuthGuard('jwt'))
  @Get('me')
  getProfile(@Request() req: { user: AuthPrincipal }) {
    const { sub, email, tenantId, role } = req.user;
    return ok({ id: sub, email, tenantId, role });
  }
}
