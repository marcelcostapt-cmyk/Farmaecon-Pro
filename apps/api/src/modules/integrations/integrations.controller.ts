import { Controller, Get, UseGuards, Post, Param, Body } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { IntegrationsService } from './integrations.service';
import { MlOAuthService } from './ml-oauth.service';
import { CurrentTenant, CurrentUser } from '../../shared/decorators/tenant.decorator';
import { AdminGuard } from '../../shared/security/admin.guard';
import type { AuthPrincipal } from '../auth/auth.service';
import { ok } from '../../shared/types/api-response.type';
class CallbackDto { @IsString() @MinLength(1) @MaxLength(2048) code: string; @IsString() @MaxLength(128) state: string; }
@UseGuards(AuthGuard('jwt'))
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService, private readonly oauth: MlOAuthService) {}
  @Get() findAll(@CurrentTenant() tenantId: string) { return this.integrations.findAll(tenantId).then(ok); }
  @UseGuards(AdminGuard)
  @Get('ml/connect') async connect(@CurrentUser() actor: AuthPrincipal) { return ok(await this.oauth.buildAuthorizationUrl(actor)); }
  @UseGuards(AdminGuard)
  @Post('ml/callback') async callback(@CurrentUser() actor: AuthPrincipal, @Body() dto: CallbackDto) {
    const result = await this.oauth.exchangeCode(dto.code, dto.state, actor);
    await this.integrations.scheduleInitialSync(result.accountId, actor.tenantId);
    return ok({ connected: true });
  }
  @UseGuards(AdminGuard)
  @Post(':id/disconnect') async disconnect(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    await this.integrations.disconnect(tenantId, id); return ok({ disconnected: true });
  }
  @Post(':id/sync') async sync(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    await this.integrations.triggerOrdersSync(tenantId, id); return ok({ scheduled: true });
  }
}
