import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
  type DoctorVerificationDocument,
  type Specialty,
} from '../interfaces/database';
import { FirebaseService } from '../firebase/firebase.service';

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
  documents: Array<{
    id: string;
    name: string;
    filename: string;
    status: string;
  }>;
  completedConsultations: number;
}

@Injectable()
export class DoctorsService {
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
        return {
          id: document.id,
          name: medicalDocument.type,
          filename: medicalDocument.fileName,
          status: verification.status,
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
        if (user.status !== AccountStatus.ACTIVE) return null;

        const [modesSnapshot, availabilitySnapshot, reviewsSnapshot] =
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
          ]);
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
      .filter((doctor): doctor is DoctorDirectoryItem => doctor !== null)
      .filter(
        (doctor) =>
          !specialtyFilter ||
          doctor.specialty.toLocaleLowerCase().includes(specialtyFilter),
      )
      .filter(
        (doctor) =>
          !cityFilter ||
          doctor.professionalAddress?.toLocaleLowerCase().includes(cityFilter),
      )
      .filter(
        (doctor) =>
          !query ||
          [doctor.name, doctor.specialty, doctor.professionalAddress ?? '']
            .some((value) => value.toLocaleLowerCase().includes(query)),
      )
      .sort((left, right) => left.name.localeCompare(right.name, 'fr'));

    return {
      doctors,
      specialties: [
        ...new Set(
          profiles
            .filter((doctor): doctor is DoctorDirectoryItem => doctor !== null)
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
}
