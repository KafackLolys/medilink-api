import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  AccountRole,
  AccountStatus,
  DoctorVerificationStatus,
  type DoctorProfile,
  type User,
} from '../interfaces/database';
import { FirebaseService } from '../firebase/firebase.service';

export interface AdminAccountsQuery {
  role?: string;
  q?: string;
  page?: string;
  pageSize?: string;
}

export interface AdminAccount {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  role: AccountRole;
  status: AccountStatus;
  emailVerified: boolean;
  verificationStatus: DoctorVerificationStatus | null;
  createdAt: string | null;
}

export interface CreateAdminRequest {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  phone?: string;
}

export interface AdminAccountPage {
  items: AdminAccount[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (isRecord(value) && typeof value.toDate === 'function') {
    const date: unknown = value.toDate();
    return date instanceof Date ? date : null;
  }
  return null;
}

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(private readonly firebase: FirebaseService) {}

  async listAccounts(query: AdminAccountsQuery): Promise<AdminAccountPage> {
    const role = query.role?.trim() || AccountRole.PATIENT;
    if (role !== AccountRole.PATIENT && role !== AccountRole.DOCTOR) {
      throw new BadRequestException('Le rôle doit être patient ou médecin');
    }
    const page = this.parsePositiveInteger(query.page, 1, 'page', 1_000_000);
    const pageSize = this.parsePositiveInteger(
      query.pageSize,
      10,
      'pageSize',
      50,
    );
    const search = query.q?.trim().toLocaleLowerCase() ?? '';
    if (search.length > 100) {
      throw new BadRequestException('q doit contenir 100 caractères ou moins');
    }

    const firestore = this.firebase.getFirestore();
    const usersSnapshot = await firestore
      .collection('users')
      .where('role', '==', role)
      .get();
    const accounts = await Promise.all(
      usersSnapshot.docs.map(async (document) => {
        const user = document.data() as User;
        const doctorProfile =
          role === AccountRole.DOCTOR
            ? await firestore
                .collection('doctorProfiles')
                .where('userId', '==', document.id)
                .limit(1)
                .get()
            : null;
        const profileDocument = doctorProfile?.docs[0];
        const profile = profileDocument
          ? (profileDocument.data() as DoctorProfile)
          : null;
        const createdAt = toDate(user.createdAt);
        return {
          id: document.id,
          firstName: user.firstName ?? '',
          lastName: user.lastName ?? '',
          email: user.email ?? null,
          phone: user.phone ?? null,
          role,
          status: user.status,
          emailVerified: user.emailVerified ?? false,
          verificationStatus: profile?.verificationStatus ?? null,
          createdAt: createdAt?.toISOString() ?? null,
        } satisfies AdminAccount;
      }),
    );
    const filtered = accounts
      .filter((account) => {
        if (!search) return true;
        return [
          account.firstName,
          account.lastName,
          account.email ?? '',
          account.phone ?? '',
        ].some((value) => value.toLocaleLowerCase().includes(search));
      })
      .sort((left, right) =>
        (right.createdAt ?? '').localeCompare(left.createdAt ?? ''),
      );
    const offset = (page - 1) * pageSize;
    const items = filtered.slice(offset, offset + pageSize);
    return {
      items,
      page,
      pageSize,
      total: filtered.length,
      totalPages: Math.ceil(filtered.length / pageSize),
    };
  }

  async updateStatus(
    actorUid: string,
    id: string,
    status: AccountStatus,
  ): Promise<{ id: string; status: AccountStatus }> {
    if (!Object.values(AccountStatus).includes(status)) {
      throw new BadRequestException('Le statut est invalide');
    }
    const firestore = this.firebase.getFirestore();
    const userRef = firestore.collection('users').doc(id);
    const snapshot = await userRef.get();
    if (!snapshot.exists) throw new NotFoundException('Compte introuvable');
    const user = snapshot.data() as User;
    this.assertManageableAccount(actorUid, user, id);

    await userRef.update({ status, updatedAt: new Date() });
    try {
      await this.firebase.getAuth().updateUser(id, {
        disabled:
          status === AccountStatus.SUSPENDED ||
          status === AccountStatus.DELETED,
      });
      if (
        status === AccountStatus.SUSPENDED ||
        status === AccountStatus.DELETED
      ) {
        await this.firebase.getAuth().revokeRefreshTokens(id);
      }
    } catch (error) {
      this.logger.error(
        `Failed to synchronize Firebase Authentication status for account ${id}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new ServiceUnavailableException(
        'Le statut du compte a été enregistré, mais Firebase Authentication n\'a pas pu être synchronisé',
      );
    }
    return { id, status };
  }

  async updateVerification(
    actorUid: string,
    id: string,
    request: { emailVerified?: unknown; verificationStatus?: unknown },
  ): Promise<{
    id: string;
    emailVerified?: boolean;
    verificationStatus?: DoctorVerificationStatus;
  }> {
    const firestore = this.firebase.getFirestore();
    const userRef = firestore.collection('users').doc(id);
    const snapshot = await userRef.get();
    if (!snapshot.exists) throw new NotFoundException('Compte introuvable');
    const user = snapshot.data() as User;
    this.assertManageableAccount(actorUid, user, id);

    if (user.role === AccountRole.PATIENT) {
      if (typeof request.emailVerified !== 'boolean') {
        throw new BadRequestException(
          'emailVerified doit être un booléen pour les comptes patients',
        );
      }
      await this.firebase.getAuth().updateUser(id, {
        emailVerified: request.emailVerified,
      });
      await userRef.update({
        emailVerified: request.emailVerified,
        updatedAt: new Date(),
      });
      return { id, emailVerified: request.emailVerified };
    }

    if (
      typeof request.verificationStatus !== 'string' ||
      !Object.values(DoctorVerificationStatus).includes(
        request.verificationStatus as DoctorVerificationStatus,
      )
    ) {
      throw new BadRequestException(
        'verificationStatus est invalide pour les comptes médecins',
      );
    }
    const doctorSnapshot = await firestore
      .collection('doctorProfiles')
      .where('userId', '==', id)
      .limit(1)
      .get();
    const doctorDocument = doctorSnapshot.docs[0];
    if (!doctorDocument) {
      throw new NotFoundException('Profil médecin introuvable');
    }
    const verificationStatus =
      request.verificationStatus as DoctorVerificationStatus;
    const now = new Date();
    const batch = firestore.batch();
    batch.update(doctorDocument.ref, {
      verificationStatus,
      verifiedAt: verificationStatus === DoctorVerificationStatus.VERIFIED ? now : null,
      updatedAt: now,
    });
    // A doctor signs up with users.status=pending. Approval should also
    // activate that account, otherwise the directory excludes the doctor.
    // Never automatically reactivate suspended/deleted accounts.
    if (verificationStatus === DoctorVerificationStatus.VERIFIED &&
        (user.status === AccountStatus.PENDING ||
         (user.status as string) === DoctorVerificationStatus.VERIFIED)) {
      batch.update(userRef, { status: AccountStatus.ACTIVE, updatedAt: now });
    }
    await batch.commit();
    return { id, verificationStatus };
  }

  async createAdmin(request: CreateAdminRequest): Promise<AdminAccount> {
    if (!isRecord(request)) {
      throw new BadRequestException('Un objet administrateur est requis');
    }
    const firstName = this.requireText(request.firstName, 'firstName');
    const lastName = this.requireText(request.lastName, 'lastName');
    const email = this.requireText(request.email, 'email').toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      throw new BadRequestException('L\'email doit être valide');
    }
    if (typeof request.password !== 'string' || request.password.length < 8) {
      throw new BadRequestException(
        'Le mot de passe doit contenir au moins 8 caractères',
      );
    }
    if (request.phone !== undefined && typeof request.phone !== 'string') {
      throw new BadRequestException('phone doit être une chaîne de caractères');
    }

    let uid: string;
    try {
      const authUser = await this.firebase.getAuth().createUser({
        email,
        password: request.password,
        displayName: `${firstName} ${lastName}`.trim(),
        emailVerified: true,
        disabled: false,
      });
      uid = authUser.uid;
    } catch (error) {
      if (
        isRecord(error) &&
        (error.code === 'auth/email-already-exists' ||
          error.code === 'auth/invalid-email' ||
          error.code === 'auth/weak-password')
      ) {
        if (error.code === 'auth/email-already-exists') {
          throw new ConflictException(
            'Un compte avec cet email existe déjà',
          );
        }
        throw new BadRequestException('Firebase a rejeté les détails du compte');
      }
      throw error;
    }

    const now = new Date();
    const userRef = this.firebase.getFirestore().collection('users').doc(uid);
    const user: User = {
      id: uid,
      firstName,
      lastName,
      role: AccountRole.ADMIN,
      status: AccountStatus.ACTIVE,
      email,
      phone: request.phone?.trim() || null,
      specialty: null,
      registrationNumber: null,
      emailVerified: true,
      phoneVerified: false,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await userRef.create(user);
    } catch (error) {
      try {
        await this.firebase.getAuth().deleteUser(uid);
      } catch (cleanupError) {
        this.logger.error(
          `Failed to remove Firebase Auth account ${uid} after admin creation failure`,
          cleanupError instanceof Error ? cleanupError.stack : undefined,
        );
        throw new ServiceUnavailableException(
          'La création de l\'administrateur a échoué et le compte Firebase n\'a pas pu être annulé',
        );
      }
      throw error;
    }

    return {
      id: uid,
      firstName,
      lastName,
      email,
      phone: user.phone,
      role: AccountRole.ADMIN,
      status: AccountStatus.ACTIVE,
      emailVerified: true,
      verificationStatus: null,
      createdAt: now.toISOString(),
    };
  }

  private assertManageableAccount(
    actorUid: string,
    user: User,
    targetUid: string,
  ): void {
    if (
      targetUid === actorUid ||
      (user.role !== AccountRole.PATIENT && user.role !== AccountRole.DOCTOR)
    ) {
      throw new ConflictException('Ce compte ne peut pas être modifié');
    }
  }

  private requireText(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException(`${field} est requis`);
    }
    return value.trim();
  }

  private parsePositiveInteger(
    value: string | undefined,
    fallback: number,
    name: string,
    max: number,
  ): number {
    if (value === undefined || value === '') return fallback;
    if (!/^\d+$/.test(value)) {
      throw new BadRequestException(`${name} doit être un entier positif`);
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
      throw new BadRequestException(`${name} doit être compris entre 1 et ${max}`);
    }
    return parsed;
  }
}
