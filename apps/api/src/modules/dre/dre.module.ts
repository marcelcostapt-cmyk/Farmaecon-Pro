import { Module } from '@nestjs/common';
import { PurchaseDocumentsController } from './purchase-documents.controller';
import { DrePreviewController } from './dre-preview.controller';
import { PurchaseInvoiceService } from './purchase-invoice.service';
import { DrePreviewService } from './dre-preview.service';

@Module({
  controllers: [PurchaseDocumentsController, DrePreviewController],
  providers: [PurchaseInvoiceService, DrePreviewService],
})
export class DreModule {}
