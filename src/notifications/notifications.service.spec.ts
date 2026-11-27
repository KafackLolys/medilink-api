import { NotificationType } from '../interfaces/database';
import { ForbiddenException } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { NotificationsService } from './notifications.service';
import { NovuService } from './novu.service';

describe('NotificationsService', () => {
  const createNotification = jest.fn();
  const getNotification = jest.fn();
  const updateNotification = jest.fn();
  const sendEachForMulticast = jest.fn();
  const getDevices = jest.fn();
  const syncNovuTokens = jest.fn();
  const triggerNovu = jest.fn();
  let service: NotificationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    syncNovuTokens.mockResolvedValue(undefined);
    triggerNovu.mockResolvedValue(undefined);
    getDevices.mockResolvedValue({
      docs: [
        { data: () => ({ token: 'fcm-token-device-one', platform: 'mobile' }) },
        { data: () => ({ token: 'fcm-token-device-two', platform: 'mobile' }) },
      ],
    });
    sendEachForMulticast.mockResolvedValue({
      failureCount: 0,
      successCount: 2,
      responses: [{ success: true }, { success: true }],
    });
    const firestore = {
      collection: (name: string) => {
        if (name === 'notifications') {
          return {
            doc: () => ({
              create: createNotification,
              get: getNotification,
              update: updateNotification,
            }),
            where: () => ({ get: jest.fn().mockResolvedValue({ docs: [] }) }),
          };
        }
        return {
          where: () => ({ get: getDevices }),
        };
      },
    };
    service = new NotificationsService(
      {
        getFirestore: () => firestore,
        getMessaging: () => ({ sendEachForMulticast }),
      } as unknown as FirebaseService,
      {
        syncSubscriberDeviceTokens: syncNovuTokens,
        triggerNotification: triggerNovu,
      } as unknown as NovuService,
    );
  });

  it('stores the internal notification and sends it to all registered devices', async () => {
    await service.publish({
      userId: 'patient-uid',
      type: NotificationType.PROPOSAL_RECEIVED,
      title: 'Nouvelle proposition',
      body: 'Un médecin a répondu à votre demande.',
      targetUrl: '/patient/demandes/need-123',
    });

    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'patient-uid',
        type: 'proposal_received',
        targetUrl: '/patient/demandes/need-123',
        readAt: null,
      }),
    );
    expect(sendEachForMulticast).toHaveBeenCalledWith(
      expect.objectContaining({
        tokens: ['fcm-token-device-one', 'fcm-token-device-two'],
      }),
    );
  });

  it('does not create or deliver a message notification to its sender', async () => {
    await service.publish({
      userId: 'patient-uid',
      senderUserId: 'patient-uid',
      type: NotificationType.NEW_MESSAGE,
      title: 'Nouveau message',
      body: 'Mon propre message',
      targetUrl: '/patient/messages',
    });

    expect(createNotification).not.toHaveBeenCalled();
    expect(getDevices).not.toHaveBeenCalled();
    expect(triggerNovu).not.toHaveBeenCalled();
    expect(sendEachForMulticast).not.toHaveBeenCalled();
  });

  it('routes Flutter devices through Novu while keeping direct FCM for other clients', async () => {
    getDevices.mockResolvedValue({
      docs: [
        {
          data: () => ({
            token: 'flutter-fcm-token',
            platform: 'mobile',
            pushProvider: 'novu',
          }),
        },
        {
          data: () => ({
            token: 'native-fcm-token',
            platform: 'mobile',
            pushProvider: 'firebase',
          }),
        },
      ],
    });

    await service.publish({
      userId: 'patient-uid',
      type: NotificationType.NEW_MESSAGE,
      title: 'Nouveau message',
      body: 'Vous avez reçu un message.',
      targetUrl: '/patient/messages',
      data: { conversationId: 'conversation-123' },
    });

    expect(triggerNovu).toHaveBeenCalledWith(
      'patient-uid',
      expect.objectContaining({
        type: 'new_message',
        title: 'Nouveau message',
        data: { conversationId: 'conversation-123' },
      }),
    );
    expect(sendEachForMulticast).toHaveBeenCalledWith(
      expect.objectContaining({ tokens: ['native-fcm-token'] }),
    );
    expect(sendEachForMulticast).not.toHaveBeenCalledWith(
      expect.objectContaining({ tokens: ['flutter-fcm-token'] }),
    );
  });


  it('sends one browser push with the local site icon and click destination', async () => {
    getDevices.mockResolvedValue({
      docs: [
        {
          data: () => ({
            token: 'web-fcm-token',
            platform: 'web',
            pushProvider: 'firebase',
          }),
        },
      ],
    });

    await service.publish({
      userId: 'patient-uid',
      type: NotificationType.NEW_MESSAGE,
      title: 'Nouveau message',
      body: 'Vous avez reçu un message.',
      targetUrl: '/patient/messages',
    });

    expect(sendEachForMulticast).toHaveBeenCalledWith(
      expect.objectContaining({
        tokens: ['web-fcm-token'],
        webpush: {
          notification: expect.objectContaining({
            icon: '/favicon.ico',
            badge: '/favicon.ico',
            tag: expect.any(String),
            renotify: false,
            data: { url: '/patient/messages' },
          }),
        },
      }),
    );
  });


  describe('inactive notification device retention', () => {
    it('removes devices older than 60 days and syncs only active Novu tokens', async () => {
      const now = new Date('2026-11-27T12:00:00.000Z');
      const staleRef = { path: 'notificationDevices/user_stale' };
      const activeRef = { path: 'notificationDevices/user_active' };
      const staleDoc = {
        ref: staleRef,
        data: () => ({
          pushProvider: 'novu',
          token: 'stale-fcm-token',
          lastUsedAt: new Date('2026-09-27T11:59:59.000Z'),
        }),
      };
      const activeDoc = {
        ref: activeRef,
        data: () => ({
          pushProvider: 'novu',
          token: 'active-fcm-token',
          lastUsedAt: new Date('2026-11-27T11:00:00.000Z'),
        }),
      };
      const batch = { delete: jest.fn(), commit: jest.fn().mockResolvedValue(undefined) };
      const firestore = {
        collection: () => ({
          where: () => ({ get: jest.fn().mockResolvedValue({ docs: [staleDoc, activeDoc] }) }),
        }),
        batch: () => batch,
      };
      const novuSync = jest.fn().mockResolvedValue(undefined);
      const cleanupService = new NotificationsService(
        { getFirestore: () => firestore } as unknown as FirebaseService,
        { syncSubscriberDeviceTokens: novuSync } as unknown as NovuService,
      );

      const removed = await cleanupService.cleanupInactiveDevicesForUser(
        'user',
        undefined,
        now,
      );

      expect(removed).toBe(1);
      expect(novuSync).toHaveBeenCalledWith('user', ['active-fcm-token'], undefined);
      expect(batch.delete).toHaveBeenCalledTimes(1);
      expect(batch.delete).toHaveBeenCalledWith(staleRef);
      expect(batch.commit).toHaveBeenCalledTimes(1);
    });

    it('keeps devices with missing, invalid, or exactly 60-day timestamps', async () => {
      const docs = [
        { ref: { path: 'missing' }, data: () => ({ pushProvider: 'novu', token: 'missing-token' }) },
        { ref: { path: 'invalid' }, data: () => ({ pushProvider: 'novu', token: 'invalid-token', lastUsedAt: 'not-a-date' }) },
        { ref: { path: 'boundary' }, data: () => ({ pushProvider: 'novu', token: 'boundary-token', lastUsedAt: new Date('2026-09-28T12:00:00.000Z') }) },
      ];
      const batch = { delete: jest.fn(), commit: jest.fn().mockResolvedValue(undefined) };
      const firestore = {
        collection: () => ({
          where: () => ({ get: jest.fn().mockResolvedValue({ docs }) }),
        }),
        batch: () => batch,
      };
      const novuSync = jest.fn().mockResolvedValue(undefined);
      const cleanupService = new NotificationsService(
        { getFirestore: () => firestore } as unknown as FirebaseService,
        { syncSubscriberDeviceTokens: novuSync } as unknown as NovuService,
      );

      const removed = await cleanupService.cleanupInactiveDevicesForUser(
        'user',
        undefined,
        new Date('2026-11-27T12:00:00.000Z'),
      );

      expect(removed).toBe(0);
      expect(batch.delete).not.toHaveBeenCalled();
      expect(novuSync).not.toHaveBeenCalled();
    });

    it('does not delete stale records when Novu synchronization fails', async () => {
      const staleRef = { path: 'notificationDevices/user_stale' };
      const docs = [{
        ref: staleRef,
        data: () => ({
          pushProvider: 'novu',
          token: 'stale-token',
          lastUsedAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      }];
      const batch = { delete: jest.fn(), commit: jest.fn().mockResolvedValue(undefined) };
      const firestore = {
        collection: () => ({
          where: () => ({ get: jest.fn().mockResolvedValue({ docs }) }),
        }),
        batch: () => batch,
      };
      const cleanupService = new NotificationsService(
        { getFirestore: () => firestore } as unknown as FirebaseService,
        {
          syncSubscriberDeviceTokens: jest.fn().mockRejectedValue(new Error('Novu offline')),
        } as unknown as NovuService,
      );

      await expect(
        cleanupService.cleanupInactiveDevicesForUser(
          'user',
          undefined,
          new Date('2026-11-27T12:00:00.000Z'),
        ),
      ).rejects.toThrow('Novu offline');
      expect(batch.delete).not.toHaveBeenCalled();
    });
  });

  it('does not allow a user to mark another user’s notification as read', async () => {
    getNotification.mockResolvedValue({
      exists: true,
      data: () => ({ userId: 'another-patient' }),
    });

    await expect(
      service.markRead({ uid: 'patient-uid' } as never, 'notification-1'),
    ).rejects.toThrow(ForbiddenException);
    expect(updateNotification).not.toHaveBeenCalled();
  });
});
