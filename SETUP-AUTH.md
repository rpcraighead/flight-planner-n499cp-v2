# Authentication Setup — Identity Platform

Sign-in for the flight planner: Google, Microsoft, or email/password with TOTP
two-factor. Access additionally requires redeeming a product key.

## How it fits together

```
browser ──sign in (Firebase modular SDK)──► Identity Platform
   │                                              │
   │  ID token                                    │
   ▼                                              │
/sessionLogin ──create_session_cookie()───────────┘
   │
   ▼  HttpOnly __session cookie
before_request gate ──► valid session? ──► TOTP if password user?
                                      ──► 'lic' custom claim? ──► app
```

Two independent conditions, both carried in the session cookie:

| Condition | Set by | Checked in |
|---|---|---|
| Valid, unrevoked session | `create_session_cookie()` | `auth.require_entitlement` |
| `lic` custom claim | `licensing.activate()` | `auth.require_entitlement` |
| TOTP second factor | client enrollment | `firebase.sign_in_second_factor` |

Entitlement is mirrored into a custom claim so the hot path never reads
Firestore. Firestore stays the source of truth; `revoke` clears the claim **and**
calls `revoke_refresh_tokens()`, which is what actually ends live sessions.

## 1. Enable the APIs

```bash
gcloud config set project cyberflight-web
gcloud services enable \
  identitytoolkit.googleapis.com \
  firestore.googleapis.com \
  secretmanager.googleapis.com
```

## 2. Turn on Identity Platform

Console → **Identity Platform** → *Enable*. Pricing is per monthly active user:
free to 50,000 MAU, then ~$0.0055/MAU. Well inside free tier at squadron scale.

Then add providers under **Identity Platform → Providers**:

- **Google** — auto-configures from the project's existing OAuth client. No work.
- **Email/Password** — enable, and turn on **Email verification**. Required: an
  account cannot enroll a second factor until its email is verified.
- **Microsoft** — see step 4.

Under **Identity Platform → Settings → Security**, add your domains to
**Authorized domains**: `flightplanner.rpc-cyberflight.com` and `localhost`.

## 3. Enable TOTP multi-factor

Console → **Identity Platform → MFA** → enable **TOTP**. Do *not* enable SMS —
it bills per message and TOTP does not.

Enrollment is enforced in `auth.require_entitlement` for password users only;
Google and Microsoft users are already covered by their provider's own 2FA.

## 4. Microsoft provider (optional, additive)

Microsoft requires an app registration — there is no way to offer "Sign in with
Microsoft" without one. It is free and needs no Azure subscription.

1. [Entra portal](https://entra.microsoft.com) → **App registrations** → *New*.
2. Supported account types: **Accounts in any organizational directory and
   personal Microsoft accounts**. Anything narrower locks out `@outlook.com`.
3. Redirect URI (type *Web*): `https://<project-id>.firebaseapp.com/__/auth/handler`
4. **Certificates & secrets** → new client secret. Copy the *Value*, not the ID.
5. Paste the Application (client) ID and secret into Identity Platform →
   Providers → **Microsoft**.
6. Add `microsoft.com` to `AUTH_PROVIDERS` (below). The button appears; no code
   change.

> Configure Microsoft as the **built-in Microsoft provider**, not as a generic
> OIDC provider. Generic OIDC bills on the enterprise tier — 50 free MAU then
> ~$0.015/MAU, roughly 3× for an identical user experience.

## 5. Firestore

Create the database in Native mode, same region as Cloud Run:

```bash
gcloud firestore databases create --location=us-west1
```

All access is server-side through the Admin SDK, which bypasses security rules.
No client ever touches Firestore, so lock it shut:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} { allow read, write: if false; }
  }
}
```

Collections created on first use: `license_keys` (doc id = SHA-256 of the key),
`users` (doc id = Firebase uid), `activations` (audit trail).

## 6. Environment

The web API key and auth domain are **not secrets** — they identify the project
and are meant to be public. Only the Microsoft client secret is sensitive, and
it lives in Identity Platform, not here.

```bash
AUTH_ENABLED=1
FIREBASE_API_KEY=<Web API key, from Identity Platform → Application setup>
FIREBASE_AUTH_DOMAIN=<project-id>.firebaseapp.com
GOOGLE_CLOUD_PROJECT=cyberflight-web
AUTH_PROVIDERS=google.com,password       # add microsoft.com after step 4
APP_URL=https://flightplanner.rpc-cyberflight.com
```

Deploy:

```bash
gcloud run deploy flight-planner --source . --region us-west1 \
  --set-env-vars AUTH_ENABLED=1,FIREBASE_API_KEY=...,FIREBASE_AUTH_DOMAIN=...,AUTH_PROVIDERS=google.com,password
```

The Cloud Run runtime service account needs **Firebase Authentication Admin**
(to set custom claims and revoke tokens) and **Cloud Datastore User**.

## 7. Local development

`AUTH_ENABLED` is unset by default, so the app runs exactly as before with no
Identity Platform behind it. To exercise auth locally:

```bash
gcloud auth application-default login
AUTH_ENABLED=1 FLASK_ENV=development FIREBASE_API_KEY=... \
  FIREBASE_AUTH_DOMAIN=... GOOGLE_CLOUD_PROJECT=cyberflight-web \
  ./.venv/bin/python -m flask run --host=0.0.0.0 --port=5001
```

`FLASK_ENV=development` drops the `Secure` flag on the session cookie so it works
over plain HTTP on localhost.

## 8. Issuing keys

```bash
./issue_key.py issue pilot@example.com --tier standard --expires 365 --send
./issue_key.py list
./issue_key.py revoke FP-XXXX-XXXX-XXXX-XXXX --reason "left the squadron"
```

Keys are 80-bit random values in Crockford base32 (no I/L/O/U, so they survive
being read aloud or retyped). Only the SHA-256 digest is stored — plain SHA-256
rather than bcrypt because there is no low-entropy secret to slow down, and a
digest makes lookup a single indexed `get()`.

`--send` needs `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` /
`SMTP_FROM`. Check SPF, DKIM and DMARC alignment on whatever relay you use, or
Gmail and Outlook will silently bin the mail. Without `--send` the key is printed
for you to deliver yourself.

Activation is a Firestore transaction, so two people racing a single-seat key
cannot both get in.

## Notes and gotchas

- **Keys are bound to the email they were issued to** (`email_locked: true`). If
  someone is emailed a key at one address but signs in with another, activation
  fails by design. Flip `email_locked` to `false` on that key document to allow
  it.
- **Email verification is mandatory** before a session cookie is minted. An
  unverified email would let anyone claim a key issued to someone else.
- **Custom claims lag by one token.** After activation the client must call
  `getIdToken(true)` and re-POST to `/sessionLogin`; `activate.html` does this.
- **Pin the SDK version.** Templates load Firebase 10.12.0 from gstatic. The QR
  helper on the enrollment page is a jsdelivr CDN dependency; if it fails to
  load the page falls back to manual secret entry.
- **`ProxyFix` is required on Cloud Run.** Without it Flask builds `http://`
  URLs behind the proxy and OAuth redirects break.
- Session cookies last 5 days (`auth.SESSION_DAYS`), configurable from 5 minutes
  to 14 days.
