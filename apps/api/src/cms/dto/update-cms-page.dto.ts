import { PartialType } from '@nestjs/mapped-types';
import { CreateCmsPageDto } from './create-cms-page.dto';

export class UpdateCmsPageDto extends PartialType(CreateCmsPageDto) {}
