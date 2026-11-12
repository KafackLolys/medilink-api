import {
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import {
  AccountRole,
  ConsultationMode,
  DoctorVerificationStatus,
  NeedPriority,
  NeedStatus,
} from '../interfaces/database';
import { FirebaseService } from '../firebase/firebase.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NeedsService } from './needs.service';

describe('NeedsService', () => {
  const needRef = {
    id: 'need-123',
    get: jest.fn(),
    set: jest.fn(),
    update: jest.fn(),
  };
  let doctorVerificationStatus = DoctorVerificationStatus.VERIFIED;
  let doctorNeedDocuments: Array<Record<string, unknown>> = [];
  let doctorProposalDocuments: Array<{
    id: string;
    data: () => Record<string, unknown>;
  }> = [];
  const firestore = {
    collection: jest.fn((name: string) => {
      if (name === 'users') {
        return {
          doc: (uid: string) => ({
            get: async () => ({
              exists: true,
              data: () => ({
                role:
                  uid === 'doctor-uid' || uid === 'doctor-owner-uid'
                    ? AccountRole.DOCTOR
                    : AccountRole.PATIENT,
              }),
            }),
          }),
        };
      }
      if (name === 'doctorProfiles') {
        return {
          where: () => ({
            limit: () => ({
              get: async () => ({
                docs: [
                  {
                    id: 'doctor-profile',
                    data: () => ({
                      verificationStatus: doctorVerificationStatus,
                    }),
                  },
                ],
              }),
            }),
          }),
        };
      }
      if (name === 'medicalNeeds') {
        return {
          doc: () => needRef,
          where: () => ({
            get: async () => ({
              docs: doctorNeedDocuments.map((need) => ({
                data: () => need,
              })),
            }),
          }),
        };
      }
      if (name === 'patients') {
        return {
          doc: () => ({
            get: async () => ({ exists: false }),
          }),
        };
      }
      if (name === 'doctorProposals') {
        return {
          doc: () => needRef,
          where: () => ({
            get: async () => ({
              size: doctorProposalDocuments.length || 2,
              docs: doctorProposalDocuments,
            }),
          }),
        };
      }
      return { doc: () => needRef };
    }),
  };
  const originalFetch = globalThis.fetch;
  const originalSupabaseUrl = process.env.SUPABASE_URL;
  const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalBucket = process.env.SUPABASE_STORAGE_BUCKET;
  let service: NeedsService;

  beforeEach(() => {
    jest.clearAllMocks();
    doctorVerificationStatus = DoctorVerificationStatus.VERIFIED;
    doctorNeedDocuments = [];
    doctorProposalDocuments = [];
    process.env.SUPABASE_URL = 'https://project.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
    process.env.SUPABASE_STORAGE_BUCKET = 'medical-files';
    globalThis.fetch = jest.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }),
    );
    service = new NeedsService({
      getFirestore: () => firestore,
    } as unknown as FirebaseService, {
      publish: jest.fn().mockResolvedValue(undefined),
    } as unknown as NotificationsService);
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
    if (originalSupabaseUrl === undefined) {
      delete process.env.SUPABASE_URL;
    } else {
      process.env.SUPABASE_URL = originalSupabaseUrl;
    }
    if (originalServiceRoleKey === undefined) {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    } else {
      process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey;
    }
    if (originalBucket === undefined) {
      delete process.env.SUPABASE_STORAGE_BUCKET;
    } else {
      process.env.SUPABASE_STORAGE_BUCKET = originalBucket;
    }
  });

  const request = {
    title: 'Maux de tête persistants',
    specialty: 'Neurologie',
    description: 'J’ai des maux de tête depuis quelques jours.',
    symptoms: ['Douleur'],
    city: 'Yaoundé',
    district: 'Centre',
    priority: 'normal',
    mode: 'domicile',
    consent: true,
  };
  const existingNeed = {
    id: 'need-123',
    ownerUserId: 'patient-uid',
    patientProfileId: null,
    specialtyId: null,
    specialty: 'Neurologie',
    city: 'Yaoundé',
    district: 'Centre',
    title: 'Maux de tête persistants',
    description: 'J’ai des maux de tête depuis quelques jours.',
    symptoms: ['Douleur'],
    durationDescription: null,
    priority: 'routine',
    consultationMode: ConsultationMode.HOME,
    status: NeedStatus.AWAITING_PROPOSALS,
    availableFrom: null,
    privateAddress: null,
    attachments: [],
    publishedAt: new Date('2026-11-11T00:00:00.000Z'),
    consentAt: new Date('2026-11-11T00:00:00.000Z'),
    createdAt: new Date('2026-11-11T00:00:00.000Z'),
    updatedAt: new Date('2026-11-11T00:00:00.000Z'),
  };

  it('uploads files to private Supabase Storage and stores their object URL', async () => {
    const file = {
      originalname: 'scan.jpg',
      mimetype: 'image/jpeg',
      size: 3,
      buffer: Buffer.from([0xff, 0xd8, 0xff]),
    };

    await service.create(
      { uid: 'patient-uid' } as never,
      JSON.stringify(request),
      [file],
    );

    const fetchMock = globalThis.fetch as jest.MockedFunction<typeof fetch>;
    expect(fetchMock.mock.calls[0][0]).toMatch(
      /^https:\/\/project\.supabase\.co\/storage\/v1\/object\/medical-files\/medical-needs\/patient-uid\/need-123\/[0-9a-f-]+$/,
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({
        Authorization: 'Bearer test-service-role-key',
        'x-upsert': 'false',
      }),
    });
    const storedNeed = needRef.set.mock.calls[0][0] as {
      attachments: Array<{ storageUrl: string; storagePath: string }>;
    };
    expect(storedNeed.attachments[0]).toMatchObject({
      storageUrl: expect.stringMatching(
        /^https:\/\/project\.supabase\.co\/storage\/v1\/object\/medical-files\/medical-needs\/patient-uid\/need-123\/[0-9a-f-]+$/,
      ),
      storagePath: expect.stringMatching(
        /^medical-needs\/patient-uid\/need-123\//,
      ),
    });
  });

  it('rejects file content that does not match its declared image type', async () => {
    await expect(
      service.create(
        { uid: 'patient-uid' } as never,
        JSON.stringify(request),
        [
          {
            originalname: 'fake.jpg',
            mimetype: 'image/jpeg',
            size: 4,
            buffer: Buffer.from('fake'),
          },
        ],
      ),
    ).rejects.toThrow(BadRequestException);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('returns details and proposal count only to the request owner', async () => {
    needRef.get.mockResolvedValueOnce({
      exists: true,
      data: () => existingNeed,
    });
    await expect(
      service.getMine({ uid: 'patient-uid' } as never, 'need-123'),
    ).resolves.toMatchObject({
      id: 'need-123',
      title: 'Maux de tête persistants',
      interested: 2,
      description: existingNeed.description,
      mode: 'domicile',
      attachments: [],
    });

    needRef.get.mockResolvedValueOnce({
      exists: true,
      data: () => existingNeed,
    });
    await expect(
      service.getMine({ uid: 'another-patient' } as never, 'need-123'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('lists the doctor’s patient needs through their proposals with server pagination', async () => {
    const proposedAt = new Date('2026-11-11T10:00:00.000Z');
    const appointmentAt = new Date('2026-11-13T10:00:00.000Z');
    needRef.get.mockResolvedValue({
      exists: true,
      data: () => existingNeed,
    });
    doctorProposalDocuments = [
      {
        id: 'proposal-1',
        data: () => ({
          id: 'proposal-1',
          needId: 'need-123',
          doctorProfileId: 'doctor-profile',
          status: 'pending',
          message: 'Je peux vous accompagner.',
          proposedAt,
          proposedAppointmentAt: appointmentAt,
          consultationMode: ConsultationMode.HOME,
          fee: 10000,
          currency: 'XAF',
          patientResponse: null,
          respondedAt: null,
        }),
      },
    ];

    const result = await service.listProposalsForDoctor(
      { uid: 'doctor-uid' } as never,
      { page: '1', pageSize: '1' },
    );

    expect(result).toMatchObject({
      page: 1,
      pageSize: 1,
      total: 1,
      totalPages: 1,
      counts: { pending: 1 },
      items: [
        {
          id: 'proposal-1',
          needId: 'need-123',
          needTitle: existingNeed.title,
          specialty: existingNeed.specialty,
          city: existingNeed.city,
          district: existingNeed.district,
          status: 'pending',
          proposedAt: proposedAt.toISOString(),
          proposedAppointmentAt: appointmentAt.toISOString(),
          consultationMode: 'home',
          fee: 10000,
        },
      ],
    });
    expect(result.items[0]).not.toHaveProperty('patientName');
  });

  it('cancels only the doctor’s own pending proposal', async () => {
    needRef.get.mockResolvedValue({
      exists: true,
      id: 'proposal-1',
      data: () => ({
        id: 'proposal-1',
        doctorProfileId: 'doctor-profile',
        status: 'pending',
      }),
    });

    await expect(
      service.cancelProposal({ uid: 'doctor-uid' } as never, 'proposal-1'),
    ).resolves.toEqual({ id: 'proposal-1', status: 'cancelled' });
    expect(needRef.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'cancelled' }),
    );
  });

  it('updates editable request details and returns the refreshed profile', async () => {
    needRef.get
      .mockResolvedValueOnce({
        exists: true,
        data: () => existingNeed,
      })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({
          ...existingNeed,
          title: 'Nouveau titre de demande',
          specialty: 'Cardiologie',
          description: 'Description mise à jour et suffisamment détaillée.',
          consultationMode: ConsultationMode.TELECONSULTATION,
        }),
      });

    const result = await service.update(
      { uid: 'patient-uid' } as never,
      'need-123',
      {
        title: 'Nouveau titre de demande',
        specialty: 'Cardiologie',
        description: 'Description mise à jour et suffisamment détaillée.',
        mode: 'tele',
      },
    );

    expect(needRef.update).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Nouveau titre de demande',
        specialty: 'Cardiologie',
        consultationMode: ConsultationMode.TELECONSULTATION,
      }),
    );
    expect(result).toMatchObject({
      title: 'Nouveau titre de demande',
      specialty: 'Cardiologie',
      mode: 'teleconsultation',
    });
  });

  it('filters doctor requests and paginates the filtered results', async () => {
    doctorNeedDocuments = [
      existingNeed,
      {
        ...existingNeed,
        id: 'need-older',
        title: 'Migraines persistantes',
        publishedAt: new Date('2026-11-10T00:00:00.000Z'),
      },
      {
        ...existingNeed,
        id: 'other-doctor-owned-need',
        ownerUserId: 'doctor-owner-uid',
      },
    ];

    await expect(
      service.listForDoctor(
        { uid: 'doctor-uid' } as never,
        {
          q: 'Yaoundé',
          specialty: 'Neurologie',
          priority: NeedPriority.ROUTINE,
          mode: ConsultationMode.HOME,
          page: '2',
          pageSize: '1',
        },
      ),
    ).resolves.toMatchObject({
      items: [{ id: 'need-older' }],
      specialties: ['Neurologie'],
      page: 2,
      pageSize: 1,
      total: 2,
      totalPages: 2,
    });
  });

  it('denies access to doctors whose profile is not verified', async () => {
    doctorVerificationStatus = DoctorVerificationStatus.PENDING;

    await expect(
      service.listForDoctor({ uid: 'doctor-uid' } as never, {}),
    ).rejects.toThrow(ForbiddenException);
  });
});
