import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { PatientsService } from './patients.service';

describe('PatientsService', () => {
  let service: PatientsService;
  const mockSet = jest.fn();
  const mockDelete = jest.fn();
  const mockDocGet = jest.fn();
  const mockWhereGet = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();

    const firestore = {
      collection: (name: string) => {
        if (name === 'medicalDocuments') {
          return {
            doc: (id: string) => ({
              id,
              set: mockSet,
              delete: mockDelete,
              get: mockDocGet,
            }),
            where: () => ({
              get: mockWhereGet,
            }),
          };
        }
        return {};
      },
    };

    service = new PatientsService({
      getFirestore: () => firestore,
    } as unknown as FirebaseService);
  });

  it('lists documents belonging to the authenticated patient', async () => {
    mockWhereGet.mockResolvedValue({
      docs: [
        {
          id: 'doc-1',
          data: () => ({
            id: 'doc-1',
            ownerUserId: 'patient-123',
            type: 'prescription',
            title: 'Ordonnance',
            fileName: 'ordonnance.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 1024,
            uploadedAt: new Date('2026-11-10T10:00:00.000Z'),
          }),
        },
      ],
    });

    const result = await service.listMyDocuments('patient-123');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('doc-1');
    expect(result[0].title).toBe('Ordonnance');
  });

  it('throws BadRequestException when no file is provided', async () => {
    await expect(
      service.uploadMyDocument('patient-123', 'prescription', null as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws BadRequestException when file type is not allowed', async () => {
    await expect(
      service.uploadMyDocument('patient-123', 'prescription', {
        fieldname: 'file',
        originalname: 'script.exe',
        encoding: '7bit',
        mimetype: 'application/x-msdownload',
        size: 100,
        buffer: Buffer.from('test'),
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('uploads and saves valid document metadata', async () => {
    mockSet.mockResolvedValue(undefined);

    const result = await service.uploadMyDocument(
      'patient-123',
      'prescription',
      {
        fieldname: 'file',
        originalname: 'ordonnance.pdf',
        encoding: '7bit',
        mimetype: 'application/pdf',
        size: 1024,
        buffer: Buffer.from('test pdf content'),
      },
      'Mon Ordonnance',
    );

    expect(result.title).toBe('Mon Ordonnance');
    expect(result.filename).toBe('ordonnance.pdf');
    expect(mockSet).toHaveBeenCalled();
  });

  it('deletes an owned document successfully', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        id: 'doc-1',
        ownerUserId: 'patient-123',
        storageKey: 'patient-documents/patient-123/doc-1/file.pdf',
      }),
    });
    mockDelete.mockResolvedValue(undefined);

    await expect(
      service.deleteMyDocument('patient-123', 'doc-1'),
    ).resolves.toBeUndefined();
    expect(mockDelete).toHaveBeenCalled();
  });

  it('throws NotFoundException when document does not belong to user', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        id: 'doc-1',
        ownerUserId: 'another-user',
      }),
    });

    await expect(
      service.deleteMyDocument('patient-123', 'doc-1'),
    ).rejects.toThrow(NotFoundException);
  });
});

