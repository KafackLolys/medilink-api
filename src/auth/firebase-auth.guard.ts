import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AccountStatus, type User } from '../interfaces/database';
import { FirebaseService } from '../firebase/firebase.service';
import type { AuthenticatedRequest } from './authenticated-request.interface';

@Injectable()
export class FirebaseAuthGuard implements CanActivate {
  constructor(private readonly firebase: FirebaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & Partial<AuthenticatedRequest>>();
    const authorization = request.headers.authorization;

    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Jeton Firebase ID Bearer requis');
    }

    const idToken = authorization.slice('Bearer '.length).trim();
    if (!idToken) {
      throw new UnauthorizedException('Jeton Firebase ID Bearer requis');
    }

    try {
      request.firebaseUser = await this.firebase
        .getAuth()
        .verifyIdToken(idToken, true);
    } catch {
      throw new UnauthorizedException('Jeton Firebase ID invalide ou révoqué');
    }

    const userSnapshot = await this.firebase
      .getFirestore()
      .collection('users')
      .doc(request.firebaseUser.uid)
      .get();
    if (!userSnapshot.exists) {
      throw new UnauthorizedException('Compte d\'application introuvable');
    }

    const user = userSnapshot.data() as User;
    if (
      user.status === AccountStatus.SUSPENDED ||
      user.status === AccountStatus.DELETED
    ) {
      throw new ForbiddenException('Ce compte n\'est pas actif');
    }

    return true;
  }
}
