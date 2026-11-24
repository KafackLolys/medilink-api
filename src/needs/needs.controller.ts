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
  type DoctorProposalFilters,
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

  @Get('doctor/proposals')
  listDoctorProposals(
    @Req() request: AuthenticatedRequest,
    @Query() filters: DoctorProposalFilters,
  ) {
    return this.needsService.listProposalsForDoctor(
      request.firebaseUser,
      filters,
    );
  }

  @Get('doctor/:id')
  getForDoctor(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.needsService.getForDoctor(request.firebaseUser, id);
  }

  @Post('doctor/:id/proposals')
  @HttpCode(HttpStatus.CREATED)
  createProposal(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: CreateProposalRequest,
  ) {
    return this.needsService.createProposal(request.firebaseUser, id, body);
  }

  @Patch('doctor/proposals/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancelDoctorProposal(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.needsService.cancelProposal(request.firebaseUser, id);
  }

  @Get(':id/proposals')
  patientProposals(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.needsService.listPatientProposals(request.firebaseUser, id);
  }

  @Patch(':id/proposals/:proposalId/accept')
  acceptPatientProposal(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('proposalId') proposalId: string,
  ) {
    return this.needsService.acceptPatientProposal(
      request.firebaseUser,
      id,
      proposalId,
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
    @Body()
    body: {
      title: string;
      specialty: string;
      description: string;
      mode: 'domicile' | 'tele';
    },
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

  // V2 route copies

  @Get('v2')
  listV2(@Req() request: AuthenticatedRequest) {
    return this.needsService.listMineV2(request.firebaseUser);
  }

  @Get('v2/doctor')
  listForDoctorV2(
    @Req() request: AuthenticatedRequest,
    @Query() filters: DoctorNeedFilters,
  ) {
    return this.needsService.listForDoctorV2(request.firebaseUser, filters);
  }

  @Get('v2/doctor/proposals')
  listDoctorProposalsV2(
    @Req() request: AuthenticatedRequest,
    @Query() filters: DoctorProposalFilters,
  ) {
    return this.needsService.listProposalsForDoctorV2(
      request.firebaseUser,
      filters,
    );
  }

  @Get('v2/doctor/:id')
  getForDoctorV2(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.needsService.getForDoctorV2(request.firebaseUser, id);
  }

  @Post('v2/doctor/:id/proposals')
  @HttpCode(HttpStatus.CREATED)
  createProposalV2(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: CreateProposalRequest,
  ) {
    return this.needsService.createProposalV2(request.firebaseUser, id, body);
  }

  @Patch('v2/doctor/proposals/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancelDoctorProposalV2(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.needsService.cancelProposalV2(request.firebaseUser, id);
  }

  @Get('v2/:id/proposals')
  patientProposalsV2(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.needsService.listPatientProposalsV2(request.firebaseUser, id);
  }

  @Patch('v2/:id/proposals/:proposalId/accept')
  acceptPatientProposalV2(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('proposalId') proposalId: string,
  ) {
    return this.needsService.acceptPatientProposalV2(
      request.firebaseUser,
      id,
      proposalId,
    );
  }

  @Get('v2/:id')
  getV2(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.needsService.getMineV2(request.firebaseUser, id);
  }

  @Patch('v2/:id')
  @HttpCode(HttpStatus.OK)
  updateV2(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body()
    body: {
      title: string;
      specialty: string;
      description: string;
      mode: 'domicile' | 'tele';
    },
  ) {
    return this.needsService.updateV2(request.firebaseUser, id, body);
  }

  @Post('v2')
  @UseInterceptors(
    FilesInterceptor('files', MAX_FILES, {
      limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES },
    }),
  )
  createV2(
    @Req() request: AuthenticatedRequest,
    @Body('data') serializedRequest: string,
    @UploadedFiles() files: UploadedNeedFile[] = [],
  ) {
    if (typeof serializedRequest !== 'string') {
      throw new BadRequestException('Request details are required');
    }
    return this.needsService.createV2(
      request.firebaseUser,
      serializedRequest,
      files,
    );
  }

  @Patch('v2/:id/close')
  @HttpCode(HttpStatus.OK)
  async closeV2(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    await this.needsService.closeV2(request.firebaseUser, id);
    return { message: 'Medical need closed' };
  }

  @Delete('v2/:id')
  @HttpCode(HttpStatus.OK)
  async removeV2(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    await this.needsService.removeV2(request.firebaseUser, id);
    return { message: 'Medical need deleted' };
  }
}
