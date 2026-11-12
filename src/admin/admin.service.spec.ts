import { Test, type TestingModule } from '@nestjs/testing';
import { FirebaseService } from '../firebase/firebase.service';
import { AccountStatus } from '../interfaces/database';
import { AdminService } from './admin.service';

describe('AdminService', () => {
  let service: AdminService;
  const createUser = jest.fn();
  const deleteUser = jest.fn();
  const updateUser = jest.fn();
  const revokeRefreshTokens = jest.fn();
  const getUser = jest.fn();
  const createUserDocument = jest.fn();
  const updateUserDocument = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();
    getUser.mockResolvedValue({
      exists: true,
      data: () => ({ role: 'doctor', status: 'active' }),
    });

    const userReference = {
      get: getUser,
      create: createUserDocument,
      update: updateUserDocument,
    };
    const firebase = {
      getAuth: () => ({
        createUser,
        deleteUser,
        updateUser,
        revokeRefreshTokens,
      }),
      getFirestore: () => ({
        collection: () => ({
          doc: () => userReference,
        }),
      }),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: FirebaseService, useValue: firebase },
      ],
    }).compile();

    service = module.get(AdminService);
  });

  it('creates an active administrator in Firebase Auth and Firestore', async () => {
    createUser.mockResolvedValue({ uid: 'new-admin-id' });
    createUserDocument.mockResolvedValue(undefined);

    const result = await service.createAdmin({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ADA@example.com',
      password: 'secure-password',
    });

    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'ada@example.com',
        emailVerified: true,
        disabled: false,
      }),
    );
    expect(createUserDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'new-admin-id',
        role: 'admin',
        status: 'active',
      }),
    );
    expect(result).toMatchObject({
      id: 'new-admin-id',
      role: 'admin',
      status: 'active',
    });
  });

  it('disables and revokes Firebase sessions when suspending an account', async () => {
    await service.updateStatus('admin-id', 'doctor-id', AccountStatus.SUSPENDED);

    expect(updateUserDocument).toHaveBeenCalledWith(
      expect.objectContaining({ status: AccountStatus.SUSPENDED }),
    );
    expect(updateUser).toHaveBeenCalledWith('doctor-id', { disabled: true });
    expect(revokeRefreshTokens).toHaveBeenCalledWith('doctor-id');
  });

  it('synchronizes patient email verification with Firebase Auth', async () => {
    getUser.mockResolvedValue({
      exists: true,
      data: () => ({ role: 'patient', status: 'active' }),
    });

    await service.updateVerification('admin-id', 'patient-id', {
      emailVerified: true,
    });

    expect(updateUser).toHaveBeenCalledWith('patient-id', {
      emailVerified: true,
    });
    expect(updateUserDocument).toHaveBeenCalledWith(
      expect.objectContaining({ emailVerified: true }),
    );
  });
});
