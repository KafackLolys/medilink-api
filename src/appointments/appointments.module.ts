import { Module } from '@nestjs/common';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { FirebaseModule } from '../firebase/firebase.module';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [FirebaseModule, NotificationsModule],
  controllers: [AppointmentsController],
  providers: [AppointmentsService, FirebaseAuthGuard],
})
export class AppointmentsModule {}
