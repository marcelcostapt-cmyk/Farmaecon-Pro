import { resolveDocumentAccount, normalizeCompanyName, type MlAccountIdentity } from './document-account-match';

const acc = (over: Partial<MlAccountIdentity>): MlAccountIdentity => ({
  id: 'a1', status: 'ACTIVE', name: 'ML #123', cnpj: null, officialName: null, ...over,
});

describe('normalizeCompanyName', () => {
  it('remove acentos, sufixos societários e pontuação', () => {
    expect(normalizeCompanyName('Drogaria Belajoyce LTDA - ME')).toBe('DROGARIA BELAJOYCE');
    expect(normalizeCompanyName('FARMÁCIA SÃO JOÃO S.A.')).toBe('FARMACIA SAO JOAO');
  });
});

describe('resolveDocumentAccount', () => {
  const contas = [
    acc({ id: 'belajoyce', cnpj: '54.000.000/0001-68', officialName: 'Drogaria Belajoyce LTDA - ME' }),
    acc({ id: 'outra', cnpj: '11.111.111/0001-11', officialName: 'Farmácia Outra ME' }),
  ];

  it('prioridade 1: CNPJ do destinatário bate com uma conta', () => {
    const r = resolveDocumentAccount({ recipientCnpj: '54000000000168' }, contas);
    expect(r).toMatchObject({ accountId: 'belajoyce', reason: 'cnpj', requiresReview: false });
  });

  it('prioridade 2: sem CNPJ cadastrado, casa pelo nome da loja', () => {
    const semCnpj = contas.map((c) => ({ ...c, cnpj: null }));
    const r = resolveDocumentAccount({ recipientName: 'DROGARIA BELAJOYCE LTDA - ME' }, semCnpj);
    expect(r).toMatchObject({ accountId: 'belajoyce', reason: 'name', requiresReview: false });
  });

  it('ambiguidade de nome → pending_review, sem vínculo', () => {
    const duplicadas = [acc({ id: 'x', officialName: 'Drogaria Belajoyce' }), acc({ id: 'y', officialName: 'Drogaria Belajoyce' })];
    const r = resolveDocumentAccount({ recipientName: 'Drogaria Belajoyce' }, duplicadas);
    expect(r).toMatchObject({ accountId: null, reason: 'ambiguous', requiresReview: true });
  });

  it('nenhuma conta casa → no_match, pending_review', () => {
    const r = resolveDocumentAccount({ recipientCnpj: '99999999000199' }, contas);
    expect(r).toMatchObject({ accountId: null, reason: 'no_match', requiresReview: true });
  });

  it('documento sem identidade (nem CNPJ nem nome) → pending_review', () => {
    const r = resolveDocumentAccount({}, contas);
    expect(r).toMatchObject({ accountId: null, reason: 'no_document_identity', requiresReview: true });
  });

  it('sem contas ativas → pending_review', () => {
    const inativas = contas.map((c) => ({ ...c, status: 'DISCONNECTED' }));
    const r = resolveDocumentAccount({ recipientCnpj: '54000000000168' }, inativas);
    expect(r).toMatchObject({ accountId: null, reason: 'no_active_accounts', requiresReview: true });
  });

  it('só considera contas ACTIVE ao casar', () => {
    const mix = [acc({ id: 'inativa', cnpj: '54000000000168', status: 'DISCONNECTED' }), acc({ id: 'ativa', cnpj: '54000000000168', status: 'ACTIVE' })];
    const r = resolveDocumentAccount({ recipientCnpj: '54000000000168' }, mix);
    expect(r).toMatchObject({ accountId: 'ativa', reason: 'cnpj', requiresReview: false });
  });
});
