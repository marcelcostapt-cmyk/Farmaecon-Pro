import { IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const QTY = /^\d+(\.\d{1,4})?$/;

export class CreateLotDto {
  @IsString() @Length(1, 200) productName!: string;
  @IsOptional() @IsString() @MaxLength(60) ean?: string | null;
  @IsOptional() @IsString() @MaxLength(60) sku?: string | null;
  @IsString() @Length(1, 60) lotNumber!: string;
  @IsOptional() @Matches(DAY, { message: 'fabricationDate deve ser AAAA-MM-DD' }) fabricationDate?: string | null;
  @IsOptional() @Matches(DAY, { message: 'expiryDate deve ser AAAA-MM-DD' }) expiryDate?: string | null;
  @IsOptional() @Matches(QTY, { message: 'quantity inválida' }) quantity?: string | null;
  @IsOptional() @IsString() @MaxLength(500) notes?: string | null;
}

export class UpdateLotDto {
  @IsOptional() @IsString() @Length(1, 200) productName?: string;
  @IsOptional() @IsString() @MaxLength(60) ean?: string | null;
  @IsOptional() @IsString() @MaxLength(60) sku?: string | null;
  @IsOptional() @IsString() @Length(1, 60) lotNumber?: string;
  @IsOptional() @Matches(DAY, { message: 'fabricationDate deve ser AAAA-MM-DD' }) fabricationDate?: string | null;
  @IsOptional() @Matches(DAY, { message: 'expiryDate deve ser AAAA-MM-DD' }) expiryDate?: string | null;
  @IsOptional() @Matches(QTY, { message: 'quantity inválida' }) quantity?: string | null;
  @IsOptional() @IsString() @MaxLength(500) notes?: string | null;
}
