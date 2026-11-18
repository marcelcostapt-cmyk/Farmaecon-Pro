import { Prisma } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocument } from './document-parser';
import { buildCostPoolFromInvoice } from './cmv-preview';
import { computeDrePreview, type DreOrderRow } from './dre-preview';
import { DEFAULT_STRATEGY } from './cost-matching';

const dir = join(__dirname, '../../../test/fixtures');
const D = (v: string) => new Prisma.Decimal(v);
const pool = async () => buildCostPoolFromInvoice(await parseDocument('NFe_1926966.xml', readFileSync(join(dir, 'nfe-belajoyce.xml'))));

const row = (over: Partial<DreOrderRow>): DreOrderRow => ({
  accountId: 'acc-1', date: new Date('2026-11-20'), ean: null, marketplaceSku: null, description: null,
  quantity: D('1'), revenue: D('45.00'), ...over,
});

describe('computeDrePreview — demonstração em modo preview', () => {
  it('mix de status: bonificado (ambíguo) + normal (indicativo) + sem match → total indicativo null, range preenchido, contagens certas', async () => {
    const p = await pool();
    const rows = [
      row({ ean: '7897947607996', description: 'Produto B' }), // bonificado → estimado, ambíguo
      row({ ean: '7897947606517', quantity: D('2'), revenue: D('80.00') }), // normal → estimado único
      row({ ean: '0000000000000' }), // sem match → indisponível
    ];
    const dre = computeDrePreview(rows, p, DEFAULT_STRATEGY, 'day');
    expect(dre.status).toBe('preview');
    expect(dre.summary.itens_estimados).toBe(2);
    expect(dre.summary.itens_indisponiveis).toBe(1);
    expect(dre.summary.itens_aprovados).toBe(0);
    // total indicativo null porque há item ambíguo e indisponível
    expect(dre.summary.cmv_total_indicativo).toBeNull();
    expect(dre.summary.lucro_bruto).toBeNull();
    expect(dre.summary.margem_bruta).toBeNull();
    // range existe (itens com custo definido)
    expect(dre.summary.cmv_total_estimado_min).not.toBeNull();
    expect(dre.summary.cmv_total_estimado_max).not.toBeNull();
    expect(dre.summary.receita_total.equals(D('170.00'))).toBe(true);
  });

  it('linha do produto normal mostra cmv_indicativo e margem; linha indisponível fica null', async () => {
    const p = await pool();
    const rows = [
      row({ ean: '7897947606517', quantity: D('2'), revenue: D('80.00') }),
      row({ ean: '0000000000000', revenue: D('30.00') }),
    ];
    const dre = computeDrePreview(rows, p, DEFAULT_STRATEGY, 'product');
    const normal = dre.lines.find((l) => l.product_ean === '7897947606517')!;
    expect(normal.cost_status).toBe('estimated');
    expect(normal.cmv_indicativo!.equals(D('33.14'))).toBe(true); // 16.57 * 2
    expect(normal.margem).not.toBeNull();
    const indisp = dre.lines.find((l) => l.product_ean === '0000000000000')!;
    expect(indisp.cost_status).toBe('unavailable');
    expect(indisp.cmv_indicativo).toBeNull();
    expect(indisp.date).toBeNull(); // group_by=product
  });

  it('group_by=day agrega por dia e conta; period cobre as datas', async () => {
    const p = await pool();
    const rows = [
      row({ ean: '7897947606517', date: new Date('2026-11-01'), quantity: D('1'), revenue: D('40') }),
      row({ ean: '7897947606517', date: new Date('2026-11-01'), quantity: D('1'), revenue: D('40') }),
      row({ ean: '7897947606517', date: new Date('2026-11-05'), quantity: D('1'), revenue: D('40') }),
    ];
    const dre = computeDrePreview(rows, p, DEFAULT_STRATEGY, 'day');
    expect(dre.lines).toHaveLength(2); // dois dias
    const dia1 = dre.lines.find((l) => l.date === '2026-11-01')!;
    expect(dia1.quantity_sold.equals(D('2'))).toBe(true);
    expect(dre.period.start).toBe('2026-11-01');
    expect(dre.period.end).toBe('2026-11-05');
  });
});
