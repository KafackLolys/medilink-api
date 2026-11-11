import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
  BadRequestException,
  Body,
  Query,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { AuthenticatedRequest } from '../auth/authenticated-request.interface';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import {
  NeedsService,
  type CreateProposalRequest,
  type DoctorNeedFilters,
  type UploadedNeedFile,
} from './needs.service';

const MAX_FILES = 5;
const MAX_FILE_SIZE = 10 * 1024 * 1024;

@Controller('needs')
@UseGuards(FirebaseAuthGuard)
export class NeedsController {
  constructor(private readonly needsService: NeedsService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.needsService.listMine(request.firebaseUser);
  }

  @Get('doctor')
  listForDoctor(
    @Req() request: AuthenticatedRequest,
    @Query() filters: DoctorNeedFilters,
  ) {
    return this.needsService.listForDoctor(request.firebaseUser, filters);
  }

  @Get('doctor/:id')
  getForDoctor(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.needsService.getForDoctor(request.firebaseUser, id);
  }

  @Post('doctor/:id/proposals')
  @HttpCode(HttpStatus.CREATED)
  createProposal(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: CreateProposalRequest,
  ) {
    return this.needsService.createProposal(
      request.firebaseUser,
      id,
      body,
    );
  }

  @Get(':id')
  get(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.needsService.getMine(request.firebaseUser, id);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  update(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { title: string; specialty: string; description: string; mode: 'domicile' | 'tele' },
  ) {
    return this.needsService.update(request.firebaseUser, id, body);
  }

  @Post()
  @UseInterceptors(
    FilesInterceptor('files', MAX_FILES, {
      limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES },
    }),
  )
  create(
    @Req() request: AuthenticatedRequest,
    @Body('data') serializedRequest: string,
    @UploadedFiles() files: UploadedNeedFile[] = [],
  ) {
    if (typeof serializedRequest !== 'string') {
      throw new BadRequestException('Request details are required');
    }
    return this.needsService.create(
      request.firebaseUser,
      serializedRequest,
      files,
    );
  }

  @Patch(':id/close')
  @HttpCode(HttpStatus.OK)
  async close(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    await this.needsService.close(request.firebaseUser, id);
    return { message: 'Medical need closed' };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    await this.needsService.remove(request.firebaseUser, id);
    return { message: 'Medical need deleted' };
  }
}
