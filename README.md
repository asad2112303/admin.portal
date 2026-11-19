# eShifa Admin Portal

Staff portal for managing callback requests submitted on the public eShifa
website. Deployed separately from that site, on its own domain.

```
Public website  →  POST /api/callback-requests
                →  CALL submit_callback_request()   as eshifa_web (insert only)
                →  MariaDB: callback_requests
                                    ↑
This portal     →  /login  →  signed session cookie
                →  SELECT … FROM callback_requests_secure      as eshifa_admin
                →  CALL set_callback_status()                  (row-level policies)
```

The two applications share **only the database**, and each connects as its own
account. No code, no deployment and no credentials in common.

## Why it is separate

The public site is anonymous, cached and crawled. This portal reads patient
names and phone numbers. Keeping them apart means a mistake in marketing copy
cannot expose patient data, the website's database account can only insert
(it cannot read a row), and this app can be firewalled or IP-restricted without
affecting the website.

## Setup

### 1. Database

MariaDB. The schema, the server security config (encryption at rest, required
TLS) and the account setup live with the public website, in `db/mariadb/`;
follow `db/mariadb/README.md` there. `setup.sh` creates this portal's account,
`eshifa_admin`, and prints nothing: store its password as you create it.

### 2. Environment

Copy `.env.example` to `.env.local`:

```bash
DATABASE_SOCKET_PATH=/run/mysqld/mysqld.sock   # or DATABASE_HOST for TCP + TLS
DATABASE_USER=eshifa_admin
DATABASE_PASSWORD=<ESHIFA_ADMIN_DB_PASSWORD from setup.sh>
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
npm test           # unit tests
```

### 4. Deploy

```bash
./scripts/push-env-to-vercel.sh
```

Only for while the portal is still on Vercel: it uploads the database and
sign-in variables and redeploys. On the Hetzner server the same variables go in
the server's environment file, and the portal connects over the Unix socket.

To check a deployment:

```bash
curl -s https://<your-admin-domain>/api/health?check=config
```

`"status":"ready"` means the login will work and the database answers both a
read and a status-change probe. Anything else names the missing variables and
gives a fixed category (`not_checked`, `schema_missing`, `unreachable`) — never
a value, host, account name or error text; the detail goes to the server log.

## Security

**Authorization is server-side.** Every `/api` handler and the `(protected)`
layout call `getAdminContext()` before touching data. `src/proxy.ts` (Next.js
16's name for middleware) only checks that a cookie is *present*, to redirect
signed-out visitors; a forged cookie passes it and is rejected immediately after.

**The session cookie is signed, HttpOnly and SameSite=Lax.** Its expiry is
inside the signed payload, not only the cookie's `maxAge`, so it cannot be
extended by editing the cookie.

**The password is an scrypt hash** (N=32768, r=8, p=1) compared in constant
time. A wrong email costs the same as a wrong password, so timing reveals
nothing, and the error message never distinguishes them.

**Failed logins are slowed, not locked out.** With a single shared account,
lockout would be a free denial of service against the whole portal.

**The database decides what the portal may see.** `eshifa_admin` has no
privilege on any table. It reads only through the `*_secure` views and changes
a status only through `set_callback_status()`, and both apply the row-level
policies in `access_policies` (deny by default; filters by status and age;
update is a separate permission). A request outside the policy answers 404,
exactly like one that does not exist. A status change and its timeline entry
are written in one transaction, so a change can never lack its audit record.
So there are two independent locks: the session check here, and the policy in
the database. A bug in this app cannot widen what the database will return.

**Nothing patient-related reaches the logs.** The MariaDB driver appends bound
values to error messages by default; the pool turns that off (`logParam:
false`) and log lines strip any SQL text as well.

**Nothing here is indexed** — `robots.txt` disallows everything and the layout
sets `noindex`.

## Trade-off

One shared login means no per-person audit trail, and revoking one person's
access changes the password for everyone. Worth revisiting beyond a couple of
users.
