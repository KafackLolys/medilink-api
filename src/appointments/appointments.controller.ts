import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/authenticated-request.interface';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { AppointmentStatus } from '../interfaces/database';
import {
  AppointmentsService,
  type CreateAppointmentRequest,
} from './appointments.service';

@Controller('appointments')
@UseGuards(FirebaseAuthGuard)
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Get()
  listMine(@Req() request: AuthenticatedRequest) {
    return this.appointmentsService.listMine(request.firebaseUser);
  }

  @Get('doctor')
  listDoctor(@Req() request: AuthenticatedRequest) {
    return this.appointmentsService.listDoctor(request.firebaseUser);
  }

  @Get(':id/review')
  getMyReview(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.appointmentsService.getMyReview(request.firebaseUser.uid, id);
  }

  @Post(':id/review')
  submitReview(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { rating: number; comment?: string | null },
  ) {
    return this.appointmentsService.submitReview(
      request.firebaseUser.uid,
      id,
      body,
    );
  }

  @Get(':id')
  getMine(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.appointmentsService.getMine(request.firebaseUser, id);
  }

  @Patch(':id/status')
  @HttpCode(HttpStatus.OK)
  updateStatus(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { status: string },
  ) {
    const status = body.status as AppointmentStatus;
    if (!Object.values(AppointmentStatus).includes(status)) {
      throw new BadRequestException(`Statut invalide : ${body.status}`);
    }
    return this.appointmentsService.updateStatus(
      request.firebaseUser,
      id,
      status,
    );
  }

  @Post()
  create(
    @Req() request: AuthenticatedRequest,
    @Body() body: CreateAppointmentRequest,
  ) {
    return this.appointmentsService.create(request.firebaseUser, body);
  }

  // V2 route copies

  @Get('v2')
  listMineV2(@Req() request: AuthenticatedRequest) {
    return this.appointmentsService.listMineV2(request.firebaseUser);
  }

  @Get('v2/doctor')
  listDoctorV2(@Req() request: AuthenticatedRequest) {
    return this.appointmentsService.listDoctorV2(request.firebaseUser);
  }

  @Get('v2/:id/review')
  getMyReviewV2(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.appointmentsService.getMyReviewV2(request.firebaseUser.uid, id);
  }

  @Post('v2/:id/review')
  submitReviewV2(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { rating: number; comment?: string | null },
  ) {
    return this.appointmentsService.submitReviewV2(
      request.firebaseUser.uid,
      id,
      body,
    );
  }

  @Get('v2/:id')
  getMineV2(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.appointmentsService.getMineV2(request.firebaseUser, id);
  }

  @Patch('v2/:id/status')
  @HttpCode(HttpStatus.OK)
  updateStatusV2(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { status: string },
  ) {
    const status = body.status as AppointmentStatus;
    if (!Object.values(AppointmentStatus).includes(status)) {
      throw new BadRequestException(`Statut invalide : ${body.status}`);
    }
    return this.appointmentsService.updateStatusV2(
      request.firebaseUser,
      id,
      status,
    );
  }

  @Post('v2')
  createV2(
    @Req() request: AuthenticatedRequest,
    @Body() body: CreateAppointmentRequest,
  ) {
    return this.appointmentsService.createV2(request.firebaseUser, body);
  }
}
