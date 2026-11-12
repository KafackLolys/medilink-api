import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { Timestamp } from 'firebase-admin/firestore';
import {
  AccountRole,
  AccountStatus,
  AppointmentStatus,
  ConsultationMode,
  DoctorVerificationStatus,
  NotificationType,
  type Appointment,
  type DoctorConsultationMode,
  type DoctorProfile,
  type PatientProfile,
  type DoctorWeeklyAvailability,
  type User,
} from '../interfaces/database';
import { FirebaseService } from '../firebase/firebase.service';
import { NotificationsService } from '../notifications/notifications.service';

export interface CreateAppointmentRequest {
  doctorId: string;
  scheduledAt: string;
  timeZone: string;
  consultationMode: ConsultationMode;
  reason?: string;
}

export interface PatientAppointmentView {
  id: string;
  doctor: {
    id: string;
    name: string;
    specialty: string;
    professionalAddress: string | null;
  };
  scheduledAt: string;
  durationMinutes: number;
  consultationMode: ConsultationMode;
  status: AppointmentStatus;
  fee: number;
  currency: string;
  reason: string | null;
}

function asDate(value: Date | Timestamp): Date {
  return value instanceof Timestamp ? value.toDate() : value;
}

function localDateParts(date: Date, timeZone: string) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  } catch {
    throw new BadRequestException('timeZone must be a valid IANA time zone');
  }
}

function asLocalDateString(value: Date | Timestamp): string {
  const date = value instanceof Timestamp ? value.toDate() : value;
  return date.toISOString().slice(0, 10);
}

function asLocalTimeString(value: Date | Timestamp): string {
  const date = value instanceof Timestamp ? value.toDate() : value;
  return date.toISOString().slice(11, 16);
}

@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger(AppointmentsService.name);

  constructor(
    private readonly firebase: FirebaseService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(
    firebaseUser: DecodedIdToken,
    request: CreateAppointmentRequest,
  ): Promise<{ id: string; status: AppointmentStatus }> {
    if (
      typeof request.doctorId !== 'string' ||
      !request.doctorId.trim() ||
      !Object.values(ConsultationMode).includes(request.consultationMode)
    ) {
      throw new BadRequestException('A doctor and consultation mode are required');
    }
    if (
      typeof request.scheduledAt !== 'string' ||
      Number.isNaN(Date.parse(request.scheduledAt))
    ) {
      throw new BadRequestException('scheduledAt must be a valid date');
    }
    if (typeof request.timeZone !== 'string' || !request.timeZone.trim()) {
      throw new BadRequestException('timeZone is required');
    }
    const scheduledAt = new Date(request.scheduledAt);
    if (scheduledAt.getTime() <= Date.now()) {
      throw new BadRequestException('Appointment must be scheduled in the future');
    }
    const reason = request.reason?.trim() ?? '';
    if (reason.length > 500) {
      throw new BadRequestException('reason must be 500 characters or fewer');
    }
    const localDate = localDateParts(scheduledAt, request.timeZone);
    const weekday = localDate.weekday.toLowerCase();
    const time = `${localDate.hour}:${localDate.minute}`;
    const localDay = `${localDate.year}-${localDate.month}-${localDate.day}`;

    const firestore = this.firebase.getFirestore();
    const [userSnapshot, patientSnapshot, doctorSnapshot] = await Promise.all([
      firestore.collection('users').doc(firebaseUser.uid).get(),
      firestore.collection('patients').doc(firebaseUser.uid).get(),
      firestore.collection('doctorProfiles').doc(request.doctorId).get(),
    ]);
    if (
      !userSnapshot.exists ||
      (userSnapshot.data() as User).role !== AccountRole.PATIENT ||
      (userSnapshot.data() as User).status !== AccountStatus.ACTIVE
    ) {
      throw new ForbiddenException('Only patients can request appointments');
    }
    if (!doctorSnapshot.exists) {
      throw new NotFoundException('Doctor not found');
    }
    const doctor = doctorSnapshot.data() as DoctorProfile;
    if (doctor.verificationStatus !== DoctorVerificationStatus.VERIFIED) {
      throw new NotFoundException('Verified doctor not found');
    }
    const doctorUserSnapshot = await firestore
      .collection('users')
      .doc(doctor.userId)
      .get();
    if (
      !doctorUserSnapshot.exists ||
      (doctorUserSnapshot.data() as User).status !== AccountStatus.ACTIVE
    ) {
      throw new NotFoundException('Verified doctor not found');
    }
    const durationMinutes =
      Number.isSafeInteger(doctor.defaultAppointmentDurationMinutes) &&
      doctor.defaultAppointmentDurationMinutes > 0
        ? doctor.defaultAppointmentDurationMinutes
        : 30;

    const [modesSnapshot, availabilitySnapshot, blockedDatesSnapshot, addressSnapshot] =
      await Promise.all([
        firestore
          .collection('doctorConsultationModes')
          .where('doctorProfileId', '==', request.doctorId)
          .get(),
        firestore
          .collection('doctorWeeklyAvailabilities')
          .where('doctorProfileId', '==', request.doctorId)
          .get(),
        firestore
          .collection('doctorBlockedDates')
          .where('doctorProfileId', '==', request.doctorId)
          .get(),
        request.consultationMode === ConsultationMode.HOME
          ? firestore
              .collection('addresses')
              .where('userId', '==', firebaseUser.uid)
              .get()
          : Promise.resolve(null),
      ]);

    const modes = modesSnapshot.docs.map(
      (document) => (document.data() as DoctorConsultationMode).mode,
    );
    if (!modes.includes(request.consultationMode)) {
      throw new BadRequestException('This doctor does not offer that consultation mode');
    }
    const availability = availabilitySnapshot.docs
      .map((document) => document.data() as DoctorWeeklyAvailability)
      .find(
        (slot) =>
          slot.isAvailable &&
          slot.weekday === weekday &&
          slot.startTime <= time &&
          time < slot.endTime &&
          (Number(localDate.hour) * 60 + Number(localDate.minute) + durationMinutes) <=
            (Number(slot.endTime.slice(0, 2)) * 60 +
              Number(slot.endTime.slice(3, 5))),
      );
    if (!availability) {
      throw new BadRequestException('The doctor is not available at the selected time');
    }
    const isBlocked = blockedDatesSnapshot.docs.some((document) => {
      const blockedDate = document.data().date as Date | Timestamp;
      return `${localDateParts(asDate(blockedDate), request.timeZone).year}-${
        localDateParts(asDate(blockedDate), request.timeZone).month
      }-${localDateParts(asDate(blockedDate), request.timeZone).day}` === localDay;
    });
    if (isBlocked) {
      throw new BadRequestException('The doctor is unavailable on the selected date');
    }
    const primaryAddress = addressSnapshot?.docs.find(
      (document) => document.data().isPrimary === true,
    );
    if (request.consultationMode === ConsultationMode.HOME && !primaryAddress) {
      throw new BadRequestException(
        'Add a primary address to your profile before requesting a home visit',
      );
    }

    const endTime = scheduledAt.getTime() + durationMinutes * 60_000;
    const appointments = firestore
      .collection('appointments')
      .where('doctorProfileId', '==', request.doctorId);
    const appointmentRef = firestore.collection('appointments').doc();
    const now = new Date();
    const appointment: Appointment & { reason: string | null } = {
      id: appointmentRef.id,
      patientProfileId: patientSnapshot.exists
        ? ((patientSnapshot.data() as { id?: string }).id ?? firebaseUser.uid)
        : firebaseUser.uid,
      doctorProfileId: request.doctorId,
      needId: null,
      proposalId: null,
      status: AppointmentStatus.PENDING_CONFIRMATION,
      consultationMode: request.consultationMode,
      scheduledAt,
      durationMinutes,
      fee: doctor.consultationFee,
      currency: doctor.currency || 'XAF',
      addressId: primaryAddress
        ? ((primaryAddress.data() as { id?: string }).id ?? primaryAddress.id)
        : null,
      cancellationReason: null,
      completedAt: null,
      reason: reason || null,
      createdAt: now,
      updatedAt: now,
    };

    await firestore.runTransaction(async (transaction) => {
      const existingAppointments = await transaction.get(appointments);
      const hasConflict = existingAppointments.docs.some((document) => {
        const existing = document.data() as Appointment;
        if (
          existing.status !== AppointmentStatus.PENDING_CONFIRMATION &&
          existing.status !== AppointmentStatus.CONFIRMED
        ) {
          return false;
        }
        const existingStart = asDate(existing.scheduledAt).getTime();
        const existingEnd =
          existingStart + (existing.durationMinutes || durationMinutes) * 60_000;
        return scheduledAt.getTime() < existingEnd && endTime > existingStart;
      });
      if (hasConflict) {
        throw new BadRequestException('This appointment time is no longer available');
      }
      transaction.create(appointmentRef, appointment);
    });

    try {
      await this.notifications.publish({
        userId: doctor.userId,
        type: NotificationType.APPOINTMENT_UPDATED,
        title: 'Nouvelle demande de rendez-vous',
        body: 'Un patient vous a envoyé une demande de rendez-vous.',
        targetUrl: '/medecin/rendez-vous',
      });
    } catch (error) {
      this.logger.error(
        `Failed to create notification for appointment ${appointment.id}`,
        error instanceof Error ? error.stack : undefined,
      );
    }

    return { id: appointment.id, status: appointment.status };
  }

  async listMine(firebaseUser: DecodedIdToken): Promise<PatientAppointmentView[]> {
    const firestore = this.firebase.getFirestore();
    const patientSnapshot = await firestore
      .collection('patients')
      .doc(firebaseUser.uid)
      .get();
    const patientId = patientSnapshot.exists
      ? ((patientSnapshot.data() as { id?: string }).id ?? firebaseUser.uid)
      : firebaseUser.uid;
    const snapshot = await firestore
      .collection('appointments')
      .where('patientProfileId', '==', patientId)
      .get();
    const appointments = await Promise.all(
      snapshot.docs.map(async (document) => {
        const appointment = document.data() as Appointment & { reason?: string | null };
        const doctorSnapshot = await firestore
          .collection('doctorProfiles')
          .doc(appointment.doctorProfileId)
          .get();
        if (!doctorSnapshot.exists) return null;
        const doctor = doctorSnapshot.data() as DoctorProfile;
        const userSnapshot = await firestore
          .collection('users')
          .doc(doctor.userId)
          .get();
        if (!userSnapshot.exists) return null;
        const user = userSnapshot.data() as User;
        return {
          id: document.id,
          doctor: {
            id: appointment.doctorProfileId,
            name:
              doctor.fullName?.trim() ||
              `${user.firstName} ${user.lastName}`.trim(),
            specialty: user.specialty ?? 'Spécialité non renseignée',
            professionalAddress: doctor.professionalAddress ?? null,
          },
          scheduledAt: asDate(appointment.scheduledAt).toISOString(),
          durationMinutes: appointment.durationMinutes,
          consultationMode: appointment.consultationMode,
          status: appointment.status,
          fee: appointment.fee,
          currency: appointment.currency,
          reason: appointment.reason ?? null,
        };
      }),
    );
    return appointments
      .filter((appointment): appointment is PatientAppointmentView => appointment !== null)
      .sort(
        (left, right) =>
          new Date(left.scheduledAt).getTime() -
          new Date(right.scheduledAt).getTime(),
      );
  }

  async getMine(
    firebaseUser: DecodedIdToken,
    id: string,
  ): Promise<PatientAppointmentView> {
    const appointments = await this.listMine(firebaseUser);
    const appointment = appointments.find((item) => item.id === id);
    if (!appointment) throw new NotFoundException('Appointment not found');
    return appointment;
  }

  private async resolveDoctorProfileId(uid: string): Promise<string> {
    const firestore = this.firebase.getFirestore();
    const userSnapshot = await firestore.collection('users').doc(uid).get();
    if (!userSnapshot.exists) {
      throw new NotFoundException('Compte utilisateur introuvable');
    }
    const user = userSnapshot.data() as User;
    if (
      user.role !== AccountRole.DOCTOR ||
      user.status === AccountStatus.SUSPENDED ||
      user.status === AccountStatus.DELETED
    ) {
      throw new NotFoundException('Profil médecin introuvable');
    }

    const doctorSnapshot = await firestore
      .collection('doctorProfiles')
      .where('userId', '==', uid)
      .limit(1)
      .get();
    const doctorDocument = doctorSnapshot.docs[0];
    if (!doctorDocument) {
      throw new NotFoundException('Profil médecin introuvable');
    }
    return doctorDocument.id;
  }

  async listDoctor(firebaseUser: DecodedIdToken): Promise<DoctorAppointmentView[]> {
    const doctorProfileId = await this.resolveDoctorProfileId(firebaseUser.uid);
    const firestore = this.firebase.getFirestore();
    const snapshot = await firestore
      .collection('appointments')
      .where('doctorProfileId', '==', doctorProfileId)
      .get();

    const views: DoctorAppointmentView[] = [];
    for (const document of snapshot.docs) {
      const data = document.data() as Appointment & { reason?: string | null };
      const scheduledAt =
        data.scheduledAt instanceof Timestamp
          ? data.scheduledAt.toDate()
          : data.scheduledAt;

      let patient = 'Patient';
      let district: string | null = null;
      let mode = 'À domicile';

      try {
        const patientSnapshot = await firestore
          .collection('patientProfiles')
          .doc(data.patientProfileId)
          .get();
        if (patientSnapshot.exists) {
          const patientProfile = patientSnapshot.data() as PatientProfile;
          const userSnapshot = await firestore
            .collection('users')
            .doc(patientProfile.userId ?? data.patientProfileId)
            .get();
          if (userSnapshot.exists) {
            const user = userSnapshot.data() as User;
            patient = `${user.firstName} ${user.lastName}`.trim() || patient;
          }
          if (data.addressId) {
            const addressSnapshot = await firestore
              .collection('addresses')
              .doc(data.addressId)
              .get();
            if (addressSnapshot.exists) {
              district =
                (addressSnapshot.data() as { district?: string }).district ?? null;
            }
          }
        }
      } catch {
        // Ignorer les erreurs de chargement patient.
      }

      switch (data.consultationMode) {
        case ConsultationMode.TELECONSULTATION:
          mode = 'Téléconsultation';
          break;
        case ConsultationMode.HOME:
        default:
          mode = 'À domicile';
      }

      views.push({
        id: document.id,
        date: asLocalDateString(scheduledAt),
        time: asLocalTimeString(scheduledAt),
        patient,
        district,
        mode,
        status: data.status,
      });
    }

    views.sort(
      (left, right) =>
        new Date(`${left.date}T${left.time}`).getTime() -
        new Date(`${right.date}T${right.time}`).getTime(),
    );

    return views;
  }

  async updateStatus(
    firebaseUser: DecodedIdToken,
    id: string,
    status: AppointmentStatus,
  ): Promise<{ id: string; status: AppointmentStatus }> {
    const doctorProfileId = await this.resolveDoctorProfileId(firebaseUser.uid);
    const firestore = this.firebase.getFirestore();

    const appointmentRef = firestore.collection('appointments').doc(id);
    const appointmentSnapshot = await appointmentRef.get();
    if (!appointmentSnapshot.exists) {
      throw new NotFoundException('Rendez-vous introuvable');
    }
    const appointment = appointmentSnapshot.data() as Appointment;
    if (appointment.doctorProfileId !== doctorProfileId) {
      throw new ForbiddenException('Ce rendez-vous ne vous appartient pas.');
    }

    await appointmentRef.update({
      status,
      updatedAt: new Date(),
    });

    try {
      await this.notifications.publish({
        userId: appointment.patientProfileId,
        type: NotificationType.APPOINTMENT_UPDATED,
        title: 'Votre rendez-vous a été mis à jour',
        body: `Le statut de votre rendez-vous est passé à "${status}".`,
        targetUrl: '/patient/rendez-vous',
      });
    } catch {
      // Ne pas faire échouer la mise à jour si la notification échoue.
    }

    return { id, status };
  }
}

export interface DoctorAppointmentView {
  id: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  patient: string;
  district: string | null;
  mode: string;
  status: AppointmentStatus;
}
