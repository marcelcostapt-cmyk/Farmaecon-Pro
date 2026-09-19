import { Controller, Post, Get, Body, UseGuards, Patch, Param } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from '@prisma/client';
import { AdminGuard } from '../../shared/security/admin.guard';
import { CurrentUser } from '../../shared/decorators/tenant.decorator';
import type { AuthPrincipal } from '../auth/auth.service';
import { UsersService } from './users.service';
import { CurrentTenant } from '../../shared/decorators/tenant.decorator';
import { ok } from '../../shared/types/api-response.type';
import { IsString, IsEmail, MinLength, IsOptional, IsEnum } from 'class-validator';

class CreateUserDto {
  @IsString() name: string;
  @IsEmail() email: string;
  @IsString() @MinLength(8) password: string;
  @IsEnum(UserRole) @IsOptional() role?: UserRole;
}

class UpdateRoleDto { @IsEnum(UserRole) role: UserRole; }

@UseGuards(AuthGuard('jwt'), AdminGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  async create(@CurrentUser() actor: AuthPrincipal, @Body() dto: CreateUserDto) {
    const user = await this.usersService.create(actor, dto);
    return ok(user);
  }

  @Patch(':id/role')
  async updateRole(@CurrentUser() actor: AuthPrincipal, @Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return ok(await this.usersService.updateRole(actor, id, dto.role));
  }

  @Get()
  async findAll(@CurrentTenant() tenantId: string) {
    const users = await this.usersService.findAll(tenantId);
    return ok(users);
  }
}
