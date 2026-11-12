import { Module } from '@nestjs/common';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { FirebaseModule } from '../firebase/firebase.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';

@Module({
  imports: [FirebaseModule, NotificationsModule],
  controllers: [MessagesController],
  providers: [MessagesService, FirebaseAuthGuard],
})
export class MessagesModule {}
