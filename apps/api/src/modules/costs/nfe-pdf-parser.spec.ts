import { Prisma } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePdfText, hasEvidenceOfItems } from './nfe-pdf-parser';

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

  it('extrai a chave de acesso de 44 dígitos mesmo formatada com espaços', () => {
    expect(nota.invoiceKey).toBe('35261011222333000181550030023253451000000024');
  });
});

describe('parsePdfText — salvaguarda 5.2 (documento com produtos mas 0 linhas)', () => {
  it('marca extractionIncomplete e avisa, sem assumir custo zero', () => {
    // Tem total de produtos, mas nenhuma linha no formato esperado → não pode concluir com custo zero.
    const texto = [
      'DADOS DOS PRODUTOS / SERVIÇOS',
      'V. TOTAL PRODUTOS',
      '6.010,44',
      'V. TOTAL DA NOTA',
      '6.012,93',
    ].join('\n');
    const nota = parsePdfText(texto);
    expect(nota.lines).toHaveLength(0);
    expect(nota.extractionIncomplete).toBe(true);
    expect(nota.conditionalAverageCost).toBeNull(); // nunca custo zero
    expect(nota.warnings.some((w) => /0 linhas|nenhuma linha|revis[ãa]o/i.test(w))).toBe(true);
  });

  it('documento sem produtos e sem linhas não é marcado como incompleto', () => {
    const nota = parsePdfText('DOCUMENTO SEM TABELA DE PRODUTOS');
    expect(nota.lines).toHaveLength(0);
    expect(nota.extractionIncomplete).toBe(false);
  });
});

describe('hasEvidenceOfItems', () => {
  it('reconhece indícios de tabela de produtos', () => {
    expect(hasEvidenceOfItems('DADOS DOS PRODUTOS / SERVIÇOS')).toBe(true);
    expect(hasEvidenceOfItems('CÓDIGO PRODUTO DESCRIÇÃO DO PRODUTO / SERVIÇO')).toBe(true);
    expect(hasEvidenceOfItems('V. TOTAL PRODUTOS\n6.010,44')).toBe(true);
  });

  it('não acusa indícios em texto sem tabela de produtos', () => {
    expect(hasEvidenceOfItems('DOCUMENTO SEM TABELA DE PRODUTOS')).toBe(false);
    expect(hasEvidenceOfItems('')).toBe(false);
  });
});
