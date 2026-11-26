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
  Patch,
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
const MAX_PROFILE_PHOTO_SIZE = 2 * 1024 * 1024;

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

  // Keep this exact V2 collection path ahead of the legacy `:id` route.
  @Get('v2')
  listV2(@Query() filters: DoctorDirectoryFilters) {
    return this.doctorsService.listV2(filters);
  }

  @Get('me/reviews')
  listMyReviews(@Req() request: AuthenticatedRequest) {
    return this.doctorsService.listMyReviews(request.firebaseUser.uid);
  }

  @Patch('me')
  updateMyProfile(
    @Req() request: AuthenticatedRequest,
    @Body()
    body: {
      bio?: string;
      yearsOfExperience?: number;
      consultationFee?: number;
      professionalAddress?: string | null;
    },
  ) {
    return this.doctorsService.updateMyProfile(request.firebaseUser.uid, body);
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

  // V2 route copies

  @Get('v2/me')
  getMineV2(@Req() request: AuthenticatedRequest) {
    return this.doctorsService.getMineV2(request.firebaseUser.uid);
  }

  @Post('v2/me/photo')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_PROFILE_PHOTO_SIZE, files: 1 },
    }),
  )
  uploadMyProfilePhotoV2(
    @Req() request: AuthenticatedRequest,
    @UploadedFile() file?: UploadedDoctorDocument,
  ) {
    if (!file) throw new BadRequestException('Une photo est requise');
    return this.doctorsService.uploadMyProfilePhotoV2(request.firebaseUser.uid, file);
  }

  @Get('v2/me/photo')
  getMyProfilePhotoV2(@Req() request: AuthenticatedRequest) {
    return this.doctorsService.getMyProfilePhotoV2(request.firebaseUser.uid);
  }

  @Get('v2/me/reviews')
  listMyReviewsV2(@Req() request: AuthenticatedRequest) {
    return this.doctorsService.listMyReviewsV2(request.firebaseUser.uid);
  }

  @Patch('v2/me')
  updateMyProfileV2(
    @Req() request: AuthenticatedRequest,
    @Body()
    body: {
      bio?: string;
      yearsOfExperience?: number;
      consultationFee?: number;
      professionalAddress?: string | null;
    },
  ) {
    return this.doctorsService.updateMyProfileV2(
      request.firebaseUser.uid,
      body,
    );
  }

  @Post('v2/me/documents')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_DOCUMENT_SIZE, files: 1 },
    }),
  )
  uploadMyDocumentV2(
    @Req() request: AuthenticatedRequest,
    @Body('type') type: string,
    @UploadedFile() file?: UploadedDoctorDocument,
  ) {
    if (!file) {
      throw new BadRequestException('A document file is required');
    }
    return this.doctorsService.uploadMyDocumentV2(
      request.firebaseUser.uid,
      type,
      file,
    );
  }

  @Delete('v2/me/documents/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteMyDocumentV2(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<void> {
    await this.doctorsService.deleteMyDocumentV2(request.firebaseUser.uid, id);
  }

  @Get('v2/:id')
  getV2(@Param('id') id: string) {
    return this.doctorsService.getV2(id);
  }
}
