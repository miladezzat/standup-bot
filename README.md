# Standup Bot

Modern Slack standup workflow that stores submissions in MongoDB, powers AI summaries, and serves dashboards for managers.

## Features
- `/standup` slash command with reminders, OOO handling, and AI-powered summaries/time estimates.
- Web dashboards for submissions, analytics, manager insights, exports, and historical thread views.
- Scheduled jobs for reminders, reports, metric calculations, and alerting.
- Optional integrations with OpenAI and Linear for richer insights.

## Requirements
- Node.js 18+
- npm 9+
- MongoDB instance (Atlas or self-hosted)
- A Slack app with Bot + App tokens (Socket Mode) and the appropriate scopes
- Clerk account for authentication (recommended) or explicit opt-in to public dashboards

## Environment Variables
Copy `.env.example` to `.env` and fill the values.

Key variables:

| Name | Required | Description |
| ---- | -------- | ----------- |
| `MONGODB_URI` | ✅ | MongoDB connection string |
| `SLACK_BOT_TOKEN` | ✅ | Slack bot token (xoxb-) |
| `SLACK_SIGNING_SECRET` | ✅ | Slack signing secret |
| `SLACK_APP_TOKEN` | ✅ | Slack app token (xapp-) for Socket Mode |
| `CHANNEL_ID` | ✅ | Default Slack channel where reminders are posted |
| `SLACK_TEAM_ID` | ✅ | Workspace/team id used when calculating metrics |
| `CLERK_PUBLISHABLE_KEY` | ✅ when auth enabled | Clerk publishable key |
| `CLERK_SECRET_KEY` | ✅ when auth enabled | Clerk secret key |
| `CLERK_SIGN_IN_URL` | optional | Override Clerk sign in URL |
| `ALLOW_PUBLIC_DASHBOARD` | optional | Set to `true` only if you explicitly want unauthenticated dashboards |
| `ENABLE_TEST_ROUTES` | optional | Set to `true` to expose `/trigger/*` endpoints in non-prod setups |
| `APP_TIMEZONE` | optional | Time zone for cron jobs & UI (default `Africa/Cairo`) |
| `OPENAI_API_KEY` | optional | Enables AI summaries, insights, and estimations |
| `LINEAR_API_KEY` | optional | Enables Linear issue lookups |
| `DAILY_*_CRON` vars | optional | Override cron expressions, see `.env.example` |

See `AUTHENTICATION_SETUP.md` for Clerk and auth guidance.

## Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a Slack app, enable Socket Mode, add the slash command `/standup`, and install it to your workspace.
3. Configure Clerk (recommended) and update the `.env` file with the issued keys. If you intentionally want public dashboards, set `ALLOW_PUBLIC_DASHBOARD=true`.
4. Provide MongoDB and other integration credentials in `.env`.
5. Build the TypeScript sources:
   ```bash
   npm run build
   ```
6. Start the bot:
   ```bash
   npm start
   ```

During development you can run:
```bash
npm run dev
```
which uses `nodemon` + `ts-node`.

## Scripts
- `npm run dev` – start the bot with live reload (development only)
- `npm run build` – compile TypeScript to `dist/`
- `npm run start` – run the compiled server from `dist/`
- `npm run lint` – type-check the project (`tsc --noEmit`)
- `npm test` – currently proxies to `npm run lint`

## Security Notes
- Dashboards are protected by Clerk unless you explicitly set `ALLOW_PUBLIC_DASHBOARD=true`.
- Test trigger routes are disabled by default; set `ENABLE_TEST_ROUTES=true` only in isolated environments.
- Sensitive files such as `.env`, `logs`, `dist`, and `node_modules` are already excluded via `.gitignore`.

## Additional docs
- [AUTHENTICATION_SETUP.md](AUTHENTICATION_SETUP.md) – Clerk configuration & fallback options
- [COMMANDS_REFERENCE.md](COMMANDS_REFERENCE.md) – Complete guide to all commands, routes, and actions
- [QUICK_REFERENCE.md](QUICK_REFERENCE.md) – One-page cheat sheet for quick lookup
- [ENHANCED_FEATURES.md](ENHANCED_FEATURES.md) – New AI-powered profile and analytics features
