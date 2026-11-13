import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  AuthService,
  type LoginRequest,
  type RefreshRequest,
  type RegisterUserRequest,
  type ResetPasswordRequest,
  type UpdateAdminProfileRequest,
} from './auth.service';
import type { AuthenticatedRequest } from './authenticated-request.interface';
import { FirebaseAuthGuard } from './firebase-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() body: RegisterUserRequest) {
    return this.authService.register(body);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() body: LoginRequest) {
    return this.authService.login(body);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() body: RefreshRequest) {
    return this.authService.refresh(body);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(@Body() body: ResetPasswordRequest) {
    return this.authService.resetPassword(body);
  }

  @Get('profile')
  @UseGuards(FirebaseAuthGuard)
  getProfile(@Req() request: AuthenticatedRequest) {
    return this.authService.getProfile(request.firebaseUser);
  }

  @Patch('admin/profile')
  @UseGuards(FirebaseAuthGuard)
  updateAdminProfile(
    @Req() request: AuthenticatedRequest,
    @Body() body: UpdateAdminProfileRequest,
  ) {
    return this.authService.updateAdminProfile(request.firebaseUser.uid, body);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(FirebaseAuthGuard)
  logout(@Req() request: AuthenticatedRequest) {
    return this.authService.logout(request.firebaseUser);
  }
}
