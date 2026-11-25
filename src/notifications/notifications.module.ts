import { Module } from '@nestjs/common';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { FirebaseModule } from '../firebase/firebase.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NovuService } from './novu.service';

@Module({
  imports: [FirebaseModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NovuService, FirebaseAuthGuard],
  exports: [NotificationsService],
})
export class NotificationsModule {}
