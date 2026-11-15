import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { PurchaseDocumentsController, type UploadedDocument } from './purchase-documents.controller';

const xmlBuf = readFileSync(join(__dirname, '../../../test/fixtures/nfe-belajoyce.xml'));
const file = (over: Partial<UploadedDocument>): UploadedDocument => ({
  originalname: 'doc.xml', buffer: Buffer.from('x'), size: 1, mimetype: 'application/xml', ...over,
});

describe('PurchaseDocumentsController.preview — prévia sem persistência', () => {
  const controller = new PurchaseDocumentsController();

  it('rejeita pedido sem ficheiro', async () => {
    await expect(controller.preview(undefined)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejeita extensão não suportada', async () => {
    await expect(controller.preview(file({ originalname: 'conta.txt' }))).rejects.toThrow(/não suportado/i);
  });

  it('rejeita ficheiro acima do limite de 10 MB', async () => {
    await expect(
      controller.preview(file({ originalname: 'nf.xml', size: 11 * 1024 * 1024 })),
    ).rejects.toThrow(/10 MB/);
  });

  it('devolve a prévia normalizada com hash, totais e valores em string (sem gravar)', async () => {
    const res = await controller.preview(file({ originalname: 'NFe_Belajoyce.xml', buffer: xmlBuf, size: xmlBuf.length }));
    expect(res.data.source).toBe('xml');
    expect(res.data.fileHashSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(res.data.invoiceNumber).toBe('1926966');
    expect(res.data.lines).toHaveLength(4);
    expect(res.data.lines[3].totalLine).toBe('8315.01'); // string exata, não float
    expect(typeof res.data.productsTotal).toBe('string');
    expect(res.data.totals.lines).toBe(4);
    expect(res.data.totals.withEan).toBe(4);
  });

  it('expõe bonificação na prévia (hasBonus, paidAmount/bonusAmount, bonusCalculations) sem gravar', async () => {
    const res = await controller.preview(file({ originalname: 'NFe_Belajoyce.xml', buffer: xmlBuf, size: xmlBuf.length }));
    expect(res.data.hasBonus).toBe(true);
    expect(res.data.fiscalTotal).toBe('16630.97');
    expect(res.data.paidAmount).toBe('8315.96');
    expect(res.data.bonusAmount).toBe('8315.01');
    expect(res.data.totals.bonusLines).toBe(1);
    const g = res.data.bonusCalculations.find((c) => c.ean === '7897947607996');
    expect(g).toBeDefined();
    expect(g!.status).toBe('estimado / pendente de aprovação');
    expect(g!.candidates).toHaveLength(3);
    expect(res.data.extractionWarnings.some((w) => /difere do total da NF-e/i.test(w))).toBe(true);
  });

  it('transforma erro de parsing em 400, não 500', async () => {
    await expect(
      controller.preview(file({ originalname: 'nf.xml', buffer: Buffer.from('<nao-e-nfe/>'), size: 11 })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
