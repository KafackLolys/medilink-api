import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { AuthenticatedRequest } from '../auth/authenticated-request.interface';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import {
  DoctorsService,
  type DoctorDirectoryFilters,
  type UploadedDoctorDocument,
} from './doctors.service';

const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024;

@Controller('doctors')
@UseGuards(FirebaseAuthGuard)
export class DoctorsController {
  constructor(private readonly doctorsService: DoctorsService) {}

  @Get()
  list(@Query() filters: DoctorDirectoryFilters) {
    return this.doctorsService.list(filters);
  }

  @Get('me')
  getMine(@Req() request: AuthenticatedRequest) {
    return this.doctorsService.getMine(request.firebaseUser.uid);
  }

  @Post('me/documents')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_DOCUMENT_SIZE, files: 1 },
    }),
  )
  uploadMyDocument(
    @Req() request: AuthenticatedRequest,
    @Body('type') type: string,
    @UploadedFile() file?: UploadedDoctorDocument,
  ) {
    if (!file) {
      throw new BadRequestException('A document file is required');
    }
    return this.doctorsService.uploadMyDocument(
      request.firebaseUser.uid,
      type,
      file,
    );
  }

  @Delete('me/documents/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteMyDocument(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<void> {
    await this.doctorsService.deleteMyDocument(request.firebaseUser.uid, id);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.doctorsService.get(id);
  }
}
