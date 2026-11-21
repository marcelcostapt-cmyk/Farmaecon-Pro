import { displayMetric, displayPeriod } from '../src/lib/agent-result-view';

describe('apresentação de resultados — sem valores inventados', () => {
  it('ROAS e ACOS ausentes aparecem como indisponível, nunca como zero', () => {
    expect(displayMetric(null, '%')).toBe('indisponível');
    expect(displayMetric('')).toBe('indisponível');
    expect(displayMetric(undefined)).toBe('indisponível');
  });

  it('valor presente mantém a unidade', () => {
    expect(displayMetric('100.00', ' BRL')).toBe('100.00 BRL');
    expect(displayMetric('0.00')).toBe('0.00');
  });

  it('período sem dados não inventa datas', () => {
    expect(displayPeriod(null, null)).toBe('sem período (sem dados)');
    expect(displayPeriod('2026-11-10', '2026-11-11')).toBe('2026-11-10 a 2026-11-11');
    expect(displayPeriod('2026-11-10', '2026-11-10')).toBe('2026-11-10');
  });
});
