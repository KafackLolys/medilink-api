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
import type { Notification } from '../interfaces/database';
import { FirebaseService } from '../firebase/firebase.service';

export type NotificationPlatform = 'web' | 'mobile';

export interface RegisterNotificationDeviceRequest {
  deviceId: string;
  token: string;
  platform: NotificationPlatform;
  userAgent?: string;
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

  constructor(private readonly firebase: FirebaseService) {}

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
    if (!snapshot.exists) throw new NotFoundException('Notification not found');
    if ((snapshot.data() as Notification).userId !== firebaseUser.uid) {
      throw new ForbiddenException('You cannot modify this notification');
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
      throw new ForbiddenException('You cannot remove this notification device');
    }
    await reference.delete();
    return { removed: true };
  }

  async publish(notification: PublishNotification): Promise<void> {
    const id = randomUUID();
    const now = new Date();
    const record: Notification = {
      id,
      userId: notification.userId,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      targetUrl: notification.targetUrl ?? null,
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
    const tokens = [...new Set(
      devices.docs
        .map((document) => document.data().token)
        .filter((token): token is string => typeof token === 'string'),
    )];
    for (let offset = 0; offset < tokens.length; offset += 500) {
      const chunk = tokens.slice(offset, offset + 500);
      const message: MulticastMessage = {
        tokens: chunk,
        notification: {
          title: notification.title,
          body: notification.body,
        },
        data: {
          notificationId: id,
          type: notification.type,
          url: notification.targetUrl ?? '/',
        },
      };
      try {
        const response: BatchResponse =
          await this.firebase.getMessaging().sendEachForMulticast(message);
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
        (response.error?.code === 'messaging/registration-token-not-registered' ||
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
}
