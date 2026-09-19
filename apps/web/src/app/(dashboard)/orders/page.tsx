import type { Metadata } from 'next';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchApi } from '@/lib/api';

export const metadata: Metadata = { title: 'Pedidos | Farmaecon PRO' };

const STATUS_MAP: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  PENDING:   { label: 'Pendente',   variant: 'outline'     },
  PAID:      { label: 'Pago',       variant: 'secondary'   },
  SHIPPED:   { label: 'Enviado',    variant: 'default'     },
  DELIVERED: { label: 'Entregue',   variant: 'default'     },
  CANCELED:  { label: 'Cancelado',  variant: 'destructive' },
};

interface OrderRow {
  id: string;
  externalOrderId: string;
  totalAmount: number;
  status: string;
  createdAt: string;
  marketplaceAccount: {
    name: string;
    platform: string;
  };
}

async function getOrders() {
  const response = await fetchApi<OrderRow[]>('/orders?page=1&limit=50');
  return response.data;
}

export default async function OrdersPage() {
  const orders = await getOrders();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Pedidos</h1>
        <p className="text-sm text-muted-foreground">Todos os pedidos dos seus marketplaces conectados</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lista de Pedidos</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pedido</TableHead>
                <TableHead>ID Externo</TableHead>
                <TableHead>Conta</TableHead>
                <TableHead>Marketplace</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Data</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order) => {
                const status = STATUS_MAP[order.status] ?? { label: order.status, variant: 'outline' as const };
                return (
                  <TableRow key={order.id}>
                    <TableCell className="font-mono text-xs">{order.id}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{order.externalOrderId}</TableCell>
                    <TableCell>
                      <span className="text-xs font-medium">{order.marketplaceAccount.name}</span>
                    </TableCell>
                    <TableCell className="text-sm">{order.marketplaceAccount.platform.replaceAll('_', ' ')}</TableCell>
                    <TableCell className="text-right font-mono font-medium">
                      R$ {order.totalAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(order.createdAt).toLocaleDateString('pt-BR')}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
