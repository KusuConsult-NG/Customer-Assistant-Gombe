/**
 * A shared location has to survive as numbers.
 *
 * This had no test, and the bug it guards against was in the code: when a
 * reporter shared their location, the handler formatted the coordinates into
 * the message text — `[Customer shared a location: lat 10.28, lng 11.17]` —
 * and stored nothing else. The numbers were there to read and impossible to
 * query. Everything a situation room does with a location is arithmetic:
 * placing a point on a map, matching an incident to the nearest polling unit,
 * telling whether two reports are the same event. None of that can be done
 * against a sentence, and the reporter only shares a pin once.
 *
 * So the text stays (a human reading the thread should see it) and the
 * coordinates are ALSO stored as floats on the message row.
 */
import { INestApplication } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { prisma } from '@ace/database';
import { createTestApp } from './support/create-test-app';
import { WhatsappService } from '../src/whatsapp/whatsapp.service';

describe('WhatsApp shared location', () => {
  let app: INestApplication;
  let service: WhatsappService;
  let orgId: string;
  let phoneNumberId: string;
  const CITIZEN = '2348031234567';
  let realFetch: typeof globalThis.fetch;

  jest.setTimeout(60000);

  // Gombe town, roughly: a plausible pin from a reporter in Gombe LGA.
  const LAT = 10.28969;
  const LNG = 11.16729;

  const inbound = (message: Record<string, any>) => ({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '2349000000000', phone_number_id: phoneNumberId },
              contacts: [{ profile: { name: 'Test Observer' }, wa_id: CITIZEN }],
              messages: [
                {
                  from: CITIZEN,
                  id: `wamid.in.${randomBytes(8).toString('hex')}`,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  ...message,
                },
              ],
            },
          },
        ],
      },
    ],
  });

  const deliver = (payload: any) => service.processIncomingWebhook(payload, `t-${randomBytes(3).toString('hex')}`);

  const lastMessage = () =>
    prisma.message.findFirst({
      where: { conversation: { organizationId: orgId }, sender: 'CUSTOMER' },
      orderBy: { sentAt: 'desc' },
      select: { content: true, latitude: true, longitude: true },
    });

  beforeAll(async () => {
    process.env.JWT_SECRET ??= 'test_jwt_secret_that_is_at_least_32_chars_long';
    process.env.JWT_REFRESH_SECRET ??= 'test_jwt_refresh_secret_at_least_32_chars';
    process.env.ENCRYPTION_KEY ??= randomBytes(32).toString('base64');
    realFetch = globalThis.fetch;
    // No real calls out; a reply failing must not fail the capture assertion.
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ messages: [{ id: `wamid.${randomBytes(4).toString('hex')}` }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as any;

    app = await createTestApp();
    service = app.get(WhatsappService);
    orgId = (
      await prisma.organization.create({
        data: { name: 'Location Test Agency', slug: `loc-${randomBytes(5).toString('hex')}`, industry: 'GOVERNMENT' },
      })
    ).id;
    phoneNumberId = `pn_${randomBytes(6).toString('hex')}`;
    await prisma.whatsAppConfig.create({
      data: {
        organizationId: orgId,
        phoneNumberId,
        displayPhoneNumber: '+2349000000000',
        whatsappBusinessId: 'waba-location-test',
        accessToken: `EAA${'t'.repeat(60)}`,
        webhookVerifyToken: `verify_${randomBytes(6).toString('hex')}`,
        isActive: true,
      },
    });
  });

  afterAll(async () => {
    globalThis.fetch = realFetch;
    if (orgId) await prisma.organization.delete({ where: { id: orgId } }).catch(() => {});
    await app?.close();
  });

  it('stores the coordinates as numbers, not only inside the message text', async () => {
    await deliver(inbound({ type: 'location', location: { latitude: LAT, longitude: LNG } }));
    const m = await lastMessage();
    expect(m).toBeTruthy();
    // The numbers, queryable.
    expect(m!.latitude).toBeCloseTo(LAT, 5);
    expect(m!.longitude).toBeCloseTo(LNG, 5);
  });

  it('still leaves a readable line in the thread for a human', async () => {
    await deliver(inbound({ type: 'location', location: { latitude: LAT, longitude: LNG, name: 'Pantami Ward' } }));
    const m = await lastMessage();
    expect(m!.content).toMatch(/shared a location/i);
    expect(m!.content).toMatch(/Pantami Ward/);
    // And the numbers are there too — the text is a convenience, not the record.
    expect(m!.latitude).toBeCloseTo(LAT, 5);
  });

  it('leaves the coordinates null for an ordinary text message', async () => {
    // Guards the other direction: a stray default would put every text report
    // at 0,0 — in the Gulf of Guinea — and a map would show a cluster there.
    await deliver(inbound({ type: 'text', text: { body: 'They are turning people away at my unit.' } }));
    const m = await lastMessage();
    expect(m!.latitude).toBeNull();
    expect(m!.longitude).toBeNull();
  });

  it('does not invent coordinates when the pin arrives malformed', async () => {
    // Meta has sent latitude as a string before now. `Number(undefined)` is
    // NaN and NaN written to a float column is a hard failure, so the handler
    // takes the value only when it is already a number.
    await deliver(inbound({ type: 'location', location: { latitude: 'not-a-number', longitude: null } }));
    const m = await lastMessage();
    expect(m!.latitude).toBeNull();
    expect(m!.longitude).toBeNull();
    // The report itself is still captured — a bad pin must not lose the report.
    expect(m!.content).toMatch(/shared a location/i);
  });
});
