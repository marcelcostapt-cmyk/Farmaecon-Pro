import { Controller, Post, Body, UseGuards, Get, Request } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TenantsService } from './tenants.service';
import { ok } from '../../shared/types/api-response.type';
import { IsString, IsOptional } from 'class-validator';

class CreateTenantDto {
  @IsString() name: string;
  @IsString() @IsOptional() document?: string;
}

interface TenantRequest {
  user: {
    tenantId: string;
  };
}

@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @UseGuards(AuthGuard('jwt'))
  @Get('me')
  async me(@Request() req: TenantRequest) {
    const tenant = await this.tenantsService.findById(req.user.tenantId);
    return ok(tenant);
  }
}
