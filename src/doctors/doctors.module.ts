import { Module } from '@nestjs/common';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { FirebaseModule } from '../firebase/firebase.module';
import { DoctorsController } from './doctors.controller';
import { DoctorsService } from './doctors.service';

@Module({
  imports: [FirebaseModule],
  controllers: [DoctorsController],
  providers: [DoctorsService, FirebaseAuthGuard],
})
export class DoctorsModule {}
