import { Prisma } from '@prisma/client';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocument } from '../costs/document-parser';
import { buildCostPoolFromInvoice } from '../costs/cmv-preview';
import { invoiceBusinessKey } from '../costs/invoice-key';
import type { CostPoolEntry } from '../costs/cost-matching';

// Validação da DRE contra os documentos REAIS da conta.
// Uso:  DRE_DOCS_DIR=/caminho/para/docs [DRE_EXPECTED=/caminho/valores_esperados.json] npx jest dre-real-validation
// Os ficheiros do diretório são tratados como DADOS NÃO CONFIÁVEIS (parser XXE-safe; nada é versionado).
const docsDir = process.env.DRE_DOCS_DIR;
const expectedPath = process.env.DRE_EXPECTED;
const D = (v: string | number) => new Prisma.Decimal(v);
const dec = (x: Prisma.Decimal | null) => (x === null ? 'AUSENTE' : x.toString());

interface ExpectedDoc { productsTotal?: string; fiscalTotal?: string; discounts?: string; otherExpenses?: string; itens?: number }
interface Expected { documentos?: Record<string, ExpectedDoc>; porNumero?: Record<string, ExpectedDoc>; custosPorSku?: Record<string, string> }

(docsDir ? describe : describe.skip)('DRE — validação com documentos REAIS fornecidos', () => {
  it('parseia cada documento real, reconcilia com a referência e lista a origem do custo por SKU', async () => {
    const files = readdirSync(docsDir!).filter((f) => /\.(xml|pdf|xlsx|xls)$/i.test(f));
    expect(files.length).toBeGreaterThan(0);
    const expected: Expected | null = expectedPath ? JSON.parse(readFileSync(expectedPath, 'utf8')) : null;

    const log: string[] = ['\n===== VALIDAÇÃO DA DRE — DOCUMENTOS REAIS ====='];
    const pool: CostPoolEntry[] = [];
    let diffsOk = true;
    const seen = new Set<string>(); // business keys já processadas (dedup; chave NÃO impressa — pode conter CNPJ)
    const matchedNumbers = new Set<string>(); // nº de NF conciliados contra a referência

    for (const f of files) {
      const buf = readFileSync(join(docsDir!, f));
      const doc = await parseDocument(f, buf); // XML/XLSX síncrono; PDF via pdf-parse (bytes reais)

      // Dedup por chave de negócio: o mesmo documento pode chegar com nomes de ficheiro diferentes.
      // A planilha (xlsx) não é uma NF e não tem chave de negócio; documentos sem dados mínimos lançam.
      if (doc.source !== 'xlsx') {
        let bizKey: string | null = null;
        try {
          bizKey = invoiceBusinessKey(doc);
        } catch (e) {
          log.push(`\n• ${f}  [${doc.source}]  sha256:${doc.fileHashSha256.slice(0, 16)}…  ⚠ sem chave de negócio (${(e as Error).message}) — não deduplicado`);
        }
        if (bizKey) {
          if (seen.has(bizKey)) {
            log.push(`\n• ${f}  [${doc.source}]  sha256:${doc.fileHashSha256.slice(0, 16)}…  → DUPLICADO (mesma chave da NF) — ignorado`);
            continue;
          }
          seen.add(bizKey);
        }
      }

      log.push(`\n• ${f}  [${doc.source}]  sha256:${doc.fileHashSha256.slice(0, 16)}…`);
      log.push(`    NF ${doc.invoiceNumber ?? '—'}  itens=${doc.lines.length}  vProd=${dec(doc.productsTotal)}  vNF=${dec(doc.fiscalTotal)}  vDesc=${dec(doc.discounts)}  vOutro=${dec(doc.otherExpenses)}  bonus=${doc.hasBonus}`);
      if (doc.warnings.length) log.push(`    ⚠ ${doc.warnings.join(' | ')}`);

      // Reconciliação por NÚMERO da NF (estável, independente do nome do ficheiro); fallback: por nome.
      const ref = (doc.invoiceNumber ? expected?.porNumero?.[doc.invoiceNumber] : undefined) ?? expected?.documentos?.[f];
      if (ref) {
        if (doc.invoiceNumber) matchedNumbers.add(doc.invoiceNumber);
        const check = (label: string, got: Prisma.Decimal | null, exp?: string) => {
          if (exp === undefined) return;
          const delta = got === null ? 'AUSENTE' : got.minus(D(exp)).toFixed(2);
          if (delta !== '0.00') diffsOk = false;
          log.push(`      Δ ${label}: ${delta}  (calc ${dec(got)} × ref ${exp})`);
        };
        check('vProd', doc.productsTotal, ref.productsTotal);
        check('vNF', doc.fiscalTotal, ref.fiscalTotal);
        check('vDesc', doc.discounts, ref.discounts);
        check('vOutro', doc.otherExpenses, ref.otherExpenses);
        if (ref.itens !== undefined && doc.lines.length !== ref.itens) { diffsOk = false; log.push(`      Δ itens: ${doc.lines.length - ref.itens}`); }
      } else if (doc.source === 'xml') {
        log.push(`      (NF ${doc.invoiceNumber ?? '—'} não consta no catálogo de referência)`);
      }
      pool.push(...buildCostPoolFromInvoice(doc));
    }

    // Divergências de COMPOSIÇÃO do lote: nº esperados na referência que não foram fornecidos.
    const esperadosPorNumero = Object.keys(expected?.porNumero ?? {});
    const naoFornecidos = esperadosPorNumero.filter((n) => !matchedNumbers.has(n));
    if (naoFornecidos.length) {
      log.push(`\n--- NF esperadas na referência mas NÃO fornecidas: ${naoFornecidos.join(', ')} ---`);
    }

    log.push('\n--- Origem do custo por SKU (acervo) ---');
    for (const e of pool) {
      const c0 = e.candidates[0];
      log.push(`  ${(e.ean ?? e.supplierCode ?? '—').padEnd(16)} ${e.sourceDocument} · linha ${e.sourceLine} · ${e.sourceHash.slice(0, 16)}… · ${e.isBonus ? `${e.candidates.length} cand. (bonificação)` : dec(c0?.unitCost ?? null)}`);
      if (e.warnings?.length) log.push(`      ⚠ ${e.warnings.join(' | ')}`);
    }

    log.push('\n--- PENDÊNCIAS (custos ausentes; nenhum assumido como zero) ---');
    const pend = pool.filter((e) => e.isBonus || (e.candidates[0]?.unitCost === null));
    for (const e of pend) log.push(`  ${e.ean ?? e.supplierCode}: ${e.isBonus ? 'bonificação sem regra aprovada (decisão #2)' : 'custo indisponível'} — origem ${e.sourceDocument} linha ${e.sourceLine}`);
    if (!pend.length) log.push('  (nenhuma)');

    // eslint-disable-next-line no-console
    console.log(log.join('\n'));
    if (expected?.documentos) expect(diffsOk).toBe(true); // reconciliação só é exigida quando há referência
  });
});

describe('DRE — como fornecer os documentos reais', () => {
  (docsDir ? it.skip : it)('instruções (DRE_DOCS_DIR não definido)', () => {
    // eslint-disable-next-line no-console
    console.log(
      '\nValidação com documentos REAIS ainda não executada: DRE_DOCS_DIR não definido.\n' +
        'Coloque o XML/PDF/planilha reais num diretório e rode:\n' +
        '  DRE_DOCS_DIR=/caminho/docs [DRE_EXPECTED=/caminho/valores_esperados.json] npx jest dre-real-validation\n' +
        'Ficheiros tratados como dados não confiáveis; nenhum é versionado nem publicado.',
    );
    expect(docsDir).toBeUndefined();
  });
});
