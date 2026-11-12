<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Firebase Authentication

Authentication operations run through the NestJS API. The client sends
registration credentials (`firstName`, `lastName`, `phone`, `role`, `email`,
`password`, and optional doctor `specialty` / `registrationNumber`) to
`POST /auth/register`. NestJS creates the Firebase Authentication account,
sends an email-verification message, and stores the profile in
`users/{uid}` in Firestore. Passwords are never stored in Firestore.

`POST /auth/login` accepts `{ "email", "password" }`. A successful login
returns `{ "user", "idToken", "refreshToken", "expiresIn", "tokenType" }`.
Store the returned tokens securely on the client; JSON tokens are accessible
to JavaScript and therefore should not be stored in `localStorage` where
possible. Send the ID token to protected routes:

```http
Authorization: Bearer <id-token>
```

`POST /auth/refresh` accepts `{ "refreshToken" }` and returns a new token
pair. `POST /auth/logout` requires the ID token and revokes all refresh tokens
for that Firebase account. `POST /auth/reset-password` accepts `{ "email" }`
and sends a Firebase password-reset email without revealing whether the
account exists. `GET /auth/profile` returns the authenticated Firestore
profile as `{ "user": ..., "patient": ... }`. The patient object uses stored
patient details when available and safe defaults otherwise. Passwords and
refresh tokens are not stored in Firestore.

### Firebase credentials

NestJS loads environment variables from the ignored `.env` file. For local
development, set the three service-account values there:

```dotenv
FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-...@your-firebase-project-id.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_WEB_API_KEY=your-firebase-web-api-key
```

Get these values from your Firebase project's service-account settings. Keep
the private key secret and never commit it. Also set
`FIREBASE_WEB_API_KEY` from the Firebase project's web-app configuration;
it is required for server-side password sign-up, login, reset and refresh.
In Firebase Console, open **Authentication → Sign-in method** and enable
**Email/Password** for the same project. If registration returns
`CONFIGURATION_NOT_FOUND`, verify that Authentication is set up and that
`FIREBASE_WEB_API_KEY` and `FIREBASE_PROJECT_ID` both belong to that project.
The API also supports Google
Application Default Credentials, for example by setting
`GOOGLE_APPLICATION_CREDENTIALS` to the path of a service-account JSON file;
on Google Cloud, use the workload's attached service account instead. If only
some `FIREBASE_*` service-account values are set, startup fails with a
configuration error rather than passing incomplete credentials to Firebase.

### Administrator accounts

The first administrator must be provisioned once in Firebase Console because
public registration intentionally accepts only patient and doctor roles:

1. Create the account under **Authentication → Users** and verify its email.
2. Copy its Firebase UID and create `users/{uid}` in Firestore with the account
   fields used by the application, including `id: {uid}`, `role: "admin"`,
   `status: "active"`, `firstName`, `lastName`, `email`,
   `emailVerified: true`, `phone: null`, `phoneVerified: false`,
   `specialty: null`, `registrationNumber: null`, `lastLoginAt: null`,
   `createdAt`, and `updatedAt`.
3. Sign in through the application; the administrator dashboard is available
   at `/admin`.

An active administrator can then create additional administrator accounts
from the dashboard. These accounts are created as email-verified because they
are provisioned by an existing administrator; their initial credentials
should be delivered through a secure channel. The dashboard can list and
search patient and doctor accounts, change account status, change patient
email verification, and set a doctor's professional verification status.
Suspended and deleted accounts are disabled in Firebase Authentication,
existing refresh tokens are revoked, and protected API requests reject them.

### Supabase Storage for medical attachments

Create a **private** Storage bucket in Supabase (the local configuration uses
`images`) and set these backend-only environment variables:

```dotenv
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_STORAGE_BUCKET=images
```

The NestJS API uploads validated files using the service-role key and stores
the private Storage object URL and path with the medical need in Firestore.
Files are limited to five per request and 10 MB per file. Never expose the
service-role key in the Next.js environment or make the medical-files bucket
public; use authenticated, short-lived signed URLs when a client needs to
view an attachment.

### Patient medical needs

The authenticated patient routes are `GET /needs` (list), `POST /needs`
(create with multipart fields `data` and optional repeated `files`),
`GET /needs/:id` (details), `PATCH /needs/:id` (update title, specialty,
description and consultation mode), `PATCH /needs/:id/close`, and
`DELETE /needs/:id` (drafts only). All routes verify the Firebase ID token and
the request owner. Detail responses include short-lived signed URLs for that
patient's private attachments.

### Internal notifications and FCM push

The notification API stores user-owned history in `notifications` and separate
per-installation FCM subscriptions in `notificationDevices`. Authenticated
clients can page through notifications, mark one or all as read, register a
device, and remove only their own device. `deviceId` is installation-specific;
the same endpoints accept both `web` and `mobile`, so a later mobile client can
share the backend without sharing a browser token. A token registered to a new
account is detached from the previous account.

The API persists a notification before attempting FCM delivery. FCM failures
are logged without undoing a successfully completed business action, and
expired device tokens are removed. Proposal and appointment events currently
create internal notifications and push alerts. Messages can use the same
`NotificationsService.publish` event path when a real messaging endpoint is
added.

For web push, configure the Firebase Web App values and its **Cloud Messaging
VAPID key** in the Next.js environment (these are public client configuration,
not service-account credentials):

```dotenv
NEXT_PUBLIC_FIREBASE_API_KEY=your-web-api-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
NEXT_PUBLIC_FIREBASE_APP_ID=your-web-app-id
NEXT_PUBLIC_FIREBASE_VAPID_KEY=your-cloud-messaging-vapid-key
```

In Firebase Console, enable Cloud Messaging for the same project. Users enable
push explicitly from the notifications tab; browsers require HTTPS except
localhost. FCM tokens are never returned by notification list endpoints.

### Frontend CORS

The API permits `http://localhost:4000` by default for local frontend
development. Set `CORS_ORIGINS` to a comma-separated list of trusted frontend
origins in other environments, for example
`CORS_ORIGINS=https://app.example.com`. The API allows the `Authorization`
and `Content-Type` headers and credentials for browser requests.

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Observability

In production applications, observability is essential for understanding how your system behaves, detecting issues early, and maintaining reliable performance.

[NestJS Observe](https://observe.nestjs.com) automatically instruments your NestJS application, giving you deep visibility into your system with minimal setup:

- **Distributed tracing:** Follow requests across services and understand how they flow through your system.
- **Waterfall analysis:** Visualize request execution and identify slow operations, bottlenecks, and unexpected delays.
- **Performance analysis:** Analyze application performance in real time and quickly pinpoint areas that need optimization.
- **Metrics:** Track key application and infrastructure metrics to understand system health and performance trends.
- **Logging:** Centralize and correlate logs with traces and other telemetry to make debugging easier.
- **Error tracking:** Detect errors quickly and investigate their root causes with the surrounding context.
- **SLA monitoring:** Track service-level objectives and identify when your application is approaching or exceeding defined thresholds.
- **Alarms and alerts:** Set up alerts for critical errors, performance degradation, SLA violations, and other anomalies so your team can react quickly.

This project is already instrumented. To connect it, run this and approve the code it prints at [observe.nestjs.com/link](https://observe.nestjs.com/link) - signing up for free if you have no account:

```bash
$ npx @nestjs/observe link
```

It writes the app key and secret into `.env` and makes every `nest start` script (`start`, `start:dev`, `start:debug`) load it. In production, set `OBSERVE_APP_KEY` and `OBSERVE_APP_SECRET` in the environment instead.

Or do it by hand: create an application and an API key at [observe.nestjs.com](https://observe.nestjs.com), and set the pair as `OBSERVE_APP_KEY` and `OBSERVE_APP_SECRET` in the environment the app runs in.

The free plan needs no payment details and covers 300,000 events a month. You can also browse the [live demo](https://www.observe-demo.nestjs.com/dashboard) first - the whole dashboard over a busy service's data, with nothing to install.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Auto-instrument your application with [NestJS Observe](https://observe.nestjs.com). Distributed tracing, metrics, and logging made easy. Error tracking and performance monitoring for your NestJS applications.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
