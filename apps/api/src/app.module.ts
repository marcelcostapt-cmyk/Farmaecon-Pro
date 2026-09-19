import { ObservationModule } from './modules/observation/observation.module';
import { HealthController } from './shared/health/health.controller';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './modules/auth/auth.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { UsersModule } from './modules/users/users.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { ProductsModule } from './modules/products/products.module';
import { OrdersModule } from './modules/orders/orders.module';
import { FinanceModule } from './modules/finance/finance.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { PrismaModule } from './shared/prisma/prisma.module';
import { QueueModule } from './shared/queue/queue.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.FARMAECON_ENV_FILE ?? '.env.local',
    }),
    ObservationModule,
    PrismaModule,
    QueueModule,
    AuthModule,
    TenantsModule,
    UsersModule,
    IntegrationsModule,
    ProductsModule,
    OrdersModule,
    FinanceModule,
    DashboardModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
