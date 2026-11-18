import type { Metadata } from 'next';
import CostReviewForm from './cost-review-form';
import type { MlAccountOption } from './types';
import { fetchApi } from '@/lib/api';
import { getCurrentUser } from '@/lib/auth';

export const metadata: Metadata = { title: 'Revisão de custos | Farmaecon PRO' };

interface AccountApi {
  id: string;
  name: string;
  displayName: string | null;
  externalSellerId: string | null;
  cnpj: string | null;
}

export default async function DrePreviewPage() {
  // Pedidos independentes: começam juntos.
  const [accounts, user] = await Promise.all([
    fetchApi<AccountApi[]>('/integrations')
      .then((response) => response.data)
      .catch(() => [] as AccountApi[]),
    getCurrentUser(),
  ]);
  const isAdmin = user?.role === 'ADMIN';
  const options: MlAccountOption[] = accounts.map((a) => ({
    id: a.id,
    name: a.name,
    displayName: a.displayName,
    externalSellerId: a.externalSellerId,
    cnpj: a.cnpj,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Revisão e publicação de custos</h1>
        <p className="text-sm text-muted-foreground">
          Importe a NF-e, escolha a regra de bonificação e publique os custos aprovados por conta ML. Modo Observação · nenhum custo é publicado sem a sua confirmação.
        </p>
      </div>

      {isAdmin ? (
        <CostReviewForm accounts={options} />
      ) : (
        <div className="rounded-lg border border-border bg-muted/30 p-6 text-sm text-muted-foreground">
          Apenas administradores podem rever e publicar custos.
        </div>
      )}
    </div>
  );
}
