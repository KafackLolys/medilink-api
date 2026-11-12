import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AccountRole } from '../interfaces/database';
import { FirebaseService } from '../firebase/firebase.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MessagesService } from './messages.service';

describe('MessagesService', () => {
  it('rejects empty message bodies', async () => {
    const service = new MessagesService(
      {} as FirebaseService,
      {} as NotificationsService,
    );

    await expect(
      service.sendMessage({ uid: 'patient-uid' } as never, 'conversation-id', '  '),
    ).rejects.toThrow(BadRequestException);
  });

  it('does not expose messaging to accounts with other roles', async () => {
    const firestore = {
      collection: () => ({
        doc: () => ({
          get: async () => ({
            exists: true,
            data: () => ({ role: AccountRole.ADMIN }),
          }),
        }),
      }),
    };
    const service = new MessagesService(
      { getFirestore: () => firestore } as unknown as FirebaseService,
      {} as NotificationsService,
    );

    await expect(
      service.listConversations({ uid: 'admin-uid' } as never),
    ).rejects.toThrow(ForbiddenException);
  });
});
