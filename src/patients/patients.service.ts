import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { MedicalDocument } from '../interfaces/database';
import { MedicalDocumentType } from '../interfaces/database';
import { FirebaseService } from '../firebase/firebase.service';

export interface UploadedPatientDocument {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface PatientDocumentResponse {
  id: string;
  type: string;
  title: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  downloadUrl: string | null;
}

interface SupabaseStorageConfig {
  url: string;
  serviceRoleKey: string;
  bucket: string;
}

function encodeStoragePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024; // 10MB

@Injectable()
export class PatientsService {
  private readonly logger = new Logger(PatientsService.name);

  constructor(private readonly firebase: FirebaseService) {}

  async listMyConditions(uid: string): Promise<Array<{
    id: string; name: string; description: string | null;
    status: string; diagnosedAt: string | null; notes: string | null;
  }>> {
    const db = this.firebase.getFirestore();
    const userSnapshot = await db.collection('users').doc(uid).get();
    if (!userSnapshot.exists || userSnapshot.data()?.role !== 'patient') {
      throw new NotFoundException('Patient profile not found');
    }
    const patientSnapshot = await db.collection('patients').doc(uid).get();
    const patientProfileId = (patientSnapshot.data()?.id as string | undefined) ?? uid;
    const links = await db.collection('patientConditions')
      .where('patientProfileId', '==', patientProfileId).get();
    return Promise.all(links.docs.map(async link => {
      const entry = link.data();
      const condition = await db.collection('medicalConditions')
        .doc(entry.medicalConditionId as string).get();
      const date = entry.diagnosedAt as {toDate?: () => Date} | Date | null | undefined;
      const parsed = date instanceof Date ? date : date?.toDate?.() ?? null;
      return {
        id: link.id,
        name: String(condition.data()?.name ?? 'Condition non renseignée'),
        description: condition.data()?.description ?? null,
        status: String(entry.status ?? 'active'),
        diagnosedAt: parsed?.toISOString() ?? null,
        notes: entry.notes ?? null,
      };
    }));
  }

  async listMyDocuments(uid: string): Promise<PatientDocumentResponse[]> {
    const firestore = this.firebase.getFirestore();
    const snapshot = await firestore
      .collection('medicalDocuments')
      .where('ownerUserId', '==', uid)
      .get();

    const docs = snapshot.docs.map((doc) => {
      const data = doc.data() as MedicalDocument & { title?: string };
      return { ...data, id: doc.id };
    });

    // Sort by uploadedAt desc
    docs.sort((a, b) => {
      const timeA = a.uploadedAt instanceof Date ? a.uploadedAt.getTime() : new Date(a.uploadedAt ?? 0).getTime();
      const timeB = b.uploadedAt instanceof Date ? b.uploadedAt.getTime() : new Date(b.uploadedAt ?? 0).getTime();
      return timeB - timeA;
    });

    return Promise.all(
      docs.map(async (doc) => {
        let downloadUrl: string | null = null;
        if (doc.storageKey) {
          try {
            downloadUrl = await this.createSignedUrl(doc.storageKey);
          } catch {
            downloadUrl = null;
          }
        }
        return {
          id: doc.id,
          type: doc.type || MedicalDocumentType.OTHER,
          title: doc.title || doc.fileName || 'Document médical',
          filename: doc.fileName,
          mimeType: doc.mimeType || 'application/octet-stream',
          sizeBytes: doc.sizeBytes ?? 0,
          uploadedAt: doc.uploadedAt instanceof Date ? doc.uploadedAt.toISOString() : new Date(doc.uploadedAt ?? Date.now()).toISOString(),
          downloadUrl,
        };
      }),
    );
  }

  async uploadMyDocument(
    uid: string,
    type: string,
    file: UploadedPatientDocument,
    title?: string,
  ): Promise<PatientDocumentResponse> {
    if (!file) {
      throw new BadRequestException('Un fichier est requis');
    }
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException('Format de fichier non pris en charge. Utilisez PDF, JPEG, PNG ou WEBP');
    }
    if (file.size > MAX_DOCUMENT_SIZE) {
      throw new BadRequestException('La taille du fichier ne doit pas dépasser 10 Mo');
    }

    const firestore = this.firebase.getFirestore();
    const documentId = randomUUID();
    const storageKey = `patient-documents/${uid}/${documentId}/${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

    let downloadUrl: string | null = null;
    try {
      await this.uploadFile(storageKey, file);
      downloadUrl = await this.createSignedUrl(storageKey);
    } catch (storageError) {
      this.logger.warn('Storage upload unavailable, proceeding with database record', storageError);
    }

    const now = new Date();
    const docTitle = title?.trim() || file.originalname.slice(0, 255);
    const medicalDocument: MedicalDocument & { title: string } = {
      id: documentId,
      ownerUserId: uid,
      type: (type as MedicalDocumentType) || MedicalDocumentType.OTHER,
      title: docTitle,
      fileName: file.originalname.slice(0, 255),
      storageKey,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      uploadedAt: now,
      createdAt: now,
      updatedAt: now,
    };

    await firestore.collection('medicalDocuments').doc(documentId).set(medicalDocument);

    return {
      id: documentId,
      type: medicalDocument.type,
      title: medicalDocument.title,
      filename: medicalDocument.fileName,
      mimeType: medicalDocument.mimeType,
      sizeBytes: medicalDocument.sizeBytes,
      uploadedAt: now.toISOString(),
      downloadUrl,
    };
  }

  async deleteMyDocument(uid: string, documentId: string): Promise<void> {
    const firestore = this.firebase.getFirestore();
    const docRef = firestore.collection('medicalDocuments').doc(documentId);
    const snapshot = await docRef.get();

    if (!snapshot.exists) {
      throw new NotFoundException('Document non trouvé');
    }

    const document = snapshot.data() as MedicalDocument;
    if (document.ownerUserId !== uid) {
      throw new NotFoundException('Document non trouvé');
    }

    if (document.storageKey) {
      try {
        await this.deleteStorageObject(document.storageKey);
      } catch (storageError) {
        this.logger.warn(`Could not delete storage object for ${documentId}`, storageError);
      }
    }

    await docRef.delete();
  }

  private getStorageConfig(): SupabaseStorageConfig | null {
    const url = process.env.SUPABASE_URL?.replace(/\/+$/, '');
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const bucket = process.env.SUPABASE_STORAGE_BUCKET;
    if (!url || !serviceRoleKey || !bucket) {
      return null;
    }
    return { url, serviceRoleKey, bucket };
  }

  private async uploadFile(path: string, file: UploadedPatientDocument): Promise<void> {
    const config = this.getStorageConfig();
    if (!config) {
      throw new ServiceUnavailableException('Storage configuration missing');
    }
    const body = new ArrayBuffer(file.buffer.byteLength);
    new Uint8Array(body).set(file.buffer);
    const response = await fetch(
      `${config.url}/storage/v1/object/${encodeURIComponent(config.bucket)}/${encodeStoragePath(path)}`,
      {
        method: 'POST',
        headers: {
          apikey: config.serviceRoleKey,
          Authorization: `Bearer ${config.serviceRoleKey}`,
          'Content-Type': file.mimetype,
          'x-upsert': 'true',
        },
        body,
      },
    );
    if (!response.ok) {
      throw new ServiceUnavailableException(`Upload failed (${response.status})`);
    }
  }

  private async createSignedUrl(path: string): Promise<string> {
    const config = this.getStorageConfig();
    if (!config) {
      throw new ServiceUnavailableException('Storage configuration missing');
    }
    const response = await fetch(
      `${config.url}/storage/v1/object/sign/${encodeURIComponent(config.bucket)}/${encodeStoragePath(path)}`,
      {
        method: 'POST',
        headers: {
          apikey: config.serviceRoleKey,
          Authorization: `Bearer ${config.serviceRoleKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ expiresIn: 3600 }),
      },
    );
    if (!response.ok) {
      throw new ServiceUnavailableException(`Signed URL request failed (${response.status})`);
    }
    const payload = (await response.json()) as { signedURL?: string };
    if (!payload.signedURL) {
      throw new ServiceUnavailableException('Missing signed URL in response');
    }
    return `${config.url}/storage/v1${payload.signedURL}`;
  }

  private async deleteStorageObject(path: string): Promise<void> {
    const config = this.getStorageConfig();
    if (!config) return;
    await fetch(
      `${config.url}/storage/v1/object/${encodeURIComponent(config.bucket)}`,
      {
        method: 'DELETE',
        headers: {
          apikey: config.serviceRoleKey,
          Authorization: `Bearer ${config.serviceRoleKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prefixes: [path] }),
      },
    );
  }
}
