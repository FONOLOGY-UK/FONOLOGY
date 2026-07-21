import type { Review } from '../types';

/**
 * REAL Google Maps reviews for the business, quoted verbatim (supplied by
 * Tanoli). Names follow the site's first-name + last-initial style; `device`
 * is inferred from what each review describes, or a generic tag where the
 * review doesn't say.
 *
 * Wording is EXACT — including the odd typo in a couple of them. Quoting a
 * public review verbatim is the safe default; ask the client before tidying
 * any of it (logged in CONTENT-TODO.md).
 */
export const MOCK_REVIEWS: Review[] = [
  {
    id: 'rev-1',
    name: 'Emma D.',
    device: 'iPhone 13 screen',
    rating: 5,
    text: 'Took my wee boys iphone 13 in to this shop to get fixed this morning, the phone was smashed to pieces front and back, the battery had expanded pushing the screen out. The phone was in a right sorry state. Got a message a few hours later to say the phone was ready for collection much to my delight. When I picked it up it looked like a brand new phone! My wee boy is over the moon. Great service and very friendly staff, will definitely use this shop again!',
  },
  {
    id: 'rev-2',
    name: 'Dillon M.',
    device: 'Phone repair',
    rating: 5,
    text: 'Fixed my phone in 20 mins easy and fast service would recommend',
  },
  {
    id: 'rev-3',
    name: 'Nicole W.',
    device: 'iPad screen',
    rating: 5,
    text: 'Fixed my little ones smashed ipad in less than an hour for an affordable price, very happy and saved lots of tiny tears',
  },
  {
    id: 'rev-4',
    name: 'Sarah W.',
    device: 'MacBook repair',
    rating: 5,
    text: 'The best place! Really helped me when I was having problems with my MacBook - so quick and affordable and amazing communication. On top of that, the staff are so friendly and kind. Would recommend to everyone & anyone :)',
  },
  {
    id: 'rev-5',
    name: 'Hasnat R.',
    device: 'Screen replacement',
    rating: 5,
    text: 'Was quoted £50 to repair the screen on my phone which was much cheaper than others and the job was done in 30 mins! Zak and his team are a delight to deal with and would highly recommend them',
  },
  {
    id: 'rev-6',
    name: 'Steven C.',
    device: 'Charging port',
    rating: 5,
    text: 'Great service phone wasn’t charging go it fixed and back the the same day at a reasonable price and the guys couldn’t be more helpful',
  },
  {
    id: 'rev-7',
    name: 'Thomas B.',
    device: 'Screen + accessories',
    rating: 5,
    text: 'These guys replaced my smashed phone screen. A competitive price and they threw in a screen protector, a phone cover and a magnetic holder. First class friendly service and would definitely recommend.',
  },
  {
    id: 'rev-8',
    name: 'Manjit J.',
    device: 'Charging issue',
    rating: 5,
    text: 'Fastest and great service. Had some charging issues with my phone but it was ok within 10-15 minutes thanks Zak and team.',
  },
];
