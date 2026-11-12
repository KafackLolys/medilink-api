import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/authenticated-request.interface';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
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

  @Get(':id')
  getMine(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.appointmentsService.getMine(request.firebaseUser, id);
  }

  @Post()
  create(
    @Req() request: AuthenticatedRequest,
    @Body() body: CreateAppointmentRequest,
  ) {
    return this.appointmentsService.create(request.firebaseUser, body);
  }
}
