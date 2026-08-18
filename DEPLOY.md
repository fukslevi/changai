# Deploying changai

**Live:** https://changai-gilt.vercel.app
**Cron:** `GET /api/cron` with `Authorization: Bearer $CRON_SECRET` - verified 200.
Without the header it returns 401, which is the intended state.

The `changai-sosimple.vercel.app` alias sits behind Vercel's own deployment
protection and will bounce you to a Vercel login. Use the address above.

The app is a standard Next.js server app plus a scheduled route. It needs a Node
host, not static hosting: every useful thing it does - reading Gmail, calling
Claude, writing to Postgres - happens on the server.

## What is already prepared

- `vercel.json` - schedules `/api/cron` every two hours
- `app/api/cron/route.ts` - one agent cycle: read the mailbox, triage, answer or
  chase. Refuses to run without `CRON_SECRET`, because an open endpoint there
  can send mail to suppliers.
- `middleware.ts` excludes `/api` so the scheduler is not bounced to the login
  page. A redirect would look like a successful call while nothing ran.
- `.env.example` lists every variable by name.
- `.env` is gitignored and stays that way.

## Steps

1. `vercel login` - this needs a browser and can only be done by you.
2. `vercel link` in this directory.
3. Set the environment variables. Everything in `.env.example`, plus
   `CRON_SECRET`, which is new. Fastest path:

       vercel env pull .env.production   # confirms what is already there
       # then, for each name in .env.example:
       vercel env add NAME production

4. `vercel deploy --prod`.
5. Confirm the schedule works:

       curl -H "Authorization: Bearer $CRON_SECRET" https://<app>.vercel.app/api/cron

   It returns a JSON summary per project. A 401 means `CRON_SECRET` does not
   match; an HTML login page means the middleware matcher lost its `api`
   exclusion.

## Before it is public

The app is protected by a single shared password (`AUTH_PASSWORD`). That is
proportionate for an internal tool on an obscure URL, and it is the only thing
between the internet and a mailbox that can email your suppliers.

Rotate anything that has been pasted into a chat window or a terminal:

- the Neon database password (Neon console, then update both `DATABASE_URL` and
  `DIRECT_DATABASE_URL`)
- the Anthropic API key
- `AUTH_SECRET` - any long random string; changing it logs everyone out
- `AUTH_PASSWORD` - pick something that is not reused elsewhere

The Gmail refresh token is the most sensitive value here: it grants read and
send access to the sourcing mailbox and does not expire on its own. If it ever
leaks, revoke it at https://myaccount.google.com/permissions and run
`scripts/gmail-auth.ts` again.

## Who runs the schedule

Both of these are live, and neither depends on your machine:

- **GitHub Actions** - `github.com/fukslevi/changai`, every two hours. The
  secrets `APP_URL` and `CRON_SECRET` are set on the repository.
- **Vercel Cron** - once a day at 03:00 UTC, which is late morning in China.
  Daily is the Hobby plan's limit; the schedule in `vercel.json` is set to the
  one slot where sending is allowed.

Running both is harmless. A second call in the same window finds nothing to do,
because every step keys off what is already recorded rather than off a timer.

A workflow whose repository sees no commits for 60 days is disabled by GitHub
automatically. If replies stop arriving in the app, check that first.

`npm run watch` still exists for local work. It is the same three steps and it
does depend on your machine staying awake - fine for watching a run in progress,
wrong as the thing production relies on.

## Sending on a schedule

`/api/cron` only sends inside Chinese business hours - reading, classifying and
raising questions run on every call. The two-hourly schedule therefore produces
at most a handful of sends a day, spread out, which is what you want on cold
outreach.

To pause all outbound without redeploying, remove `CRON_SECRET` from the
environment. The route then refuses every call.
