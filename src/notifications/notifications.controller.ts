import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/authenticated-request.interface';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import {
  NotificationsService,
  type RegisterNotificationDeviceRequest,
} from './notifications.service';

@Controller('notifications')
@UseGuards(FirebaseAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @Req() request: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.notifications.listForUser(request.firebaseUser, page, pageSize);
  }

  @Patch('read-all')
  markAllRead(@Req() request: AuthenticatedRequest) {
    return this.notifications.markAllRead(request.firebaseUser);
  }

  @Patch(':id/read')
  markRead(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.notifications.markRead(request.firebaseUser, id);
  }

  @Post('devices')
  registerDevice(
    @Req() request: AuthenticatedRequest,
    @Body() body: RegisterNotificationDeviceRequest,
  ) {
    return this.notifications.registerDevice(request.firebaseUser, body);
  }

  @Post('devices/:deviceId/unregister')
  unregisterDevice(
    @Req() request: AuthenticatedRequest,
    @Param('deviceId') deviceId: string,
  ) {
    return this.notifications.unregisterDevice(request.firebaseUser, deviceId);
  }
}
