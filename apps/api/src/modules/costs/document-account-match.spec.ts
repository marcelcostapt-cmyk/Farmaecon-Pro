import { resolveDocumentAccount, normalizeCompanyName, type MlAccountIdentity } from './document-account-match';

const acc = (over: Partial<MlAccountIdentity>): MlAccountIdentity => ({
  id: 'a1', status: 'ACTIVE', name: 'ML #123', cnpj: null, officialName: null, ...over,
});

// CNPJs sintéticos VÁLIDOS (DV mod-11 confere): o matcher agora exige CNPJ válido para confirmar.
const CNPJ_A = '11222333000181';
const CNPJ_B = '11444777000161';

describe('normalizeCompanyName', () => {
  it('remove acentos, sufixos societários e pontuação', () => {
    expect(normalizeCompanyName('Drogaria Belajoyce LTDA - ME')).toBe('DROGARIA BELAJOYCE');
    expect(normalizeCompanyName('FARMÁCIA SÃO JOÃO S.A.')).toBe('FARMACIA SAO JOAO');
  });
});

describe('resolveDocumentAccount (decisões confirmadas §5)', () => {
  const contas = [
    acc({ id: 'belajoyce', cnpj: CNPJ_A, officialName: 'Drogaria Belajoyce LTDA - ME' }),
    acc({ id: 'outra', cnpj: CNPJ_B, officialName: 'Farmácia Outra ME' }),
  ];

  it('confirma por CNPJ válido e exato do destinatário quando há 1 candidato elegível', () => {
    const r = resolveDocumentAccount({ recipientCnpj: '11.222.333/0001-81' }, contas);
    expect(r).toMatchObject({ accountId: 'belajoyce', reason: 'cnpj', requiresReview: false });
  });

  it('decisão #1 — elegibilidade inclui contas NÃO-ACTIVE (desconectada) para revisão histórica', () => {
    const desconectadas = contas.map((c) => ({ ...c, status: 'DISCONNECTED' }));
    const r = resolveDocumentAccount({ recipientCnpj: CNPJ_A }, desconectadas);
    expect(r).toMatchObject({ accountId: 'belajoyce', reason: 'cnpj', requiresReview: false });
  });

  it('decisão #3 — nome NUNCA confirma: só sugere e mantém PENDING_REVIEW', () => {
    const semCnpj = contas.map((c) => ({ ...c, cnpj: null }));
    const r = resolveDocumentAccount({ recipientName: 'DROGARIA BELAJOYCE LTDA - ME' }, semCnpj);
    expect(r).toMatchObject({ accountId: null, reason: 'name_suggestion', requiresReview: true, candidates: ['belajoyce'] });
  });

  it('decisão #4 — 2+ contas com o MESMO CNPJ → ambíguo, pending, seleção explícita', () => {
    const duplas = [acc({ id: 'x', cnpj: CNPJ_A }), acc({ id: 'y', cnpj: CNPJ_A })];
    const r = resolveDocumentAccount({ recipientCnpj: CNPJ_A }, duplas);
    expect(r).toMatchObject({ accountId: null, reason: 'ambiguous', requiresReview: true });
    expect(r.candidates.sort()).toEqual(['x', 'y']);
  });

  it('decisão #5 — CNPJ válido do documento sem conta igual → pendente; nome só sugere, não encobre a divergência', () => {
    // documento com CNPJ_B (válido) mas o nome bate com a conta de CNPJ_A: NÃO pode confirmar.
    const r = resolveDocumentAccount({ recipientCnpj: CNPJ_B, recipientName: 'Drogaria Belajoyce LTDA' }, [contas[0]]);
    expect(r).toMatchObject({ accountId: null, reason: 'cnpj_no_match', requiresReview: true });
  });

  it('decisão #5 — CNPJ do documento INVÁLIDO → pendente (não cai para o nome)', () => {
    const r = resolveDocumentAccount({ recipientCnpj: '11222333000182', recipientName: 'Drogaria Belajoyce LTDA' }, contas);
    expect(r).toMatchObject({ accountId: null, reason: 'invalid_document_cnpj', requiresReview: true });
  });

  it('documento sem identidade (nem CNPJ nem nome) → pending_review', () => {
    const r = resolveDocumentAccount({}, contas);
    expect(r).toMatchObject({ accountId: null, reason: 'no_document_identity', requiresReview: true });
  });

  it('tenant sem contas → pending_review', () => {
    const r = resolveDocumentAccount({ recipientCnpj: CNPJ_A }, []);
    expect(r).toMatchObject({ accountId: null, reason: 'no_accounts', requiresReview: true });
  });
});
