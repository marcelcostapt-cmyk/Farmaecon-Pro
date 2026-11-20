import { Controller, Get, UseGuards, Post, Patch, Delete, Param, Body } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { IntegrationsService } from './integrations.service';
import { MlOAuthService } from './ml-oauth.service';
import { CurrentTenant, CurrentUser } from '../../shared/decorators/tenant.decorator';
import { AdminGuard } from '../../shared/security/admin.guard';
import type { AuthPrincipal } from '../auth/auth.service';
import { ok } from '../../shared/types/api-response.type';
// PATCH parcial: cada campo é opcional; ausente = preservar, null = limpar (se opcional).
// Os limites/validação de regra (CNPJ, 60 chars) ficam no serviço; aqui só o formato.
class UpdateAccountIdentityDto {
  @IsOptional() @IsString() @MaxLength(80) displayName?: string | null;
  @IsOptional() @IsString() @MaxLength(255) businessName?: string | null;
  @IsOptional() @IsString() @MaxLength(18) cnpj?: string | null;
}
class CallbackDto { @IsString() @MinLength(1) @MaxLength(2048) code: string; @IsString() @MaxLength(128) state: string; }
@UseGuards(AuthGuard('jwt'))
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService, private readonly oauth: MlOAuthService) {}
  @Get() findAll(@CurrentTenant() tenantId: string) { return this.integrations.findAll(tenantId).then(ok); }
  @Get('ml/config') config() { return ok(this.oauth.oauthConfig()); }
  @UseGuards(AdminGuard)
  @Get('ml/connect') async connect(@CurrentUser() actor: AuthPrincipal) { return ok(await this.oauth.buildAuthorizationUrl(actor)); }
  @UseGuards(AdminGuard)
  @Post('ml/callback') async callback(@CurrentUser() actor: AuthPrincipal, @Body() dto: CallbackDto) {
    const result = await this.oauth.exchangeCode(dto.code, dto.state, actor);
    await this.integrations.scheduleInitialSync(result.accountId, actor.tenantId);
    return ok({ connected: true, reconnected: result.reconnected });
  }
  @UseGuards(AdminGuard)
  @Post(':id/disconnect') async disconnect(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    await this.integrations.disconnect(tenantId, id); return ok({ disconnected: true });
  }
  @UseGuards(AdminGuard)
  @Patch(':id') async updateIdentity(
    @CurrentTenant() tenantId: string,
    @CurrentUser() actor: AuthPrincipal,
    @Param('id') id: string,
    @Body() dto: UpdateAccountIdentityDto,
  ) {
    return ok(await this.integrations.updateIdentity(tenantId, id, actor, dto));
  }
  @UseGuards(AdminGuard)
  @Post(':id/reconnect') async reconnect(@CurrentUser() actor: AuthPrincipal, @Param('id') id: string) {
    return ok(await this.integrations.startReconnect(actor, id));
  }
  @UseGuards(AdminGuard)
  @Delete(':id') async remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    await this.integrations.remove(tenantId, id); return ok({ removed: true });
  }
  @Post(':id/sync') async sync(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    await this.integrations.triggerOrdersSync(tenantId, id); return ok({ scheduled: true });
  }
}
