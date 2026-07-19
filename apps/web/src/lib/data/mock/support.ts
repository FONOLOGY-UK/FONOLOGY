import type { Booking, Order } from '../types';
import { DELIVERY_FEE, pounds } from '../types';

/** Artificial network latency so loading/skeleton states are genuinely exercised. */
export function latency(): Promise<void> {
  const ms = 150 + Math.random() * 250; // 150–400ms per the brief
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Sequential booking/order reference generator, e.g. "FNL-1042". */
let refCounter = 1041;
export function nextReference(): string {
  refCounter += 1;
  return `FNL-${refCounter}`;
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
      fulfilment: 'collect',
      address: null,
      subtotal: pounds(38),
      deliveryFee: pounds(0),
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
      fulfilment: 'deliver',
      address: '12 Fenwick Road, Leeds, LS8 2AA',
      subtotal: pounds(34),
      deliveryFee: DELIVERY_FEE,
      total: pounds(34) + DELIVERY_FEE,
      status: 'shipped',
      createdAt: '2026-07-16T15:42:00.000Z',
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
      date: '2026-07-18',
      slot: '11:00',
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
      email: '',
      date: '2026-07-18',
      slot: '14:00',
      notes: '',
      price: pounds(64),
      status: 'received',
      createdAt: '2026-07-18T09:20:00.000Z',
    },
  ] as Booking[],
};
