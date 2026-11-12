import { Module } from '@nestjs/common';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { FirebaseModule } from '../firebase/firebase.module';
import { PatientsController } from './patients.controller';
import { PatientsService } from './patients.service';

@Module({
  imports: [FirebaseModule],
  controllers: [PatientsController],
  providers: [PatientsService, FirebaseAuthGuard],
  exports: [PatientsService],
})
export class PatientsModule {}

