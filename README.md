# Subscription Tracker

Upload a bank statement CSV → AI cleans up the messy merchant names → automatically
detects recurring subscriptions → chat with your own spending data.

## How it works

1. **Upload** (`/api/upload`) — parses your CSV, and since every bank exports columns
   differently, asks Claude (haiku, cheap+fast) to figure out which column is the date,
   description, and amount. Transactions get stored raw.
2. **Analyze** (`/api/analyze`) — cleans up messy descriptions like `SP * SPOTIFY AB
   STOCKHOLM` into `Spotify`, and assigns a category, in batches of 25.
3. **Detect** (`/api/detect`) — groups transactions by merchant, checks interval regularity
   and amount consistency with plain math first. High-confidence matches get saved
   automatically. Medium-confidence ones get a second opinion from Claude (sonnet) to
   filter out things like "I buy coffee at the same place every week" from actual
   subscriptions.
4. **Chat** (`/api/chat`) — ask plain-English questions ("how much am I spending on
   streaming?"). The app computes the numbers server-side and hands Claude a clean
   summary table to answer from — no risky text-to-SQL against a live database.

## Setup

```bash
npm install
cp .env.example .env       # fill in DATABASE_URL and ANTHROPIC_API_KEY
npx prisma migrate dev --name init
npm run dev
```

Then open http://localhost:3000.

## Deploying (Vercel, same as your other projects)

1. Push to GitHub, import into Vercel.
2. Add `DATABASE_URL` and `ANTHROPIC_API_KEY` as environment variables in Vercel's
   project settings.
3. If using Vercel Postgres or Supabase, run `npx prisma migrate deploy` once against
   the production DB (or add it as a build step).

## Making it installable on your phone (PWA)

`public/manifest.json` is already wired up. You still need to:
- Drop `icon-192.png` and `icon-512.png` into `/public` (any square logo works).
- Optionally add a service worker if you want offline support — not included here
  since the app is fundamentally online-only (talks to your DB + the API), but the
  manifest alone is enough for "Add to Home Screen" to work on iOS/Android.

## Notes / things you'll probably want to tweak

- **Auth**: there's no login yet — everything is a single shared dataset. Before you
  put real financial data in a deployed instance, add NextAuth or similar so it's
  locked to you.
- **Currency**: amounts are just floats, no currency field — fine if you only bank in
  one currency, add a `currency` column otherwise.
- **Frequency tolerances** live in `lib/detection.ts` (`FREQUENCY_WINDOWS`) if
  detection feels too strict/loose.
- **Confidence thresholds** (auto-save vs. ask-AI vs. ignore) are in
  `app/api/detect/route.ts` — currently 0.65 and 0.35.
- **Dismissing false positives**: the `Subscription.dismissed` field exists in the
  schema but there's no UI button for it yet — quick add if you want it.
