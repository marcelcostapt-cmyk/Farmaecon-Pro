import { money } from './cost-money';
import type { MarginOrderRow } from './margin-preview';
import { computeFeeChanges } from './fee-change';

const at = (month: string) => new Date(`${month}-10T12:00:00Z`);
const sale = (id: string, month: string, sku: string, unitPrice: string, qty: number, fee: string | null, description: string | null = sku): MarginOrderRow => ({
  orderId: id,
  accountId: 'acc',
  soldAt: at(month),
  items: [{ sku, description, quantity: qty, unitPrice: money(unitPrice), saleFee: fee === null ? null : money(fee) }],
});

describe('computeFeeChanges', () => {
  it('alerta quando a taxa efetiva do SKU sobe ≥ 2 pp entre os dois últimos meses', () => {
    const rows = [sale('o1', '2026-05', 'TAR', '100', 1, '10'), sale('o2', '2026-06', 'TAR', '100', 1, '15')];
    const [c] = computeFeeChanges(rows);
    expect(c.sku).toBe('TAR');
    expect(c.fromMonth).toBe('2026-05');
    expect(c.toMonth).toBe('2026-06');
    expect(c.fromRatePercent.toString()).toBe('10');
    expect(c.toRatePercent.toString()).toBe('15');
    expect(c.deltaPp.toString()).toBe('5');
  });

  it('não alerta variação abaixo do limite', () => {
    const rows = [sale('o1', '2026-05', 'TAR', '100', 1, '10'), sale('o2', '2026-06', 'TAR', '100', 1, '11')];
    expect(computeFeeChanges(rows)).toEqual([]);
  });

  it('exige pelo menos dois meses com taxa para comparar', () => {
    expect(computeFeeChanges([sale('o1', '2026-06', 'TAR', '100', 1, '10')])).toEqual([]);
  });

  it('ignora itens sem saleFee (nunca estima taxa em falta)', () => {
    const rows = [sale('o1', '2026-05', 'TAR', '100', 1, '10'), sale('o2', '2026-06', 'TAR', '100', 1, null)];
    expect(computeFeeChanges(rows)).toEqual([]);
  });

  it('usa a taxa efetiva ponderada pela receita, não a média simples das taxas', () => {
    // maio: receita 100 com taxa 10% + receita 300 com taxa 20% → ponderada 70/400 = 17,5%
    // (média simples seria 15%). junho: 18%. Δ = 0,5 pp → sem alerta.
    const rows = [
      sale('o1', '2026-05', 'TAR', '100', 1, '10'),
      sale('o2', '2026-05', 'TAR', '300', 1, '60'),
      sale('o3', '2026-06', 'TAR', '100', 1, '18'),
    ];
    expect(computeFeeChanges(rows)).toEqual([]);
  });

  it('ordena pela maior variação absoluta e isola SKUs', () => {
    const rows = [
      sale('o1', '2026-05', 'A', '100', 1, '10'),
      sale('o2', '2026-06', 'A', '100', 1, '13'),
      sale('o3', '2026-05', 'B', '100', 1, '10'),
      sale('o4', '2026-06', 'B', '100', 1, '20'),
    ];
    expect(computeFeeChanges(rows).map((c) => c.sku)).toEqual(['B', 'A']);
  });
});
