import { AccountRole, AccountStatus, DoctorVerificationStatus } from '../interfaces/database';
import { FirebaseService } from '../firebase/firebase.service';
import { DoctorsService } from './doctors.service';

describe('DoctorsService', () => {
  const profile = {
    userId: 'doctor-uid',
    fullName: 'Dr. Nguema',
    registrationNumber: 'CM-123',
    bio: 'Médecin spécialiste.',
    yearsOfExperience: 12,
    consultationFee: 20000,
    currency: 'XAF',
    professionalAddress: 'Yaoundé',
    verificationStatus: DoctorVerificationStatus.PENDING,
  };
  const user = {
    firstName: 'Amina',
    lastName: 'Nguema',
    role: AccountRole.DOCTOR,
    status: AccountStatus.ACTIVE,
    email: 'amina@example.test',
    phone: '+237600000000',
    specialty: 'Cardiologie',
    registrationNumber: 'CM-123',
  };
  let doctorAccountStatus = AccountStatus.ACTIVE;
  let profileExists = true;
  let migratedProfile: Record<string, unknown> | null = null;
  const transactionCreate = jest.fn();
  const legacyProfileRef = { id: 'doctor-uid' };
  const firestore = {
    collection: jest.fn((name: string) => {
      if (name === 'users') {
        return {
          doc: () => ({
            get: async () => ({
              exists: true,
              data: () => ({ ...user, status: doctorAccountStatus }),
            }),
          }),
        };
      }
      if (name === 'doctorProfiles') {
        return {
          doc: () => legacyProfileRef,
          where: () => ({
            limit: () => ({
              get: async () => ({
                docs: profileExists
                  ? [{ id: 'doctor-profile', data: () => profile }]
                  : [],
              }),
            }),
          }),
        };
      }
      if (name === 'doctorSpecialties') {
        return {
          where: () => ({
            get: async () => ({
              docs: [
                { data: () => ({ specialtyId: 'primary', isPrimary: true }) },
                { data: () => ({ specialtyId: 'secondary', isPrimary: false }) },
              ],
            }),
          }),
        };
      }
      if (name === 'specialties') {
        return {
          doc: (id: string) => ({
            get: async () => ({
              exists: id === 'secondary',
              data: () => ({ name: 'Médecine interne' }),
            }),
          }),
        };
      }
      if (name === 'doctorQualifications') {
        return {
          where: () => ({
            get: async () => ({
              docs: [
                {
                  data: () => ({
                    title: 'Doctorat en médecine',
                    institution: 'Université de Yaoundé I',
                    yearAwarded: 2014,
                  }),
                },
              ],
            }),
          }),
        };
      }
      if (name === 'doctorVerificationDocuments') {
        return {
          where: () => ({
            get: async () => ({
              docs: [
                {
                  id: 'verification-1',
                  data: () => ({
                    documentId: 'medical-document-1',
                    status: 'approved',
                  }),
                },
              ],
            }),
          }),
        };
      }
      if (name === 'medicalDocuments') {
        return {
          doc: () => ({
            get: async () => ({
              exists: true,
              data: () => ({
                type: 'medical_license',
                fileName: 'license.pdf',
                storageKey: 'private/should-not-be-returned',
              }),
            }),
          }),
        };
      }
      const docs =
        name === 'doctorConsultationModes'
          ? [{ data: () => ({ mode: 'teleconsultation' }) }]
          : name === 'doctorWeeklyAvailabilities'
            ? [
                {
                  data: () => ({
                    weekday: 'monday',
                    isAvailable: true,
                    startTime: '09:00',
                    endTime: '12:00',
                  }),
                },
              ]
            : name === 'reviews'
              ? [{ data: () => ({ rating: 5 }) }, { data: () => ({ rating: 4 }) }]
              : name === 'appointments'
                ? [{ data: () => ({ status: 'completed' }) }]
                : [];
      const query = {
        where: () => query,
        get: async () => ({ docs, size: docs.length }),
      };
      return {
        where: () => query,
      };
    }),
    runTransaction: async (
      callback: (transaction: {
        get: () => Promise<{ exists: boolean; data: () => Record<string, unknown> }>;
        create: typeof transactionCreate;
      }) => Promise<unknown>,
    ) =>
      callback({
        get: async () => ({
          exists: migratedProfile !== null,
          data: () => migratedProfile ?? {},
        }),
        create: transactionCreate,
      }),
  };
  let service: DoctorsService;

  beforeEach(() => {
    jest.clearAllMocks();
    doctorAccountStatus = AccountStatus.ACTIVE;
    profileExists = true;
    migratedProfile = null;
    service = new DoctorsService({
      getFirestore: () => firestore,
    } as unknown as FirebaseService);
  });

  it('loads the signed-in doctor profile and associated professional details', async () => {
    const result = await service.getMine('doctor-uid');

    expect(result).toMatchObject({
      id: 'doctor-profile',
      name: 'Dr. Nguema',
      specialty: 'Cardiologie',
      email: 'amina@example.test',
      phone: '+237600000000',
      secondarySpecialties: ['Médecine interne'],
      degrees: ['Doctorat en médecine · Université de Yaoundé I · 2014'],
      verificationStatus: DoctorVerificationStatus.PENDING,
      documents: [
        {
          id: 'verification-1',
          name: 'medical_license',
          filename: 'license.pdf',
          status: 'approved',
        },
      ],
      rating: 4.5,
      reviewsCount: 2,
      completedConsultations: 1,
    });
    expect(JSON.stringify(result)).not.toContain('private/should-not-be-returned');
  });

  it('creates a basic profile for a logged-in pending doctor without one', async () => {
    profileExists = false;
    doctorAccountStatus = AccountStatus.PENDING;

    const result = await service.getMine('doctor-uid');

    expect(result).toMatchObject({
      id: 'doctor-uid',
      name: 'Amina Nguema',
      specialty: 'Cardiologie',
      registrationNumber: 'CM-123',
      verificationStatus: DoctorVerificationStatus.PENDING,
    });
    expect(transactionCreate).toHaveBeenCalledWith(
      legacyProfileRef,
      expect.objectContaining({
        id: 'doctor-uid',
        userId: 'doctor-uid',
        verificationStatus: DoctorVerificationStatus.PENDING,
        yearsOfExperience: 0,
      }),
    );
  });
});
