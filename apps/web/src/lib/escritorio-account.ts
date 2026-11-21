export interface AccountOption {
  id: string;
  name: string;
  displayName: string | null;
}

/** Conta escolhida na URL (`?conta=`). Só aceita ids da lista do próprio tenant; senão, a primeira conta. */
export function resolveSelectedAccount(accounts: AccountOption[], requested: string | undefined): AccountOption | null {
  if (accounts.length === 0) return null;
  return accounts.find((account) => account.id === requested) ?? accounts[0];
}

export function accountLabel(account: AccountOption): string {
  return account.displayName ?? account.name;
}
