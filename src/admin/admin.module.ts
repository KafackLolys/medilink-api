import { Module } from '@nestjs/common';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { FirebaseModule } from '../firebase/firebase.module';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';

@Module({
  imports: [FirebaseModule],
  controllers: [AdminController],
  providers: [AdminService, FirebaseAuthGuard, AdminGuard],
})
export class AdminModule {}
