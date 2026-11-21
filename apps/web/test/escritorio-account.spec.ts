import { accountLabel, resolveSelectedAccount, type AccountOption } from '../src/lib/escritorio-account';

const accounts: AccountOption[] = [
  { id: 'acc-a', name: 'ML #1', displayName: 'Loja Centro' },
  { id: 'acc-b', name: 'ML #2', displayName: null },
];

describe('escritório — conta selecionada', () => {
  it('usa a conta pedida quando ela pertence à lista', () => {
    expect(resolveSelectedAccount(accounts, 'acc-b')?.id).toBe('acc-b');
  });

  it('ignora ids que não estão na lista do tenant e usa a primeira conta', () => {
    expect(resolveSelectedAccount(accounts, 'acc-de-outro-tenant')?.id).toBe('acc-a');
    expect(resolveSelectedAccount(accounts, undefined)?.id).toBe('acc-a');
  });

  it('sem contas devolve null (nada é pedido à API)', () => {
    expect(resolveSelectedAccount([], 'x')).toBeNull();
  });

  it('rótulo usa o nome amigável e cai para o técnico', () => {
    expect(accountLabel(accounts[0])).toBe('Loja Centro');
    expect(accountLabel(accounts[1])).toBe('ML #2');
  });
});
