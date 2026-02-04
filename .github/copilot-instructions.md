# Standup Bot - AI Coding Instructions

## Architecture Overview

This is a **Slack standup bot** with TypeScript, Express, MongoDB (Mongoose), and Socket Mode. It collects daily standups via slash commands, provides web dashboards for managers and teams, and runs automated cron jobs for reminders and reports.

**Key Components:**
- **Slack Bot** ([src/singleton/slack-app-singleton.ts](src/singleton/slack-app-singleton.ts)) - Socket Mode app handling `/standup` commands, modals, and app mentions
- **Express Web Server** ([src/singleton/express-app-singleton.ts](src/singleton/express-app-singleton.ts)) - Serves Handlebars dashboards with optional Clerk authentication
- **MongoDB Models** ([src/models/](src/models/)) - Mongoose schemas for standups, breaks, metrics, alerts, achievements
- **Service Layer** ([src/service/](src/service/)) - Business logic separated from routes/handlers
- **Cron Jobs** ([src/jobs/](src/jobs/)) - Scheduled reminders, reports, metrics calculations
- **Singleton Pattern** - Slack and Express instances are singletons ([src/singleton/index.ts](src/singleton/index.ts))

## Critical Conventions

### Configuration & Environment
- All config comes from [src/config.ts](src/config.ts) (never read `process.env` directly elsewhere)
- Timezone is configurable via `APP_TIMEZONE` (default: `Africa/Cairo`) - always use `toZonedTime()` from `date-fns-tz`
- Authentication: **Clerk is optional**. If `CLERK_PUBLISHABLE_KEY`/`CLERK_SECRET_KEY` exist and valid (start with `pk_`/`sk_`, >20 chars), auth is enabled. Otherwise requires `ALLOW_PUBLIC_DASHBOARD=true`
- Check [src/index.ts](src/index.ts) lines 70-90 for authentication validation logic

### Date Handling Pattern
```typescript
import { format, toZonedTime } from 'date-fns-tz';
import { APP_TIMEZONE } from './config';

const today = format(toZonedTime(new Date(), APP_TIMEZONE), 'yyyy-MM-dd');
```
Always use this exact pattern - dates are stored as `YYYY-MM-DD` strings, not Date objects.

### Service Layer Structure
Services export request handlers that take `(req: Request, res: Response)` or business logic functions. Example:
```typescript
export const getSubmissionsDashboard = async (req: Request, res: Response) => {
  // Fetch data from MongoDB
  // Transform for Handlebars view
  res.render('submissions', { data });
};
```
Routes in [src/index.ts](src/index.ts) call services directly: `expressApp.get('/submissions', getSubmissionsDashboard)`

### Slack Bot Patterns
- All Slack handlers use Socket Mode (not HTTP)
- Command: `slackApp.command('/standup', handler)`
- Action: `slackApp.action('action_id', handler)` 
- View submission: `slackApp.view('callback_id', handler)`
- App mention: `slackApp.event('app_mention', handler)`
- Always `await ack()` first in handlers

### MongoDB Queries
- Use `StandupEntry.findOne({ slackUserId, date })` to check existing submissions
- Index on `slackUserId` and `date` (see [src/models/standupEntry.ts](src/models/standupEntry.ts))
- Performance metrics are pre-aggregated weekly/monthly ([src/models/performanceMetrics.ts](src/models/performanceMetrics.ts))

## Key Files Reference

| File | Purpose |
|------|---------|
| [src/index.ts](src/index.ts) | Main entry point - routes, middleware, job initialization |
| [src/config.ts](src/config.ts) | Single source of truth for all environment variables |
| [src/service/standup-submission.service.ts](src/service/standup-submission.service.ts) | Core standup logic: modal, slash command, OOO handling |
| [src/jobs/index.ts](src/jobs/index.ts) | Cron job orchestration - all jobs start here |
| [src/middleware/clerk-auth.middleware.ts](src/middleware/clerk-auth.middleware.ts) | Authentication guard (redirects to sign-in, not 401) |
| [src/helper.ts](src/helper.ts) | User info fetching, HTML formatting, Slack utilities |

## Adding New Features

### New Slack Command
1. Add handler in relevant service file (or create new service)
2. Register in [src/index.ts](src/index.ts): `slackApp.command('/name', handler)`
3. Always start with `await ack()`

### New Dashboard Route
1. Create service function in [src/service/](src/service/)
2. Create Handlebars template in [src/views/](src/views/)
3. Add route in [src/index.ts](src/index.ts): `expressApp.get('/path', checkAuth, serviceHandler)`
4. Authentication: Use `checkAuth` middleware (redirects unauthenticated users) unless route should be public

### New Cron Job
1. Create job file in [src/jobs/](src/jobs/)
2. Use `cron` package with timezone: `new CronJob('0 9 * * 1-5', handler, null, false, APP_TIMEZONE)`
3. Register in [src/jobs/index.ts](src/jobs/index.ts) `runJobs()` function
4. Job should be exported as `jobName.start()` for initialization

### New MongoDB Model
1. Create schema in [src/models/](src/models/)
2. Use Mongoose with TypeScript interface extending `Document`
3. Add compound indexes if querying multiple fields together
4. Export model with `export default mongoose.model<IModelName>('ModelName', schema)`

## Development Workflow

**Start dev server:** `npm run dev` (uses nodemon + ts-node)

**Build for production:** `npm run build` (compiles TS, copies Handlebars views to `dist/`)

**Lint:** `npm run lint` (TypeScript type checking without emitting)

**Test routes:** Set `ENABLE_TEST_ROUTES=true` to enable `/trigger/*` endpoints for manual job testing

## Common Patterns

**Fetching Slack user info:**
```typescript
import { getUserInfo } from './helper';
const user = await getUserInfo(slackUserId);
```

**Logging:** Use Winston logger from [src/utils/logger.ts](src/utils/logger.ts):
```typescript
import { logInfo, logError, logWarn } from './utils/logger';
logInfo('Message', { context: 'data' });
```

**Handlebars views:** Use layouts ([src/views/layouts/main.hbs](src/views/layouts/main.hbs)) and partials ([src/views/partials/](src/views/partials/))

**CSV Export pattern:** See [src/service/export.service.ts](src/service/export.service.ts) - streams data with headers, sets Content-Disposition

## Integration Points

- **Linear:** Optional integration ([src/service/linear.service.ts](src/service/linear.service.ts)) - checks `LINEAR_API_KEY` existence
- **Clerk:** Optional auth provider - check `hasClerk` variable in [src/index.ts](src/index.ts)
- **Slack Socket Mode:** All Slack events come through WebSocket, not webhooks

## Gotchas & Important Notes

- **Never instantiate new Slack/Express apps** - always import from [src/singleton/index.ts](src/singleton/index.ts)
- **Trust proxy is enabled** - required for Heroku/cloud deployments to detect HTTPS correctly
- **Helmet CSP** configured for Clerk domains - add new domains if integrating other services
- **Rate limiting** applied to all dashboard routes via [src/middleware/security.middleware.ts](src/middleware/security.middleware.ts)
- **Authentication redirects, doesn't 401** - web interface shows sign-in page, not error JSON
- **OOO command syntax:** `/standup ooo [date] [time-range] reason` - see [src/service/standup-submission.service.ts](src/service/standup-submission.service.ts) for parsing logic
- **Break command:** `/standup break 20mins for lunch` - parsed in [src/service/break.service.ts](src/service/break.service.ts)
