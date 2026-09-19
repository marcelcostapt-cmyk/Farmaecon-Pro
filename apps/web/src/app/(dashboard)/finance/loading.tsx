import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

export default function FinanceLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-between items-center">
        <div><Skeleton className="h-8 w-52 mb-2" /><Skeleton className="h-4 w-80" /></div>
        <Skeleton className="h-6 w-32" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card><CardContent className="pt-6"><Skeleton className="h-12 w-48" /></CardContent></Card>
        <Card className="lg:col-span-2"><CardContent className="pt-6"><div className="grid grid-cols-2 gap-4">{Array.from({ length: 4 }).map((_, i) => (<div key={i}><Skeleton className="h-4 w-24 mb-1" /><Skeleton className="h-6 w-32" /></div>))}</div></CardContent></Card>
      </div>
      <Card><CardHeader><Skeleton className="h-5 w-48" /></CardHeader><CardContent className="flex flex-col gap-3">{Array.from({ length: 8 }).map((_, i) => (<div key={i} className="flex justify-between"><Skeleton className="h-4 w-56" /><Skeleton className="h-4 w-24" /></div>))}</CardContent></Card>
    </div>
  );
}
