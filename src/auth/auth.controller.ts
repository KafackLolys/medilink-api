import {
  Body,
  Controller,
  BadRequestException,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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

const MAX_ADMIN_PROFILE_PHOTO_SIZE = 2 * 1024 * 1024;

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // Google sign-in is authenticated by verifying the Firebase ID token inside the service.
  // These endpoints must not use FirebaseAuthGuard because an unregistered Google UID
  // intentionally has no Firestore users document yet.
  @Post('google/status')
  @HttpCode(HttpStatus.OK)
  googleStatus(@Body() body: { idToken?: unknown }) {
    return this.authService.googleStatus(body?.idToken);
  }

  @Post('google/complete')
  @HttpCode(HttpStatus.OK)
  googleComplete(@Body() body: { idToken?: unknown; role?: unknown }) {
    return this.authService.googleComplete(body?.idToken, body?.role);
  }

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

  // V2 route copies

  @Post('v2/google/status')
  @HttpCode(HttpStatus.OK)
  googleStatusV2(@Body() body: { idToken?: unknown }) {
    return this.authService.googleStatusV2(body?.idToken);
  }

  @Post('v2/google/complete')
  @HttpCode(HttpStatus.OK)
  googleCompleteV2(@Body() body: { idToken?: unknown; role?: unknown }) {
    return this.authService.googleCompleteV2(body?.idToken, body?.role);
  }

  @Post('v2/register')
  registerV2(@Body() body: RegisterUserRequest) {
    return this.authService.registerV2(body);
  }

  @Post('v2/login')
  @HttpCode(HttpStatus.OK)
  loginV2(@Body() body: LoginRequest) {
    return this.authService.loginV2(body);
  }

  @Post('v2/refresh')
  @HttpCode(HttpStatus.OK)
  refreshV2(@Body() body: RefreshRequest) {
    return this.authService.refreshV2(body);
  }

  @Post('v2/reset-password')
  @HttpCode(HttpStatus.OK)
  resetPasswordV2(@Body() body: ResetPasswordRequest) {
    return this.authService.resetPasswordV2(body);
  }

  @Get('v2/profile')
  @UseGuards(FirebaseAuthGuard)
  getProfileV2(@Req() request: AuthenticatedRequest) {
    return this.authService.getProfileV2(request.firebaseUser);
  }

  @Patch('v2/admin/profile')
  @UseGuards(FirebaseAuthGuard)
  updateAdminProfileV2(
    @Req() request: AuthenticatedRequest,
    @Body() body: UpdateAdminProfileRequest,
  ) {
    return this.authService.updateAdminProfileV2(
      request.firebaseUser.uid,
      body,
    );
  }

  @Post('v2/admin/profile/photo')
  @UseGuards(FirebaseAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_ADMIN_PROFILE_PHOTO_SIZE, files: 1 },
    }),
  )
  uploadAdminProfilePhotoV2(
    @Req() request: AuthenticatedRequest,
    @UploadedFile() file?: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  ) {
    if (!file) throw new BadRequestException('Une photo est requise');
    return this.authService.uploadAdminProfilePhotoV2(request.firebaseUser.uid, file);
  }

  @Get('v2/admin/profile/photo')
  @UseGuards(FirebaseAuthGuard)
  getAdminProfilePhotoV2(@Req() request: AuthenticatedRequest) {
    return this.authService.getAdminProfilePhotoV2(request.firebaseUser.uid);
  }

  @Post('v2/logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(FirebaseAuthGuard)
  logoutV2(@Req() request: AuthenticatedRequest) {
    return this.authService.logoutV2(request.firebaseUser);
  }
}
