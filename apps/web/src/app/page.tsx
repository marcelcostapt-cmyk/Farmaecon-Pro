import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background gap-4">
      <h1 className="text-4xl font-bold">Farmaecon PRO</h1>
      <p className="text-muted-foreground">Plataforma SaaS Multi-Marketplace</p>
      <Link
        href="/dashboard"
        className="rounded-md bg-primary text-primary-foreground px-6 py-2 text-sm font-medium hover:bg-primary/90 transition-colors"
      >
        Acessar Dashboard
      </Link>
    </div>
  );
}
