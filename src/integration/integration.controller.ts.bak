import { Body, Controller, Get, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { IntegrationService, type DoctorZoneInput, type PatientProfileInput, type ContactInput } from './integration.service';

type AuthenticatedRequest = { firebaseUser: { uid: string } };

@Controller('integration')
export class IntegrationController {
  constructor(private readonly service: IntegrationService) {}

  @UseGuards(FirebaseAuthGuard)
  @Get('doctor/zone')
  getDoctorZone(@Req() req: AuthenticatedRequest) {
    return this.service.getDoctorZone(req.firebaseUser.uid);
  }

  @UseGuards(FirebaseAuthGuard)
  @Put('doctor/zone')
  saveDoctorZone(@Req() req: AuthenticatedRequest, @Body() body: DoctorZoneInput) {
    return this.service.saveDoctorZone(req.firebaseUser.uid, body);
  }

  @UseGuards(FirebaseAuthGuard)
  @Patch('patient/profile')
  savePatientProfile(@Req() req: AuthenticatedRequest, @Body() body: PatientProfileInput) {
    return this.service.savePatientProfile(req.firebaseUser.uid, body);
  }

  @Post('contact')
  createContact(@Body() body: ContactInput) {
    return this.service.createContact(body);
  }
}
