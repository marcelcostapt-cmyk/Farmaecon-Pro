import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createPrismaAdapter } from '../src/shared/prisma/prisma-options';

const prisma = new PrismaClient({
  adapter: createPrismaAdapter(),
});

async function main() {
  console.log('🌱 Seeding database...');

  // Create demo tenant
  const tenant = await prisma.tenant.upsert({
    where: { id: 'demo-tenant-id' },
    update: {},
    create: { id: 'demo-tenant-id', name: 'Loja Demo', document: '12.345.678/0001-90' },
  });
  console.log(`✅ Tenant: ${tenant.name}`);

  // Create admin user
  const password = await bcrypt.hash('admin1234', 12);
  const user = await prisma.user.upsert({
    where: { email: 'admin@farmaecon.com' },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'Admin Demo',
      email: 'admin@farmaecon.com',
      password,
      role: 'ADMIN',
    },
  });
  console.log(`✅ User: ${user.email} (role: ${user.role})`);

  // Create marketplace accounts
  const mlAccount = await prisma.marketplaceAccount.upsert({
    where: { id: 'ml-account-demo' },
    update: {
      status: 'ACTIVE',
      externalSellerId: '123456789',
    },
    create: {
      id: 'ml-account-demo',
      tenantId: tenant.id,
      platform: 'MERCADO_LIVRE',
      status: 'ACTIVE',
      externalSellerId: '123456789',
      name: 'ML - Loja Principal',
    },
  });
  console.log(`✅ Marketplace: ${mlAccount.name}`);

  // Create sample products
  const products = [
    { sku: 'PROD-001', title: 'Produto Alpha', costPrice: 25.0, basePrice: 79.9, stockQuantity: 18, minStockQuantity: 6 },
    { sku: 'PROD-002', title: 'Produto Beta', costPrice: 12.5, basePrice: 49.9, stockQuantity: 4, minStockQuantity: 8 },
    { sku: 'PROD-003', title: 'Produto Gamma', costPrice: 45.0, basePrice: 149.9, stockQuantity: 11, minStockQuantity: 5 },
  ];

  for (const p of products) {
    await prisma.product.upsert({
      where: { tenantId_sku: { tenantId: tenant.id, sku: p.sku } },
      update: {
        title: p.title,
        costPrice: p.costPrice,
        basePrice: p.basePrice,
        stockQuantity: p.stockQuantity,
        minStockQuantity: p.minStockQuantity,
      },
      create: { tenantId: tenant.id, ...p },
    });
  }
  console.log(`✅ Products: ${products.length} seeded`);

  // Seed sample orders and transactions for DRE demo
  for (let i = 1; i <= 10; i++) {
    const amount = Math.round((Math.random() * 150 + 49.9) * 100) / 100;
    const createdAt = new Date(Date.now() - i * 86400000);
    const status = i <= 2 ? 'PENDING' : i <= 4 ? 'SHIPPED' : 'DELIVERED';
    const order = await prisma.order.create({
      data: {
        tenantId: tenant.id,
        marketplaceAccountId: mlAccount.id,
        externalOrderId: `ML-DEMO-${Date.now()}-${i}`,
        totalAmount: amount,
        status,
        createdAt,
      },
    });

    await prisma.financialTransaction.createMany({
      data: [
        { tenantId: tenant.id, orderId: order.id, amount, type: 'REVENUE', date: createdAt },
        { tenantId: tenant.id, orderId: order.id, amount: amount * 0.16, type: 'FEE', date: createdAt },
        { tenantId: tenant.id, orderId: order.id, amount: 25.0, type: 'PRODUCT_COST', date: createdAt },
        { tenantId: tenant.id, orderId: order.id, amount: 12.0, type: 'SHIPPING', date: createdAt },
        { tenantId: tenant.id, orderId: order.id, amount: amount * 0.04, type: 'TAX', date: createdAt },
      ],
    });
  }

  await prisma.financialTransaction.create({
    data: {
      tenantId: tenant.id,
      amount: 880.49,
      type: 'EXPENSE',
      description: 'Assinaturas e despesas operacionais',
      date: new Date(),
    },
  });
  console.log(`✅ Orders + transactions: 10 demo orders seeded`);

  console.log('\n🎉 Seed complete!');
  console.log('Login: admin@farmaecon.com / admin1234');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
