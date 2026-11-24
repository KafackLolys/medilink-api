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

  @Get('me/modes')
  getModes(@Req() request: AuthenticatedRequest) {
    return this.availabilities.getModes(request.firebaseUser.uid);
  }

  @Put('me/modes')
  setModes(
    @Req() request: AuthenticatedRequest,
    @Body() body: { modes?: unknown },
  ) {
    return this.availabilities.setModes(request.firebaseUser.uid, body?.modes);
  }

  @Get('me/duration')
  getDuration(@Req() request: AuthenticatedRequest) {
    return this.availabilities.getDuration(request.firebaseUser.uid);
  }

  @Patch('me/duration')
  setDuration(
    @Req() request: AuthenticatedRequest,
    @Body() body: { durationMinutes: number },
  ) {
    return this.availabilities.setDuration(
      request.firebaseUser.uid,
      body?.durationMinutes,
    );
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
  deleteBlocked(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.availabilities.deleteBlocked(request.firebaseUser.uid, id);
  }

  @Get('me/appointments')
  getDoctorAppointments(@Req() request: AuthenticatedRequest) {
    return this.availabilities.getDoctorAppointments(request.firebaseUser.uid);
  }

  // V2 route copies

  @Get('v2/me/modes')
  getModesV2(@Req() request: AuthenticatedRequest) {
    return this.availabilities.getModesV2(request.firebaseUser.uid);
  }

  @Put('v2/me/modes')
  setModesV2(
    @Req() request: AuthenticatedRequest,
    @Body() body: { modes?: unknown },
  ) {
    return this.availabilities.setModesV2(
      request.firebaseUser.uid,
      body?.modes,
    );
  }

  @Get('v2/me/duration')
  getDurationV2(@Req() request: AuthenticatedRequest) {
    return this.availabilities.getDurationV2(request.firebaseUser.uid);
  }

  @Patch('v2/me/duration')
  setDurationV2(
    @Req() request: AuthenticatedRequest,
    @Body() body: { durationMinutes: number },
  ) {
    return this.availabilities.setDurationV2(
      request.firebaseUser.uid,
      body?.durationMinutes,
    );
  }

  @Get('v2/me/weekly')
  getWeeklyV2(@Req() request: AuthenticatedRequest) {
    return this.availabilities.getWeeklyV2(request.firebaseUser.uid);
  }

  @Put('v2/me/weekly')
  setWeeklyV2(
    @Req() request: AuthenticatedRequest,
    @Body() body: WeeklyAvailabilityInput[],
  ) {
    return this.availabilities.setWeeklyV2(request.firebaseUser.uid, body);
  }

  @Get('v2/me/blocked')
  getBlockedV2(@Req() request: AuthenticatedRequest) {
    return this.availabilities.getBlockedV2(request.firebaseUser.uid);
  }

  @Post('v2/me/blocked')
  createBlockedV2(
    @Req() request: AuthenticatedRequest,
    @Body() body: CreateBlockedDateInput,
  ) {
    return this.availabilities.createBlockedV2(request.firebaseUser.uid, body);
  }

  @Delete('v2/me/blocked/:id')
  deleteBlockedV2(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.availabilities.deleteBlockedV2(request.firebaseUser.uid, id);
  }

  @Get('v2/me/appointments')
  getDoctorAppointmentsV2(@Req() request: AuthenticatedRequest) {
    return this.availabilities.getDoctorAppointmentsV2(
      request.firebaseUser.uid,
    );
  }
}
