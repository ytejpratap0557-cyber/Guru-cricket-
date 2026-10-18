# AI Cricket Guru

Mobile-first cricket coaching website (dark navy + green). Players can pick a batting/bowling video and camera angle, preview it locally, and view demo reports.

> **Status: early preview.** AI analysis is **not** implemented. Reports, scores and the AI Coach are clearly labeled demo content. Videos are previewed in the browser only: nothing is uploaded or stored.

## What is in this repo
| Path | Purpose |
|---|---|
| `index.html` | The whole site (React + TypeScript, compiled in the browser by Babel). Static: no build step. |
| `supabase/migrations/001_visits.sql` | Anonymous visit log (insert-only for visitors). |
| `supabase/migrations/002_admin_panel.sql` | `admins`, `features`, `reviews`, `site_settings` tables + Row Level Security. |
| `supabase/migrations/003_admin_list_users.sql` | Admin-only function to list registered users. |
| `supabase/make_admin.sql` | Grants admin to one existing Auth user. |

## Features
- Home, Upload (local validation, preview, consent), Dashboard, Demo Report, AI Coach (demo UI), About.
- Visit tracking only after the visitor accepts the privacy notice (page, referrer, language, screen width; no IP or name stored in the table).
- Admin panel at `/#admin`: manage features, reviews, announcement banner; view visits, registered users, and a read-only database viewer.

## Setup
1. **Database:** in Supabase SQL Editor run the three files in `supabase/migrations/` in order.
2. **Admin user:** Dashboard → Authentication → Users → Add user, then run `supabase/make_admin.sql` with your email.
3. **Config:** in `index.html` set `SUPABASE_URL` and `SUPABASE_KEY` (the *publishable* key only).
4. **Deploy:** upload this folder to Netlify, Vercel or GitHub Pages. Open the site, then `/#admin` to log in.

## Security notes
- Only the **publishable** key belongs in the browser. Never commit a `service_role` / secret key.
- Visitors can only insert visits and read active features, published reviews and the banner. All other access requires a logged-in admin, enforced by RLS.
- Add an admin read policy for any new table you want to see in the Database tab.

## Not built yet (needs backend)
Video upload to private storage, saved player accounts and history, real AI analysis, a real AI Coach.

## Roadmap
Split `index.html` into a Vite + React + TypeScript project, add Supabase Storage for videos, and an analysis service behind a secure server.
