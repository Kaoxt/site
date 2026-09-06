# The Kollection — Shared Nuvio Login + Admin Access

This package implements one Nuvio-backed Kollection session for:

- `https://kollection.tv/set-up-collection`
- `https://kollection.tv/admin-update-collection.html`

## What changed

### Continue with Nuvio

Set Up Collection now has a **Continue with Nuvio** button.

It uses Nuvio's device/TV login flow:

1. The Kollection starts a short-lived Nuvio device login request.
2. Nuvio opens at `nuvio.tv/link` (with automatic legacy fallback to `nuvio.tv/tv-login`).
3. The user approves The Kollection in Nuvio.
4. kollection.tv polls Nuvio for approval.
5. After approval, Cloudflare exchanges the one-time code for Nuvio tokens.
6. Cloudflare stores those tokens in an encrypted, `HttpOnly`, `Secure`, `SameSite=Lax` cookie.

If the browser already has a Nuvio website session, Nuvio can use that session on its own approval page. kollection.tv does not read Nuvio cookies directly.

### Set Up Collection automatic login

When Set Up Collection loads, it checks the Kollection session.

If a valid Nuvio-backed Kollection session already exists:

- the Sign in / Create account area is hidden;
- the Nuvio account shows as connected;
- profiles are loaded automatically;
- the user goes straight to profile selection in Step 2.

The existing email/password and Create account fallback remains available for users who do not use Continue with Nuvio.

If a user signs in using the email/password fallback, that successful Nuvio token response is also converted into the same shared Kollection session.

### Sign out

The Step 2 Nuvio account banner now includes **Sign out**.

This signs the browser out of **The Kollection session only**. It intentionally does not sign the user out of the Nuvio website/app.

### Admin page

The admin page uses the exact same Kollection Nuvio session.

A normal Nuvio user can be signed in to kollection.tv, but the runtime updater only unlocks when the verified account matches:

- `NUVIO_ADMIN_USER_ID`, or
- `NUVIO_ADMIN_EMAIL`

`NUVIO_ADMIN_USER_ID` takes priority if both are configured.

## Upload these files to Kaoxt/site

Upload/replace these exact paths:

- `set-up-collection.html`
- `set-up-collection/set-up-collection.js`
- `set-up-collection/styles.css`
- `nuvio-auth/nuvio-auth.js`
- `admin-update-collection.html`
- `admin/admin.css`
- `admin/admin.js`
- `functions/_lib/nuvio-session.js`
- `functions/api/auth/nuvio/start.js`
- `functions/api/auth/nuvio/poll.js`
- `functions/api/auth/nuvio-connect.js`
- `functions/api/auth/session.js`
- `functions/api/auth/token.js`
- `functions/api/auth/logout.js`
- `functions/api/admin/update-runtime.js`

The ZIP also includes `set-up-collection/config.js` as a reference. Your current file already uses `/runtime/...`, so it normally does not need to be replaced.

Do not remove your existing:

- `functions/api/manifest.js`
- `shared.css`
- `components.js`
- `nav.html`
- `footer.html`

## Cloudflare secrets

Add these to the Cloudflare project that deploys `kollection.tv`.

### Required for all shared Nuvio login sessions

`KOLLECTION_SESSION_SECRET`

Use a long random secret. A 64-character hexadecimal string is a good choice.

### Required for admin publishing

`GITHUB_TOKEN`

Use a fine-grained GitHub personal access token restricted to:

`Kaoxt/site`

Repository permission:

- Contents: Read and write

### Required to identify your admin Nuvio account

Use one of:

`NUVIO_ADMIN_EMAIL=your-nuvio-email@example.com`

or preferably:

`NUVIO_ADMIN_USER_ID=<your Nuvio user UUID>`

The user-ID value is preferred because it does not change if the account email changes.

## Optional Cloudflare variables

Defaults are already built in:

- `NUVIO_API_BASE=https://api.nuvio.tv`
- current Nuvio publishable client key
- `GITHUB_OWNER=Kaoxt`
- `GITHUB_REPO=site`
- `GITHUB_BRANCH=main`

## Cookie/session design

The Kollection session:

- lasts up to 8 hours;
- is encrypted with AES-GCM using `KOLLECTION_SESSION_SECRET`;
- is `HttpOnly`;
- is `Secure`;
- uses `SameSite=Lax`;
- contains the Nuvio access/refresh token response so Set Up Collection can restore the Nuvio API session;
- refreshes the Nuvio access token server-side when it is near expiry.

The browser only receives a Nuvio access token from `/api/auth/token` when Set Up Collection actually needs to call the Nuvio API.

## Important limitation

A website on `kollection.tv` cannot directly read the login cookies for `nuvio.tv`.

The improved behavior is instead:

- if a user is already logged in at Nuvio, **Continue with Nuvio** opens Nuvio's own approval page and can reuse that Nuvio session;
- after approval, the browser stays logged into kollection.tv for Set Up Collection and the admin page.


## Navigation profile display

This package also adds a site-wide Nuvio account display without changing `nav.html`.

Upload/replace these additional files:

- `components.js`
- `nuvio-auth/nav-account.js`
- `nuvio-auth/nav-account.css`

### Landscape / desktop

When signed in, the navigation shows the current Nuvio profile avatar and profile name in a compact pill. Selecting it opens a small account menu with:

- Current profile
- Nuvio account email
- Set Up Collection
- Sign out

When signed out, the same area shows **Sign in** and uses Continue with Nuvio.

### Mobile

The Nuvio account block appears inside the existing mobile menu immediately above the GitHub and Buy me a coffee links.

When signed in it shows:

- Current profile avatar
- Current profile name
- Nuvio account email
- Set Up Collection
- Sign out

When signed out it shows **Continue with Nuvio**.

### Which profile is shown?

Nuvio has multiple profiles, but the active profile is a client-side choice rather than a single globally active profile for the whole account.

The Kollection therefore remembers the profile selected in Set Up Collection for that Nuvio user in this browser. When the user changes the profile in Step 2, the navigation updates immediately.

### Avatar behavior

The navigation uses:

1. the profile's `avatar_url` when Nuvio returns one;
2. the standard Nuvio avatar catalog when the profile has `avatar_id`;
3. the profile color + first letter as a fallback.
