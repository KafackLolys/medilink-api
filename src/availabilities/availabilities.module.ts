import { Module } from '@nestjs/common';
import { FirebaseModule } from '../firebase/firebase.module';
import { AvailabilitiesController } from './availabilities.controller';
import { AvailabilitiesService } from './availabilities.service';

@Module({
  imports: [FirebaseModule],
  controllers: [AvailabilitiesController],
  providers: [AvailabilitiesService],
})
export class AvailabilitiesModule {}
