import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { DecodedIdToken } from 'firebase-admin/auth';

export interface NovuNotificationEvent {
  notificationId: string;
  type: string;
  title: string;
  body: string;
  targetUrl: string | null;
  data?: Record<string, string>;
}

class NovuApiError extends Error {
  constructor(
    readonly statusCode: number,
    method: string,
    path: string,
  ) {
    super(`Novu API returned HTTP ${statusCode} for ${method} ${path}`);
    this.name = 'NovuApiError';
  }
}

@Injectable()
export class NovuService {
  private readonly logger = new Logger(NovuService.name);

  private get apiBaseUrl(): string {
    return (process.env.NOVU_API_BASE_URL ?? '').trim().replace(/\/+$/, '');
  }

  private get secretKey(): string {
    return (process.env.NOVU_SECRET_KEY ?? '').trim();
  }

  private get workflowId(): string {
    return (process.env.NOVU_WORKFLOW_ID ?? '').trim();
  }

  private get integrationIdentifier(): string {
    return (process.env.NOVU_FCM_INTEGRATION_IDENTIFIER ?? '').trim();
  }

  private assertConfigured(): void {
    if (!this.apiBaseUrl || !this.secretKey || !this.workflowId) {
      throw new ServiceUnavailableException(
        'Novu n’est pas configuré. Définissez NOVU_API_BASE_URL, NOVU_SECRET_KEY et NOVU_WORKFLOW_ID côté backend.',
      );
    }

    try {
      const url = new URL(this.apiBaseUrl);
      if (
        url.protocol !== 'https:' ||
        url.pathname !== '/' ||
        url.username ||
        url.password
      ) {
        throw new Error('Invalid Novu API URL');
      }
    } catch {
      throw new ServiceUnavailableException(
        'NOVU_API_BASE_URL doit être l’origine HTTPS de l’API Novu, sans suffixe /v1 ni URL du tableau de bord.',
      );
    }
  }

  private async request(
    path: string,
    method: 'GET' | 'POST' | 'PUT',
    body?: Record<string, unknown>,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${this.apiBaseUrl}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `ApiKey ${this.secretKey}`,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(12_000),
      });
    } catch (error) {
      this.logger.error(
        `Novu API request failed (${method} ${path})`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new ServiceUnavailableException('L’API Novu est injoignable.');
    }

    if (!response.ok) {
      throw new NovuApiError(response.status, method, path);
    }

    const raw = await response.text();
    if (!raw) return {};
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      throw new ServiceUnavailableException(
        'L’API Novu a renvoyé une réponse JSON invalide.',
      );
    }
  }

  private async ensureSubscriber(
    subscriberId: string,
    profile?: DecodedIdToken,
  ): Promise<void> {
    const subscriberPath = `/v1/subscribers/${encodeURIComponent(subscriberId)}`;
    try {
      await this.request(subscriberPath, 'GET');
      return;
    } catch (error) {
      if (!(error instanceof NovuApiError) || error.statusCode !== 404) {
        throw error;
      }
    }

    const claims = (profile ?? {}) as unknown as Record<string, unknown>;
    const fullName = typeof claims.name === 'string' ? claims.name.trim() : '';
    const firstName =
      typeof claims.given_name === 'string'
        ? claims.given_name
        : fullName.split(/\s+/)[0] ?? '';
    const lastName =
      typeof claims.family_name === 'string'
        ? claims.family_name
        : fullName.split(/\s+/).slice(1).join(' ');

    const subscriber: Record<string, unknown> = { subscriberId };
    if (typeof claims.email === 'string' && claims.email.trim()) {
      subscriber.email = claims.email.trim();
    }
    if (firstName) subscriber.firstName = firstName;
    if (lastName) subscriber.lastName = lastName;

    try {
      await this.request('/v1/subscribers', 'POST', subscriber);
    } catch (error) {
      // A concurrent registration may have created the subscriber first.
      if (!(error instanceof NovuApiError) || error.statusCode !== 409) {
        throw error;
      }
    }
  }

  async syncSubscriberDeviceTokens(
    subscriberId: string,
    deviceTokens: string[],
    profile?: DecodedIdToken,
  ): Promise<void> {
    this.assertConfigured();
    const uniqueTokens = [...new Set(deviceTokens.filter(Boolean))];

    try {
      if (uniqueTokens.length > 0) {
        await this.ensureSubscriber(subscriberId, profile);
      } else {
        // Do not create a subscriber merely because the last device logged out.
        try {
          await this.request(
            `/v1/subscribers/${encodeURIComponent(subscriberId)}`,
            'GET',
          );
        } catch (error) {
          if (error instanceof NovuApiError && error.statusCode === 404) return;
          throw error;
        }
      }

      await this.request(
        `/v1/subscribers/${encodeURIComponent(subscriberId)}/credentials`,
        'PUT',
        {
          providerId: 'fcm',
          ...(this.integrationIdentifier
            ? { integrationIdentifier: this.integrationIdentifier }
            : {}),
          credentials: { deviceTokens: uniqueTokens },
        },
      );
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      const status =
        error instanceof NovuApiError ? error.statusCode : undefined;
      this.logger.error(
        `Novu FCM credential synchronization failed (HTTP ${status ?? 'unknown'})`,
      );
      throw new ServiceUnavailableException(
        status === 401 || status === 403
          ? 'Novu refuse la clé API. Vérifiez la clé et son environnement.'
          : 'Impossible de synchroniser les appareils FCM avec Novu.',
      );
    }
  }

  async triggerNotification(
    subscriberId: string,
    notification: NovuNotificationEvent,
  ): Promise<void> {
    this.assertConfigured();
    try {
      await this.request('/v1/events/trigger', 'POST', {
        name: this.workflowId,
        to: [subscriberId],
        payload: {
          notificationId: notification.notificationId,
          type: notification.type,
          title: notification.title,
          body: notification.body,
          targetUrl: notification.targetUrl,
          ...notification.data,
        },
      });
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      const status =
        error instanceof NovuApiError ? error.statusCode : undefined;
      this.logger.error(
        `Novu notification trigger failed (HTTP ${status ?? 'unknown'})`,
      );
      throw new ServiceUnavailableException(
        status === 401 || status === 403
          ? 'Novu refuse la clé API. Vérifiez la clé et son environnement.'
          : 'Novu n’a pas accepté le déclenchement de la notification.',
      );
    }
  }
}
