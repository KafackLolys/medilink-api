import { Module } from '@nestjs/common';
import { FirebaseModule } from '../firebase/firebase.module';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { IntegrationController } from './integration.controller';
import { IntegrationService } from './integration.service';

@Module({
  imports: [FirebaseModule],
  controllers: [IntegrationController],
  providers: [IntegrationService, FirebaseAuthGuard],
})
export class IntegrationModule {}
