export interface RemoteOrder {
  id: number | string;
  status?: string;
  date_created?: string;
  total_amount?: number;
  currency_id?: string;
}

// Reject incomplete batches: unknown money and dates must never become zero/now.
export function validateOrder(order: RemoteOrder, simulated = false) {
  const id = typeof order.id === 'number' && Number.isSafeInteger(order.id) && order.id > 0
    ? String(order.id) : typeof order.id === 'string' ? order.id : '';
  if (!(simulated ? /^[A-Za-z0-9-]{1,128}$/ : /^[1-9]\d{0,31}$/).test(id)) throw new Error('Invalid marketplace order identifier');
  if ((!simulated || order.currency_id) && order.currency_id !== 'BRL') throw new Error('Unsupported or missing order currency');
  const value = order.total_amount;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || !Number.isSafeInteger(Math.round(value * 100))
    || Math.abs(value * 100 - Math.round(value * 100)) > 0.000001) throw new Error('Missing or invalid order amount');
  const raw = order.date_created;
  const calendar = typeof raw === 'string' && raw.match(/^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/);
  if (!calendar || Number(calendar[2]) < 1 || Number(calendar[2]) > 12 || Number(calendar[3]) < 1
    || Number(calendar[3]) > new Date(Date.UTC(Number(calendar[1]), Number(calendar[2]), 0)).getUTCDate()) throw new Error('Missing or invalid order date');
  const date = new Date(raw!);
  if (!Number.isFinite(date.getTime())) throw new Error('Missing or invalid order date');
  return { externalOrderId: id, totalAmount: Math.round(value * 100) / 100, createdAt: date };
}
