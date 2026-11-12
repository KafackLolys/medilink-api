import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/authenticated-request.interface';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import {
  AvailabilitiesService,
  type CreateBlockedDateInput,
  type WeeklyAvailabilityInput,
} from './availabilities.service';

@Controller('availabilities')
@UseGuards(FirebaseAuthGuard)
export class AvailabilitiesController {
  constructor(private readonly availabilities: AvailabilitiesService) {}

  @Get('me/duration')
  getDuration(@Req() request: AuthenticatedRequest) {
    return this.availabilities.getDuration(request.firebaseUser.uid);
  }

  @Patch('me/duration')
  setDuration(@Req() request: AuthenticatedRequest, @Body() body: { durationMinutes: number }) {
    return this.availabilities.setDuration(request.firebaseUser.uid, body?.durationMinutes);
  }

  @Get('me/weekly')
  getWeekly(@Req() request: AuthenticatedRequest) {
    return this.availabilities.getWeekly(request.firebaseUser.uid);
  }

  @Put('me/weekly')
  setWeekly(
    @Req() request: AuthenticatedRequest,
    @Body() body: WeeklyAvailabilityInput[],
  ) {
    return this.availabilities.setWeekly(request.firebaseUser.uid, body);
  }

  @Get('me/blocked')
  getBlocked(@Req() request: AuthenticatedRequest) {
    return this.availabilities.getBlocked(request.firebaseUser.uid);
  }

  @Post('me/blocked')
  createBlocked(
    @Req() request: AuthenticatedRequest,
    @Body() body: CreateBlockedDateInput,
  ) {
    return this.availabilities.createBlocked(request.firebaseUser.uid, body);
  }

  @Delete('me/blocked/:id')
  deleteBlocked(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.availabilities.deleteBlocked(request.firebaseUser.uid, id);
  }

  @Get('me/appointments')
  getDoctorAppointments(@Req() request: AuthenticatedRequest) {
    return this.availabilities.getDoctorAppointments(request.firebaseUser.uid);
  }
}
