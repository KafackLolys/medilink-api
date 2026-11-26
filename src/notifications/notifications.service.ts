import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { DecodedIdToken } from 'firebase-admin/auth';
import {
  type MulticastMessage,
  type BatchResponse,
} from 'firebase-admin/messaging';
import { type Notification } from '../interfaces/database';
import { FirebaseService } from '../firebase/firebase.service';
import { NovuService } from './novu.service';

export type NotificationPlatform = 'web' | 'mobile';
export type NotificationPushProvider = 'firebase' | 'novu';

export interface RegisterNotificationDeviceRequest {
  deviceId: string;
  token: string;
  platform: NotificationPlatform;
  userAgent?: string;
  /** Flutter uses Novu; legacy native/web clients keep direct Firebase delivery. */
  pushProvider?: NotificationPushProvider;
}

export interface NotificationItem {
  id: string;
  type: Notification['type'];
  title: string;
  body: string;
  targetUrl: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPage {
  items: NotificationItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  unreadCount: number;
}

export interface PublishNotification {
  userId: string;
  type: Notification['type'];
  title: string;
  body: string;
  targetUrl?: string | null;
  data?: Record<string, string>;
  /** User who caused the notification, when applicable. */
  senderUserId?: string;
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
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly firebase: FirebaseService,
    private readonly novu: NovuService,
  ) {}

  async listForUser(
    firebaseUser: DecodedIdToken,
    pageValue?: string,
    pageSizeValue?: string,
  ): Promise<NotificationPage> {
    const page = this.parsePositiveInteger(pageValue, 1, 'page', 1_000_000);
    const pageSize = this.parsePositiveInteger(
      pageSizeValue,
      20,
      'pageSize',
      50,
    );
    const snapshot = await this.firebase
      .getFirestore()
      .collection('notifications')
      .where('userId', '==', firebaseUser.uid)
      .get();
    const notifications = snapshot.docs
      .filter((document) => document.data().senderUserId !== firebaseUser.uid)
      .map((document) => {
        const notification = document.data() as Notification;
        const createdAt = toDate(notification.createdAt);
        if (!createdAt) {
          this.logger.warn(
            `Notification ${document.id} has an invalid createdAt timestamp`,
          );
          return null;
        }
        return {
          id: document.id,
          type: notification.type,
          title: notification.title,
          body: notification.body,
          targetUrl: notification.targetUrl ?? null,
          readAt: toDate(notification.readAt)?.toISOString() ?? null,
          createdAt: createdAt.toISOString(),
        } satisfies NotificationItem;
      })
      .filter((item): item is NotificationItem => item !== null)
      .sort(
        (left, right) =>
          new Date(right.createdAt).getTime() -
          new Date(left.createdAt).getTime(),
      );
    const offset = (page - 1) * pageSize;
    return {
      items: notifications.slice(offset, offset + pageSize),
      page,
      pageSize,
      total: notifications.length,
      totalPages: Math.ceil(notifications.length / pageSize),
      unreadCount: notifications.filter((item) => !item.readAt).length,
    };
  }

  async markRead(
    firebaseUser: DecodedIdToken,
    notificationId: string,
  ): Promise<{ id: string; readAt: string }> {
    const reference = this.firebase
      .getFirestore()
      .collection('notifications')
      .doc(notificationId);
    const snapshot = await reference.get();
    if (!snapshot.exists)
      throw new NotFoundException('Notification introuvable');
    if ((snapshot.data() as Notification).userId !== firebaseUser.uid) {
      throw new ForbiddenException(
        'Vous ne pouvez pas modifier cette notification',
      );
    }
    const readAt = new Date();
    await reference.update({ readAt, updatedAt: readAt });
    return { id: notificationId, readAt: readAt.toISOString() };
  }

  async markAllRead(
    firebaseUser: DecodedIdToken,
  ): Promise<{ updated: number }> {
    const firestore = this.firebase.getFirestore();
    const snapshot = await firestore
      .collection('notifications')
      .where('userId', '==', firebaseUser.uid)
      .get();
    const unread = snapshot.docs.filter(
      (document) => !(document.data() as Notification).readAt,
    );
    const now = new Date();
    for (let offset = 0; offset < unread.length; offset += 450) {
      const batch = firestore.batch();
      for (const document of unread.slice(offset, offset + 450)) {
        batch.update(document.ref, { readAt: now, updatedAt: now });
      }
      await batch.commit();
    }
    return { updated: unread.length };
  }

  async registerDevice(
    firebaseUser: DecodedIdToken,
    request: RegisterNotificationDeviceRequest,
  ): Promise<{ deviceId: string; platform: NotificationPlatform }> {
    if (
      !request ||
      typeof request !== 'object' ||
      typeof request.deviceId !== 'string' ||
      !/^[A-Za-z0-9_-]{16,100}$/.test(request.deviceId) ||
      typeof request.token !== 'string' ||
      request.token.length < 20 ||
      request.token.length > 4096 ||
      (request.platform !== 'web' && request.platform !== 'mobile') ||
      (request.userAgent !== undefined &&
        (typeof request.userAgent !== 'string' ||
          request.userAgent.length > 500))
    ) {
      throw new BadRequestException('Notification device details are invalid');
    }
    const firestore = this.firebase.getFirestore();
    const now = new Date();
    const deviceRef = firestore
      .collection('notificationDevices')
      .doc(`${firebaseUser.uid}_${request.deviceId}`);

    const existingTokenDevices = await firestore
      .collection('notificationDevices')
      .where('token', '==', request.token)
      .get();
    const batch = firestore.batch();
    for (const document of existingTokenDevices.docs) {
      if (document.ref.path !== deviceRef.path) {
        batch.delete(document.ref);
      }
    }
    batch.set(
      deviceRef,
      {
        id: request.deviceId,
        userId: firebaseUser.uid,
        platform: request.platform,
        token: request.token,
        userAgent: request.userAgent ?? null,
        lastUsedAt: now,
        updatedAt: now,
        createdAt: now,
      },
      { merge: true },
    );
    await batch.commit();
    return { deviceId: request.deviceId, platform: request.platform };
  }

  async unregisterDevice(
    firebaseUser: DecodedIdToken,
    deviceId: string,
  ): Promise<{ removed: boolean }> {
    if (!/^[A-Za-z0-9_-]{16,100}$/.test(deviceId)) {
      throw new BadRequestException('deviceId is invalid');
    }
    const reference = this.firebase
      .getFirestore()
      .collection('notificationDevices')
      .doc(`${firebaseUser.uid}_${deviceId}`);
    const snapshot = await reference.get();
    if (!snapshot.exists) return { removed: false };
    if (snapshot.data()?.userId !== firebaseUser.uid) {
      throw new ForbiddenException(
        'Vous ne pouvez pas supprimer cet appareil de notification',
      );
    }
    await reference.delete();
    return { removed: true };
  }

  private async syncNovuDeviceTokens(
    userId: string,
    profile?: DecodedIdToken,
    excludedDocumentPath?: string,
  ): Promise<void> {
    const snapshot = await this.firebase
      .getFirestore()
      .collection('notificationDevices')
      .where('userId', '==', userId)
      .get();
    const tokens = [
      ...new Set(
        snapshot.docs
          .filter((document) => document.ref.path !== excludedDocumentPath)
          .filter((document) => document.data().pushProvider === 'novu')
          .map((document) => document.data().token)
          .filter((token): token is string => typeof token === 'string'),
      ),
    ];
    await this.novu.syncSubscriberDeviceTokens(userId, tokens, profile);
  }

  async publish(notification: PublishNotification): Promise<void> {
    // A notification must never be delivered to the user who caused it.
    // Keep this invariant in the shared publisher so every channel (in-app,
    // Firebase and Novu) receives the same recipient filtering.
    if (notification.senderUserId && notification.senderUserId === notification.userId) {
      this.logger.warn(`Skipping self-notification for user ${notification.userId}`);
      return;
    }

    const id = randomUUID();
    const now = new Date();
    const record: Notification = {
      id,
      userId: notification.userId,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      targetUrl: notification.targetUrl ?? null,
      ...(notification.data?.conversationId
        ? { conversationId: notification.data.conversationId }
        : {}),
      ...(notification.senderUserId
        ? { senderUserId: notification.senderUserId }
        : {}),
      readAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.firebase
      .getFirestore()
      .collection('notifications')
      .doc(id)
      .create(record);

    const devices = await this.firebase
      .getFirestore()
      .collection('notificationDevices')
      .where('userId', '==', notification.userId)
      .get();
    const deviceRecords = devices.docs.map((document) => document.data());
    const hasNovuDevice = deviceRecords.some(
      (device) =>
        device.pushProvider === 'novu' &&
        typeof device.token === 'string' &&
        device.token.length > 0,
    );
    if (hasNovuDevice) {
      try {
        await this.novu.triggerNotification(notification.userId, {
          notificationId: id,
          type: notification.type,
          title: notification.title,
          body: notification.body,
          targetUrl: notification.targetUrl ?? null,
          data: notification.data,
        });
      } catch (error) {
        this.logger.error(
          `Novu delivery failed for notification ${id}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }

    // Android Flutter devices must receive data-only FCM messages. If an FCM
    // "notification" block is present, Android displays it itself in background
    // and ignores the category icon selected by flutter_local_notifications.
    // Web keeps a notification payload; Novu remains responsible for its devices.
    const mobileTokens = [
      ...new Set(
        deviceRecords
          .filter((device) => device.pushProvider !== 'novu')
          .filter((device) => device.platform === 'mobile')
          .map((device) => device.token)
          .filter((token): token is string => typeof token === 'string'),
      ),
    ];
    const webTokens = [
      ...new Set(
        deviceRecords
          .filter((device) => device.pushProvider !== 'novu')
          .filter((device) => device.platform === 'web')
          .map((device) => device.token)
          .filter((token): token is string => typeof token === 'string'),
      ),
    ];
    const dataPayload = {
      notificationId: id,
      type: notification.type,
      targetUrl: notification.targetUrl ?? '/',
      // Compatibility alias consumed by existing web notification handlers.
      url: notification.targetUrl ?? '/',
      title: notification.title,
      body: notification.body.slice(0, 700),
      ...notification.data,
    };

    const sendChunks = async (
      deviceTokens: string[],
      buildMessage: (chunk: string[]) => MulticastMessage,
    ): Promise<void> => {
      for (let offset = 0; offset < deviceTokens.length; offset += 500) {
        const chunk = deviceTokens.slice(offset, offset + 500);
        try {
          const response: BatchResponse = await this.firebase
            .getMessaging()
            .sendEachForMulticast(buildMessage(chunk));
          await this.removeInvalidTokens(chunk, response.responses);
          if (response.failureCount > 0) {
            this.logger.warn(
              `FCM delivery failed for ${response.failureCount} device(s) on notification ${id}`,
            );
          }
        } catch (error) {
          this.logger.error(
            `FCM delivery failed for notification ${id}`,
            error instanceof Error ? error.stack : undefined,
          );
        }
      }
    };

    await sendChunks(mobileTokens, (chunk) => ({
      tokens: chunk,
      // Deliberately no "notification" property: Flutter handles all Android
      // categories in foreground, background and terminated app states.
      data: dataPayload,
      android: { priority: 'high' },
      // Preserve native iOS alert presentation for Flutter mobile devices.
      apns: {
        headers: { 'apns-priority': '10' },
        payload: {
          aps: {
            alert: {
              title: notification.title,
              body: notification.body.slice(0, 700),
            },
            sound: 'default',
          },
        },
      },
    }));

    await sendChunks(webTokens, (chunk) => ({
      tokens: chunk,
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: dataPayload,
      webpush: {
        notification: {
          title: notification.title,
          body: notification.body.slice(0, 700),
        },
      },
    }));
  }

  private async removeInvalidTokens(
    tokens: string[],
    responses: BatchResponse['responses'],
  ): Promise<void> {
    const firestore = this.firebase.getFirestore();
    const invalidTokens = new Set<string>();
    responses.forEach((response, index) => {
      if (
        !response.success &&
        (response.error?.code ===
          'messaging/registration-token-not-registered' ||
          response.error?.code === 'messaging/invalid-registration-token')
      ) {
        invalidTokens.add(tokens[index]);
      }
    });
    for (const token of invalidTokens) {
      const snapshot = await firestore
        .collection('notificationDevices')
        .where('token', '==', token)
        .get();
      const batch = firestore.batch();
      snapshot.docs.forEach((document) => batch.delete(document.ref));
      await batch.commit();
    }
  }

  private parsePositiveInteger(
    value: string | undefined,
    fallback: number,
    name: string,
    max: number,
  ): number {
    if (value === undefined || value === '') return fallback;
    if (!/^\d+$/.test(value)) {
      throw new BadRequestException(`${name} must be a positive integer`);
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
      throw new BadRequestException(`${name} must be between 1 and ${max}`);
    }
    return parsed;
  }

  async listForUserV2(
    firebaseUser: DecodedIdToken,
    pageValue?: string,
    pageSizeValue?: string,
  ): Promise<NotificationPage> {
    const page = this.parsePositiveInteger(pageValue, 1, 'page', 1_000_000);
    const pageSize = this.parsePositiveInteger(
      pageSizeValue,
      20,
      'pageSize',
      50,
    );
    const snapshot = await this.firebase
      .getFirestore()
      .collection('notifications')
      .where('userId', '==', firebaseUser.uid)
      .get();
    const notifications = snapshot.docs
      .map((document) => {
        const notification = document.data() as Notification;
        const createdAt = toDate(notification.createdAt);
        if (!createdAt) {
          this.logger.warn(
            `Notification ${document.id} has an invalid createdAt timestamp`,
          );
          return null;
        }
        return {
          id: document.id,
          type: notification.type,
          title: notification.title,
          body: notification.body,
          targetUrl: notification.targetUrl ?? null,
          readAt: toDate(notification.readAt)?.toISOString() ?? null,
          createdAt: createdAt.toISOString(),
        } satisfies NotificationItem;
      })
      .filter((item): item is NotificationItem => item !== null)
      .sort(
        (left, right) =>
          new Date(right.createdAt).getTime() -
          new Date(left.createdAt).getTime(),
      );
    const offset = (page - 1) * pageSize;
    return {
      items: notifications.slice(offset, offset + pageSize),
      page,
      pageSize,
      total: notifications.length,
      totalPages: Math.ceil(notifications.length / pageSize),
      unreadCount: notifications.filter((item) => !item.readAt).length,
    };
  }

  async markAllReadV2(
    firebaseUser: DecodedIdToken,
  ): Promise<{ updated: number }> {
    const firestore = this.firebase.getFirestore();
    const snapshot = await firestore
      .collection('notifications')
      .where('userId', '==', firebaseUser.uid)
      .get();
    const unread = snapshot.docs.filter(
      (document) => !(document.data() as Notification).readAt,
    );
    const now = new Date();
    for (let offset = 0; offset < unread.length; offset += 450) {
      const batch = firestore.batch();
      for (const document of unread.slice(offset, offset + 450)) {
        batch.update(document.ref, { readAt: now, updatedAt: now });
      }
      await batch.commit();
    }
    return { updated: unread.length };
  }

  async markReadV2(
    firebaseUser: DecodedIdToken,
    notificationId: string,
  ): Promise<{ id: string; readAt: string }> {
    const reference = this.firebase
      .getFirestore()
      .collection('notifications')
      .doc(notificationId);
    const snapshot = await reference.get();
    if (!snapshot.exists)
      throw new NotFoundException('Notification introuvable');
    if ((snapshot.data() as Notification).userId !== firebaseUser.uid) {
      throw new ForbiddenException(
        'Vous ne pouvez pas modifier cette notification',
      );
    }
    const readAt = new Date();
    await reference.update({ readAt, updatedAt: readAt });
    return { id: notificationId, readAt: readAt.toISOString() };
  }

  async registerDeviceV2(
    firebaseUser: DecodedIdToken,
    request: RegisterNotificationDeviceRequest,
  ): Promise<{
    deviceId: string;
    platform: NotificationPlatform;
    pushProvider: NotificationPushProvider;
  }> {
    const pushProvider = request?.pushProvider ?? 'firebase';
    if (
      !request ||
      typeof request !== 'object' ||
      typeof request.deviceId !== 'string' ||
      !/^[A-Za-z0-9_-]{16,100}$/.test(request.deviceId) ||
      typeof request.token !== 'string' ||
      request.token.length < 20 ||
      request.token.length > 4096 ||
      (request.platform !== 'web' && request.platform !== 'mobile') ||
      (pushProvider !== 'firebase' && pushProvider !== 'novu') ||
      (request.userAgent !== undefined &&
        (typeof request.userAgent !== 'string' ||
          request.userAgent.length > 500))
    ) {
      throw new BadRequestException('Notification device details are invalid');
    }

    const firestore = this.firebase.getFirestore();
    const now = new Date();
    const deviceRef = firestore
      .collection('notificationDevices')
      .doc(`${firebaseUser.uid}_${request.deviceId}`);
    const previousSnapshot = await deviceRef.get();
    const previousProvider = previousSnapshot.data()?.pushProvider;

    const existingTokenDevices = await firestore
      .collection('notificationDevices')
      .where('token', '==', request.token)
      .get();
    const affectedNovuUsers = new Set<string>();
    if (previousProvider === 'novu' && pushProvider !== 'novu') {
      affectedNovuUsers.add(firebaseUser.uid);
    }

    const batch = firestore.batch();
    for (const document of existingTokenDevices.docs) {
      if (document.ref.path !== deviceRef.path) {
        const existing = document.data();
        if (
          existing.pushProvider === 'novu' &&
          typeof existing.userId === 'string'
        ) {
          affectedNovuUsers.add(existing.userId);
        }
        batch.delete(document.ref);
      }
    }
    batch.set(
      deviceRef,
      {
        id: request.deviceId,
        userId: firebaseUser.uid,
        platform: request.platform,
        pushProvider,
        token: request.token,
        userAgent: request.userAgent ?? null,
        lastUsedAt: now,
        updatedAt: now,
        createdAt: now,
      },
      { merge: true },
    );
    await batch.commit();

    if (pushProvider === 'novu') {
      affectedNovuUsers.add(firebaseUser.uid);
    }
    for (const userId of affectedNovuUsers) {
      await this.syncNovuDeviceTokens(
        userId,
        userId === firebaseUser.uid ? firebaseUser : undefined,
      );
    }

    return { deviceId: request.deviceId, platform: request.platform, pushProvider };
  }

  async unregisterDeviceV2(
    firebaseUser: DecodedIdToken,
    deviceId: string,
  ): Promise<{ removed: boolean }> {
    if (!/^[A-Za-z0-9_-]{16,100}$/.test(deviceId)) {
      throw new BadRequestException('deviceId is invalid');
    }
    const reference = this.firebase
      .getFirestore()
      .collection('notificationDevices')
      .doc(`${firebaseUser.uid}_${deviceId}`);
    const snapshot = await reference.get();
    if (!snapshot.exists) return { removed: false };
    const device = snapshot.data();
    if (device?.userId !== firebaseUser.uid) {
      throw new ForbiddenException(
        'Vous ne pouvez pas supprimer cet appareil de notification',
      );
    }

    if (device.pushProvider === 'novu') {
      // Update Novu before deleting the Firestore record. If Novu is unavailable,
      // the caller can retry without leaving a stale token attached to the subscriber.
      await this.syncNovuDeviceTokens(firebaseUser.uid, undefined, reference.path);
    }
    await reference.delete();
    return { removed: true };
  }
}
