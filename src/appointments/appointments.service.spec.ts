import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountRole,
  AppointmentStatus,
  ConsultationMode,
  DoctorVerificationStatus,
} from '../interfaces/database';
import { FirebaseService } from '../firebase/firebase.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AppointmentsService } from './appointments.service';

describe('AppointmentsService', () => {
  const appointmentRef = { id: 'appointment-123' };
  let doctorVerificationStatus = DoctorVerificationStatus.VERIFIED;
  let availabilityDocuments: Array<Record<string, unknown>> = [];
  let existingAppointments: Array<Record<string, unknown>> = [];
  const transactionCreate = jest.fn();
  const firestore = {
    collection: jest.fn((name: string) => {
      if (name === 'users') {
        return {
          doc: () => ({
            get: async () => ({
              exists: true,
              data: () => ({
                role: AccountRole.PATIENT,
                status: 'active',
                firstName: 'Patient',
              }),
            }),
          }),
        };
      }
      if (name === 'patients') {
        return {
          doc: () => ({
            get: async () => ({ exists: true, data: () => ({ id: 'patient-profile' }) }),
          }),
        };
      }
      if (name === 'doctorProfiles') {
        return {
          doc: () => ({
            get: async () => ({
              exists: true,
              data: () => ({
                id: 'doctor-profile',
                userId: 'doctor-uid',
                fullName: 'Dr. Médecin',
                verificationStatus: doctorVerificationStatus,
                defaultAppointmentDurationMinutes: 30,
                consultationFee: 15000,
                currency: 'XAF',
              }),
            }),
          }),
        };
      }
      if (name === 'doctorConsultationModes') {
        return {
          where: () => ({
            get: async () => ({
              docs: [{ data: () => ({ mode: ConsultationMode.TELECONSULTATION }) }],
            }),
          }),
        };
      }
      if (name === 'doctorWeeklyAvailabilities') {
        return {
          where: () => ({
            get: async () => ({
              docs: availabilityDocuments.map((availability) => ({
                data: () => availability,
              })),
            }),
          }),
        };
      }
      if (name === 'doctorBlockedDates') {
        return { where: () => ({ get: async () => ({ docs: [] }) }) };
      }
      if (name === 'appointments') {
        return {
          where: () => ({ queryType: 'doctor-appointments' }),
          doc: () => appointmentRef,
        };
      }
      throw new Error(`Unexpected collection: ${name}`);
    }),
    runTransaction: async (
      callback: (transaction: {
        get: (query: { queryType: string }) => Promise<{
          docs: Array<{ data: () => Record<string, unknown> }>;
        }>;
        create: typeof transactionCreate;
      }) => Promise<void>,
    ) =>
      callback({
        get: async () => ({
          docs: existingAppointments.map((appointment) => ({
            data: () => appointment,
          })),
        }),
        create: transactionCreate,
      }),
  };
  let service: AppointmentsService;
  let scheduledAt: Date;
  let weekday: string;

  beforeEach(() => {
    jest.clearAllMocks();
    doctorVerificationStatus = DoctorVerificationStatus.VERIFIED;
    existingAppointments = [];
    scheduledAt = new Date();
    scheduledAt.setUTCDate(scheduledAt.getUTCDate() + 5);
    scheduledAt.setUTCHours(12, 0, 0, 0);
    weekday = [
      'sunday',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
    ][scheduledAt.getUTCDay()];
    availabilityDocuments = [
      {
        weekday,
        isAvailable: true,
        startTime: '10:00',
        endTime: '14:00',
      },
    ];
    service = new AppointmentsService({
      getFirestore: () => firestore,
    } as unknown as FirebaseService, {
      publish: jest.fn().mockResolvedValue(undefined),
    } as unknown as NotificationsService);
  });

  it('creates a pending appointment in an available consultation slot', async () => {
    await expect(
      service.create(
        { uid: 'patient-uid' } as never,
        {
          doctorId: 'doctor-profile',
          scheduledAt: scheduledAt.toISOString(),
          timeZone: 'UTC',
          consultationMode: ConsultationMode.TELECONSULTATION,
          reason: 'Consultation de suivi',
        },
      ),
    ).resolves.toEqual({
      id: 'appointment-123',
      status: AppointmentStatus.PENDING_CONFIRMATION,
    });

    expect(transactionCreate).toHaveBeenCalledWith(
      appointmentRef,
      expect.objectContaining({
        patientProfileId: 'patient-profile',
        doctorProfileId: 'doctor-profile',
        status: AppointmentStatus.PENDING_CONFIRMATION,
        consultationMode: ConsultationMode.TELECONSULTATION,
        reason: 'Consultation de suivi',
      }),
    );
  });

  it('rejects a time outside the doctor weekly availability', async () => {
    availabilityDocuments = [];

    await expect(
      service.create(
        { uid: 'patient-uid' } as never,
        {
          doctorId: 'doctor-profile',
          scheduledAt: scheduledAt.toISOString(),
          timeZone: 'UTC',
          consultationMode: ConsultationMode.TELECONSULTATION,
        },
      ),
    ).rejects.toThrow(BadRequestException);
    expect(transactionCreate).not.toHaveBeenCalled();
  });

  it('rejects a time that conflicts with another active appointment', async () => {
    existingAppointments = [
      {
        status: AppointmentStatus.CONFIRMED,
        scheduledAt: new Date(scheduledAt.getTime() - 15 * 60_000),
        durationMinutes: 45,
      },
    ];

    await expect(
      service.create(
        { uid: 'patient-uid' } as never,
        {
          doctorId: 'doctor-profile',
          scheduledAt: scheduledAt.toISOString(),
          timeZone: 'UTC',
          consultationMode: ConsultationMode.TELECONSULTATION,
        },
      ),
    ).rejects.toThrow('This appointment time is no longer available');
    expect(transactionCreate).not.toHaveBeenCalled();
  });

  it('rejects appointments for doctors who are not verified', async () => {
    doctorVerificationStatus = DoctorVerificationStatus.PENDING;

    await expect(
      service.create(
        { uid: 'patient-uid' } as never,
        {
          doctorId: 'doctor-profile',
          scheduledAt: scheduledAt.toISOString(),
          timeZone: 'UTC',
          consultationMode: ConsultationMode.TELECONSULTATION,
        },
      ),
    ).rejects.toThrow(NotFoundException);
    expect(transactionCreate).not.toHaveBeenCalled();
  });
});
