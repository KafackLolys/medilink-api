import type { Request } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';

export interface AuthenticatedRequest extends Request {
  firebaseUser: DecodedIdToken;
}
