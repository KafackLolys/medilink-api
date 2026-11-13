import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { Timestamp } from 'firebase-admin/firestore';
import { createHash, randomUUID } from 'node:crypto';
import {
  AccountRole,
  AccountStatus,
  AppointmentStatus,
  ConsultationMode,
  DoctorVerificationStatus,
  type MedicalNeed,
  type NeedAttachment,
  NeedPriority,
  NeedStatus,
  NotificationType,
  type DoctorProfile,
  type DoctorProposal,
  ProposalStatus,
  type User,
} from '../interfaces/database';
import { FirebaseService } from '../firebase/firebase.service';
import { NotificationsService } from '../notifications/notifications.service';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_FILES = 5;
const ALLOWED_FILE_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

interface SupabaseStorageConfig {
  url: string;
  serviceRoleKey: string;
  bucket: string;
}

function dateFromFirestore(value: Date | Timestamp): Date {
  return value instanceof Timestamp ? value.toDate() : value;
}

function encodeStoragePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

export interface UploadedNeedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

interface CreateNeedRequest {
  title: string;
  specialty: string;
  description: string;
  symptoms: string[];
  since?: string;
  city: string;
  district: string;
  address?: string;
  priority: 'normal' | 'rapide' | 'urgence';
  mode: 'domicile' | 'tele';
  consent: boolean;
}

export interface PatientNeedListItem {
  id: string;
  title: string;
  specialty: string;
  createdAt: string;
  interested: number;
  mode: 'domicile' | 'teleconsultation';
  status: NeedStatus;
  attachmentsCount: number;
}

export interface PatientProposalView {
  id: string;
  status: ProposalStatus;
  doctor: { id: string; name: string; specialty: string };
  conversationId: string;
  message: string;
  proposedAt: string;
  proposedAppointmentAt: string | null;
  consultationMode: ConsultationMode;
  fee: number;
  currency: string;
}

export interface PatientNeedDetail extends PatientNeedListItem {
  description: string;
  symptoms: string[];
  durationDescription: string | null;
  city: string;
  district: string;
  privateAddress: string | null;
  priority: 'normal' | 'rapide';
  attachments: Array<{
    id: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    downloadUrl: string;
  }>;
}

export interface DoctorNeedDetail extends Omit<PatientNeedDetail, 'priority'> {
  priority: NeedPriority;
  availableFrom: string | null;
}

interface UpdateNeedRequest {
  title: string;
  specialty: string;
  description: string;
  mode: 'domicile' | 'tele';
}

export interface DoctorNeedFilters {
  q?: string;
  specialty?: string;
  priority?: NeedPriority;
  mode?: ConsultationMode;
  page?: string;
  pageSize?: string;
}

export interface DoctorNeedListItem {
  id: string;
  title: string;
  summary: string;
  specialty: string;
  city: string;
  district: string;
  mode: ConsultationMode;
  priority: NeedPriority;
  publishedAt: string;
  availableFrom: string | null;
  documentsCount: number;
  publicLocation?: { latitude: number; longitude: number } | null;
}

export interface PaginatedDoctorNeeds {
  items: DoctorNeedListItem[];
  specialties: string[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface CreateProposalRequest {
  message: string;
  proposedAppointmentAt: string;
  consultationMode: ConsultationMode;
  fee: number;
  details?: string;
}

export interface DoctorProposalFilters {
  status?: string;
  page?: string;
  pageSize?: string;
}

export interface DoctorProposalListItem {
  id: string;
  needId: string;
  needTitle: string;
  specialty: string;
  city: string;
  district: string;
  status: ProposalStatus;
  message: string;
  proposedAt: string;
  proposedAppointmentAt: string | null;
  consultationMode: ConsultationMode;
  fee: number;
  currency: string;
  patientResponse: string | null;
  respondedAt: string | null;
}

export interface PaginatedDoctorProposals {
  items: DoctorProposalListItem[];
  counts: Record<ProposalStatus, number>;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

@Injectable()
export class NeedsService {
  private readonly logger = new Logger(NeedsService.name);

  constructor(
    private readonly firebase: FirebaseService,
    private readonly notifications: NotificationsService,
  ) {}

  async listForDoctor(
    firebaseUser: DecodedIdToken,
    filters: DoctorNeedFilters,
  ): Promise<PaginatedDoctorNeeds> {
    await this.getVerifiedDoctor(firebaseUser.uid);
    const page = this.parsePositiveInteger(filters.page, 1, 'page', 1_000_000);
    const pageSize = this.parsePositiveInteger(
      filters.pageSize,
      10,
      'pageSize',
      50,
    );
    const search = filters.q?.trim().toLocaleLowerCase() ?? '';
    if (search.length > 100) {
      throw new BadRequestException('q must be 100 characters or fewer');
    }
    if (
      filters.specialty &&
      (filters.specialty.trim().length > 100 || !filters.specialty.trim())
    ) {
      throw new BadRequestException('specialty must be 1 to 100 characters');
    }
    if (
      filters.priority &&
      !Object.values(NeedPriority).includes(filters.priority)
    ) {
      throw new BadRequestException('priority is invalid');
    }
    if (
      filters.mode &&
      !Object.values(ConsultationMode).includes(filters.mode)
    ) {
      throw new BadRequestException('consultation mode is invalid');
    }

    const firestore = this.firebase.getFirestore();
    const snapshot = await firestore
      .collection('medicalNeeds')
      .where('status', 'in', [
        NeedStatus.PUBLISHED,
        NeedStatus.AWAITING_PROPOSALS,
        NeedStatus.PROPOSALS_RECEIVED,
      ])
      .get();
    const availableNeeds = (
      await Promise.all(
        snapshot.docs.map(async (document) => {
          const need = document.data() as MedicalNeed;
          if (need.ownerUserId === firebaseUser.uid) return null;
          const ownerSnapshot = await firestore
            .collection('users')
            .doc(need.ownerUserId)
            .get();
          if (
            !ownerSnapshot.exists ||
            (ownerSnapshot.data() as User).role !== AccountRole.PATIENT
          ) {
            return null;
          }
          return { ...need, id: need.id || document.id };
        }),
      )
    ).filter((need): need is MedicalNeed => need !== null);
    const specialties = [...new Set(availableNeeds.map((need) => need.specialty))]
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right, 'fr'));
    const filtered = availableNeeds
      .filter(
        (need) =>
          !filters.specialty ||
          need.specialty === filters.specialty.trim(),
      )
      .filter((need) => !filters.priority || need.priority === filters.priority)
      .filter(
        (need) =>
          !filters.mode || need.consultationMode === filters.mode,
      )
      .filter((need) => {
        if (!search) return true;
        return [
          need.title,
          need.description,
          need.specialty,
          need.city,
          need.district,
        ].some((value) => value.toLocaleLowerCase().includes(search));
      })
      .sort(
        (left, right) =>
          dateFromFirestore(right.publishedAt ?? right.createdAt).getTime() -
          dateFromFirestore(left.publishedAt ?? left.createdAt).getTime(),
      );
    const offset = (page - 1) * pageSize;
    const pageNeeds = filtered.slice(offset, offset + pageSize);
    const [districtSnapshot, citySnapshot] = await Promise.all([
      firestore.collection('districts').get(), firestore.collection('cities').get(),
    ]);
    const cities = new Map(citySnapshot.docs.map(doc => [doc.id, doc.data().name?.trim().toLowerCase()]));
    const centers = new Map<string, { latitude: number; longitude: number }>();
    for (const doc of districtSnapshot.docs) {
      const area = doc.data();
      const city = cities.get(area.cityId);
      const lat = area.centerLatitude;
      const lon = area.centerLongitude;
      if (city && typeof area.name === 'string' && typeof lat === 'number' && typeof lon === 'number' &&
          Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
        centers.set(`${city}::${area.name.trim().toLowerCase()}`, { latitude: lat, longitude: lon });
      }
    }
    const items = pageNeeds.map((need) => ({
      id: need.id,
      title: need.title,
      summary: need.description,
      specialty: need.specialty,
      city: need.city,
      district: need.district,
      mode: need.consultationMode,
      priority: need.priority,
      publishedAt: dateFromFirestore(
        need.publishedAt ?? need.createdAt,
      ).toISOString(),
      availableFrom: need.availableFrom
        ? dateFromFirestore(need.availableFrom).toISOString()
        : null,
      documentsCount: need.attachments?.length ?? 0,
      publicLocation: centers.get(`${need.city.trim().toLowerCase()}::${need.district.trim().toLowerCase()}`) ?? null,
    }));

    return {
      items,
      specialties,
      page,
      pageSize,
      total: filtered.length,
      totalPages: Math.ceil(filtered.length / pageSize),
    };
  }

  async getForDoctor(
    firebaseUser: DecodedIdToken,
    id: string,
  ): Promise<DoctorNeedDetail> {
    await this.getVerifiedDoctor(firebaseUser.uid);
    const snapshot = await this.firebase
      .getFirestore()
      .collection('medicalNeeds')
      .doc(id)
      .get();
    if (!snapshot.exists) {
      throw new NotFoundException('Medical need not found');
    }
    const need = snapshot.data() as MedicalNeed;
    const ownerSnapshot = await this.firebase
      .getFirestore()
      .collection('users')
      .doc(need.ownerUserId)
      .get();
    if (
      need.ownerUserId === firebaseUser.uid ||
      !ownerSnapshot.exists ||
      (ownerSnapshot.data() as User).role !== AccountRole.PATIENT ||
      ![
        NeedStatus.PUBLISHED,
        NeedStatus.AWAITING_PROPOSALS,
        NeedStatus.PROPOSALS_RECEIVED,
      ].includes(need.status)
    ) {
      throw new NotFoundException('Medical need not found');
    }

    const [proposalSnapshot, attachments] = await Promise.all([
      this.firebase
        .getFirestore()
        .collection('doctorProposals')
        .where('needId', '==', need.id)
        .get(),
      Promise.all(
        (need.attachments ?? []).map(async (attachment) => ({
          id: attachment.id,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          downloadUrl: await this.createSignedUrl(attachment.storagePath),
        })),
      ),
    ]);

    return {
      id: need.id,
      title: need.title,
      specialty: need.specialty,
      createdAt: dateFromFirestore(need.createdAt).toISOString(),
      interested: proposalSnapshot.size,
      mode:
        need.consultationMode === ConsultationMode.HOME
          ? 'domicile'
          : 'teleconsultation',
      status: need.status,
      attachmentsCount: attachments.length,
      description: need.description,
      symptoms: need.symptoms ?? [],
      durationDescription: need.durationDescription ?? null,
      city: need.city,
      district: need.district,
      privateAddress: null,
      priority: need.priority,
      availableFrom: need.availableFrom
        ? dateFromFirestore(need.availableFrom).toISOString()
        : null,
      attachments,
    };
  }

  async createProposal(
    firebaseUser: DecodedIdToken,
    needId: string,
    request: CreateProposalRequest,
  ): Promise<{ id: string }> {
    const doctor = await this.getVerifiedDoctor(firebaseUser.uid);
    const proposal = this.validateProposal(request);
    const firestore = this.firebase.getFirestore();
    const needRef = firestore.collection('medicalNeeds').doc(needId);
    const needSnapshot = await needRef.get();
    if (!needSnapshot.exists) {
      throw new NotFoundException('Medical need not found');
    }
    const need = needSnapshot.data() as MedicalNeed;
    if (
      need.ownerUserId === firebaseUser.uid ||
      ![
        NeedStatus.PUBLISHED,
        NeedStatus.AWAITING_PROPOSALS,
        NeedStatus.PROPOSALS_RECEIVED,
      ].includes(need.status)
    ) {
      throw new NotFoundException('Medical need not found');
    }

    const existingProposals = await firestore
      .collection('doctorProposals')
      .where('needId', '==', needId)
      .get();
    if (
      existingProposals.docs.some(
        (document) =>
          (document.data() as DoctorProposal).doctorProfileId === doctor.id,
      )
    ) {
      throw new ConflictException(
        'You have already sent a proposal for this request',
      );
    }

    const proposalRef = firestore.collection('doctorProposals').doc();
    const now = new Date();
    const newProposal: DoctorProposal = {
      id: proposalRef.id,
      needId,
      doctorProfileId: doctor.id,
      status: ProposalStatus.PENDING,
      message: [
        proposal.message,
        proposal.details?.trim() ? `Informations complémentaires : ${proposal.details.trim()}` : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
      proposedAt: now,
      proposedAppointmentAt: new Date(proposal.proposedAppointmentAt),
      consultationMode: proposal.consultationMode,
      fee: proposal.fee,
      currency: 'XAF',
      patientResponse: null,
      respondedAt: null,
      expiresAt: null,
      createdAt: now,
      updatedAt: now,
    };

    await firestore.runTransaction(async (transaction) => {
      const currentNeedSnapshot = await transaction.get(needRef);
      if (!currentNeedSnapshot.exists) {
        throw new NotFoundException('Medical need not found');
      }
      const currentNeed = currentNeedSnapshot.data() as MedicalNeed;
      if (
        ![
          NeedStatus.PUBLISHED,
          NeedStatus.AWAITING_PROPOSALS,
          NeedStatus.PROPOSALS_RECEIVED,
        ].includes(currentNeed.status)
      ) {
        throw new BadRequestException(
          'This request is no longer accepting proposals',
        );
      }
      transaction.create(proposalRef, newProposal);
      transaction.update(needRef, {
        status: NeedStatus.PROPOSALS_RECEIVED,
        updatedAt: now,
      });
    });

    try {
      await this.notifications.publish({
        userId: need.ownerUserId,
        type: NotificationType.PROPOSAL_RECEIVED,
        title: 'Nouvelle proposition',
        body: 'Un médecin a répondu à votre demande.',
        targetUrl: `/patient/demandes/${encodeURIComponent(needId)}`,
      });
    } catch (error) {
      this.logger.error(
        `Failed to create notification for proposal ${proposalRef.id}`,
        error instanceof Error ? error.stack : undefined,
      );
    }

    return { id: proposalRef.id };
  }

  async listProposalsForDoctor(
    firebaseUser: DecodedIdToken,
    filters: DoctorProposalFilters,
  ): Promise<PaginatedDoctorProposals> {
    const doctor = await this.getVerifiedDoctor(firebaseUser.uid);
    const page = this.parsePositiveInteger(filters.page, 1, 'page', 1_000_000);
    const pageSize = this.parsePositiveInteger(
      filters.pageSize,
      10,
      'pageSize',
      50,
    );
    if (
      filters.status &&
      !Object.values(ProposalStatus).includes(filters.status as ProposalStatus)
    ) {
      throw new BadRequestException('proposal status is invalid');
    }

    const firestore = this.firebase.getFirestore();
    const proposalsSnapshot = await firestore
      .collection('doctorProposals')
      .where('doctorProfileId', '==', doctor.id)
      .get();
    const counts: Record<ProposalStatus, number> = {
      [ProposalStatus.SENT]: 0,
      [ProposalStatus.PENDING]: 0,
      [ProposalStatus.ACCEPTED]: 0,
      [ProposalStatus.REJECTED]: 0,
      [ProposalStatus.EXPIRED]: 0,
      [ProposalStatus.CANCELLED]: 0,
    };

    const items = (
      await Promise.all(
        proposalsSnapshot.docs.map(async (document) => {
          const proposal = document.data() as DoctorProposal;
          if (!Object.values(ProposalStatus).includes(proposal.status)) {
            return null;
          }
          const needSnapshot = await firestore
            .collection('medicalNeeds')
            .doc(proposal.needId)
            .get();
          if (!needSnapshot.exists) return null;
          const need = needSnapshot.data() as MedicalNeed;
          const ownerSnapshot = await firestore
            .collection('users')
            .doc(need.ownerUserId)
            .get();
          if (
            !ownerSnapshot.exists ||
            (ownerSnapshot.data() as User).role !== AccountRole.PATIENT
          ) {
            return null;
          }

          counts[proposal.status] += 1;
          return {
            id: proposal.id || document.id,
            needId: proposal.needId,
            needTitle: need.title,
            specialty: need.specialty,
            city: need.city,
            district: need.district,
            status: proposal.status,
            message: proposal.message,
            proposedAt: dateFromFirestore(proposal.proposedAt).toISOString(),
            proposedAppointmentAt: proposal.proposedAppointmentAt
              ? dateFromFirestore(proposal.proposedAppointmentAt).toISOString()
              : null,
            consultationMode: proposal.consultationMode,
            fee: proposal.fee,
            currency: proposal.currency || 'XAF',
            patientResponse: proposal.patientResponse ?? null,
            respondedAt: proposal.respondedAt
              ? dateFromFirestore(proposal.respondedAt).toISOString()
              : null,
          } satisfies DoctorProposalListItem;
        }),
      )
    )
      .filter((item): item is DoctorProposalListItem => item !== null)
      .filter((item) => !filters.status || item.status === filters.status)
      .sort(
        (left, right) =>
          new Date(right.proposedAt).getTime() -
          new Date(left.proposedAt).getTime(),
      );

    const offset = (page - 1) * pageSize;
    return {
      items: items.slice(offset, offset + pageSize),
      counts,
      page,
      pageSize,
      total: items.length,
      totalPages: Math.ceil(items.length / pageSize),
    };
  }

  async cancelProposal(
    firebaseUser: DecodedIdToken,
    proposalId: string,
  ): Promise<{ id: string; status: ProposalStatus }> {
    const doctor = await this.getVerifiedDoctor(firebaseUser.uid);
    const proposalRef = this.firebase
      .getFirestore()
      .collection('doctorProposals')
      .doc(proposalId);
    const snapshot = await proposalRef.get();
    if (!snapshot.exists) {
      throw new NotFoundException('Proposal not found');
    }
    const proposal = snapshot.data() as DoctorProposal;
    if (proposal.doctorProfileId !== doctor.id) {
      throw new NotFoundException('Proposal not found');
    }
    if (
      proposal.status !== ProposalStatus.PENDING &&
      proposal.status !== ProposalStatus.SENT
    ) {
      throw new BadRequestException('This proposal can no longer be cancelled');
    }
    await proposalRef.update({
      status: ProposalStatus.CANCELLED,
      updatedAt: new Date(),
    });
    return { id: proposal.id || snapshot.id, status: ProposalStatus.CANCELLED };
  }

  async listMine(firebaseUser: DecodedIdToken): Promise<PatientNeedListItem[]> {
    const firestore = this.firebase.getFirestore();
    const snapshot = await firestore
      .collection('medicalNeeds')
      .where('ownerUserId', '==', firebaseUser.uid)
      .get();

    return Promise.all(
      snapshot.docs
        .map((document) => document.data() as MedicalNeed)
        .sort(
          (left, right) =>
            dateFromFirestore(right.createdAt).getTime() -
            dateFromFirestore(left.createdAt).getTime(),
        )
        .map(async (need) => {
          const proposals = await firestore
            .collection('doctorProposals')
            .where('needId', '==', need.id)
            .get();
          return {
            id: need.id,
            title: need.title,
            specialty: need.specialty,
            createdAt: dateFromFirestore(need.createdAt).toISOString(),
            interested: proposals.size,
            mode:
              need.consultationMode === ConsultationMode.HOME
                ? 'domicile'
                : 'teleconsultation',
            status: need.status,
            attachmentsCount: need.attachments?.length ?? 0,
          };
        }),
    );
  }

  async listPatientProposals(
    firebaseUser: DecodedIdToken,
    needId: string,
  ): Promise<{ items: PatientProposalView[] }> {
    const firestore = this.firebase.getFirestore();
    const needSnapshot = await firestore.collection('medicalNeeds').doc(needId).get();
    if (!needSnapshot.exists) throw new NotFoundException('Medical need not found');
    this.assertOwner(needSnapshot.data() as MedicalNeed, firebaseUser.uid);
    const snapshot = await firestore.collection('doctorProposals').where('needId', '==', needId).get();
    const items = await Promise.all(snapshot.docs.map(async (document) => {
      const proposal = document.data() as DoctorProposal;
      const doctorSnapshot = await firestore.collection('doctorProfiles').doc(proposal.doctorProfileId).get();
      if (!doctorSnapshot.exists) return null;
      const doctor = doctorSnapshot.data() as DoctorProfile;
      if (doctor.verificationStatus !== DoctorVerificationStatus.VERIFIED) return null;
      const userSnapshot = await firestore.collection('users').doc(doctor.userId).get();
      if (!userSnapshot.exists) return null;
      const user = userSnapshot.data() as User;
      if (user.role !== AccountRole.DOCTOR) return null;
      return {
        id: proposal.id || document.id,
        status: proposal.status,
        doctor: {
          id: doctorSnapshot.id,
          name: doctor.fullName?.trim() || `${user.firstName} ${user.lastName}`.trim(),
          specialty: user.specialty?.trim() || 'Médecine générale',
        },
        conversationId: createHash('sha256')
          .update(`${firebaseUser.uid}:${doctorSnapshot.id}`).digest('hex'),
        message: proposal.message,
        proposedAt: dateFromFirestore(proposal.proposedAt).toISOString(),
        proposedAppointmentAt: proposal.proposedAppointmentAt
          ? dateFromFirestore(proposal.proposedAppointmentAt).toISOString() : null,
        consultationMode: proposal.consultationMode,
        fee: proposal.fee,
        currency: proposal.currency || 'XAF',
      } satisfies PatientProposalView;
    }));
    return {
      items: items.filter((item): item is PatientProposalView => item !== null)
        .sort((a, b) => Date.parse(b.proposedAt) - Date.parse(a.proposedAt)),
    };
  }

  async acceptPatientProposal(
    firebaseUser: DecodedIdToken, needId: string, proposalId: string,
  ): Promise<{ proposalId: string; appointmentId: string }> {
    const db = this.firebase.getFirestore();
    const needRef = db.collection('medicalNeeds').doc(needId);
    const proposalRef = db.collection('doctorProposals').doc(proposalId);
    const preflightProposal = await proposalRef.get();
    if (!preflightProposal.exists || preflightProposal.data()?.needId !== needId) {
      throw new NotFoundException('Proposal not found for this request');
    }
    const doctorProfileId = (preflightProposal.data() as DoctorProposal).doctorProfileId;
    const doctorRef = db.collection('doctorProfiles').doc(doctorProfileId);
    const preflightDoctor = await doctorRef.get();
    if (!preflightDoctor.exists) throw new NotFoundException('Doctor not found');
    const doctorUserRef = db.collection('users').doc((preflightDoctor.data() as DoctorProfile).userId);
    const appointmentRef = db.collection('appointments').doc();
    const patientRef = db.collection('patients').doc(firebaseUser.uid);
    const allProposalsQuery = db.collection('doctorProposals').where('needId', '==', needId);
    const appointmentsQuery = db.collection('appointments').where('doctorProfileId', '==', doctorProfileId);
    const modesQuery = db.collection('doctorConsultationModes').where('doctorProfileId', '==', doctorProfileId);
    const weeklyQuery = db.collection('doctorWeeklyAvailabilities').where('doctorProfileId', '==', doctorProfileId);
    const blockedQuery = db.collection('doctorBlockedDates').where('doctorProfileId', '==', doctorProfileId);
    const addressesQuery = db.collection('addresses').where('userId', '==', firebaseUser.uid);
    const now = new Date();

    const result = await db.runTransaction(async (tx) => {
      // Firestore transaction: read everything first, then write atomically.
      const [needSnapshot, proposalSnapshot, doctorSnapshot, doctorUserSnapshot,
        patientSnapshot, allProposals, appointmentsSnapshot, modesSnapshot,
        weeklySnapshot, blockedSnapshot, addressesSnapshot] = await Promise.all([
        tx.get(needRef), tx.get(proposalRef), tx.get(doctorRef), tx.get(doctorUserRef),
        tx.get(patientRef), tx.get(allProposalsQuery), tx.get(appointmentsQuery),
        tx.get(modesQuery), tx.get(weeklyQuery), tx.get(blockedQuery), tx.get(addressesQuery),
      ]);
      if (!needSnapshot.exists) throw new NotFoundException('Medical need not found');
      const need = needSnapshot.data() as MedicalNeed;
      this.assertOwner(need, firebaseUser.uid);
      if (![NeedStatus.PUBLISHED, NeedStatus.AWAITING_PROPOSALS, NeedStatus.PROPOSALS_RECEIVED].includes(need.status)) {
        throw new ConflictException('A doctor has already been selected or this request is closed');
      }
      if (!proposalSnapshot.exists) throw new NotFoundException('Proposal not found');
      const proposal = proposalSnapshot.data() as DoctorProposal;
      if (proposal.needId !== needId || proposal.doctorProfileId !== doctorProfileId ||
          ![ProposalStatus.PENDING, ProposalStatus.SENT].includes(proposal.status)) {
        throw new ConflictException('This proposal can no longer be accepted');
      }
      if (allProposals.docs.some((doc) => doc.id !== proposalId && doc.data().status === ProposalStatus.ACCEPTED)) {
        throw new ConflictException('Another proposal has already been accepted');
      }
      if (!doctorSnapshot.exists || !doctorUserSnapshot.exists) {
        throw new NotFoundException('Doctor not found');
      }
      const doctor = doctorSnapshot.data() as DoctorProfile;
      const doctorUser = doctorUserSnapshot.data() as User;
      if (doctor.verificationStatus !== DoctorVerificationStatus.VERIFIED ||
          doctorUser.role !== AccountRole.DOCTOR || doctorUser.status !== AccountStatus.ACTIVE) {
        throw new BadRequestException('Doctor is not available for appointments');
      }
      if (need.consultationMode !== proposal.consultationMode ||
          !modesSnapshot.docs.some((doc) => doc.data().mode === proposal.consultationMode)) {
        throw new BadRequestException('This consultation mode is not available');
      }
      if (!proposal.proposedAppointmentAt) throw new BadRequestException('The proposed appointment date is missing');
      const startsAt = dateFromFirestore(proposal.proposedAppointmentAt);
      if (!Number.isFinite(startsAt.getTime()) || startsAt.getTime() <= Date.now()) {
        throw new BadRequestException('The proposed appointment is in the past');
      }
      const duration = Number.isSafeInteger(doctor.defaultAppointmentDurationMinutes) &&
        doctor.defaultAppointmentDurationMinutes > 0 ? doctor.defaultAppointmentDurationMinutes : 30;
      const endsAt = new Date(startsAt.getTime() + duration * 60_000);
      const localParts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Africa/Douala', year: 'numeric', month: '2-digit', day: '2-digit',
        weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      }).formatToParts(startsAt);
      const local = Object.fromEntries(localParts.map(({ type, value }) => [type, value]));
      const weekday = local.weekday.toLowerCase();
      const day = `${local.year}-${local.month}-${local.day}`;
      const minutes = Number(local.hour) * 60 + Number(local.minute);
      const available = weeklySnapshot.docs.some((doc) => {
        const slot = doc.data();
        const [sh, sm] = String(slot.startTime).split(':').map(Number);
        const [eh, em] = String(slot.endTime).split(':').map(Number);
        return slot.isAvailable === true && slot.weekday === weekday &&
          minutes >= sh * 60 + sm && minutes + duration <= eh * 60 + em;
      });
      if (!available) throw new BadRequestException('Doctor is not available at the proposed time');
      const blocked = blockedSnapshot.docs.some((doc) => {
        const value = doc.data().date as Date | Timestamp;
        const parts = new Intl.DateTimeFormat('en-GB', {
          timeZone: 'Africa/Douala', year: 'numeric', month: '2-digit', day: '2-digit',
        }).formatToParts(dateFromFirestore(value));
        const localDay = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
        return `${localDay.year}-${localDay.month}-${localDay.day}` === day;
      });
      if (blocked) throw new BadRequestException('Doctor is unavailable on the proposed date');
      const conflict = appointmentsSnapshot.docs.some((doc) => {
        const old = doc.data();
        if (![AppointmentStatus.CONFIRMED, AppointmentStatus.PENDING_CONFIRMATION].includes(old.status)) return false;
        const oldStart = dateFromFirestore(old.scheduledAt as Date | Timestamp).getTime();
        const oldEnd = oldStart + (Number(old.durationMinutes) || 30) * 60_000;
        return startsAt.getTime() < oldEnd && endsAt.getTime() > oldStart;
      });
      if (conflict) throw new ConflictException('This appointment time is already booked');
      const primaryAddress = addressesSnapshot.docs.find((doc) => doc.data().isPrimary === true);
      if (proposal.consultationMode === ConsultationMode.HOME && !primaryAddress) {
        throw new BadRequestException('Add a primary address before accepting a home visit');
      }
      tx.update(proposalRef, {
        status: ProposalStatus.ACCEPTED, respondedAt: now,
        patientResponse: 'Proposition acceptée', updatedAt: now,
      });
      for (const doc of allProposals.docs) {
        if (doc.id === proposalId) continue;
        if ([ProposalStatus.PENDING, ProposalStatus.SENT].includes(doc.data().status)) {
          tx.update(doc.ref, {
            status: ProposalStatus.REJECTED,
            patientResponse: 'Une autre proposition a été acceptée',
            respondedAt: now, updatedAt: now,
          });
        }
      }
      tx.update(needRef, { status: NeedStatus.APPOINTMENT_CONFIRMED, updatedAt: now });
      tx.create(appointmentRef, {
        id: appointmentRef.id,
        patientProfileId: patientSnapshot.exists ? (patientSnapshot.data()?.id ?? firebaseUser.uid) : firebaseUser.uid,
        doctorProfileId, needId, proposalId, status: AppointmentStatus.CONFIRMED,
        consultationMode: proposal.consultationMode, scheduledAt: startsAt,
        durationMinutes: duration, fee: proposal.fee, currency: proposal.currency || 'XAF',
        addressId: primaryAddress ? (primaryAddress.data().id ?? primaryAddress.id) : null,
        cancellationReason: null, completedAt: null, createdAt: now, updatedAt: now,
      });
      return { proposalId, appointmentId: appointmentRef.id, doctorUserId: doctor.userId };
    });
    try {
      await this.notifications.publish({
        userId: result.doctorUserId, type: NotificationType.PROPOSAL_ACCEPTED,
        title: 'Votre proposition a été acceptée',
        body: 'Un patient a accepté votre proposition de consultation.',
        targetUrl: '/medecin/rendez-vous',
      });
    } catch (error) {
      this.logger.warn(`Appointment ${result.appointmentId} created; notification failed: ${String(error)}`);
    }
    return { proposalId: result.proposalId, appointmentId: result.appointmentId };
  }

  async getMine(
    firebaseUser: DecodedIdToken,
    id: string,
  ): Promise<PatientNeedDetail> {
    const firestore = this.firebase.getFirestore();
    const needRef = firestore.collection('medicalNeeds').doc(id);
    const snapshot = await needRef.get();
    if (!snapshot.exists) {
      throw new NotFoundException('Medical need not found');
    }

    const need = snapshot.data() as MedicalNeed;
    this.assertOwner(need, firebaseUser.uid);
    const [proposalSnapshot, attachments] = await Promise.all([
      firestore
        .collection('doctorProposals')
        .where('needId', '==', need.id)
        .get(),
      Promise.all(
        (need.attachments ?? []).map(async (attachment) => ({
          id: attachment.id,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          downloadUrl: await this.createSignedUrl(attachment.storagePath),
        })),
      ),
    ]);

    return {
      id: need.id,
      title: need.title,
      specialty: need.specialty,
      createdAt: dateFromFirestore(need.createdAt).toISOString(),
      interested: proposalSnapshot.size,
      mode:
        need.consultationMode === ConsultationMode.HOME
          ? 'domicile'
          : 'teleconsultation',
      status: need.status,
      attachmentsCount: attachments.length,
      description: need.description,
      symptoms: need.symptoms ?? [],
      durationDescription: need.durationDescription ?? null,
      city: need.city,
      district: need.district,
      privateAddress: need.privateAddress ?? null,
      priority:
        need.priority === NeedPriority.URGENT ? 'rapide' : 'normal',
      attachments,
    };
  }

  async update(
    firebaseUser: DecodedIdToken,
    id: string,
    request: UpdateNeedRequest,
  ): Promise<PatientNeedDetail> {
    const firestore = this.firebase.getFirestore();
    const needRef = firestore.collection('medicalNeeds').doc(id);
    const snapshot = await needRef.get();
    if (!snapshot.exists) {
      throw new NotFoundException('Medical need not found');
    }
    const need = snapshot.data() as MedicalNeed;
    this.assertOwner(need, firebaseUser.uid);
    if (
      ![
        NeedStatus.DRAFT,
        NeedStatus.PUBLISHED,
        NeedStatus.AWAITING_PROPOSALS,
        NeedStatus.PROPOSALS_RECEIVED,
      ].includes(need.status)
    ) {
      throw new BadRequestException('This request can no longer be edited');
    }

    const update = this.validateUpdate(request);
    await needRef.update({
      title: update.title,
      specialty: update.specialty,
      description: update.description,
      consultationMode:
        update.mode === 'domicile'
          ? ConsultationMode.HOME
          : ConsultationMode.TELECONSULTATION,
      updatedAt: new Date(),
    });

    return this.getMine(firebaseUser, id);
  }

  async create(
    firebaseUser: DecodedIdToken,
    serializedRequest: string,
    files: UploadedNeedFile[],
  ): Promise<PatientNeedListItem> {
    const request = this.parseRequest(serializedRequest);
    this.validateFiles(files);

    const firestore = this.firebase.getFirestore();
    const userSnapshot = await firestore
      .collection('users')
      .doc(firebaseUser.uid)
      .get();
    if (!userSnapshot.exists) {
      throw new NotFoundException('Application account not found');
    }
    const user = userSnapshot.data() as User;
    if (user.role !== AccountRole.PATIENT) {
      throw new ForbiddenException('Only patients can publish medical needs');
    }

    const needRef = firestore.collection('medicalNeeds').doc();
    const now = new Date();
    const uploadedObjects: string[] = [];
    let attachments: NeedAttachment[] = [];

    try {
      if (files.length > 0) {
        for (const file of files) {
          const id = randomUUID();
          const storagePath = `medical-needs/${firebaseUser.uid}/${needRef.id}/${id}`;
          uploadedObjects.push(storagePath);
          const storageUrl = await this.uploadFile(storagePath, file);
          attachments.push({
            id,
            fileName: file.originalname,
            storageUrl,
            storagePath,
            mimeType: file.mimetype,
            sizeBytes: file.size,
            uploadedAt: now,
          });
        }
      }

      const patientSnapshot = await firestore
        .collection('patients')
        .doc(firebaseUser.uid)
        .get();
      const patientId = patientSnapshot.exists
        ? ((patientSnapshot.data() as { id?: string }).id ?? firebaseUser.uid)
        : null;

      const need: MedicalNeed = {
        id: needRef.id,
        ownerUserId: firebaseUser.uid,
        patientProfileId: patientId,
        specialtyId: null,
        specialty: request.specialty,
        city: request.city,
        district: request.district,
        title: request.title,
        description: request.description,
        symptoms: request.symptoms,
        durationDescription: request.since?.trim() || null,
        priority:
          request.priority === 'rapide'
            ? NeedPriority.URGENT
            : NeedPriority.ROUTINE,
        consultationMode:
          request.mode === 'domicile'
            ? ConsultationMode.HOME
            : ConsultationMode.TELECONSULTATION,
        status: NeedStatus.AWAITING_PROPOSALS,
        availableFrom: null,
        privateAddress: request.address?.trim() || null,
        attachments,
        publishedAt: now,
        consentAt: now,
        createdAt: now,
        updatedAt: now,
      };

      await needRef.set(need);
      return {
        id: need.id,
        title: need.title,
        specialty: need.specialty,
        createdAt: now.toISOString(),
        interested: 0,
        mode: request.mode === 'domicile' ? 'domicile' : 'teleconsultation',
        status: need.status,
        attachmentsCount: attachments.length,
      };
    } catch (error) {
      await this.deleteUploadedObjects(uploadedObjects);
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      this.logger.error(
        'Failed to publish a patient medical need',
        error instanceof Error ? error.stack : undefined,
      );
      throw new ServiceUnavailableException(
        'The request could not be published. Verify Supabase Storage configuration and try again.',
      );
    }
  }

  async close(firebaseUser: DecodedIdToken, id: string): Promise<void> {
    const needRef = this.firebase.getFirestore().collection('medicalNeeds').doc(id);
    const snapshot = await needRef.get();
    if (!snapshot.exists) {
      throw new NotFoundException('Medical need not found');
    }
    const need = snapshot.data() as MedicalNeed;
    this.assertOwner(need, firebaseUser.uid);
    if (
      ![
        NeedStatus.PUBLISHED,
        NeedStatus.AWAITING_PROPOSALS,
        NeedStatus.PROPOSALS_RECEIVED,
      ].includes(need.status)
    ) {
      throw new BadRequestException('Only active requests can be closed');
    }
    await needRef.update({
      status: NeedStatus.CLOSED,
      updatedAt: new Date(),
    });
  }

  async remove(firebaseUser: DecodedIdToken, id: string): Promise<void> {
    const firestore = this.firebase.getFirestore();
    const needRef = firestore.collection('medicalNeeds').doc(id);
    const snapshot = await needRef.get();
    if (!snapshot.exists) {
      throw new NotFoundException('Medical need not found');
    }
    const need = snapshot.data() as MedicalNeed;
    this.assertOwner(need, firebaseUser.uid);
    if (need.status !== NeedStatus.DRAFT) {
      throw new BadRequestException('Only draft requests can be deleted');
    }

    const attachments = need.attachments ?? [];
    if (attachments.length > 0) {
      try {
        await this.deleteSupabaseObjects(
          attachments.map((attachment) => attachment.storagePath),
        );
      } catch (error) {
        this.logger.error(
          `Failed to remove files for medical need ${id}`,
          error instanceof Error ? error.stack : undefined,
        );
        throw new ServiceUnavailableException(
          'The request files could not be removed. The request was not deleted.',
        );
      }
    }
    await needRef.delete();
  }

  private parseRequest(serializedRequest: string): CreateNeedRequest {
    let value: unknown;
    try {
      value = JSON.parse(serializedRequest);
    } catch {
      throw new BadRequestException('Request details must be valid JSON');
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException('Request details are required');
    }
    const request = value as Partial<CreateNeedRequest>;
    const text = (field: unknown): field is string =>
      typeof field === 'string';
    if (!text(request.title) || request.title.trim().length < 5) {
      throw new BadRequestException('title must contain at least 5 characters');
    }
    if (!text(request.specialty) || !request.specialty.trim()) {
      throw new BadRequestException('specialty is required');
    }
    if (
      !text(request.description) ||
      request.description.trim().length < 20 ||
      request.description.length > 800
    ) {
      throw new BadRequestException(
        'description must contain between 20 and 800 characters',
      );
    }
    if (
      !Array.isArray(request.symptoms) ||
      request.symptoms.some((symptom) => !text(symptom))
    ) {
      throw new BadRequestException('symptoms must be a list of strings');
    }
    if (!text(request.city) || !request.city.trim()) {
      throw new BadRequestException('city is required');
    }
    if (!text(request.district) || !request.district.trim()) {
      throw new BadRequestException('district is required');
    }
    if (request.priority === 'urgence') {
      throw new BadRequestException(
        'Medical emergencies must be handled by emergency services',
      );
    }
    if (request.priority !== 'normal' && request.priority !== 'rapide') {
      throw new BadRequestException('priority is invalid');
    }
    if (request.mode !== 'domicile' && request.mode !== 'tele') {
      throw new BadRequestException('consultation mode is invalid');
    }
    if (request.consent !== true) {
      throw new BadRequestException('Consent is required to publish a request');
    }
    return {
      title: request.title.trim(),
      specialty: request.specialty.trim(),
      description: request.description.trim(),
      symptoms: request.symptoms,
      city: request.city.trim(),
      district: request.district.trim(),
      priority: request.priority,
      mode: request.mode,
      consent: request.consent,
      since: text(request.since) ? request.since : undefined,
      address: text(request.address) ? request.address : undefined,
    };
  }

  private validateFiles(files: UploadedNeedFile[]): void {
    if (files.length > MAX_FILES) {
      throw new BadRequestException(`A maximum of ${MAX_FILES} files is allowed`);
    }
    for (const file of files) {
      if (!ALLOWED_FILE_TYPES.has(file.mimetype) || !this.hasValidSignature(file)) {
        throw new BadRequestException(
          'Files must be valid PDF, JPEG, PNG, WebP, HEIC or HEIF files',
        );
      }
      if (file.size > MAX_FILE_SIZE) {
        throw new BadRequestException('Each file must be 10 MB or smaller');
      }
    }
  }

  private validateUpdate(value: UpdateNeedRequest): UpdateNeedRequest {
    if (!value || typeof value !== 'object') {
      throw new BadRequestException('Request details are required');
    }
    if (typeof value.title !== 'string' || value.title.trim().length < 5) {
      throw new BadRequestException('title must contain at least 5 characters');
    }
    if (typeof value.specialty !== 'string' || !value.specialty.trim()) {
      throw new BadRequestException('specialty is required');
    }
    if (
      typeof value.description !== 'string' ||
      value.description.trim().length < 20 ||
      value.description.length > 800
    ) {
      throw new BadRequestException(
        'description must contain between 20 and 800 characters',
      );
    }
    if (value.mode !== 'domicile' && value.mode !== 'tele') {
      throw new BadRequestException('consultation mode is invalid');
    }
    return {
      title: value.title.trim(),
      specialty: value.specialty.trim(),
      description: value.description.trim(),
      mode: value.mode,
    };
  }

  private assertOwner(need: MedicalNeed, uid: string): void {
    if (need.ownerUserId !== uid) {
      throw new ForbiddenException('You cannot modify this medical need');
    }
  }

  private async getVerifiedDoctor(uid: string): Promise<DoctorProfile> {
    const firestore = this.firebase.getFirestore();
    const userSnapshot = await firestore.collection('users').doc(uid).get();
    if (!userSnapshot.exists) {
      throw new NotFoundException('Application account not found');
    }
    const user = userSnapshot.data() as User;
    if (user.role !== AccountRole.DOCTOR) {
      throw new ForbiddenException('Only doctors can access patient requests');
    }

    const doctorSnapshot = await firestore
      .collection('doctorProfiles')
      .where('userId', '==', uid)
      .limit(1)
      .get();
    const document = doctorSnapshot.docs[0];
    if (!document) {
      throw new ForbiddenException('Doctor profile is not available');
    }
    const profile = document.data() as DoctorProfile;
    if (profile.verificationStatus !== DoctorVerificationStatus.VERIFIED) {
      throw new ForbiddenException(
        'Only verified doctors can access patient requests',
      );
    }
    return { ...profile, id: profile.id || document.id };
  }

  private parsePositiveInteger(
    value: string | undefined,
    defaultValue: number,
    name: string,
    maximum: number,
  ): number {
    if (value === undefined || value === '') return defaultValue;
    if (!/^\d+$/.test(value)) {
      throw new BadRequestException(`${name} must be a positive integer`);
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
      throw new BadRequestException(
        `${name} must be between 1 and ${maximum}`,
      );
    }
    return parsed;
  }

  private validateProposal(value: CreateProposalRequest): CreateProposalRequest {
    if (!value || typeof value !== 'object') {
      throw new BadRequestException('Proposal details are required');
    }
    if (typeof value.message !== 'string' || value.message.trim().length < 10) {
      throw new BadRequestException(
        'Proposal message must contain at least 10 characters',
      );
    }
    const proposedDate = new Date(value.proposedAppointmentAt);
    if (
      typeof value.proposedAppointmentAt !== 'string' ||
      !Number.isFinite(proposedDate.getTime()) ||
      proposedDate.getTime() <= Date.now()
    ) {
      throw new BadRequestException(
        'The proposed appointment must be a valid future date',
      );
    }
    if (
      value.consultationMode !== ConsultationMode.HOME &&
      value.consultationMode !== ConsultationMode.TELECONSULTATION
    ) {
      throw new BadRequestException('Consultation mode is invalid');
    }
    if (
      typeof value.fee !== 'number' ||
      !Number.isFinite(value.fee) ||
      value.fee < 0
    ) {
      throw new BadRequestException('Fee must be a non-negative number');
    }
    if (
      value.details !== undefined &&
      (typeof value.details !== 'string' || value.details.length > 2000)
    ) {
      throw new BadRequestException(
        'Additional details must be 2000 characters or fewer',
      );
    }
    return {
      ...value,
      message: value.message.trim(),
    };
  }

  private async deleteUploadedObjects(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    try {
      await this.deleteSupabaseObjects(paths);
    } catch (error) {
      this.logger.error(
        'Failed to clean up uploaded medical files',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private getSupabaseStorageConfig(): SupabaseStorageConfig {
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
    file: UploadedNeedFile,
  ): Promise<string> {
    const config = this.getSupabaseStorageConfig();
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

    return `${config.url}/storage/v1/object/${encodeURIComponent(config.bucket)}/${encodeStoragePath(path)}`;
  }

  private async createSignedUrl(path: string): Promise<string> {
    const config = this.getSupabaseStorageConfig();
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

  private async deleteSupabaseObjects(paths: string[]): Promise<void> {
    const config = this.getSupabaseStorageConfig();
    const response = await fetch(
      `${config.url}/storage/v1/object/${encodeURIComponent(config.bucket)}`,
      {
        method: 'DELETE',
        headers: {
          apikey: config.serviceRoleKey,
          Authorization: `Bearer ${config.serviceRoleKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prefixes: paths }),
      },
    );
    if (!response.ok) {
      throw new ServiceUnavailableException(
        `Supabase Storage cleanup failed (${response.status})`,
      );
    }
  }

  private hasValidSignature(file: UploadedNeedFile): boolean {
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
      case 'image/heic':
      case 'image/heif': {
        const brand = bytes.subarray(8, 12).toString();
        return bytes.subarray(4, 8).toString() === 'ftyp' &&
          ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand);
      }
      default:
        return false;
    }
  }
}
