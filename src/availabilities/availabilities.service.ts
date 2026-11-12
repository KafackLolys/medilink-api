import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { Timestamp } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import {
  AccountRole,
  AccountStatus,
  AppointmentStatus,
  type Appointment,
  type DoctorBlockedDate,
  type DoctorProfile,
  type DoctorWeeklyAvailability,
  type User,
  Weekday,
} from '../interfaces/database';
import { FirebaseService } from '../firebase/firebase.service';

const WEEKDAYS: Weekday[] = [
  Weekday.MONDAY,
  Weekday.TUESDAY,
  Weekday.WEDNESDAY,
  Weekday.THURSDAY,
  Weekday.FRIDAY,
  Weekday.SATURDAY,
  Weekday.SUNDAY,
];

export interface WeeklyAvailabilityInput {
  weekday: Weekday;
  isAvailable: boolean;
  startTime: string;
  endTime: string;
}

export interface WeeklyAvailabilityOutput {
  id: string;
  weekday: Weekday;
  isAvailable: boolean;
  startTime: string;
  endTime: string;
}

export interface CreateBlockedDateInput {
  date: string; // YYYY-MM-DD
  reason?: string;
}

export interface BlockedDateOutput {
  id: string;
  date: string; // YYYY-MM-DD
  label: string;
  reason: string | null;
}

export interface DoctorAppointmentView {
  id: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  patient: string;
  district: string | null;
  status: string;
}

function asLocalDateString(value: Date | Timestamp): string {
  const date = value instanceof Timestamp ? value.toDate() : value;
  return date.toISOString().slice(0, 10);
}

function asLocalTimeString(value: Date | Timestamp): string {
  const date = value instanceof Timestamp ? value.toDate() : value;
  return date.toISOString().slice(11, 16);
}

function formatLabel(date: Date): string {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(date);
}

@Injectable()
export class AvailabilitiesService {
  private readonly logger = new Logger(AvailabilitiesService.name);

  constructor(private readonly firebase: FirebaseService) {}

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

  async getWeekly(uid: string): Promise<WeeklyAvailabilityOutput[]> {
    const doctorProfileId = await this.resolveDoctorProfileId(uid);
    const firestore = this.firebase.getFirestore();
    const snapshot = await firestore
      .collection('doctorWeeklyAvailabilities')
      .where('doctorProfileId', '==', doctorProfileId)
      .get();

    const byWeekday = new Map<Weekday, WeeklyAvailabilityOutput>();
    for (const document of snapshot.docs) {
      const data = document.data() as DoctorWeeklyAvailability;
      byWeekday.set(data.weekday, {
        id: document.id,
        weekday: data.weekday,
        isAvailable: data.isAvailable,
        startTime: data.startTime,
        endTime: data.endTime,
      });
    }

    return WEEKDAYS.map((weekday) =>
      byWeekday.get(weekday) ?? {
        id: '',
        weekday,
        isAvailable: false,
        startTime: '09:00',
        endTime: '17:00',
      },
    );
  }

  async setWeekly(
    uid: string,
    availabilities: WeeklyAvailabilityInput[],
  ): Promise<WeeklyAvailabilityOutput[]> {
    const doctorProfileId = await this.resolveDoctorProfileId(uid);
    const firestore = this.firebase.getFirestore();

    for (const item of availabilities) {
      if (!WEEKDAYS.includes(item.weekday)) {
        throw new BadRequestException(`Jour invalide : ${item.weekday}`);
      }
      if (item.isAvailable) {
        if (!item.startTime || !item.endTime) {
          throw new BadRequestException(
            'Les heures de début et de fin sont requises quand le jour est activé.',
          );
        }
        if (item.startTime >= item.endTime) {
          throw new BadRequestException(
            "L'heure de fin doit être postérieure à l'heure de début.",
          );
        }
      }
    }

    await firestore.runTransaction(async (transaction) => {
      const existing = await firestore
        .collection('doctorWeeklyAvailabilities')
        .where('doctorProfileId', '==', doctorProfileId)
        .get();
      for (const document of existing.docs) {
        transaction.delete(document.ref);
      }

      const now = new Date();
      for (const item of availabilities) {
        const ref = firestore.collection('doctorWeeklyAvailabilities').doc();
        transaction.create(ref, {
          id: ref.id,
          doctorProfileId,
          weekday: item.weekday,
          isAvailable: item.isAvailable,
          startTime: item.startTime,
          endTime: item.endTime,
          createdAt: now,
          updatedAt: now,
        });
      }
    });

    return this.getWeekly(uid);
  }

  async getBlocked(uid: string): Promise<BlockedDateOutput[]> {
    const doctorProfileId = await this.resolveDoctorProfileId(uid);
    const firestore = this.firebase.getFirestore();
    const snapshot = await firestore
      .collection('doctorBlockedDates')
      .where('doctorProfileId', '==', doctorProfileId)
      .get();

    return snapshot.docs
      .map((document) => {
        const data = document.data() as DoctorBlockedDate;
        const date = data.date instanceof Timestamp ? data.date.toDate() : data.date;
        return {
          id: document.id,
          date: asLocalDateString(date),
          label: formatLabel(date),
          reason: data.reason ?? null,
          _dateObj: date,
        };
      })
      .sort((a, b) => a._dateObj.getTime() - b._dateObj.getTime())
      .map(({ _dateObj, ...rest }) => rest);
  }

  async createBlocked(
    uid: string,
    input: CreateBlockedDateInput,
  ): Promise<BlockedDateOutput> {
    const doctorProfileId = await this.resolveDoctorProfileId(uid);
    const firestore = this.firebase.getFirestore();

    const date = new Date(`${input.date}T12:00:00`);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('Date invalide');
    }

    const existing = await firestore
      .collection('doctorBlockedDates')
      .where('doctorProfileId', '==', doctorProfileId)
      .get();
    for (const document of existing.docs) {
      const data = document.data() as DoctorBlockedDate;
      if (asLocalDateString(data.date) === input.date) {
        throw new BadRequestException('Cette date est déjà bloquée.');
      }
    }

    const id = randomUUID();
    const now = new Date();
    const blockedDate: DoctorBlockedDate = {
      id,
      doctorProfileId,
      date,
      reason: input.reason?.trim() ?? null,
      createdAt: now,
      updatedAt: now,
    };

    await firestore.collection('doctorBlockedDates').doc(id).set(blockedDate);

    return {
      id,
      date: input.date,
      label: formatLabel(date),
      reason: blockedDate.reason,
    };
  }

  async deleteBlocked(uid: string, id: string): Promise<void> {
    const doctorProfileId = await this.resolveDoctorProfileId(uid);
    const firestore = this.firebase.getFirestore();
    const document = await firestore.collection('doctorBlockedDates').doc(id).get();
    if (!document.exists) {
      throw new NotFoundException('Date bloquée introuvable');
    }
    const data = document.data() as DoctorBlockedDate;
    if (data.doctorProfileId !== doctorProfileId) {
      throw new BadRequestException('Accès non autorisé à cette date bloquée.');
    }
    await firestore.collection('doctorBlockedDates').doc(id).delete();
  }

  async getDoctorAppointments(uid: string): Promise<DoctorAppointmentView[]> {
    const doctorProfileId = await this.resolveDoctorProfileId(uid);
    const firestore = this.firebase.getFirestore();
    const now = new Date();

    const snapshot = await firestore
      .collection('appointments')
      .where('doctorProfileId', '==', doctorProfileId)
      .where('status', '==', AppointmentStatus.CONFIRMED)
      .get();

    const views: DoctorAppointmentView[] = [];
    for (const document of snapshot.docs) {
      const data = document.data() as Appointment;
      const scheduledAt =
        data.scheduledAt instanceof Timestamp
          ? data.scheduledAt.toDate()
          : data.scheduledAt;
      if (scheduledAt.getTime() <= now.getTime()) continue;

      let patient = 'Patient';
      let district: string | null = null;

      try {
        const patientSnapshot = await firestore
          .collection('patientProfiles')
          .doc(data.patientProfileId)
          .get();
        if (patientSnapshot.exists) {
          const patientProfile = patientSnapshot.data();
          const userSnapshot = await firestore
            .collection('users')
            .doc((patientProfile as { userId?: string }).userId ?? data.patientProfileId)
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
        // Ignorer les erreurs de chargement patient, garder les valeurs par défaut.
      }

      views.push({
        id: document.id,
        date: asLocalDateString(scheduledAt),
        time: asLocalTimeString(scheduledAt),
        patient,
        district,
        status: data.status,
      });
    }

    views.sort(
      (left, right) =>
        new Date(`${left.date}T${left.time}`).getTime() -
        new Date(`${right.date}T${right.time}`).getTime(),
    );

    return views.slice(0, 4);
  }
}
