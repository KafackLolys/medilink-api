import { AdminService } from './admin.service';
import { FirebaseService } from '../firebase/firebase.service';
import { AccountRole, AccountStatus, DoctorVerificationStatus } from '../interfaces/database';

describe('AdminService doctor directory eligibility', () => {
  const userRef = { id: 'doctor-uid' };
  const profileRef = { id: 'doctor-profile' };
  const update = jest.fn();
  const commit = jest.fn();
  let userStatus: AccountStatus;
  let service: AdminService;

  beforeEach(() => {
    jest.clearAllMocks();
    userStatus = AccountStatus.PENDING;
    commit.mockResolvedValue(undefined);
    const firestore = {
      collection: (name: string) => {
        if (name === 'users') {
          return {
            doc: () => ({
              ...userRef,
              get: async () => ({
                exists: true,
                data: () => ({ role: AccountRole.DOCTOR, status: userStatus }),
              }),
            }),
          };
        }
        if (name === 'doctorProfiles') {
          return {
            where: () => ({
              limit: () => ({ get: async () => ({ docs: [{ ref: profileRef }] }) }),
            }),
          };
        }
        throw new Error('Unexpected collection');
      },
      batch: () => ({ update, commit }),
    };
    service = new AdminService({ getFirestore: () => firestore } as unknown as FirebaseService);
  });

  it('atomically activates a pending doctor when their profile is verified', async () => {
    await service.updateVerification('admin-id', 'doctor-uid', { verificationStatus: DoctorVerificationStatus.VERIFIED });
    expect(update).toHaveBeenCalledWith(profileRef, expect.objectContaining({ verificationStatus: DoctorVerificationStatus.VERIFIED }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining(userRef), expect.objectContaining({ status: AccountStatus.ACTIVE }));
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('never reactivates suspended accounts automatically', async () => {
    userStatus = AccountStatus.SUSPENDED;
    await service.updateVerification('admin-id', 'doctor-uid', { verificationStatus: DoctorVerificationStatus.VERIFIED });
    expect(update).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('does not activate rejected doctors', async () => {
    await service.updateVerification('admin-id', 'doctor-uid', { verificationStatus: DoctorVerificationStatus.REJECTED });
    expect(update).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledTimes(1);
  });
});
