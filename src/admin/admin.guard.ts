import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedRequest } from '../auth/authenticated-request.interface';
import { FirebaseService } from '../firebase/firebase.service';
import { AccountRole, AccountStatus, type User } from '../interfaces/database';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly firebase: FirebaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & Partial<AuthenticatedRequest>>();
    if (!request.firebaseUser?.uid) {
      throw new UnauthorizedException('Authentication required');
    }

    const snapshot = await this.firebase
      .getFirestore()
      .collection('users')
      .doc(request.firebaseUser.uid)
      .get();
    if (!snapshot.exists) {
      throw new ForbiddenException('Administrator account required');
    }

    const user = snapshot.data() as User;
    if (
      user.role !== AccountRole.ADMIN ||
      user.status !== AccountStatus.ACTIVE
    ) {
      throw new ForbiddenException('Administrator account required');
    }
    return true;
  }
}
