import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  DoctorQualification,
  DoctorSpecialty,
  DoctorConsultationMode,
  DoctorProfile,
  DoctorWeeklyAvailability,
  MedicalDocument,
  User,
} from '../interfaces/database';
import {
  AccountRole,
  AccountStatus,
  AppointmentStatus,
  DoctorVerificationStatus,
  MedicalDocumentType,
  VerificationDocumentStatus,
  type DoctorVerificationDocument,
  type Specialty,
} from '../interfaces/database';
import { FirebaseService } from '../firebase/firebase.service';
import { matchesDoctorSearch } from './doctor-search';

export interface DoctorDirectoryFilters {
  q?: string;
  specialty?: string;
  city?: string;
}

export interface DoctorDirectoryItem {
  id: string;
  name: string;
  specialty: string;
  bio: string;
  yearsOfExperience: number;
  consultationFee: number;
  currency: string;
  professionalAddress: string | null;
  serviceCity?: string | null;
  serviceDistricts?: string[];
  blockedDates?: string[];
  appointmentDurationMinutes?: number;
  modes: DoctorConsultationMode['mode'][];
  availability: DoctorWeeklyAvailability[];
  rating: number | null;
  reviewsCount: number;
}

export interface DoctorOwnProfile extends DoctorDirectoryItem {
  phone: string;
  email: string;
  registrationNumber: string;
  secondarySpecialties: string[];
  degrees: string[];
  verificationStatus: DoctorVerificationStatus;
  documents: DoctorVerificationDocumentView[];
  completedConsultations: number;
}

export interface DoctorVerificationDocumentView {
  id: string;
  medicalDocumentId: string;
  name: ProfessionalDocumentType;
  filename: string;
  status: VerificationDocumentStatus;
  sizeBytes: number;
  downloadUrl: string | null;
}

export interface UploadedDoctorDocument {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export type ProfessionalDocumentType =
  | MedicalDocumentType.MEDICAL_LICENSE
  | MedicalDocumentType.MEDICAL_DEGREE
  | MedicalDocumentType.IDENTITY_DOCUMENT
  | MedicalDocumentType.OTHER;

const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024;
const ALLOWED_DOCUMENT_TYPES = new Set<string>([
  MedicalDocumentType.MEDICAL_LICENSE,
  MedicalDocumentType.MEDICAL_DEGREE,
  MedicalDocumentType.IDENTITY_DOCUMENT,
  MedicalDocumentType.OTHER,
]);
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const MAX_DOCUMENTS = 50;

interface SupabaseStorageConfig {
  url: string;
  serviceRoleKey: string;
  bucket: string;
}

function encodeStoragePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function isProfessionalDocumentType(
  value: string,
): value is ProfessionalDocumentType {
  return ALLOWED_DOCUMENT_TYPES.has(value);
}

@Injectable()
export class DoctorsService {
  private readonly logger = new Logger(DoctorsService.name);

  constructor(private readonly firebase: FirebaseService) {}

  async getMine(uid: string): Promise<DoctorOwnProfile> {
    const firestore = this.firebase.getFirestore();
    const userSnapshot = await firestore.collection('users').doc(uid).get();
    if (!userSnapshot.exists) {
      throw new NotFoundException('Doctor account not found');
    }
    const user = userSnapshot.data() as User;
    if (
      user.role !== AccountRole.DOCTOR ||
      user.status === AccountStatus.SUSPENDED ||
      user.status === AccountStatus.DELETED
    ) {
      throw new NotFoundException('Doctor profile not found');
    }

    const doctorSnapshot = await firestore
      .collection('doctorProfiles')
      .where('userId', '==', uid)
      .limit(1)
      .get();
    const doctorDocument = doctorSnapshot.docs[0];
    let doctorProfileId: string;
    let profile: DoctorProfile;
    if (doctorDocument) {
      doctorProfileId = doctorDocument.id;
      profile = doctorDocument.data() as DoctorProfile;
    } else {
      const doctorProfileRef = firestore
        .collection('doctorProfiles')
        .doc(uid);
      profile = await firestore.runTransaction(async (transaction) => {
        const existingProfile = await transaction.get(doctorProfileRef);
        if (existingProfile.exists) {
          const existingData = existingProfile.data() as DoctorProfile;
          if (existingData.userId !== uid) {
            throw new NotFoundException('Doctor profile not found');
          }
          return existingData;
        }

        const now = new Date();
        const newProfile: DoctorProfile = {
          id: uid,
          userId: uid,
          fullName: `${user.firstName} ${user.lastName}`.trim(),
          registrationNumber: user.registrationNumber ?? '',
          bio: '',
          yearsOfExperience: 0,
          consultationFee: 0,
          currency: 'XAF',
          defaultAppointmentDurationMinutes: 30,
          professionalAddress: null,
          verificationStatus: DoctorVerificationStatus.PENDING,
          verifiedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        transaction.create(doctorProfileRef, newProfile);
        return newProfile;
      });
      doctorProfileId = uid;
    }

    const [
      modesSnapshot,
      availabilitySnapshot,
      reviewsSnapshot,
      completedAppointmentsSnapshot,
      qualificationsSnapshot,
      secondarySpecialtiesSnapshot,
      verificationDocumentsSnapshot,
    ] = await Promise.all([
      firestore
        .collection('doctorConsultationModes')
        .where('doctorProfileId', '==', doctorProfileId)
        .get(),
      firestore
        .collection('doctorWeeklyAvailabilities')
        .where('doctorProfileId', '==', doctorProfileId)
        .get(),
      firestore
        .collection('reviews')
        .where('doctorProfileId', '==', doctorProfileId)
        .get(),
      firestore
        .collection('appointments')
        .where('doctorProfileId', '==', doctorProfileId)
        .get(),
      firestore
        .collection('doctorQualifications')
        .where('doctorProfileId', '==', doctorProfileId)
        .get(),
      firestore
        .collection('doctorSpecialties')
        .where('doctorProfileId', '==', doctorProfileId)
        .get(),
      firestore
        .collection('doctorVerificationDocuments')
        .where('doctorProfileId', '==', doctorProfileId)
        .get(),
    ]);

    const secondarySpecialtyLinks = secondarySpecialtiesSnapshot.docs
      .map((document) => document.data() as DoctorSpecialty)
      .filter((specialty) => !specialty.isPrimary);
    const secondarySpecialties = await Promise.all(
      secondarySpecialtyLinks.map(async (link) => {
        const specialtySnapshot = await firestore
          .collection('specialties')
          .doc(link.specialtyId)
          .get();
        return specialtySnapshot.exists
          ? ((specialtySnapshot.data() as Specialty).name ?? '')
          : '';
      }),
    );

    const documents = await Promise.all(
      verificationDocumentsSnapshot.docs.map(async (document) => {
        const verification =
          document.data() as DoctorVerificationDocument & { documentId?: string };
        const medicalDocumentId =
          verification.documentId ?? document.id;
        const medicalDocumentSnapshot = await firestore
          .collection('medicalDocuments')
          .doc(medicalDocumentId)
          .get();
        if (!medicalDocumentSnapshot.exists) return null;
        const medicalDocument = medicalDocumentSnapshot.data() as MedicalDocument;
        if (!isProfessionalDocumentType(medicalDocument.type)) return null;
        return {
          id: document.id,
          medicalDocumentId,
          name: medicalDocument.type,
          filename: medicalDocument.fileName,
          status: verification.status,
          sizeBytes: medicalDocument.sizeBytes ?? 0,
          downloadUrl: medicalDocument.storageKey
            ? await this.createSignedUrl(medicalDocument.storageKey)
            : null,
        };
      }),
    );
    const ratings = reviewsSnapshot.docs
      .map((review) => Number(review.data().rating))
      .filter((rating) => Number.isFinite(rating) && rating >= 1 && rating <= 5);

    return {
      id: doctorProfileId,
      name:
        profile.fullName?.trim() ||
        `${user.firstName} ${user.lastName}`.trim(),
      specialty: user.specialty?.trim() || 'Spécialité non renseignée',
      bio: profile.bio ?? '',
      yearsOfExperience: profile.yearsOfExperience ?? 0,
      consultationFee: profile.consultationFee ?? 0,
      currency: profile.currency || 'XAF',
      professionalAddress: profile.professionalAddress ?? null,
      modes: modesSnapshot.docs
        .map((mode) => (mode.data() as DoctorConsultationMode).mode)
        .filter(Boolean),
      availability: availabilitySnapshot.docs
        .map((slot) => slot.data() as DoctorWeeklyAvailability)
        .filter((slot) => slot.isAvailable),
      rating:
        ratings.length > 0
          ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length
          : null,
      reviewsCount: ratings.length,
      phone: user.phone ?? '',
      email: user.email ?? '',
      registrationNumber: profile.registrationNumber ?? '',
      secondarySpecialties: [
        ...new Set(secondarySpecialties.filter(Boolean)),
      ],
      degrees: qualificationsSnapshot.docs
        .map((document) => {
          const qualification = document.data() as DoctorQualification;
          return [
            qualification.title,
            qualification.institution,
            qualification.yearAwarded,
          ]
            .filter(Boolean)
            .join(' · ');
        })
        .filter(Boolean),
      verificationStatus: profile.verificationStatus,
      documents: documents.filter(
        (document): document is NonNullable<typeof document> => document !== null,
      ),
      completedConsultations: completedAppointmentsSnapshot.docs.filter(
        (appointment) =>
          appointment.data().status === AppointmentStatus.COMPLETED,
      ).length,
    };
  }

  async listMyReviews(uid: string) {
    const { doctorProfileId } = await this.getDoctorProfileId(uid);
    const snapshot = await this.firebase.getFirestore().collection('reviews')
      .where('doctorProfileId', '==', doctorProfileId).get();
    const distribution: Record<1 | 2 | 3 | 4 | 5, number> = {1:0,2:0,3:0,4:0,5:0};
    const items = snapshot.docs.flatMap(document => {
      const review = document.data();
      const rating = Number(review.rating);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) return [];
      const created = review.createdAt as Date | { toDate?: () => Date } | null;
      const date = created instanceof Date ? created : created?.toDate?.() ?? null;
      if (!date) return [];
      distribution[rating as 1 | 2 | 3 | 4 | 5] += 1;
      return [{
        id: document.id,
        appointmentId: String(review.appointmentId ?? ''),
        rating,
        comment: typeof review.comment === 'string' ? review.comment : null,
        createdAt: date.toISOString(),
        patientLabel: 'Patient', // Minimise l'exposition de l'identité dans les avis
      }];
    }).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
    const total = items.length;
    return {items, total, distribution,
      rating: total ? items.reduce((sum, item) => sum + item.rating, 0) / total : null};
  }

  async updateMyProfile(uid: string, body: {
    bio?: string; yearsOfExperience?: number;
    consultationFee?: number; professionalAddress?: string | null;
  }): Promise<DoctorOwnProfile> {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Un objet de mise à jour est requis');
    }
    const allowed = ['bio','yearsOfExperience','consultationFee','professionalAddress'];
    if (Object.keys(body).some(key => !allowed.includes(key))) {
      throw new BadRequestException('Champ non modifiable');
    }
    const updates: Record<string, unknown> = {};
    if (body.bio !== undefined) {
      if (typeof body.bio !== 'string' || body.bio.length > 600) throw new BadRequestException('Présentation invalide (600 caractères max)');
      updates.bio = body.bio.trim();
    }
    if (body.yearsOfExperience !== undefined) {
      if (!Number.isInteger(body.yearsOfExperience) || body.yearsOfExperience < 0 || body.yearsOfExperience > 80) throw new BadRequestException('Expérience invalide');
      updates.yearsOfExperience = body.yearsOfExperience;
    }
    if (body.consultationFee !== undefined) {
      if (!Number.isSafeInteger(body.consultationFee) || body.consultationFee < 0 || body.consultationFee > 100000000) throw new BadRequestException('Tarif invalide');
      updates.consultationFee = body.consultationFee;
    }
    if (body.professionalAddress !== undefined) {
      if (body.professionalAddress !== null && (typeof body.professionalAddress !== 'string' || body.professionalAddress.length > 255)) throw new BadRequestException('Adresse invalide');
      updates.professionalAddress = body.professionalAddress?.trim() || null;
    }
    if (Object.keys(updates).length === 0) throw new BadRequestException('Aucune modification');
    const { doctorProfileId } = await this.getDoctorProfileId(uid);
    await this.firebase.getFirestore().collection('doctorProfiles').doc(doctorProfileId)
      .update({...updates, updatedAt: new Date()});
    return this.getMine(uid);
  }

  async uploadMyDocument(
    uid: string,
    type: string,
    file: UploadedDoctorDocument,
  ): Promise<DoctorOwnProfile['documents'][number]> {
    if (!isProfessionalDocumentType(type)) {
      throw new BadRequestException('Document type is invalid');
    }
    if (
      !file ||
      !Buffer.isBuffer(file.buffer) ||
      file.size <= 0 ||
      file.size > MAX_DOCUMENT_SIZE ||
      file.buffer.length !== file.size
    ) {
      throw new BadRequestException('Document must be between 1 byte and 10 MB');
    }
    if (!ALLOWED_MIME_TYPES.has(file.mimetype) || !this.hasValidSignature(file)) {
      throw new BadRequestException('Document content is not a supported file type');
    }

    const firestore = this.firebase.getFirestore();
    const { doctorProfileId } = await this.getDoctorProfileId(uid);
    const existingDocuments = await firestore
      .collection('doctorVerificationDocuments')
      .where('doctorProfileId', '==', doctorProfileId)
      .get();
    if (existingDocuments.size >= MAX_DOCUMENTS) {
      throw new BadRequestException(`No more than ${MAX_DOCUMENTS} documents can be stored`);
    }

    const documentId = randomUUID();
    const storageKey = `doctor-verification/${uid}/${doctorProfileId}/${documentId}`;
    await this.uploadFile(storageKey, file);
    const now = new Date();
    const medicalDocument: MedicalDocument = {
      id: documentId,
      ownerUserId: uid,
      type,
      fileName: file.originalname.slice(0, 255),
      storageKey,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      uploadedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    const verificationDocument: DoctorVerificationDocument = {
      doctorProfileId,
      documentId,
      status: VerificationDocumentStatus.PENDING,
      reviewedAt: null,
      reviewerUserId: null,
      rejectionReason: null,
    };

    let downloadUrl: string;
    try {
      downloadUrl = await this.createSignedUrl(storageKey);
      await firestore.runTransaction(async (transaction) => {
        transaction.create(
          firestore.collection('medicalDocuments').doc(documentId),
          medicalDocument,
        );
        transaction.create(
          firestore.collection('doctorVerificationDocuments').doc(documentId),
          verificationDocument,
        );
      });
    } catch (error) {
      try {
        await this.deleteStorageObject(storageKey);
      } catch (cleanupError) {
        this.logger.error(
          'Failed to remove a doctor document after metadata persistence failed',
          cleanupError instanceof Error ? cleanupError.stack : undefined,
        );
      }
      throw error;
    }

    return {
      id: documentId,
      medicalDocumentId: documentId,
      name: type,
      filename: medicalDocument.fileName,
      status: verificationDocument.status,
      sizeBytes: medicalDocument.sizeBytes,
      downloadUrl,
    };
  }

  async deleteMyDocument(uid: string, id: string): Promise<void> {
    const firestore = this.firebase.getFirestore();
    const { doctorProfileId } = await this.getDoctorProfileId(uid);
    const verificationRef = firestore
      .collection('doctorVerificationDocuments')
      .doc(id);
    const verificationSnapshot = await verificationRef.get();
    if (!verificationSnapshot.exists) {
      throw new NotFoundException('Doctor document not found');
    }
    const verification =
      verificationSnapshot.data() as DoctorVerificationDocument;
    const medicalDocumentId = verification.documentId || id;
    const medicalDocumentRef = firestore
      .collection('medicalDocuments')
      .doc(medicalDocumentId);
    const medicalDocumentSnapshot = await medicalDocumentRef.get();
    if (!medicalDocumentSnapshot.exists) {
      throw new NotFoundException('Doctor document not found');
    }
    const medicalDocument = medicalDocumentSnapshot.data() as MedicalDocument;
    if (
      verification.doctorProfileId !== doctorProfileId ||
      verification.documentId !== id ||
      medicalDocument.ownerUserId !== uid
    ) {
      throw new NotFoundException('Doctor document not found');
    }

    await this.deleteStorageObject(medicalDocument.storageKey);
    const profileRef = firestore.collection('doctorProfiles').doc(doctorProfileId);
    await firestore.runTransaction(async (transaction) => {
      const currentVerification = await transaction.get(verificationRef);
      const currentDocument = await transaction.get(medicalDocumentRef);
      const currentProfile = await transaction.get(profileRef);
      if (!currentVerification.exists || !currentDocument.exists) {
        throw new NotFoundException('Doctor document not found');
      }
      const currentData =
        currentVerification.data() as DoctorVerificationDocument;
      const currentMedicalDocument = currentDocument.data() as MedicalDocument;
      if (
        currentData.doctorProfileId !== doctorProfileId ||
        currentMedicalDocument.ownerUserId !== uid
      ) {
        throw new NotFoundException('Doctor document not found');
      }
      transaction.delete(verificationRef);
      transaction.delete(medicalDocumentRef);
      if (
        currentData.status === VerificationDocumentStatus.APPROVED &&
        currentProfile.exists
      ) {
        transaction.update(profileRef, {
          verificationStatus: DoctorVerificationStatus.PENDING,
          verifiedAt: null,
          updatedAt: new Date(),
        });
      }
    });
  }

  async list(filters: DoctorDirectoryFilters): Promise<{
    doctors: DoctorDirectoryItem[];
    specialties: string[];
  }> {
    const query = filters.q?.trim().toLocaleLowerCase() ?? '';
    const specialtyFilter = filters.specialty?.trim().toLocaleLowerCase() ?? '';
    const cityFilter = filters.city?.trim().toLocaleLowerCase() ?? '';
    if (query.length > 100 || specialtyFilter.length > 100 || cityFilter.length > 100) {
      throw new BadRequestException('Search filters must be 100 characters or fewer');
    }

    const snapshot = await this.firebase
      .getFirestore()
      .collection('doctorProfiles')
      .where('verificationStatus', '==', DoctorVerificationStatus.VERIFIED)
      .get();
    const profiles = await Promise.all(
      snapshot.docs.map(async (document) => {
        const profile = document.data() as DoctorProfile;
        const userSnapshot = await this.firebase
          .getFirestore()
          .collection('users')
          .doc(profile.userId)
          .get();
        if (!userSnapshot.exists) return null;
        const user = userSnapshot.data() as User;
        if (user.role !== AccountRole.DOCTOR || user.status !== AccountStatus.ACTIVE) return null;

        const [modesSnapshot, availabilitySnapshot, reviewsSnapshot, zoneSnapshot, blockedDatesSnapshot] =
          await Promise.all([
            this.firebase
              .getFirestore()
              .collection('doctorConsultationModes')
              .where('doctorProfileId', '==', document.id)
              .get(),
            this.firebase
              .getFirestore()
              .collection('doctorWeeklyAvailabilities')
              .where('doctorProfileId', '==', document.id)
              .get(),
            this.firebase
              .getFirestore()
              .collection('reviews')
              .where('doctorProfileId', '==', document.id)
              .get(),
            // This is the collection written by /integration/doctor/zone.
            // Its document ID is the Firebase user UID (not doctorProfileId).
            this.firebase
              .getFirestore()
              .collection('doctorServiceAreaSettings')
              .doc(profile.userId)
              .get(),
            this.firebase
              .getFirestore()
              .collection('doctorBlockedDates')
              .where('doctorProfileId', '==', document.id)
              .get(),
          ]);
        const zone = zoneSnapshot.exists ? zoneSnapshot.data() : undefined;
        const serviceCity = typeof zone?.city === 'string' ? zone.city.trim() : null;
        const serviceDistricts: string[] = Array.isArray(zone?.districts)
          ? zone.districts.filter((district: unknown): district is string =>
              typeof district === 'string' && district.trim().length > 0,
            ).map((district: string) => district.trim())
          : [];
        const ratings = reviewsSnapshot.docs
          .map((review) => Number(review.data().rating))
          .filter((rating) => Number.isFinite(rating) && rating >= 1 && rating <= 5);
        const specialty = user.specialty?.trim() || 'Spécialité non renseignée';
        const name =
          profile.fullName?.trim() ||
          `${user.firstName} ${user.lastName}`.trim();

        return {
          id: document.id,
          name,
          specialty,
          bio: profile.bio ?? '',
          yearsOfExperience: profile.yearsOfExperience ?? 0,
          consultationFee: profile.consultationFee ?? 0,
          currency: profile.currency || 'XAF',
          professionalAddress: profile.professionalAddress ?? null,
          serviceCity,
          serviceDistricts,
          // Only calendar dates; do not expose a doctor's private block reason.
          blockedDates: blockedDatesSnapshot.docs
            .map((blocked) => {
              const value = blocked.data().date as Date | { toDate?: () => Date } | undefined;
              const date = value instanceof Date ? value : value?.toDate?.();
              return date instanceof Date && Number.isFinite(date.getTime())
                ? date.toISOString().slice(0, 10)
                : null;
            })
            .filter((value): value is string => value !== null),
          appointmentDurationMinutes: profile.defaultAppointmentDurationMinutes ?? 30,
          modes: modesSnapshot.docs
            .map((mode) => (mode.data() as DoctorConsultationMode).mode)
            .filter(Boolean),
          availability: availabilitySnapshot.docs
            .map((slot) => slot.data() as DoctorWeeklyAvailability)
            .filter((slot) => slot.isAvailable),
          rating:
            ratings.length > 0
              ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length
              : null,
          reviewsCount: ratings.length,
        } satisfies DoctorDirectoryItem;
      }),
    );

    const doctors = profiles
      .filter((doctor) => doctor !== null)
      .filter((doctor) => matchesDoctorSearch(doctor, {
        q: query,
        specialty: specialtyFilter,
        city: cityFilter,
      }))
      .sort((left, right) => left.name.localeCompare(right.name, 'fr'));

    return {
      doctors,
      specialties: [
        ...new Set(
          profiles
            .filter((doctor) => doctor !== null)
            .map((doctor) => doctor.specialty)
            .filter((specialty) => specialty !== 'Spécialité non renseignée'),
        ),
      ].sort((left, right) => left.localeCompare(right, 'fr')),
    };
  }

  async get(id: string): Promise<DoctorDirectoryItem> {
    const result = await this.list({});
    const doctor = result.doctors.find((item) => item.id === id);
    if (!doctor) throw new NotFoundException('Verified doctor not found');
    return doctor;
  }

  private async getDoctorProfileId(uid: string): Promise<{ doctorProfileId: string }> {
    const firestore = this.firebase.getFirestore();
    const userSnapshot = await firestore.collection('users').doc(uid).get();
    if (
      !userSnapshot.exists ||
      (userSnapshot.data() as User).role !== AccountRole.DOCTOR ||
      [AccountStatus.SUSPENDED, AccountStatus.DELETED].includes(
        (userSnapshot.data() as User).status,
      )
    ) {
      throw new NotFoundException('Doctor profile not found');
    }

    const profileSnapshot = await firestore
      .collection('doctorProfiles')
      .where('userId', '==', uid)
      .limit(1)
      .get();
    const profile = profileSnapshot.docs[0];
    if (!profile) throw new NotFoundException('Doctor profile not found');
    return { doctorProfileId: profile.id };
  }

  private getStorageConfig(): SupabaseStorageConfig {
    const url = process.env.SUPABASE_URL?.replace(/\/+$/, '');
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const bucket = process.env.SUPABASE_STORAGE_BUCKET;
    if (!url || !serviceRoleKey || !bucket) {
      throw new ServiceUnavailableException(
        'SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_STORAGE_BUCKET must be configured',
      );
    }
    return { url, serviceRoleKey, bucket };
  }

  private async uploadFile(
    path: string,
    file: UploadedDoctorDocument,
  ): Promise<void> {
    const config = this.getStorageConfig();
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
          'x-upsert': 'false',
        },
        body,
      },
    );
    if (!response.ok) {
      throw new ServiceUnavailableException(
        `Supabase Storage upload failed (${response.status})`,
      );
    }
  }

  private async createSignedUrl(path: string): Promise<string> {
    const config = this.getStorageConfig();
    const response = await fetch(
      `${config.url}/storage/v1/object/sign/${encodeURIComponent(config.bucket)}/${encodeStoragePath(path)}`,
      {
        method: 'POST',
        headers: {
          apikey: config.serviceRoleKey,
          Authorization: `Bearer ${config.serviceRoleKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ expiresIn: 900 }),
      },
    );
    if (!response.ok) {
      throw new ServiceUnavailableException(
        `Supabase Storage signed URL request failed (${response.status})`,
      );
    }
    const payload = (await response.json()) as { signedURL?: string };
    if (!payload.signedURL) {
      throw new ServiceUnavailableException(
        'Supabase Storage returned no signed URL',
      );
    }
    return payload.signedURL.startsWith('http')
      ? payload.signedURL
      : `${config.url}/storage/v1${payload.signedURL.startsWith('/') ? '' : '/'}${payload.signedURL}`;
  }

  private async deleteStorageObject(path: string): Promise<void> {
    const config = this.getStorageConfig();
    const response = await fetch(
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
    if (!response.ok) {
      throw new ServiceUnavailableException(
        `Supabase Storage delete failed (${response.status})`,
      );
    }
  }

  private hasValidSignature(file: UploadedDoctorDocument): boolean {
    const bytes = file.buffer;
    switch (file.mimetype) {
      case 'application/pdf':
        return bytes.subarray(0, 5).toString() === '%PDF-';
      case 'image/jpeg':
        return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
      case 'image/png':
        return bytes.subarray(0, 8).equals(
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        );
      case 'image/webp':
        return (
          bytes.subarray(0, 4).toString() === 'RIFF' &&
          bytes.subarray(8, 12).toString() === 'WEBP'
        );
      default:
        return false;
    }
  }
}
