import type { Booking, Order, SellRequest } from '../types';
import { pounds } from '../types';

/** Artificial network latency so loading/skeleton states are genuinely exercised. */
export function latency(): Promise<void> {
  const ms = 150 + Math.random() * 250; // 150–400ms per the brief
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sequential booking/order reference generator, e.g. "FNL-1042".
 *
 * `prefix` mirrors `issue_reference(..., p_prefix)` in the real schema, where
 * every series draws from ONE sequence and differs only by prefix — so a
 * `REF-` and an `FNL-` can never collide on their number. Keeping the counter
 * shared here reproduces that; giving refunds their own counter would let the
 * mock issue REF-1042 and FNL-1042 in one session, which the database cannot.
 */
let refCounter = 1041;
export function nextReference(prefix = 'FNL'): string {
  refCounter += 1;
  return `${prefix}-${refCounter}`;
}

/**
 * In-memory store for records created during a session (bookings/orders),
 * seeded with a little history so the admin lists and /track have something to
 * show. Resets on reload — it is a mock, not a database.
 */
export const mockDb = {
  orders: [
    {
      id: 'ord-1001',
      reference: 'FNL-1001',
      lines: [
        {
          productId: 'aegis-15',
          name: 'Aegis Mag Case',
          sub: 'iPhone 15 / 15 Pro',
          slug: 'aegis-mag-case',
          kind: 'accessory',
          unitPrice: pounds(24),
          quantity: 1,
        },
        {
          productId: 'glasspro-2',
          name: 'Tempered Glass Pro',
          sub: 'Twin pack · fitted free',
          slug: 'tempered-glass-pro',
          kind: 'accessory',
          unitPrice: pounds(14),
          quantity: 1,
        },
      ],
      name: 'Rebecca Shaw',
      email: 'rebecca.shaw@example.co.uk',
      phone: '07700 900222',
      delivery: 'collect',
      address: null,
      postcode: null,
      subtotal: pounds(38),
      deliveryFee: pounds(0),
      discount: pounds(0),
      total: pounds(38),
      status: 'ready',
      createdAt: '2026-07-17T10:14:00.000Z',
    },
    {
      id: 'ord-1002',
      reference: 'FNL-1002',
      lines: [
        {
          productId: 'volt-65',
          name: 'Volt 65W GaN Charger',
          sub: 'USB-C · dual port',
          slug: 'volt-65w-gan-charger',
          kind: 'accessory',
          unitPrice: pounds(34),
          quantity: 1,
        },
      ],
      name: 'Tom Brennan',
      email: 'tom.brennan@example.co.uk',
      phone: '07700 900333',
      delivery: 'standard',
      address: '12 Fenwick Road, Leeds',
      postcode: 'LS8 2AA',
      subtotal: pounds(34),
      deliveryFee: pounds(3.95),
      discount: pounds(0),
      total: pounds(34) + pounds(3.95),
      status: 'shipped',
      createdAt: '2026-07-16T15:42:00.000Z',
    },
    {
      id: 'ord-1003',
      reference: 'FNL-1003',
      lines: [
        {
          productId: 'pulse-anc',
          name: 'Pulse ANC Earbuds',
          sub: 'Active noise cancelling',
          slug: 'pulse-anc-earbuds',
          kind: 'accessory',
          unitPrice: pounds(59),
          quantity: 1,
        },
        {
          productId: 'braid-c2',
          name: 'Braided USB-C Cable',
          sub: '2 metres · 100W',
          slug: 'braided-usb-c-cable',
          kind: 'accessory',
          unitPrice: pounds(12),
          quantity: 2,
        },
      ],
      name: 'Aisha Rahman',
      email: 'aisha.rahman@example.co.uk',
      phone: '07700 900444',
      delivery: 'next-day',
      address: '88 Wellington Street, Glasgow',
      postcode: 'G2 6HJ',
      subtotal: pounds(83),
      deliveryFee: pounds(6.95),
      discount: pounds(0),
      total: pounds(83) + pounds(6.95),
      status: 'paid',
      createdAt: '2026-07-21T08:12:00.000Z',
    },
    {
      id: 'ord-1004',
      reference: 'FNL-1004',
      lines: [
        {
          productId: 'arc-10k',
          name: 'Arc 10K Power Bank',
          sub: 'Magnetic · 10,000mAh',
          slug: 'arc-10k-power-bank',
          kind: 'accessory',
          unitPrice: pounds(39),
          quantity: 1,
        },
      ],
      name: 'Gary Whitfield',
      email: 'gary.w@example.co.uk',
      phone: '07700 900555',
      delivery: 'collect',
      address: null,
      postcode: null,
      subtotal: pounds(39),
      deliveryFee: pounds(0),
      discount: pounds(0),
      total: pounds(39),
      status: 'paid',
      createdAt: '2026-07-21T09:40:00.000Z',
    },
    {
      id: 'ord-1005',
      reference: 'FNL-1005',
      lines: [
        {
          productId: 'plate-4d-standard',
          name: '4D Standard Plate',
          sub: 'Road legal · made to order',
          slug: '4d-standard-plate',
          kind: 'plate',
          unitPrice: pounds(29),
          quantity: 2,
        },
      ],
      name: 'Liam Docherty',
      email: 'liam.docherty@example.co.uk',
      phone: '07700 900666',
      delivery: 'standard',
      address: '3 Rosemount Place, Aberdeen',
      postcode: 'AB25 2XA',
      subtotal: pounds(58),
      deliveryFee: pounds(3.95),
      discount: pounds(0),
      total: pounds(58) + pounds(3.95),
      status: 'pending',
      createdAt: '2026-07-21T11:05:00.000Z',
    },
    {
      id: 'ord-1006',
      reference: 'FNL-1006',
      lines: [
        {
          productId: 'watch-duo',
          name: 'Watch Duo Charger',
          sub: 'Phone + watch, one plug',
          slug: 'watch-duo-charger',
          kind: 'accessory',
          unitPrice: pounds(29),
          quantity: 1,
        },
      ],
      name: 'Priya Nair',
      email: 'priya.nair@example.co.uk',
      phone: '07700 900910',
      delivery: 'collect',
      address: null,
      postcode: null,
      subtotal: pounds(29),
      deliveryFee: pounds(0),
      discount: pounds(0),
      total: pounds(29),
      status: 'collected',
      createdAt: '2026-07-14T16:20:00.000Z',
    },
  ] as Order[],

  bookings: [
    {
      id: 'bkg-1001',
      reference: 'FNL-2001',
      deviceId: 'ip14',
      repairId: 'screen',
      tierId: 'oem',
      name: 'Chloe Adeyemi',
      phone: '07700 900321',
      email: 'chloe.a@example.co.uk',
      address: '18 Maple Grove, Sheffield',
      postcode: 'S7 1AA',
      preferredContact: 'email',
      notes: 'Back glass is fine, just the front.',
      price: pounds(121),
      status: 'in-progress',
      createdAt: '2026-07-18T08:05:00.000Z',
    },
    {
      id: 'bkg-1002',
      reference: 'FNL-2002',
      deviceId: 's23',
      repairId: 'battery',
      tierId: 'oem',
      name: 'Ade Kolawole',
      phone: '07700 900654',
      email: 'ade.k@example.co.uk',
      address: '4 Canal Street, Manchester',
      postcode: 'M1 3HE',
      preferredContact: 'phone',
      notes: '',
      price: pounds(64),
      status: 'received',
      createdAt: '2026-07-18T09:20:00.000Z',
    },
  ] as Booking[],

  sellRequests: [
    {
      id: 'sell-1001',
      reference: 'FNL-3001',
      deviceId: 'ip13',
      condition: {
        storage: '128GB',
        screen: 'good',
        body: 'good',
        powersOn: true,
        network: 'unlocked',
        accessories: ['Charger'],
      },
      deviceOther: null,
      name: 'Priya Nair',
      phone: '07700 900910',
      email: 'priya.nair@example.co.uk',
      preferredContact: 'email',
      notes: '',
      // A quoted request carries the figure a PERSON set, plus who set it and
      // when — the same three fields the server stamps from the session.
      quotedAmount: pounds(180),
      quotedBy: 'staff-1001',
      quotedAt: '2026-07-17T14:10:00.000Z',
      status: 'quoted',
      createdAt: '2026-07-17T13:02:00.000Z',
      updatedAt: '2026-07-17T14:10:00.000Z',
    },
    {
      id: 'sell-1002',
      reference: 'FNL-3002',
      deviceId: 's23',
      deviceOther: null,
      condition: {
        storage: '256GB',
        screen: 'cracked',
        body: 'worn',
        powersOn: true,
        network: 'unlocked',
        accessories: [],
      },
      name: 'Tomas Reid',
      phone: '07700 900377',
      email: 'tomas.reid@example.co.uk',
      preferredContact: 'phone',
      notes: 'Says the screen was replaced last year.',
      // Awaiting a quote — no figure at all, which is the point.
      quotedAmount: null,
      quotedBy: null,
      quotedAt: null,
      status: 'submitted',
      createdAt: '2026-07-19T10:41:00.000Z',
      updatedAt: '2026-07-19T10:41:00.000Z',
    },
  ] as SellRequest[],
};
