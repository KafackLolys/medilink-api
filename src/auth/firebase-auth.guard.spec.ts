import { UnauthorizedException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { ExecutionContext } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { FirebaseAuthGuard } from './firebase-auth.guard';

describe('FirebaseAuthGuard', () => {
  let guard: FirebaseAuthGuard;
  const verifyIdToken = jest.fn();
  const getUser = jest.fn();

  beforeEach(async () => {
    verifyIdToken.mockReset();
    getUser.mockReset();
    getUser.mockResolvedValue({
      exists: true,
      data: () => ({ status: 'active' }),
    });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FirebaseAuthGuard,
        {
          provide: FirebaseService,
          useValue: {
            getAuth: () => ({ verifyIdToken }),
            getFirestore: () => ({
              collection: () => ({ doc: () => ({ get: getUser }) }),
            }),
          },
        },
      ],
    }).compile();

    guard = module.get(FirebaseAuthGuard);
  });

  function createContext(authorization?: string) {
    const request = { headers: { authorization } };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as ExecutionContext;
    return { context, request };
  }

  it('rejects requests without a bearer token', async () => {
    const { context } = createContext();

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it('verifies tokens with revocation checking enabled', async () => {
    const decodedToken = { uid: 'firebase-user-id' } as DecodedIdToken;
    verifyIdToken.mockResolvedValue(decodedToken);
    const { context, request } = createContext('Bearer valid-token');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(verifyIdToken).toHaveBeenCalledWith('valid-token', true);
    expect(request).toHaveProperty('firebaseUser', decodedToken);
  });

  it('rejects invalid or revoked tokens', async () => {
    verifyIdToken.mockRejectedValue(new Error('Token revoked'));
    const { context } = createContext('Bearer revoked-token');

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects suspended application accounts', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'firebase-user-id' });
    getUser.mockResolvedValue({
      exists: true,
      data: () => ({ status: 'suspended' }),
    });
    const { context } = createContext('Bearer valid-token');

    await expect(guard.canActivate(context)).rejects.toThrow(
      'This account is not active',
    );
  });
});
