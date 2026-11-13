import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { Timestamp } from 'firebase-admin/firestore';
import { createHash, randomUUID } from 'node:crypto';
import {
  AccountRole,
  DoctorVerificationStatus,
  NotificationType,
  ProposalStatus,
  type DoctorProfile,
  type DoctorProposal,
  type MedicalNeed,
  type User,
} from '../interfaces/database';
import { FirebaseService } from '../firebase/firebase.service';
import { NotificationsService } from '../notifications/notifications.service';

const ACTIVE_PROPOSAL_STATUSES = new Set([
  ProposalStatus.SENT,
  ProposalStatus.PENDING,
  ProposalStatus.ACCEPTED,
]);

interface ConversationContext {
  id: string;
  doctorProfileId: string;
  doctorUserId: string;
  patientUserId: string;
  peerName: string;
  requestId: string;
  requestTitle: string;
  interactionAt: Date;
}

export interface ConversationListItem {
  id: string;
  peerUserId: string;
  peerName: string;
  requestId: string;
  requestTitle: string;
  preview: string;
  lastMessageAt: string | null;
  unreadCount: number;
}

export interface MessageItem {
  id: string;
  senderUserId: string;
  body: string;
  sentAt: string;
  readAt: string | null;
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (value instanceof Timestamp) return value.toDate();
  return null;
}

function conversationId(patientUserId: string, doctorProfileId: string): string {
  return createHash('sha256')
    .update(`${patientUserId}:${doctorProfileId}`)
    .digest('hex');
}

function userName(user: User): string {
  return [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || 'Utilisateur';
}

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    private readonly firebase: FirebaseService,
    private readonly notifications: NotificationsService,
  ) {}

  async listConversations(
    firebaseUser: DecodedIdToken,
  ): Promise<{ items: ConversationListItem[] }> {
    const contexts = await this.findConversationContexts(firebaseUser.uid);
    const firestore = this.firebase.getFirestore();
    const items = await Promise.all(
      contexts.map(async (context) => {
        const messages = firestore
          .collection('conversations')
          .doc(context.id)
          .collection('messages');
        const [lastMessageSnapshot, receivedMessages] = await Promise.all([
          messages.orderBy('sentAt', 'desc').limit(1).get(),
          messages
            .where('receiverUserId', '==', firebaseUser.uid)
            .get(),
        ]);
        const unreadCount = receivedMessages.docs.filter(
          (document) => !document.data().readAt,
        ).length;
        const lastMessage = lastMessageSnapshot.docs[0]?.data();
        const lastMessageAt = asDate(lastMessage?.sentAt);
        return {
          id: context.id,
          peerUserId:
            context.doctorUserId === firebaseUser.uid
              ? context.patientUserId
              : context.doctorUserId,
          peerName: context.peerName,
          requestId: context.requestId,
          requestTitle: context.requestTitle,
          preview: typeof lastMessage?.body === 'string' ? lastMessage.body : '',
          lastMessageAt: lastMessageAt?.toISOString() ?? null,
          unreadCount,
          interactionAt: context.interactionAt,
        };
      }),
    );

    return {
      items: items
        .sort((left, right) => {
          const leftTime = left.lastMessageAt
            ? new Date(left.lastMessageAt).getTime()
            : left.interactionAt.getTime();
          const rightTime = right.lastMessageAt
            ? new Date(right.lastMessageAt).getTime()
            : right.interactionAt.getTime();
          return rightTime - leftTime;
        })
        .map(({ interactionAt: _interactionAt, ...item }) => item),
    };
  }

  async listMessages(
    firebaseUser: DecodedIdToken,
    id: string,
  ): Promise<{ items: MessageItem[] }> {
    const context = await this.getConversationContext(firebaseUser.uid, id);
    const messages = this.firebase
      .getFirestore()
      .collection('conversations')
      .doc(context.id)
      .collection('messages');
    const [snapshot, receivedMessages] = await Promise.all([
      messages.orderBy('sentAt', 'desc').limit(100).get(),
      messages
        .where('receiverUserId', '==', firebaseUser.uid)
        .get(),
    ]);
    const unreadMessages = receivedMessages.docs.filter(
      (document) => !document.data().readAt,
    );

    const now = new Date();
    for (let offset = 0; offset < unreadMessages.length; offset += 450) {
      const batch = this.firebase.getFirestore().batch();
      for (const document of unreadMessages.slice(offset, offset + 450)) {
        batch.update(document.ref, { readAt: now });
      }
      await batch.commit();
    }

    const items = snapshot.docs
      .reverse()
      .map((document) => {
        const data = document.data();
        const sentAt = asDate(data.sentAt);
        if (!sentAt || typeof data.body !== 'string') {
          this.logger.warn(`Ignoring malformed message ${document.id}`);
          return null;
        }
        return {
          id: document.id,
          senderUserId: String(data.senderUserId ?? ''),
          body: data.body,
          sentAt: sentAt.toISOString(),
          readAt:
            data.receiverUserId === firebaseUser.uid && !data.readAt
              ? now.toISOString()
              : asDate(data.readAt)?.toISOString() ?? null,
        } satisfies MessageItem;
      })
      .filter((item): item is MessageItem => item !== null);
    return { items };
  }

  async sendMessage(
    firebaseUser: DecodedIdToken,
    id: string,
    rawBody: unknown,
  ): Promise<MessageItem> {
    if (typeof rawBody !== 'string' || !rawBody.trim() || rawBody.trim().length > 4000) {
      throw new BadRequestException('Message body must contain 1 to 4000 characters');
    }
    const context = await this.getConversationContext(firebaseUser.uid, id);
    const isDoctor = context.doctorUserId === firebaseUser.uid;
    const recipientUserId = isDoctor
      ? context.patientUserId
      : context.doctorUserId;
    const now = new Date();
    const messageId = randomUUID();
    const firestore = this.firebase.getFirestore();
    const conversationRef = firestore.collection('conversations').doc(context.id);
    const messageRef = conversationRef.collection('messages').doc(messageId);
    const conversationSnapshot = await conversationRef.get();
    const message: MessageItem = {
      id: messageId,
      senderUserId: firebaseUser.uid,
      body: rawBody.trim(),
      sentAt: now.toISOString(),
      readAt: null,
    };

    const batch = firestore.batch();
    batch.set(
      conversationRef,
      {
        id: context.id,
        patientProfileId: context.patientUserId,
        patientUserId: context.patientUserId,
        doctorProfileId: context.doctorProfileId,
        doctorUserId: context.doctorUserId,
        needId: context.requestId,
        lastMessageAt: now,
        updatedAt: now,
        ...(!conversationSnapshot.exists ? { createdAt: now } : {}),
      },
      { merge: true },
    );
    batch.create(messageRef, {
      ...message,
      conversationId: context.id,
      receiverUserId: recipientUserId,
      sentAt: now,
    });
    await batch.commit();

    try {
      await this.notifications.publish({
        userId: recipientUserId,
        type: NotificationType.NEW_MESSAGE,
        title: isDoctor
          ? 'Nouveau message de votre médecin'
          : 'Nouveau message d’un patient',
        body: 'Vous avez reçu un nouveau message.',
        targetUrl: `${isDoctor ? '/patient/profil?activeContent=messages&tab=messages&' : '/medecin?tab=messages&'}conversation=${context.id}`,
      });
    } catch (error) {
      this.logger.error(
        `Message ${messageId} was saved, but its notification could not be sent`,
        error instanceof Error ? error.stack : undefined,
      );
    }
    return message;
  }

  private async getConversationContext(
    userId: string,
    id: string,
  ): Promise<ConversationContext> {
    const contexts = await this.findConversationContexts(userId);
    const context = contexts.find((item) => item.id === id);
    if (!context) {
      throw new NotFoundException('Conversation not found');
    }
    return context;
  }

  private async findConversationContexts(
    userId: string,
  ): Promise<ConversationContext[]> {
    const firestore = this.firebase.getFirestore();
    const userSnapshot = await firestore.collection('users').doc(userId).get();
    if (!userSnapshot.exists) throw new NotFoundException('Account not found');
    const user = userSnapshot.data() as User;
    if (user.role !== AccountRole.DOCTOR && user.role !== AccountRole.PATIENT) {
      throw new ForbiddenException('Only patients and doctors can use messaging');
    }

    let doctorProfile: DoctorProfile | null = null;
    if (user.role === AccountRole.DOCTOR) {
      const profiles = await firestore
        .collection('doctorProfiles')
        .where('userId', '==', userId)
        .limit(1)
        .get();
      const profileDoc = profiles.docs[0];
      if (!profileDoc) throw new ForbiddenException('Doctor profile is not available');
      doctorProfile = {
        ...(profileDoc.data() as DoctorProfile),
        id: (profileDoc.data() as DoctorProfile).id || profileDoc.id,
      };
      if (doctorProfile.verificationStatus !== DoctorVerificationStatus.VERIFIED) {
        throw new ForbiddenException('Only verified doctors can use messaging');
      }
    }

    const needsSnapshot =
      user.role === AccountRole.DOCTOR
        ? null
        : await firestore
            .collection('medicalNeeds')
            .where('ownerUserId', '==', userId)
            .get();
    const proposalsSnapshot =
      user.role === AccountRole.DOCTOR
        ? await firestore
            .collection('doctorProposals')
            .where('doctorProfileId', '==', doctorProfile!.id)
            .get()
        : null;
    const proposalsByNeed = needsSnapshot
      ? await Promise.all(
          needsSnapshot.docs.map((need) =>
            firestore
              .collection('doctorProposals')
              .where('needId', '==', need.id)
              .get(),
          ),
        )
      : null;
    const documents = proposalsSnapshot
      ? proposalsSnapshot.docs
      : (proposalsByNeed ?? []).flatMap((snapshot) => snapshot.docs);

    const contexts = new Map<string, ConversationContext>();
    await Promise.all(
      documents.map(async (document) => {
        const proposal = document.data() as DoctorProposal;
        if (!ACTIVE_PROPOSAL_STATUSES.has(proposal.status)) return;
        const needSnapshot = await firestore
          .collection('medicalNeeds')
          .doc(proposal.needId)
          .get();
        if (!needSnapshot.exists) return;
        const need = needSnapshot.data() as MedicalNeed;
        if (
          (user.role === AccountRole.PATIENT && need.ownerUserId !== userId) ||
          (doctorProfile && proposal.doctorProfileId !== doctorProfile.id)
        ) {
          return;
        }
        const resolvedDoctor = doctorProfile
          ? doctorProfile
          : await this.getDoctorProfile(proposal.doctorProfileId);
        const doctorSnapshot = await firestore
          .collection('users')
          .doc(resolvedDoctor.userId)
          .get();
        if (!doctorSnapshot.exists) return;
        const doctorUser = doctorSnapshot.data() as User;
        if (doctorUser.role !== AccountRole.DOCTOR) return;
        const patientUserId = need.ownerUserId;
        const patientSnapshot = await firestore
          .collection('users')
          .doc(patientUserId)
          .get();
        if (!patientSnapshot.exists) return;
        const patient = patientSnapshot.data() as User;
        if (patient.role !== AccountRole.PATIENT) return;
        const doctorUserId = resolvedDoctor.userId;
        const id = conversationId(patientUserId, resolvedDoctor.id);
        const interactionAt =
          asDate(proposal.updatedAt) ??
          asDate(proposal.proposedAt) ??
          new Date(0);
        const context: ConversationContext = {
          id,
          doctorProfileId: resolvedDoctor.id,
          doctorUserId,
          patientUserId,
          peerName:
            doctorUserId === userId ? userName(patient) : userName(doctorUser),
          requestId: need.id,
          requestTitle: need.title,
          interactionAt,
        };
        const previous = contexts.get(id);
        if (!previous || previous.interactionAt < interactionAt) {
          contexts.set(id, context);
        }
      }),
    );
    return [...contexts.values()];
  }

  private async getDoctorProfile(id: string): Promise<DoctorProfile> {
    const firestore = this.firebase.getFirestore();
    let snapshot = await firestore.collection('doctorProfiles').doc(id).get();
    if (!snapshot.exists) {
      const byId = await firestore
        .collection('doctorProfiles')
        .where('id', '==', id)
        .limit(1)
        .get();
      snapshot = byId.docs[0] ?? snapshot;
    }
    if (!snapshot.exists) throw new NotFoundException('Doctor profile not found');
    const profile = snapshot.data() as DoctorProfile;
    if (profile.verificationStatus !== DoctorVerificationStatus.VERIFIED) {
      throw new ForbiddenException('Only verified doctors can use messaging');
    }
    return { ...profile, id: profile.id || snapshot.id };
  }
}
