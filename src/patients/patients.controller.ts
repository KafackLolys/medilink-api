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
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { AuthenticatedRequest } from '../auth/authenticated-request.interface';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import {
  PatientsService,
  type UploadedPatientDocument,
} from './patients.service';

const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024;

@Controller('patients')
@UseGuards(FirebaseAuthGuard)
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  @Get('me/conditions')
  listMyConditions(@Req() request: AuthenticatedRequest) {
    return this.patientsService.listMyConditions(request.firebaseUser.uid);
  }

  @Get('me/documents')
  listMyDocuments(@Req() request: AuthenticatedRequest) {
    return this.patientsService.listMyDocuments(request.firebaseUser.uid);
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
    @Body('title') title?: string,
    @UploadedFile() file?: UploadedPatientDocument,
  ) {
    if (!file) {
      throw new BadRequestException('Un fichier de document est requis');
    }
    return this.patientsService.uploadMyDocument(
      request.firebaseUser.uid,
      type,
      file,
      title,
    );
  }

  @Delete('me/documents/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteMyDocument(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<void> {
    await this.patientsService.deleteMyDocument(request.firebaseUser.uid, id);
  }
}

