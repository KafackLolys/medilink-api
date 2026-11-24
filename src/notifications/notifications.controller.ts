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
  markRead(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
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

  // V2 route copies

  @Get('v2')
  listV2(
    @Req() request: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.notifications.listForUserV2(
      request.firebaseUser,
      page,
      pageSize,
    );
  }

  @Patch('v2/read-all')
  markAllReadV2(@Req() request: AuthenticatedRequest) {
    return this.notifications.markAllReadV2(request.firebaseUser);
  }

  @Patch('v2/:id/read')
  markReadV2(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.notifications.markReadV2(request.firebaseUser, id);
  }

  @Post('v2/devices')
  registerDeviceV2(
    @Req() request: AuthenticatedRequest,
    @Body() body: RegisterNotificationDeviceRequest,
  ) {
    return this.notifications.registerDeviceV2(request.firebaseUser, body);
  }

  @Post('v2/devices/:deviceId/unregister')
  unregisterDeviceV2(
    @Req() request: AuthenticatedRequest,
    @Param('deviceId') deviceId: string,
  ) {
    return this.notifications.unregisterDeviceV2(
      request.firebaseUser,
      deviceId,
    );
  }
}
