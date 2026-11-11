import { Module } from '@nestjs/common';
import { FirebaseModule } from '../firebase/firebase.module';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { NeedsController } from './needs.controller';
import { NeedsService } from './needs.service';

@Module({
  imports: [FirebaseModule],
  controllers: [NeedsController],
  providers: [NeedsService, FirebaseAuthGuard],
})
export class NeedsModule {}
