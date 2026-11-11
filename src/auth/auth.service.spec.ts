import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { FirebaseService } from '../firebase/firebase.service';
import {
  AccountRole,
  BloodType,
  Gender,
} from '../interfaces/database';

describe('AuthService', () => {
  const transaction = {
    get: jest.fn(),
    create: jest.fn(),
  };
  const userRef = {
    delete: jest.fn(),
    get: jest.fn(),
    update: jest.fn(),
  };
  const patientRef = {
    get: jest.fn(),
  };
  const firestore = {
    collection: jest.fn((name: string) => ({
      doc: jest.fn(() => (name === 'patients' ? patientRef : userRef)),
    })),
    runTransaction: jest.fn(
      async (callback: (tx: typeof transaction) => Promise<void>) =>
        callback(transaction),
    ),
  };
  const firebaseAuth = {
    deleteUser: jest.fn(),
    getUser: jest.fn(),
    revokeRefreshTokens: jest.fn(),
    verifyIdToken: jest.fn(),
  };
  const fetchMock = jest.fn<typeof fetch>();
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.FIREBASE_WEB_API_KEY;
  let service: AuthService;

  function firebaseResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.FIREBASE_WEB_API_KEY = 'test-web-api-key';
    transaction.get.mockResolvedValue({ exists: false });
    userRef.get.mockResolvedValue({
      exists: true,
      data: () => ({
        id: 'firebase-uid',
        firstName: 'Ada',
        lastName: 'Lovelace',
        role: AccountRole.PATIENT,
        status: 'active',
        email: 'person@example.com',
        phone: '+123456789',
        specialty: null,
        registrationNumber: null,
        emailVerified: true,
        phoneVerified: false,
        lastLoginAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    });
    patientRef.get.mockResolvedValue({ exists: false });
    firebaseAuth.verifyIdToken.mockResolvedValue({
      uid: 'firebase-uid',
      email: 'person@example.com',
      email_verified: true,
    });
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as typeof fetch;
    service = new AuthService({
      getAuth: () => firebaseAuth,
      getFirestore: () => firestore,
    } as unknown as FirebaseService);
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.FIREBASE_WEB_API_KEY;
    } else {
      process.env.FIREBASE_WEB_API_KEY = originalApiKey;
    }
  });

  const registration = {
    firstName: 'Ada',
    lastName: 'Lovelace',
    phone: '+123456789',
    role: AccountRole.PATIENT,
    email: 'person@example.com',
    password: 'StrongPass123!',
  };

  it('creates Firebase credentials, stores only the profile, and returns JSON tokens', async () => {
    fetchMock
      .mockResolvedValueOnce(
        firebaseResponse({
          localId: 'firebase-uid',
          idToken: 'firebase-id-token',
          refreshToken: 'firebase-refresh-token',
          expiresIn: '3600',
        }),
      )
      .mockResolvedValueOnce(firebaseResponse({ email: 'person@example.com' }));

    const result = await service.register(registration);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        href: expect.stringContaining('/accounts:signUp'),
      }),
      expect.objectContaining({
        body: JSON.stringify({
          email: 'person@example.com',
          password: 'StrongPass123!',
          returnSecureToken: true,
        }),
      }),
    );
    const storedUser = transaction.create.mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(storedUser).toMatchObject({
      id: 'firebase-uid',
      firstName: 'Ada',
      lastName: 'Lovelace',
      role: AccountRole.PATIENT,
      email: 'person@example.com',
    });
    expect(storedUser).not.toHaveProperty('password');
    expect(result).toMatchObject({
      user: { firstName: 'Ada', lastName: 'Lovelace' },
      idToken: 'firebase-id-token',
      refreshToken: 'firebase-refresh-token',
      expiresIn: 3600,
      tokenType: 'Bearer',
    });
  });

  it('rejects weak passwords before calling Firebase', async () => {
    await expect(
      service.register({ ...registration, password: 'short' }),
    ).rejects.toThrow(BadRequestException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('signs in through Firebase and returns the user with the session tokens', async () => {
    fetchMock.mockResolvedValueOnce(
      firebaseResponse({
        localId: 'firebase-uid',
        idToken: 'login-id-token',
        refreshToken: 'login-refresh-token',
        expiresIn: '3600',
      }),
    );

    const result = await service.login({
      email: 'person@example.com',
      password: 'StrongPass123!',
    });

    expect(firebaseAuth.verifyIdToken).toHaveBeenCalledWith(
      'login-id-token',
      true,
    );
    expect(result).toMatchObject({
      user: { id: 'firebase-uid' },
      idToken: 'login-id-token',
      refreshToken: 'login-refresh-token',
    });
    expect(userRef.update).toHaveBeenCalled();
  });

  it('returns user and default patient profiles when no patient document exists', async () => {
    const result = await service.getProfile({ uid: 'firebase-uid' });

    expect(result).toEqual({
      user: {
        id: 'firebase-uid',
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'person@example.com',
        phone: '+123456789',
        role: AccountRole.PATIENT,
        specialty: null,
        registrationNumber: null,
        status: 'active',
        emailVerified: true,
        phoneVerified: false,
      },
      patient: {
        id: 'firebase-uid',
        fullName: 'Ada Lovelace',
        dateOfBirth: null,
        gender: Gender.UNDISCLOSED,
        bloodType: BloodType.UNKNOWN,
        verified: false,
        address: null,
      },
    });
    expect(firestore.collection).toHaveBeenCalledWith('patients');
  });

  it('returns the stored patient details when a patient document exists', async () => {
    patientRef.get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        id: 'patient-profile-id',
        fullName: 'Ada Lovelace',
        dateOfBirth: new Date('1815-12-10T00:00:00.000Z'),
        gender: Gender.FEMALE,
        bloodType: BloodType.O_POSITIVE,
      }),
    });

    const result = await service.getProfile({ uid: 'firebase-uid' });

    expect(result.patient).toEqual({
      id: 'patient-profile-id',
      fullName: 'Ada Lovelace',
      dateOfBirth: new Date('1815-12-10T00:00:00.000Z'),
      gender: Gender.FEMALE,
      bloodType: BloodType.O_POSITIVE,
      verified: false,
      address: null,
    });
  });

  it('exchanges refresh tokens and verifies returned Firebase ID tokens', async () => {
    fetchMock.mockResolvedValueOnce(
      firebaseResponse({
        user_id: 'firebase-uid',
        id_token: 'renewed-id-token',
        refresh_token: 'renewed-refresh-token',
        expires_in: '3600',
      }),
    );

    const result = await service.refresh({
      refreshToken: 'old-refresh-token',
    });

    expect(firebaseAuth.verifyIdToken).toHaveBeenCalledWith(
      'renewed-id-token',
      true,
    );
    expect(result).toMatchObject({
      user: { id: 'firebase-uid' },
      idToken: 'renewed-id-token',
      refreshToken: 'renewed-refresh-token',
      expiresIn: 3600,
    });
  });

  it('returns a generic reset response when the email is not registered', async () => {
    fetchMock.mockResolvedValueOnce(
      firebaseResponse({ error: { message: 'EMAIL_NOT_FOUND' } }, 400),
    );

    await expect(
      service.resetPassword({ email: 'unknown@example.com' }),
    ).resolves.toEqual({
      message: 'If this account exists, a password reset email has been sent.',
    });
  });

  it('rejects invalid credentials from Firebase', async () => {
    fetchMock.mockResolvedValueOnce(
      firebaseResponse(
        { error: { message: 'INVALID_LOGIN_CREDENTIALS' } },
        400,
      ),
    );

    await expect(
      service.login({ email: 'person@example.com', password: 'wrong' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('explains when Firebase Authentication is not configured', async () => {
    fetchMock.mockResolvedValueOnce(
      firebaseResponse(
        { error: { message: 'CONFIGURATION_NOT_FOUND' } },
        400,
      ),
    );

    await expect(service.register(registration)).rejects.toThrow(
      'Enable Email/Password sign-in in Firebase Console',
    );
  });
});
