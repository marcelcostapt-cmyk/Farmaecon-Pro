import { fetchApi } from '@/lib/api';
interface Ledger { complete: false; grossRevenue: number | null; marketplaceFees: number | null; productCosts: number | null; shippingCosts: number | null; taxes: number | null; otherExpenses: number | null; }
export default async function FinancePage() {
  const now = new Date(); const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const { data } = await fetchApi<Ledger>(`/finance/dre?from=${from.toISOString()}&to=${now.toISOString()}`);
  const fields = [['Receita registrada', data.grossRevenue], ['Taxas registradas', data.marketplaceFees], ['Custos registrados', data.productCosts], ['Frete registrado', data.shippingCosts], ['Impostos registrados', data.taxes], ['Despesas registradas', data.otherExpenses]] as const;
  return <section className="max-w-3xl space-y-6"><h1 className="text-3xl font-semibold">Financeiro em observação</h1>
    <p className="border-l-4 border-amber-500 bg-amber-50 p-4 text-amber-950">DRE indisponível. A cobertura financeira ainda não foi reconciliada. Valores abaixo são registros parciais, não resultado financeiro real.</p>
    <p className="text-sm">Período: {from.toLocaleDateString('pt-BR')} a {now.toLocaleString('pt-BR')}</p>
    <dl className="divide-y rounded-xl border px-5">{fields.map(([label, value]) => <div key={label} className="flex justify-between py-4"><dt>{label}</dt><dd>{value === null ? 'Não informado' : value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</dd></div>)}</dl>
    <p>Lucro líquido e margem: indisponíveis.</p><a className="underline" href="/observation">Ver origens e lacunas no relatório de observação</a></section>;
}
