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

  @Get(':id')
  getMine(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
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
}
