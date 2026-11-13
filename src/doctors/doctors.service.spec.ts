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
  const transactionDelete = jest.fn();
  const transactionUpdate = jest.fn();
  const legacyProfileRef = { id: 'doctor-uid' };
  const originalFetch = globalThis.fetch;
  const originalSupabaseUrl = process.env.SUPABASE_URL;
  const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalBucket = process.env.SUPABASE_STORAGE_BUCKET;
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
          doc: (id: string) => ({ ...legacyProfileRef, id }),
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
          doc: (id: string) => ({
            id,
            get: async () => ({
              exists: id === 'verification-1',
              data: () => ({
                doctorProfileId: 'doctor-profile',
                documentId: 'medical-document-1',
                status: 'approved',
                reviewedAt: null,
                reviewerUserId: null,
                rejectionReason: null,
              }),
            }),
          }),
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
          doc: (id: string) => ({
            id,
            get: async () => ({
              exists: id === 'medical-document-1',
              data: () => ({
                id,
                ownerUserId: 'doctor-uid',
                type: 'medical_license',
                fileName: 'license.pdf',
                storageKey: 'private/should-not-be-returned',
                sizeBytes: 2048,
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
        get: (ref?: { id?: string }) => Promise<{
          exists: boolean;
          data: () => Record<string, unknown>;
        }>;
        create: typeof transactionCreate;
        delete: typeof transactionDelete;
        update: typeof transactionUpdate;
      }) => Promise<unknown>,
    ) =>
      callback({
        get: async (ref) => {
          if (ref?.id === 'verification-1') {
            return {
              exists: true,
              data: () => ({
                doctorProfileId: 'doctor-profile',
                documentId: 'medical-document-1',
                status: 'approved',
              }),
            };
          }
          if (ref?.id === 'medical-document-1') {
            return {
              exists: true,
              data: () => ({
                ownerUserId: 'doctor-uid',
                storageKey: 'private/should-not-be-returned',
              }),
            };
          }
          return {
            exists: ref?.id === 'doctor-profile' || migratedProfile !== null,
            data: () => migratedProfile ?? {},
          };
        },
        create: transactionCreate,
        delete: transactionDelete,
        update: transactionUpdate,
      }),
  };
  let service: DoctorsService;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SUPABASE_URL = 'https://project.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
    process.env.SUPABASE_STORAGE_BUCKET = 'medical-files';
    globalThis.fetch = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockResolvedValue(
      new Response(JSON.stringify({ signedURL: '/object/sign/medical-files/document?token=test' }), {
        status: 200,
      }),
    );
    doctorAccountStatus = AccountStatus.ACTIVE;
    profileExists = true;
    migratedProfile = null;
    service = new DoctorsService({
      getFirestore: () => firestore,
    } as unknown as FirebaseService);
  });

  it('uploads a private verification document and creates a temporary consultation link', async () => {
    const fileBytes = Buffer.from('%PDF-1.7 test document');
    const result = await service.uploadMyDocument(
      'doctor-uid',
      'medical_degree',
      {
        originalname: 'diplome.pdf',
        mimetype: 'application/pdf',
        size: fileBytes.length,
        buffer: fileBytes,
      },
    );

    expect(result).toMatchObject({
      name: 'medical_degree',
      filename: 'diplome.pdf',
      status: 'pending',
      sizeBytes: fileBytes.length,
      downloadUrl: expect.stringContaining('/storage/v1/object/sign/'),
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/\/storage\/v1\/object\/medical-files\/doctor-verification\/doctor-uid\/doctor-profile\//),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(transactionCreate).toHaveBeenCalledTimes(2);
  });

  it('deletes only an owned document and resets verification when an approved file is removed', async () => {
    await expect(
      service.deleteMyDocument('doctor-uid', 'verification-1'),
    ).resolves.toBeUndefined();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://project.supabase.co/storage/v1/object/medical-files',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(transactionDelete).toHaveBeenCalledTimes(2);
    expect(transactionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'doctor-profile' }),
      expect.objectContaining({
        verificationStatus: DoctorVerificationStatus.PENDING,
        verifiedAt: null,
      }),
    );
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
    if (originalSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalSupabaseUrl;
    if (originalServiceRoleKey === undefined) {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    } else {
      process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey;
    }
    if (originalBucket === undefined) delete process.env.SUPABASE_STORAGE_BUCKET;
    else process.env.SUPABASE_STORAGE_BUCKET = originalBucket;
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
          medicalDocumentId: 'medical-document-1',
          name: 'medical_license',
          filename: 'license.pdf',
          status: 'approved',
          sizeBytes: 2048,
          downloadUrl:
            'https://project.supabase.co/storage/v1/object/sign/medical-files/document?token=test',
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
