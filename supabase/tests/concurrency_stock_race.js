#!/usr/bin/env node
// supabase/tests/concurrency_stock_race.js
//
// Proves the one invariant pgTAP structurally cannot touch: two staff
// selling the last unit of the same product at the same instant, from two
// genuinely separate connections. A single pgTAP file runs in one session,
// one transaction — there is no way to hold two open, uncommitted
// transactions racing each other inside it. This script is that proof,
// committed as a real file instead of the throwaway script it used to be,
// so the guarantee it checks (apply_stock_movement()'s `for update` lock in
// 0004_inventory.sql, which is what actually makes the second of two
// simultaneous sales of the last item fail instead of taking stock negative)
// can never quietly stop being exercised.
//
// What it does, precisely:
//   1. Ensures one well-known test product exists with exactly 1 unit of
//      stock (creating it, or topping it back up to 1, so this script is
//      safe to run any number of times).
//   2. Opens two independent pg connections, each starts its own
//      transaction, and both call stock_consume() for that one unit at
//      (as close as JS can arrange) the same instant.
//   3. Confirms exactly one succeeds and the other is refused with "Not
//      enough stock" — never both succeeding, and never the product's
//      stock_qty going negative.
//
// Run it from the same place as the pgTAP suite, with the same PG* env vars
// (PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE) already used for
// apply.js/run_tap.js — see supabase/tests/README.md for the full command
// and for why this one file is a .js script instead of a .sql file like
// everything else here.
//
// Exit code 0 means the race is still safe. Any other exit code means it
// isn't, or the script itself couldn't complete the proof — either way,
// treat that as the schema's most important guarantee having broken.

const { Client } = require('pg');

const PRODUCT_SLUG = 'concurrency-race-test-product';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureTestProduct(setup) {
  const existing = await setup.query(`select id, stock_qty from public.products where slug = $1`, [
    PRODUCT_SLUG,
  ]);

  let productId;
  if (existing.rows.length === 0) {
    const inserted = await setup.query(
      `insert into public.products (slug, name, category, price, cost_price, stock_qty)
       values ($1, 'Concurrency Race Test Product', 'cases', 1000, 400, 0)
       returning id`,
      [PRODUCT_SLUG],
    );
    productId = inserted.rows[0].id;
  } else {
    productId = existing.rows[0].id;
  }

  // Top up to exactly 1 unit, whatever it currently is. Normally this is 0
  // (the previous run's race consumed the one unit) — if it's already >= 1
  // (an interrupted previous run), consume the surplus back down first so
  // every run starts from a known, identical state.
  const current = await setup.query(`select stock_qty from public.products where id = $1`, [
    productId,
  ]);
  const qty = current.rows[0].stock_qty;

  if (qty < 1) {
    await setup.query(
      `select public.stock_receive($1, $2, 100, 'correction', null, null, null, $3)`,
      [productId, 1 - qty, 'concurrency_stock_race.js: topping stock back up to 1 before the race'],
    );
  } else if (qty > 1) {
    await setup.query(`select public.stock_consume($1, $2, 'correction', null, null, null, $3)`, [
      productId,
      qty - 1,
      'concurrency_stock_race.js: trimming stock back down to 1 before the race',
    ]);
  }

  return productId;
}

async function raceOnce(productId) {
  const clientA = new Client();
  const clientB = new Client();
  await clientA.connect();
  await clientB.connect();

  try {
    await clientA.query('begin');
    await clientB.query('begin');

    const consumeSql = `select public.stock_consume($1, 1, 'sale', 'concurrency_stock_race', null, null, null)`;

    // Two genuinely different ways this race can resolve safely, both of
    // which show up in practice, not just in theory:
    //
    //   1. Clean lock wait. One connection's INSERT trigger acquires
    //      apply_stock_movement()'s `for update` lock on the product row
    //      and returns; the other blocks inside its own trigger waiting for
    //      that lock, and stays blocked until the first transaction ends.
    //      Nothing unblocks it on its own — it needs an explicit commit or
    //      rollback on the other connection.
    //
    //   2. Deadlock. Before either trigger even runs, the INSERT itself
    //      takes a lighter "for key share" lock on the product row to
    //      check the foreign key — and if both connections' INSERTs land
    //      close enough together, both end up holding that shared lock and
    //      then both try to upgrade to `for update` at the same time. That
    //      is a genuine lock cycle: each is waiting on a lock the other
    //      already holds. Postgres's own deadlock detector (~1s later)
    //      breaks it by aborting one side outright with "deadlock
    //      detected" — no commit from this script involved at all.
    //
    // Either shape is a correct, safe outcome — exactly one connection
    // still sells the unit, the other is refused, stock never goes
    // negative. This loop handles both: it commits the winner itself the
    // moment case 1 is visible (rather than waiting out Postgres's own
    // ~1s deadlock timer for no reason), and just gets out of the way if
    // case 2 resolves both sides on its own first.
    let aState = 'pending';
    let bState = 'pending';
    const pA = clientA.query(consumeSql, [productId]);
    const pB = clientB.query(consumeSql, [productId]);
    pA.then(
      () => {
        aState = 'fulfilled';
      },
      () => {
        aState = 'rejected';
      },
    );
    pB.then(
      () => {
        bState = 'fulfilled';
      },
      () => {
        bState = 'rejected';
      },
    );
    // Marks both promises "handled" immediately so Node doesn't treat a
    // rejection that happens before the .then() above's microtask runs as
    // an unhandled rejection and crash the process. Doesn't consume the
    // result — pA/pB themselves are still read via Promise.allSettled below.
    pA.catch(() => {});
    pB.catch(() => {});

    const deadline = Date.now() + 5000;
    let releasedBy = null;
    while (Date.now() < deadline) {
      if (aState === 'fulfilled' && bState === 'pending') {
        await clientA.query('commit').catch(() => {});
        releasedBy = 'A';
        break;
      }
      if (bState === 'fulfilled' && aState === 'pending') {
        await clientB.query('commit').catch(() => {});
        releasedBy = 'B';
        break;
      }
      if (aState !== 'pending' && bState !== 'pending') {
        // Both already settled without any help from this script — the
        // deadlock path resolved it first.
        break;
      }
      await sleep(50);
    }

    const [resA, resB] = await Promise.allSettled([pA, pB]);

    if (
      resA.status === 'pending' ||
      resB.status === 'pending' ||
      aState === 'pending' ||
      bState === 'pending'
    ) {
      throw new Error(`Race never resolved within the deadline: aState=${aState} bState=${bState}`);
    }

    const fulfilled = resA.status === 'fulfilled' ? 'A' : resB.status === 'fulfilled' ? 'B' : null;
    const rejected = resA.status === 'rejected' ? 'A' : resB.status === 'rejected' ? 'B' : null;

    if (resA.status === resB.status) {
      throw new Error(
        resA.status === 'fulfilled'
          ? `Both connections succeeded in selling the same last unit — this is the exact bug ` +
              `apply_stock_movement()'s FOR UPDATE lock exists to prevent.`
          : `Both connections were refused — one of the two should have sold the unit. ` +
              `A: ${resA.reason}\nB: ${resB.reason}`,
      );
    }

    const loserReason = String(rejected === 'A' ? resA.reason : resB.reason);
    if (!/not enough stock|deadlock detected/i.test(loserReason)) {
      throw new Error(
        `The losing connection (${rejected}) was refused, but not for an expected reason ` +
          `("Not enough stock" or "deadlock detected"): ${loserReason}`,
      );
    }

    // Whichever connection fulfilled still has an open transaction unless
    // it was the one already committed inside the loop above — commit it
    // now if not. Whichever was rejected has an aborted transaction either
    // way (from the raised exception, or from the deadlock abort) and just
    // needs a rollback to clear it; rolling back a connection with no
    // active transaction is a harmless no-op, not an error.
    const winnerClient = fulfilled === 'A' ? clientA : clientB;
    const loserClient = rejected === 'A' ? clientA : clientB;
    if (releasedBy !== fulfilled) {
      await winnerClient.query('commit').catch(() => {});
    }
    await loserClient.query('rollback').catch(() => {});

    return { winnerLabel: fulfilled, loserLabel: rejected, loserReason };
  } finally {
    await clientA.end().catch(() => {});
    await clientB.end().catch(() => {});
  }
}

async function main() {
  const setup = new Client();
  await setup.connect();

  let productId;
  try {
    productId = await ensureTestProduct(setup);
  } finally {
    await setup.end();
  }

  const { winnerLabel, loserLabel, loserReason } = await raceOnce(productId);

  const verify = new Client();
  await verify.connect();
  let finalQty;
  try {
    const r = await verify.query(`select stock_qty from public.products where id = $1`, [
      productId,
    ]);
    finalQty = r.rows[0].stock_qty;
  } finally {
    await verify.end();
  }

  if (finalQty !== 0) {
    console.error(
      `FAIL: expected stock_qty = 0 after the race, got ${finalQty}. Stock went negative or the loser's rollback did not fully undo its attempt.`,
    );
    process.exit(1);
  }
  if (finalQty < 0) {
    console.error(
      `FAIL: stock_qty is negative (${finalQty}) — the exact bug this script exists to catch.`,
    );
    process.exit(1);
  }

  console.log(
    `OK: two simultaneous sales of the last unit raced safely. ` +
      `Connection ${winnerLabel} won and sold it; connection ${loserLabel} was cleanly refused ` +
      `(${JSON.stringify(loserReason)}); final stock_qty is 0, never negative.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error('FAIL:', err.message || err);
  process.exit(1);
});
