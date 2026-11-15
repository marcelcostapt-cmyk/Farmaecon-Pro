import { Prisma } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePdfText } from './nfe-pdf-parser';

const texto = readFileSync(join(__dirname, '../../../test/fixtures/danfe-luciana.txt'), 'utf8');

describe('parsePdfText — DANFE Luciana (valores documentados)', () => {
  const nota = parsePdfText(texto);

  it('extrai cabeçalho: número, série, data de emissão', () => {
    expect(nota.source).toBe('pdf');
    expect(nota.invoiceNumber).toBe('2325345');
    expect(nota.invoiceSeries).toBe('003');
    expect(nota.issuedAt?.toISOString().slice(0, 10)).toBe('2026-10-28');
  });

  it('extrai 2 linhas, fornecedor 5080, 376 unidades, totais da nota', () => {
    expect(nota.lines).toHaveLength(2);
    expect(nota.lines.every((l) => l.supplierProductCode === '5080')).toBe(true);
    const un = nota.lines.reduce((s, l) => s.plus(l.quantity), new Prisma.Decimal(0));
    expect(un.equals(new Prisma.Decimal('376'))).toBe(true);
    expect(nota.productsTotal!.equals(new Prisma.Decimal('6010.44'))).toBe(true);
    expect(nota.otherExpenses!.equals(new Prisma.Decimal('2.49'))).toBe(true);
    expect(nota.documentTotal!.equals(new Prisma.Decimal('6012.93'))).toBe(true);
  });

  it('não informa EAN, 5080 não é SKU e marca essas pendências; custo não aprovado', () => {
    expect(nota.lines[0].ean).toBeNull();
    expect(nota.lines[0].marketplaceSku).toBeNull();
    expect(nota.lines[0].approvedAcquisitionCost).toBeNull();
    expect(nota.warnings.some((w) => /EAN não informado/i.test(w))).toBe(true);
    expect(nota.warnings.some((w) => /não é SKU do marketplace/i.test(w))).toBe(true);
  });

  it('registra a diferença de arredondamento da linha 1 (316 × 15,9852 vs 5.051,33)', () => {
    const l1 = nota.lines[0];
    expect(l1.unitCostExtracted!.equals(new Prisma.Decimal('15.9852'))).toBe(true);
    expect(l1.warnings.some((w) => /arredondamento/i.test(w))).toBe(true);
  });

  it('calcula o custo médio condicional (preview), sem aprovar', () => {
    // 6012.93 / 376 = 15,991835106382... — preserva precisão, não arredonda cedo
    expect(nota.conditionalAverageCost!.toFixed(6)).toBe('15.991835');
    expect(nota.approvedAverageCost ?? null).toBeNull();
  });
});
