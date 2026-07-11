# huncho-web

Landing page for **[Huncho](https://github.com/Hixly/huncho)** — a voice-native AI operator for Windows. Live at [huncho.tech](https://huncho.tech).

Premium porcelain + liquid-chrome design matching the app's in-product theme: blueprint micro-grid, HUD furniture, orbital-ring diamond core, and a pure-CSS scripted demo loop. No UI or animation libraries.

## Stack

- Next.js (App Router, TypeScript) — single static route + one API route
- Supabase — early-access waitlist storage (server-side only)
- Vitest — API validation tests

## Develop

```bash
npm install
npm run dev     # http://localhost:3000
npm test        # waitlist API tests
npm run build   # production build
```

## Environment

The waitlist API needs (in `.env.local` / Vercel project settings):

```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

Table schema: `supabase/waitlist.sql`.
