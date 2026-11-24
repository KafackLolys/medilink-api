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
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import type { AuthenticatedRequest } from '../auth/authenticated-request.interface';
import { AccountStatus } from '../interfaces/database';
import { AdminGuard } from './admin.guard';
import {
  AdminService,
  type AdminAccountsQuery,
  type CreateAdminRequest,
} from './admin.service';

@Controller('admin')
@UseGuards(FirebaseAuthGuard, AdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // V2
  @Get('v2/accounts')
  listAccountsV2(@Query() query: AdminAccountsQuery) {
    return this.adminService.listAccountsV2(query);
  }

  @Patch('v2/accounts/:id/status')
  updateStatusV2(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { status: AccountStatus },
  ) {
    return this.adminService.updateStatusV2(
      request.firebaseUser.uid,
      id,
      body.status,
    );
  }

  @Patch('v2/accounts/:id/verification')
  updateVerificationV2(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { emailVerified?: unknown; verificationStatus?: unknown },
  ) {
    return this.adminService.updateVerificationV2(
      request.firebaseUser.uid,
      id,
      body,
    );
  }

  @Post('v2/admins')
  createAdminV2(@Body() body: CreateAdminRequest) {
    return this.adminService.createAdminV2(body);
  }
  // V1
  @Get('accounts')
  listAccounts(@Query() query: AdminAccountsQuery) {
    return this.adminService.listAccounts(query);
  }

  @Patch('accounts/:id/status')
  updateStatus(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { status: AccountStatus },
  ) {
    return this.adminService.updateStatus(
      request.firebaseUser.uid,
      id,
      body.status,
    );
  }

  @Patch('accounts/:id/verification')
  updateVerification(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { emailVerified?: unknown; verificationStatus?: unknown },
  ) {
    return this.adminService.updateVerification(
      request.firebaseUser.uid,
      id,
      body,
    );
  }

  @Post('admins')
  createAdmin(@Body() body: CreateAdminRequest) {
    return this.adminService.createAdmin(body);
  }
}
