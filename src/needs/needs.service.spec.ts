import {
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import {
  AccountRole,
  ConsultationMode,
  NeedStatus,
} from '../interfaces/database';
import { FirebaseService } from '../firebase/firebase.service';
import { NeedsService } from './needs.service';

describe('NeedsService', () => {
  const needRef = {
    id: 'need-123',
    get: jest.fn(),
    set: jest.fn(),
    update: jest.fn(),
  };
  const firestore = {
    collection: jest.fn((name: string) => {
      if (name === 'users') {
        return {
          doc: () => ({
            get: async () => ({
              exists: true,
              data: () => ({ role: AccountRole.PATIENT }),
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
          where: () => ({ get: async () => ({ size: 2 }) }),
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
    process.env.SUPABASE_URL = 'https://project.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
    process.env.SUPABASE_STORAGE_BUCKET = 'medical-files';
    globalThis.fetch = jest.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }),
    );
    service = new NeedsService({
      getFirestore: () => firestore,
    } as unknown as FirebaseService);
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
});
