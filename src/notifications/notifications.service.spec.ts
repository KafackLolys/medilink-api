import { NotificationType } from '../interfaces/database';
import { ForbiddenException } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  const createNotification = jest.fn();
  const getNotification = jest.fn();
  const updateNotification = jest.fn();
  const sendEachForMulticast = jest.fn();
  const getDevices = jest.fn();
  const transactionGet = jest.fn().mockResolvedValue({ data: () => undefined });
  const transactionSet = jest.fn();
  let service: NotificationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    transactionGet.mockResolvedValue({ data: () => undefined });
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
      runTransaction: async (run: (transaction: {
        get: typeof transactionGet;
        set: typeof transactionSet;
      }) => Promise<unknown>) => run({ get: transactionGet, set: transactionSet }),
      collection: (name: string) => {
        if (name === 'notificationPushTestLimits') {
          return { doc: () => ({ id: 'cooldown-reference' }) };
        }
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
    service = new NotificationsService({
      getFirestore: () => firestore,
      getMessaging: () => ({ sendEachForMulticast }),
    } as unknown as FirebaseService);
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
        android: {
          priority: 'high',
          notification: {
            channelId: 'medilink-alerts-v2',
            sound: 'default',
          },
        },
      }),
    );
  });

  it('sends an authenticated push test with safe content to Android FCM tokens', async () => {
    const response = await service.testMobilePush({ uid: 'patient-uid' } as never);
    expect(response).toEqual({
      registeredDevices: 2,
      acceptedByFcm: 2,
      rejectedByFcm: 0,
    });
    expect(transactionSet).toHaveBeenCalledTimes(1);
    expect(sendEachForMulticast).toHaveBeenCalledWith(expect.objectContaining({
      tokens: ['fcm-token-device-one', 'fcm-token-device-two'],
      notification: expect.objectContaining({ title: 'MediLink · Test de notification' }),
      android: {
        priority: 'high',
        notification: { channelId: 'medilink-alerts-v2', sound: 'default' },
      },
      data: { type: 'system', test: 'true' },
    }));
  });

  it('throttles repeated push tests for one authenticated user', async () => {
    transactionGet.mockResolvedValue({
      data: () => ({ lastSentAt: new Date() }),
    });
    await expect(
      service.testMobilePush({ uid: 'patient-uid' } as never),
    ).rejects.toMatchObject({ status: 429 });
    expect(sendEachForMulticast).not.toHaveBeenCalled();
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
