import { Injectable } from '@nestjs/common';
import {
  type App,
  applicationDefault,
  cert,
  getApps,
  initializeApp,
} from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

@Injectable()
export class FirebaseService {
  private readonly db: Firestore;
  private readonly auth: Auth;
  private readonly app: App;

  constructor() {
    this.app =
      getApps()[0] ?? initializeApp({ credential: this.getCredential() });

    this.db = getFirestore(this.app);
    this.auth = getAuth(this.app);
  }

  private getCredential() {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    const hasPartialConfiguration = Boolean(
      projectId || clientEmail || privateKey,
    );

    if (hasPartialConfiguration && !(projectId && clientEmail && privateKey)) {
      throw new Error(
        'Firebase service account configuration is incomplete. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY, or configure Google Application Default Credentials.',
      );
    }

    if (projectId && clientEmail && privateKey) {
      return cert({ projectId, clientEmail, privateKey });
    }

    return applicationDefault();
  }

  getFirestore(): Firestore {
    return this.db;
  }

  getAuth(): Auth {
    return this.auth;
  }
}
