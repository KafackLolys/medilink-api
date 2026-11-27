import { NovuService } from './novu.service';

describe('NovuService', () => {
  const originalEnv = {
    apiBaseUrl: process.env.NOVU_API_BASE_URL,
    secretKey: process.env.NOVU_SECRET_KEY,
    workflowId: process.env.NOVU_WORKFLOW_ID,
  };
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.NOVU_API_BASE_URL = 'https://notify.example.test/api';
    process.env.NOVU_SECRET_KEY = 'test-secret';
    process.env.NOVU_WORKFLOW_ID = 'medilink-workflow';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ acknowledged: true }),
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalEnv.apiBaseUrl === undefined) delete process.env.NOVU_API_BASE_URL;
    else process.env.NOVU_API_BASE_URL = originalEnv.apiBaseUrl;
    if (originalEnv.secretKey === undefined) delete process.env.NOVU_SECRET_KEY;
    else process.env.NOVU_SECRET_KEY = originalEnv.secretKey;
    if (originalEnv.workflowId === undefined) delete process.env.NOVU_WORKFLOW_ID;
    else process.env.NOVU_WORKFLOW_ID = originalEnv.workflowId;
  });

  it('triggers Flutter push as high-priority data-only FCM', async () => {
    const service = new NovuService();

    await service.triggerNotification('patient-uid', {
      notificationId: 'notification-123',
      type: 'appointment',
      title: 'Rendez-vous confirmé',
      body: 'Votre rendez-vous est confirmé.',
      targetUrl: '/patient/appointments',
      data: { appointmentId: 'appointment-123' },
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, request] = (global.fetch as jest.Mock).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(request.method).toBe('POST');
    expect(JSON.parse(String(request.body))).toEqual(
      expect.objectContaining({
        name: 'medilink-workflow',
        to: ['patient-uid'],
        payload: expect.objectContaining({
          notificationId: 'notification-123',
          type: 'appointment',
          title: 'Rendez-vous confirmé',
          body: 'Votre rendez-vous est confirmé.',
          appointmentId: 'appointment-123',
        }),
        overrides: {
          providers: {
            fcm: {
              type: 'data',
              android: { priority: 'high' },
            },
          },
          steps: {
            push-step_st_h4qGirKoNRjylvaW: {
              providers: {
                fcm: {
                  type: 'data',
                  android: { priority: 'high' },
                },
              },
            },
          },
        },
      }),
    );
  });
});
