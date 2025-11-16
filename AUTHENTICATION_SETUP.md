# Authentication Setup

Dashboards expose sensitive team data, so authentication must be configured for every production deployment.

## Recommended: Clerk
1. Sign up for [Clerk](https://clerk.com) and create a new application.
2. Enable Email + Password or the identity providers you prefer.
3. Add your production domain to the Allowed Origins list.
4. Retrieve the **Publishable key** and **Secret key** from the Clerk dashboard.
5. Update your `.env` with:
   ```env
   CLERK_PUBLISHABLE_KEY=pk_...
   CLERK_SECRET_KEY=sk_...
   CLERK_SIGN_IN_URL=https://<your-app>.accounts.dev/sign-in
   ```
6. Deploy the bot; dashboard routes (`/`, `/submissions`, `/manager`, `/analytics`, `/history`, `/daily-summary`, `/export/*`) will automatically require Clerk auth.

## Development Overrides
- `ALLOW_PUBLIC_DASHBOARD=true` allows the app to start without Clerk. **Do not set this in production** – every dashboard becomes public.
- `ENABLE_TEST_ROUTES=true` exposes `/trigger/standup-reminder` and `/trigger/daily-summary`. Keep this off in production to prevent arbitrary message sends.

## Troubleshooting
- Missing Clerk keys now prevent the server from starting unless `ALLOW_PUBLIC_DASHBOARD=true`.
- Clerk cookies are cleared on `/auth/sign-out`; if you still see a session, clear browser cookies and try again.
- When using custom domains behind proxies (Heroku, Render, etc.), ensure `expressApp.set('trust proxy', 1);` remains so Clerk can detect HTTPS.
