export enum UserRole {
  PATIENT = "patient",
  DOCTOR = "doctor",
  ADMIN = "admin",
}

export const AccountRole = UserRole;
export type AccountRole = UserRole;

export enum AccountStatus {
  ACTIVE = "active",
  PENDING = "pending",
  SUSPENDED = "suspended",
  DELETED = "deleted",
}

export enum Gender {
  FEMALE = "female",
  MALE = "male",
  NON_BINARY = "non_binary",
  UNDISCLOSED = "undisclosed",
}

export enum BloodType {
  A_POSITIVE = "a_positive",
  A_NEGATIVE = "a_negative",
  B_POSITIVE = "b_positive",
  B_NEGATIVE = "b_negative",
  AB_POSITIVE = "ab_positive",
  AB_NEGATIVE = "ab_negative",
  O_POSITIVE = "o_positive",
  O_NEGATIVE = "o_negative",
  UNKNOWN = "unknown",
}

export enum DoctorVerificationStatus {
  PENDING = "pending",
  VERIFIED = "verified",
  REJECTED = "rejected",
  SUSPENDED = "suspended",
}

export enum VerificationDocumentStatus {
  PENDING = "pending",
  APPROVED = "approved",
  REJECTED = "rejected",
}

export enum ConsultationMode {
  HOME = "home",
  TELECONSULTATION = "teleconsultation",
}

export enum NeedPriority {
  ROUTINE = "routine",
  URGENT = "urgent",
  EMERGENCY = "emergency",
}

export enum NeedStatus {
  DRAFT = "draft",
  PUBLISHED = "published",
  AWAITING_PROPOSALS = "awaiting_proposals",
  PROPOSALS_RECEIVED = "proposals_received",
  APPOINTMENT_CONFIRMED = "appointment_confirmed",
  CLOSED = "closed",
  CANCELLED = "cancelled",
}

export enum ProposalStatus {
  SENT = "sent",
  PENDING = "pending",
  ACCEPTED = "accepted",
  REJECTED = "rejected",
  EXPIRED = "expired",
  CANCELLED = "cancelled",
}

export enum AppointmentStatus {
  PENDING_CONFIRMATION = "pending_confirmation",
  CONFIRMED = "confirmed",
  COMPLETED = "completed",
  CANCELLED = "cancelled",
  REJECTED = "rejected",
  NO_SHOW = "no_show",
}

export enum Weekday {
  MONDAY = "monday",
  TUESDAY = "tuesday",
  WEDNESDAY = "wednesday",
  THURSDAY = "thursday",
  FRIDAY = "friday",
  SATURDAY = "saturday",
  SUNDAY = "sunday",
}

export enum MedicalDocumentType {
  PRESCRIPTION = "prescription",
  LAB_RESULT = "lab_result",
  MEDICAL_REPORT = "medical_report",
  IMAGING = "imaging",
  MEDICAL_LICENSE = "medical_license",
  MEDICAL_DEGREE = "medical_degree",
  IDENTITY_DOCUMENT = "identity_document",
  OTHER = "other",
}

export enum MedicalConditionStatus {
  ACTIVE = "active",
  CONTROLLED = "controlled",
  INACTIVE = "inactive",
}

export enum NotificationType {
  RELEVANT_NEED = "relevant_need",
  PROPOSAL_RECEIVED = "proposal_received",
  PROPOSAL_ACCEPTED = "proposal_accepted",
  APPOINTMENT_UPDATED = "appointment_updated",
  NEW_MESSAGE = "new_message",
  SYSTEM = "system",
}

export enum NotificationPreferenceType {
  RELEVANT_NEEDS = "relevant_needs",
  APPOINTMENTS = "appointments",
  MESSAGES = "messages",
  NEWSLETTER = "newsletter",
}

export interface Timestamped {
  createdAt: Date;
  updatedAt: Date;
}

export interface User extends Timestamped {
  /** Firebase Authentication UID; also the Firestore document ID. */
  id: string;
  firstName: string;
  lastName: string;
  role: AccountRole;
  status: AccountStatus;
  email: string | null;
  phone: string | null;
  specialty: string | null;
  registrationNumber: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  lastLoginAt: Date | null;
}

export interface PatientProfile extends Timestamped {
  id: string;
  /** Foreign key to User.id; one patient profile per user. */
  userId: string;
  fullName: string;
  dateOfBirth: Date | null;
  gender: Gender;
  bloodType: BloodType;
  /** Foreign key to Address.id. */
  primaryAddressId: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
}

export interface DoctorProfile extends Timestamped {
  id: string;
  /** Foreign key to User.id; one doctor profile per user. */
  userId: string;
  fullName: string;
  registrationNumber: string;
  bio: string;
  yearsOfExperience: number;
  consultationFee: number;
  currency: string;
  defaultAppointmentDurationMinutes: number;
  professionalAddress: string | null;
  verificationStatus: DoctorVerificationStatus;
  verifiedAt: Date | null;
}

export interface Specialty extends Timestamped {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
}

/** Join table between doctors and their primary or secondary specialties. */
export interface DoctorSpecialty {
  /** Foreign key to DoctorProfile.id. */
  doctorProfileId: string;
  /** Foreign key to Specialty.id. */
  specialtyId: string;
  isPrimary: boolean;
}

export interface DoctorQualification extends Timestamped {
  id: string;
  /** Foreign key to DoctorProfile.id. */
  doctorProfileId: string;
  title: string;
  institution: string;
  yearAwarded: number | null;
}

/** Join table for consultation modes offered by a doctor. */
export interface DoctorConsultationMode {
  /** Foreign key to DoctorProfile.id. */
  doctorProfileId: string;
  mode: ConsultationMode;
}

export interface City extends Timestamped {
  id: string;
  name: string;
  countryCode: string;
}

export interface District extends Timestamped {
  id: string;
  /** Foreign key to City.id. */
  cityId: string;
  name: string;
}

export interface Address extends Timestamped {
  id: string;
  /** Foreign key to User.id. */
  userId: string;
  /** Foreign key to City.id. */
  cityId: string;
  /** Foreign key to District.id. */
  districtId: string;
  label: string | null;
  addressLine: string | null;
  latitude: number | null;
  longitude: number | null;
  isPrimary: boolean;
}

export interface DoctorServiceArea extends Timestamped {
  id: string;
  /** Foreign key to DoctorProfile.id. */
  doctorProfileId: string;
  /** Foreign key to District.id. */
  districtId: string;
  radiusKm: number;
  maximumDistanceKm: number;
}

export interface MedicalNeed extends Timestamped {
  id: string;
  /** Firebase UID of the patient who owns this need. */
  ownerUserId: string;
  /** Optional relation once a patient profile document has been created. */
  patientProfileId: string | null;
  /** Foreign key to Specialty.id. */
  specialtyId: string | null;
  /** Snapshot labels are retained until city, district and specialty catalogs exist. */
  specialty: string;
  city: string;
  district: string;
  title: string;
  description: string;
  symptoms: string[];
  durationDescription: string | null;
  priority: NeedPriority;
  consultationMode: ConsultationMode;
  status: NeedStatus;
  availableFrom: Date | null;
  /** Private exact address; expose only after an authorized interaction. */
  privateAddress: string | null;
  attachments: NeedAttachment[];
  publishedAt: Date | null;
  consentAt: Date | null;
}

export interface NeedAttachment {
  id: string;
  fileName: string;
  /** Private gs:// reference; never a public download token URL. */
  storageUrl: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: Date;
}

export interface Symptom extends Timestamped {
  id: string;
  name: string;
}

/** Join table linking a medical need to its symptoms. */
export interface NeedSymptom {
  needId: string;
  symptomId: string;
}

export interface MedicalDocument extends Timestamped {
  id: string;
  /** Foreign key to User.id, the document owner. */
  ownerUserId: string;
  type: MedicalDocumentType;
  fileName: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: Date;
}

/** Join table for files attached to a patient need. */
export interface NeedDocument {
  needId: string;
  documentId: string;
  sharedWithDoctors: boolean;
  sharedAt: Date | null;
}

/** Join table for professional documents submitted for doctor verification. */
export interface DoctorVerificationDocument {
  doctorProfileId: string;
  documentId: string;
  status: VerificationDocumentStatus;
  reviewedAt: Date | null;
  reviewerUserId: string | null;
  rejectionReason: string | null;
}

export interface DoctorProposal extends Timestamped {
  id: string;
  /** Foreign key to MedicalNeed.id. */
  needId: string;
  /** Foreign key to DoctorProfile.id. */
  doctorProfileId: string;
  status: ProposalStatus;
  message: string;
  proposedAt: Date;
  proposedAppointmentAt: Date | null;
  consultationMode: ConsultationMode;
  fee: number;
  currency: string;
  patientResponse: string | null;
  respondedAt: Date | null;
  expiresAt: Date | null;
}

export interface Appointment extends Timestamped {
  id: string;
  /** Foreign key to PatientProfile.id. */
  patientProfileId: string;
  /** Foreign key to DoctorProfile.id. */
  doctorProfileId: string;
  /** Foreign key to MedicalNeed.id. */
  needId: string | null;
  /** Foreign key to DoctorProposal.id; null for appointments booked directly. */
  proposalId: string | null;
  status: AppointmentStatus;
  consultationMode: ConsultationMode;
  scheduledAt: Date;
  durationMinutes: number;
  fee: number;
  currency: string;
  /** Foreign key to Address.id; nullable for teleconsultations. */
  addressId: string | null;
  cancellationReason: string | null;
  completedAt: Date | null;
  reason?: string | null;
}

export interface DoctorWeeklyAvailability extends Timestamped {
  id: string;
  /** Foreign key to DoctorProfile.id. */
  doctorProfileId: string;
  weekday: Weekday;
  isAvailable: boolean;
  startTime: string;
  endTime: string;
}

export interface DoctorBlockedDate extends Timestamped {
  id: string;
  /** Foreign key to DoctorProfile.id. */
  doctorProfileId: string;
  date: Date;
  reason: string | null;
}

export interface Conversation extends Timestamped {
  id: string;
  /** Foreign key to PatientProfile.id. */
  patientProfileId: string;
  /** Foreign key to DoctorProfile.id. */
  doctorProfileId: string;
  /** Foreign key to MedicalNeed.id. */
  needId: string | null;
  lastMessageAt: Date | null;
}

export interface Message {
  id: string;
  /** Foreign key to Conversation.id. */
  conversationId: string;
  /** Foreign key to User.id. */
  senderUserId: string;
  body: string;
  sentAt: Date;
  readAt: Date | null;
}

export interface Notification extends Timestamped {
  id: string;
  /** Foreign key to User.id. */
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  targetUrl: string | null;
  readAt: Date | null;
}

export interface NotificationPreference extends Timestamped {
  id: string;
  /** Foreign key to User.id. */
  userId: string;
  type: NotificationPreferenceType;
  isEnabled: boolean;
}

export interface MedicalCondition extends Timestamped {
  id: string;
  name: string;
  description: string | null;
}

/** Join table for conditions in a patient's health record. */
export interface PatientCondition extends Timestamped {
  id: string;
  /** Foreign key to PatientProfile.id. */
  patientProfileId: string;
  /** Foreign key to MedicalCondition.id. */
  medicalConditionId: string;
  status: MedicalConditionStatus;
  diagnosedAt: Date | null;
  notes: string | null;
}

export interface Review extends Timestamped {
  id: string;
  /** Foreign key to Appointment.id. */
  appointmentId: string;
  /** Foreign key to PatientProfile.id. */
  patientProfileId: string;
  /** Foreign key to DoctorProfile.id. */
  doctorProfileId: string;
  rating: number;
  comment: string | null;
}

/** Maps each database table name to the TypeScript shape of one row. */
export interface DatabaseTables {
  users: User;
  patientProfiles: PatientProfile;
  doctorProfiles: DoctorProfile;
  specialties: Specialty;
  doctorSpecialties: DoctorSpecialty;
  doctorQualifications: DoctorQualification;
  doctorConsultationModes: DoctorConsultationMode;
  cities: City;
  districts: District;
  addresses: Address;
  doctorServiceAreas: DoctorServiceArea;
  medicalNeeds: MedicalNeed;
  symptoms: Symptom;
  needSymptoms: NeedSymptom;
  medicalDocuments: MedicalDocument;
  needDocuments: NeedDocument;
  doctorVerificationDocuments: DoctorVerificationDocument;
  doctorProposals: DoctorProposal;
  appointments: Appointment;
  doctorWeeklyAvailabilities: DoctorWeeklyAvailability;
  doctorBlockedDates: DoctorBlockedDate;
  conversations: Conversation;
  messages: Message;
  notifications: Notification;
  notificationPreferences: NotificationPreference;
  medicalConditions: MedicalCondition;
  patientConditions: PatientCondition;
  reviews: Review;
}
