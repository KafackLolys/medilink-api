import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
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
      throw new UnauthorizedException('Bearer Firebase ID token required');
    }

    const idToken = authorization.slice('Bearer '.length).trim();
    if (!idToken) {
      throw new UnauthorizedException('Bearer Firebase ID token required');
    }

    try {
      request.firebaseUser = await this.firebase
        .getAuth()
        .verifyIdToken(idToken, true);
    } catch {
      throw new UnauthorizedException('Invalid or revoked Firebase ID token');
    }

    return true;
  }
}
