#!/bin/bash
set -e

echo "🚀 Farmaecon PRO — Setup de Desenvolvimento"
echo "============================================"

# 1. Verificar dependências
echo ""
echo "📦 Verificando dependências..."
command -v node >/dev/null 2>&1 || { echo "❌ Node.js não encontrado. Instale em https://nodejs.org"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "❌ Docker não encontrado. Instale em https://docker.com"; exit 1; }
echo "✅ Node.js $(node -v) | Docker $(docker -v | awk '{print $3}')"

# 2. Instalar dependências do monorepo
echo ""
echo "📦 Instalando dependências..."
npm install

echo "📦 Instalando dependências da API..."
cd apps/api && npm install && cd ../..

echo "📦 Instalando dependências do Web..."
cd apps/web && npm install && cd ../..

# 3. Criar .env se não existir
if [ ! -f apps/api/.env ]; then
  cp apps/api/.env apps/api/.env.backup 2>/dev/null || true
  echo ""
  echo "⚠️  Arquivo .env criado em apps/api/.env"
  echo "   Por favor, revise as variáveis antes de continuar."
fi

# 4. Subir banco e Redis
echo ""
echo "🐳 Iniciando PostgreSQL e Redis via Docker..."
docker compose up -d
echo "⏳ Aguardando banco ficar pronto..."
sleep 5

# 5. Setup Prisma
echo ""
echo "🗄️  Gerando cliente Prisma..."
cd apps/api
npx prisma generate

echo "🗄️  Aplicando schema no banco..."
npx prisma db push

echo "🌱 Executando seed com dados demo..."
npm run db:seed

cd ../..

echo ""
echo "============================================"
echo "✅ Setup concluído!"
echo ""
echo "🖥️  Para iniciar os servidores:"
echo "   Terminal 1 → cd apps/api && npm run dev"
echo "   Terminal 2 → cd apps/web && npm run dev"
echo ""
echo "🔗 URLs:"
echo "   Frontend: http://localhost:3000"
echo "   API:      http://localhost:3001/api/v1"
echo ""
echo "🔑 Login demo:"
echo "   Email:    admin@farmaecon.com"
echo "   Senha:    admin1234"
