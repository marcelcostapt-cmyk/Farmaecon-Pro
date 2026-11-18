import { resolveValidFrom } from './cost-validity';

describe('resolveValidFrom', () => {
  it('usa issuedAt quando presente', () => {
    const issued = new Date('2026-04-10T00:00:00Z');
    expect(resolveValidFrom({ issuedAt: issued, createdAt: new Date('2026-05-01T00:00:00Z') })).toEqual(issued);
  });

  it('cai para createdAt quando issuedAt é null', () => {
    const created = new Date('2026-05-01T00:00:00Z');
    expect(resolveValidFrom({ issuedAt: null, createdAt: created })).toEqual(created);
  });
});
