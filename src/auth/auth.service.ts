import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { DecodedIdToken } from 'firebase-admin/auth';
import {
  AccountRole,
  AccountStatus,
  BloodType,
  DoctorVerificationStatus,
  Gender,
  type DoctorProfile,
  type PatientProfile,
  type User,
} from '../interfaces/database';
import { FirebaseService } from '../firebase/firebase.service';

export interface RegisterUserRequest {
  firstName: string;
  lastName: string;
  phone: string;
  role: AccountRole;
  specialty?: string;
  registrationNumber?: string;
  email: string;
  password: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RefreshRequest {
  refreshToken: string;
}

export interface ResetPasswordRequest {
  email: string;
}

export interface AuthProfile {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  role: AccountRole;
  specialty: string | null;
  registrationNumber: string | null;
  status: AccountStatus;
  emailVerified: boolean;
  phoneVerified: boolean;
}

export interface PatientProfileResponse {
  id: string;
  fullName: string;
  dateOfBirth: Date | null;
  gender: Gender;
  bloodType: BloodType;
  verified: boolean;
  address: {
    city: string;
    district: string;
  } | null;
}

export interface AuthProfileResponse {
  user: AuthProfile;
  patient: PatientProfileResponse;
}

export interface AuthSession {
  user: AuthProfile;
  idToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

interface IdentityTokenResponse {
  idToken?: string;
  id_token?: string;
  refreshToken?: string;
  refresh_token?: string;
  localId?: string;
  user_id?: string;
  expiresIn?: string;
  expires_in?: string;
  error?: {
    message?: string;
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly firebase: FirebaseService) {}

  async register(request: RegisterUserRequest): Promise<AuthSession> {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      throw new BadRequestException('A registration object is required');
    }

    const firstName = this.requireText(request.firstName, 'firstName');
    const lastName = this.requireText(request.lastName, 'lastName');
    const phone = this.requireText(request.phone, 'phone');
    const email = this.requireText(request.email, 'email').toLowerCase();
    if (typeof request.password !== 'string' || request.password.length < 8) {
      throw new BadRequestException(
        'password must contain at least 8 characters',
      );
    }
    if (
      request.role !== AccountRole.PATIENT &&
      request.role !== AccountRole.DOCTOR
    ) {
      throw new BadRequestException(
        'Only patient or doctor roles can register',
      );
    }
    if (
      request.specialty !== undefined &&
      typeof request.specialty !== 'string'
    ) {
      throw new BadRequestException('specialty must be a string');
    }
    if (
      request.registrationNumber !== undefined &&
      typeof request.registrationNumber !== 'string'
    ) {
      throw new BadRequestException('registrationNumber must be a string');
    }

    const tokens = await this.identityRequest<IdentityTokenResponse>(
      'accounts:signUp',
      {
        email,
        password: request.password,
        returnSecureToken: true,
      },
    );
    const identity = this.readTokens(tokens);
    const uid = tokens.localId;
    if (!uid) {
      throw new ServiceUnavailableException(
        'Firebase Authentication returned no user identifier',
      );
    }

    const firestore = this.firebase.getFirestore();
    const userRef = firestore.collection('users').doc(uid);
    const doctorProfileRef = firestore.collection('doctorProfiles').doc(uid);
    const now = new Date();
    const user: User = {
      id: uid,
      firstName,
      lastName,
      role: request.role,
      status:
        request.role === AccountRole.DOCTOR
          ? AccountStatus.PENDING
          : AccountStatus.ACTIVE,
      email,
      phone,
      specialty:
        request.role === AccountRole.DOCTOR
          ? request.specialty?.trim() || null
          : null,
      registrationNumber:
        request.role === AccountRole.DOCTOR
          ? request.registrationNumber?.trim() || null
          : null,
      emailVerified: false,
      phoneVerified: false,
      lastLoginAt: now,
      createdAt: now,
      updatedAt: now,
    };

    let profileCreated = false;
    try {
      await firestore.runTransaction(async (transaction) => {
        const existingUser = await transaction.get(userRef);
        if (existingUser.exists) {
          throw new ConflictException(
            'This Firebase account is already registered',
          );
        }
        const existingDoctorProfile =
          request.role === AccountRole.DOCTOR
            ? await transaction.get(doctorProfileRef)
            : null;
        if (existingDoctorProfile?.exists) {
          throw new ConflictException(
            'A professional profile already exists for this account',
          );
        }
        transaction.create(userRef, user);
        if (request.role === AccountRole.DOCTOR) {
          const doctorProfile: DoctorProfile = {
            id: uid,
            userId: uid,
            fullName: `${firstName} ${lastName}`.trim(),
            registrationNumber: user.registrationNumber ?? '',
            bio: '',
            yearsOfExperience: 0,
            consultationFee: 0,
            currency: 'XAF',
            defaultAppointmentDurationMinutes: 30,
            professionalAddress: null,
            verificationStatus: DoctorVerificationStatus.PENDING,
            verifiedAt: null,
            createdAt: now,
            updatedAt: now,
          };
          transaction.create(doctorProfileRef, doctorProfile);
        }
      });
      profileCreated = true;

      await this.identityRequest('accounts:sendOobCode', {
        requestType: 'VERIFY_EMAIL',
        idToken: identity.idToken,
      });
    } catch (error) {
      if (!(error instanceof ConflictException)) {
        try {
          if (profileCreated) {
            await Promise.all([
              userRef.delete(),
              request.role === AccountRole.DOCTOR
                ? doctorProfileRef.delete()
                : Promise.resolve(),
            ]);
          }
          await this.firebase.getAuth().deleteUser(uid);
        } catch (cleanupError) {
          this.logger.error(
            `Failed to clean up Firebase account ${uid} after registration failure`,
            cleanupError instanceof Error ? cleanupError.stack : undefined,
          );
          throw new ServiceUnavailableException(
            'Registration failed and the Firebase account could not be rolled back',
          );
        }
      }
      throw error;
    }

    return {
      user: this.toProfile(user),
      ...identity,
    };
  }

  async login(request: LoginRequest): Promise<AuthSession> {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      throw new BadRequestException('A login object is required');
    }
    const email = this.requireText(request.email, 'email').toLowerCase();
    if (typeof request.password !== 'string' || request.password.length === 0) {
      throw new BadRequestException('password is required');
    }

    const response = await this.identityRequest<IdentityTokenResponse>(
      'accounts:signInWithPassword',
      {
        email,
        password: request.password,
        returnSecureToken: true,
      },
    );
    const identity = this.readTokens(response);
    const decoded = await this.verifyToken(identity.idToken);
    if (!decoded.email_verified) {
      throw new ForbiddenException(
        'Votre adresse e-mail n’a pas encore été vérifiée. Consultez votre boîte de réception et cliquez sur le lien de confirmation avant de vous connecter.',
      );
    }

    const user = await this.getStoredUser(decoded.uid);
    this.assertAccountCanSignIn(user);
    const updates: Partial<User> = {
      lastLoginAt: new Date(),
      updatedAt: new Date(),
      email: decoded.email ?? user.email,
      emailVerified: decoded.email_verified ?? false,
    };
    if (decoded.phone_number) {
      updates.phone = decoded.phone_number;
      updates.phoneVerified = true;
    }

    await this.firebase
      .getFirestore()
      .collection('users')
      .doc(decoded.uid)
      .update(updates);

    return {
      user: this.toProfile({ ...user, ...updates }),
      ...identity,
    };
  }

  async refresh(request: RefreshRequest): Promise<AuthSession> {
    if (
      !request ||
      typeof request !== 'object' ||
      typeof request.refreshToken !== 'string' ||
      request.refreshToken.trim().length === 0
    ) {
      throw new BadRequestException('refreshToken is required');
    }

    const response = await this.identityRefreshRequest(request.refreshToken);
    const identity = this.readTokens(response);
    const decoded = await this.verifyToken(identity.idToken);
    const user = await this.getStoredUser(decoded.uid);
    this.assertAccountCanSignIn(user);

    return {
      user: this.toProfile(user),
      ...identity,
    };
  }

  async resetPassword(
    request: ResetPasswordRequest,
  ): Promise<{ message: string }> {
    if (!request || typeof request !== 'object') {
      throw new BadRequestException('An email is required');
    }
    const email = this.requireText(request.email, 'email').toLowerCase();

    try {
      await this.identityRequest('accounts:sendOobCode', {
        requestType: 'PASSWORD_RESET',
        email,
      });
    } catch (error) {
      if (!(error instanceof UnauthorizedException)) {
        throw error;
      }
    }

    return {
      message: 'If this account exists, a password reset email has been sent.',
    };
  }

  async getProfile(
    firebaseUser: Pick<DecodedIdToken, 'uid'>,
  ): Promise<AuthProfileResponse> {
    const user = await this.getStoredUser(firebaseUser.uid);
    const patientSnapshot = await this.firebase
      .getFirestore()
      .collection('patients')
      .doc(firebaseUser.uid)
      .get();
    const patient = patientSnapshot.exists
      ? (patientSnapshot.data() as PatientProfile)
      : null;

    return {
      user: this.toProfile(user),
      patient: {
        id: patient?.id ?? firebaseUser.uid,
        fullName:
          patient?.fullName ?? `${user.firstName} ${user.lastName}`.trim(),
        dateOfBirth: patient?.dateOfBirth ?? null,
        gender: patient?.gender ?? Gender.UNDISCLOSED,
        bloodType: patient?.bloodType ?? BloodType.UNKNOWN,
        verified: false,
        address: null,
      },
    };
  }

  async logout(firebaseUser: DecodedIdToken): Promise<{ message: string }> {
    await this.firebase.getAuth().revokeRefreshTokens(firebaseUser.uid);
    return { message: 'Firebase sessions revoked' };
  }

  private async getStoredUser(uid: string): Promise<User> {
    const snapshot = await this.firebase
      .getFirestore()
      .collection('users')
      .doc(uid)
      .get();
    if (!snapshot.exists) {
      throw new NotFoundException('Application account not found');
    }
    return snapshot.data() as User;
  }

  private assertAccountCanSignIn(user: User): void {
    if (
      user.status === AccountStatus.SUSPENDED ||
      user.status === AccountStatus.DELETED
    ) {
      throw new ForbiddenException('This account is not active');
    }
  }

  private async verifyToken(idToken: string): Promise<DecodedIdToken> {
    try {
      return await this.firebase.getAuth().verifyIdToken(idToken, true);
    } catch {
      throw new UnauthorizedException('Invalid or revoked Firebase ID token');
    }
  }

  private async identityRequest<T>(
    action: string,
    body: Record<string, string | boolean>,
  ): Promise<T> {
    const url = new URL(`https://identitytoolkit.googleapis.com/v1/${action}`);
    url.searchParams.set('key', this.getWebApiKey());
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      throw new ServiceUnavailableException(
        'Unable to reach Firebase Authentication',
      );
    }

    const payload = (await this.readResponse(response)) as T &
      IdentityTokenResponse;
    if (!response.ok) {
      this.throwIdentityError(payload.error?.message, response.status);
    }
    return payload;
  }

  private async identityRefreshRequest(
    refreshToken: string,
  ): Promise<IdentityTokenResponse> {
    const url = new URL('https://securetoken.googleapis.com/v1/token');
    url.searchParams.set('key', this.getWebApiKey());
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }),
      });
    } catch {
      throw new ServiceUnavailableException(
        'Unable to reach Firebase Authentication',
      );
    }

    const payload = (await this.readResponse(
      response,
    )) as IdentityTokenResponse;
    if (!response.ok) {
      this.throwIdentityError(payload.error?.message, response.status);
    }
    return payload;
  }

  private async readResponse(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new BadGatewayException(
        'Firebase Authentication returned an invalid response',
      );
    }
  }

  private throwIdentityError(
    message: string | undefined,
    status: number,
  ): never {
    const code = message?.split(':')[0] ?? '';
    if (code === 'EMAIL_EXISTS') {
      throw new ConflictException('An account with this email already exists');
    }
    if (
      [
        'EMAIL_NOT_FOUND',
        'INVALID_PASSWORD',
        'INVALID_LOGIN_CREDENTIALS',
        'USER_DISABLED',
        'TOKEN_EXPIRED',
        'INVALID_REFRESH_TOKEN',
        'USER_TOKEN_EXPIRED',
      ].includes(code)
    ) {
      throw new UnauthorizedException('Invalid credentials or expired session');
    }
    if (
      [
        'WEAK_PASSWORD',
        'INVALID_EMAIL',
        'MISSING_EMAIL',
        'MISSING_PASSWORD',
      ].includes(code)
    ) {
      throw new BadRequestException(
        'Firebase rejected the supplied credentials',
      );
    }
    if (['API_KEY_INVALID', 'API_KEY_SERVICE_BLOCKED'].includes(code)) {
      throw new ServiceUnavailableException(
        'FIREBASE_WEB_API_KEY is invalid or unavailable',
      );
    }
    if (code === 'CONFIGURATION_NOT_FOUND') {
      throw new ServiceUnavailableException(
        'Firebase Authentication is not configured for this project. Enable Email/Password sign-in in Firebase Console and verify that FIREBASE_WEB_API_KEY belongs to FIREBASE_PROJECT_ID.',
      );
    }
    throw new ServiceUnavailableException(
      `Firebase Authentication request failed (${code || status})`,
    );
  }

  private getWebApiKey(): string {
    const apiKey = process.env.FIREBASE_WEB_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'FIREBASE_WEB_API_KEY must be configured for Firebase Authentication',
      );
    }
    return apiKey;
  }

  private readTokens(
    response: IdentityTokenResponse,
  ): Omit<AuthSession, 'user'> {
    const idToken = response.idToken ?? response.id_token;
    const refreshToken = response.refreshToken ?? response.refresh_token;
    const expiresIn = Number(response.expiresIn ?? response.expires_in);
    if (
      !idToken ||
      !refreshToken ||
      !Number.isFinite(expiresIn) ||
      expiresIn <= 0
    ) {
      throw new ServiceUnavailableException(
        'Firebase Authentication returned an incomplete token response',
      );
    }
    return { idToken, refreshToken, expiresIn, tokenType: 'Bearer' };
  }

  private toProfile(user: User): AuthProfile {
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      role: user.role,
      specialty: user.specialty,
      registrationNumber: user.registrationNumber,
      status: user.status,
      emailVerified: user.emailVerified,
      phoneVerified: user.phoneVerified,
    };
  }

  private requireText(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new BadRequestException(`${field} is required`);
    }
    return value.trim();
  }
}
