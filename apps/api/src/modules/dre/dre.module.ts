import { Module } from '@nestjs/common';
import { PurchaseDocumentsController } from './purchase-documents.controller';

@Module({
  controllers: [PurchaseDocumentsController],
})
export class DreModule {}
