import { Module } from '@nestjs/common';
import { PurchaseDocumentsController } from './purchase-documents.controller';
import { DrePreviewController } from './dre-preview.controller';
import { PurchaseInvoiceService } from './purchase-invoice.service';
import { DrePreviewService } from './dre-preview.service';
import { CostPublicationService } from './cost-publication.service';

@Module({
  controllers: [PurchaseDocumentsController, DrePreviewController],
  providers: [PurchaseInvoiceService, DrePreviewService, CostPublicationService],
})
export class DreModule {}
