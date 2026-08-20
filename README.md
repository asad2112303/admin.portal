# eShifa Admin Portal

Staff portal for managing callback requests submitted on the public eShifa
website. Deployed separately from that site, on its own domain.

```
Public website  →  POST /api/callback-requests
                →  submit_callback_request()      (the only public write path)
                →  Supabase: callback_requests
                                    ↑
This portal     →  /login  →  signed session cookie
                →  reads and updates with the secret key, server-side
```

The two applications share **only the database**. No code, no deployment, and
no credentials in common beyond the Supabase project itself.

## Why it is separate

The public site is anonymous, cached and crawled. This portal reads patient
names and phone numbers and holds the secret key that bypasses Row Level
Security. Keeping them apart means a mistake in marketing copy cannot expose
patient data, the secret key is never present in the public deployment at all,
and this app can be firewalled or IP-restricted without affecting the website.

## Setup

### 1. Database

The schema lives with the public website
(`supabase/migrations/0001_setup.sql`) and only needs running once, from
either repository.

### 2. Environment

Copy `.env.example` to `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your-key
SUPABASE_SECRET_KEY=sb_secret_your-key
```

### 3. Credentials

```bash
npm run set-admin-password
```

Prompts for the email and password, then writes `ADMIN_EMAIL`,
`ADMIN_PASSWORD_HASH` and `ADMIN_SESSION_SECRET`. You type the password at your
own terminal with the echo suppressed, and only its **scrypt hash** is stored,
so `.env.local` never contains a usable password. Re-run it to change the
password; it also rotates the session secret, which signs out any open session.

```bash
npm install
npm run dev        # http://localhost:22431
```

## Security

**Authorization is server-side.** Every `/api` handler and the `(protected)`
layout call `getAdminContext()` before touching data. Middleware only checks
that a cookie is *present* — it runs on the edge runtime and cannot verify an
HMAC — so a forged cookie passes middleware and is rejected immediately after.

**The session cookie is signed, HttpOnly and SameSite=Lax.** Its expiry is
inside the signed payload, not only the cookie's `maxAge`, so it cannot be
extended by editing the cookie.

**The password is an scrypt hash** (N=32768, r=8, p=1) compared in constant
time. A wrong email costs the same as a wrong password, so timing reveals
nothing, and the error message never distinguishes them.

**Failed logins are slowed, not locked out.** With a single shared account,
lockout would be a free denial of service against the whole portal.

**Row Level Security is on with no policies**, so nothing reachable with the
publishable key can read these tables. This portal reads with the secret key,
only after the session has been verified.

**Nothing here is indexed** — `robots.txt` disallows everything and the layout
sets `noindex`.

## Trade-off

One shared login means no per-person audit trail, and revoking one person's
access changes the password for everyone. Worth revisiting beyond a couple of
users.
