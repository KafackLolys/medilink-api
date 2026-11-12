import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/authenticated-request.interface';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { DoctorsService, type DoctorDirectoryFilters } from './doctors.service';

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

  @Get(':id')
  get(@Param('id') id: string) {
    return this.doctorsService.get(id);
  }
}
