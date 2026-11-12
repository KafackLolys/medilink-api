import { ForbiddenException } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  const createNotification = jest.fn();
  const getNotification = jest.fn();
  const updateNotification = jest.fn();
  const sendEachForMulticast = jest.fn();
  const getDevices = jest.fn();
  let service: NotificationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    getDevices.mockResolvedValue({
      docs: [
        { data: () => ({ token: 'fcm-token-device-one' }) },
        { data: () => ({ token: 'fcm-token-device-two' }) },
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
    service = new NotificationsService({
      getFirestore: () => firestore,
      getMessaging: () => ({ sendEachForMulticast }),
    } as unknown as FirebaseService);
  });

  it('stores the internal notification and sends it to all registered devices', async () => {
    await service.publish({
      userId: 'patient-uid',
      type: 'proposal_received',
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
