# Standup Bot

Modern Slack standup workflow that stores submissions in MongoDB and serves beautiful dashboards for managers and teams.

## ✨ Features

### Core Standup
- 📝 `/standup` slash command with modal for structured submissions
- 🏖️ Out-of-office (OOO) tracking with optional time ranges
- ☕ Break tracking (lunch, coffee, appointments, etc.)
- 🔔 Automated reminders for non-submitters
- 💬 Summaries and time tracking of daily standups

### Web Dashboards
- 📊 **Submissions** - View all standup submissions with Today/Yesterday/All filters
- 📈 **Analytics** - Team performance charts and metrics visualization
- 🔀 **Workflow** - Visual task flow showing completed → planned tasks per user
- ☕ **Breaks** - Track team break patterns and daily totals
- 👤 **User Reports** - Individual member detailed view with performance trends
- 🎯 **Manager Dashboard** - Alerts, achievements, and team health overview
- 📜 **History** - Legacy thread-based standup view

### Team Insights
- 📈 Performance metrics, velocity charts, and consistency scores
- 🔔 Alerts for blockers, underperforming pages, and capacity risks
- 🧭 Manager dashboards surface badges, streaks, and actionable callouts

### Data Export
- Export standups, metrics, alerts, achievements to CSV
- Per-user comprehensive report exports

### Scheduled Jobs
- Morning standup reminders
- Hourly reminders for non-submitters
- Weekly and monthly performance reports
- Automatic metrics calculation
- Alert engine checks

## 🎮 Slash Commands

| Command | Description | Example |
| ------- | ----------- | ------- |
| `/standup` | Open standup submission modal | `/standup` |
| `/standup ooo [reason]` | Mark yourself as out of office | `/standup ooo doctor appointment` |
| `/standup break <duration> [for <reason>]` | Log a break | `/standup break 20mins for lunch` |

### Break Command Examples
```
/standup break 20mins for lunch     # 20 minute lunch break
/standup break 1hr doctor appointment   # 1 hour break
/standup break 15m coffee           # 15 minute coffee break
/standup break 30mins               # 30 minute break (no reason)
```

## 🌐 Web Routes

| Route | Description |
| ----- | ----------- |
| `/` | Submissions dashboard (default view: today) |
| `/submissions` | Same as above |
| `/submissions?range=today` | Today's submissions |
| `/submissions?range=yesterday` | Yesterday's submissions |
| `/submissions?range=all` | All submissions |
| `/workflow` | Visual task flow visualization |
| `/analytics` | Team analytics with charts |
| `/breaks` | Breaks tracking dashboard |
| `/manager` | Manager insights (alerts, achievements) |
| `/user/:userId` | Individual user report |
| `/history` | Legacy thread-based view |

### Export Routes
| Route | Description |
| ----- | ----------- |
| `/export/standups` | Export standups to CSV |
| `/export/metrics` | Export performance metrics to CSV |
| `/export/alerts` | Export alerts to CSV |
| `/export/achievements` | Export achievements to CSV |
| `/export/user/:userId` | Export user report to CSV |

## 📁 Project Structure

```
src/
├── config.ts              # Environment configuration
├── constants.ts           # App constants
├── index.ts               # Main entry point
├── helper.ts              # Utility helpers
├── config/
│   └── view-engine.ts     # Handlebars setup
├── db/
│   └── connection.ts      # MongoDB connection
├── jobs/                  # Scheduled cron jobs
│   ├── calculate-metrics.ts
│   ├── hourly-reminder-non-submitters.ts
│   ├── monthly-report.ts
│   ├── reminder-non-submitters.ts
│   ├── run-alert-checks.ts
│   ├── stand-up-huddle-follow-up.ts
│   ├── stand-up-reminder.ts
│   ├── start-week.ts
│   ├── end-week.ts
│   └── weekly-report.ts
├── middleware/
│   ├── clerk-auth.middleware.ts
│   └── security.middleware.ts
├── models/                # MongoDB schemas
│   ├── achievements.ts
│   ├── alerts.ts
│   ├── break.ts
│   ├── performanceMetrics.ts
│   ├── standupEntry.ts
│   ├── standupThread.ts
│   └── teamGoals.ts
├── service/               # Business logic
│   ├── achievement.service.ts
│   ├── performance-analysis.service.ts
│   ├── alert-engine.service.ts
│   ├── app-mention.service.ts
│   ├── break.service.ts
│   ├── breaks-dashboard.service.ts
│   ├── contribution-graph.service.ts
│   ├── daily-summary-view.service.ts
│   ├── export.service.ts
│   ├── linear.service.ts
│   ├── manager-dashboard.service.ts
│   ├── monthly-report.service.ts
│   ├── standup-history.service.ts
│   ├── standup-submission.service.ts
│   ├── submissions-dashboard.service.ts
│   ├── team-analytics-dashboard.service.ts
│   ├── team-members.service.ts
│   ├── thanks-message.service.ts
│   ├── user-report.service.ts
│   ├── weekly-report.service.ts
│   └── workflow.service.ts
├── singleton/             # App singletons
│   ├── express-app-singleton.ts
│   ├── slack-app-singleton.ts
│   └── slack-web-client-singleton.ts
├── utils/
│   └── logger.ts          # Winston logging
└── views/                 # Handlebars templates
    ├── layouts/
    ├── partials/
    ├── analytics.hbs
    ├── breaks.hbs
    ├── manager.hbs
    ├── submissions.hbs
    ├── user-report.hbs
    └── workflow.hbs
```

## 📊 Data Models

| Model | Description |
| ----- | ----------- |
| `StandupEntry` | Individual standup submissions with time tracking |
| `Break` | Break time tracking (lunch, coffee, etc.) |
| `PerformanceMetrics` | Aggregated weekly/monthly metrics |
| `Achievement` | Badges earned (streak, velocity, helper, etc.) |
| `Alert` | Smart alerts for managers (blocker, performance, etc.) |
| `TeamGoals` | Team goals and commitments |
| `StandupThread` | Legacy thread tracking |

## 🔧 Requirements
- Node.js 18+
- npm 9+
- MongoDB instance (Atlas or self-hosted)
- Slack app with Bot + App tokens (Socket Mode)
- Clerk account for authentication (recommended) or explicit opt-in to public dashboards

## ⚙️ Environment Variables

Copy `.env.example` to `.env` and configure:

### Required
| Name | Description |
| ---- | ----------- |
| `MONGODB_URI` | MongoDB connection string |
| `SLACK_BOT_TOKEN` | Slack bot token (xoxb-) |
| `SLACK_SIGNING_SECRET` | Slack signing secret |
| `SLACK_APP_TOKEN` | Slack app token (xapp-) for Socket Mode |
| `CHANNEL_ID` | Default Slack channel for reminders |

### Authentication (choose one)
| Name | Description |
| ---- | ----------- |
| `CLERK_PUBLISHABLE_KEY` | Clerk publishable key (pk_...) |
| `CLERK_SECRET_KEY` | Clerk secret key (sk_...) |
| `ALLOW_PUBLIC_DASHBOARD` | Set to `true` for public access (no auth) |

### Optional Integrations
| Name | Default | Description |
| ---- | ------- | ----------- |
| `LINEAR_API_KEY` | - | Enables Linear issue lookups |

### Configuration
| Name | Default | Description |
| ---- | ------- | ----------- |
| `APP_TIMEZONE` | `Africa/Cairo` | Timezone for cron jobs & UI |
| `SLACK_TEAM_ID` | `default` | Workspace ID for metrics |
| `API_RATE_LIMIT_MAX` | `100` | Max requests per 15min window |
| `MAX_BREAK_DURATION_MINUTES` | `480` | Max break duration (8 hours) |
| `BREAK_WARNING_THRESHOLD_MINUTES` | `120` | Warn when daily breaks exceed |
| `ENABLE_TEST_ROUTES` | `false` | Expose `/trigger/*` test endpoints |

## 🚀 Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Create Slack app:**
   - Enable Socket Mode
   - Add `/standup` slash command
   - Add bot scopes: `chat:write`, `commands`, `users:read`, `app_mentions:read`
   - Install to workspace

3. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```

4. **Build and start:**
   ```bash
   npm run build
   npm start
   ```

### Development
```bash
npm run dev    # Live reload with nodemon + ts-node
```

## 📜 Scripts

| Script | Description |
| ------ | ----------- |
| `npm run dev` | Development with live reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run production server |
| `npm run lint` | Type-check with `tsc --noEmit` |
| `npm test` | Run lint (alias) |

## 🔒 Security

- **Authentication:** Dashboards protected by Clerk unless `ALLOW_PUBLIC_DASHBOARD=true`
- **Rate Limiting:** API endpoints rate-limited (default 100 req/15min)
- **Security Headers:** Helmet.js for secure HTTP headers
- **Test Routes:** Disabled by default (`ENABLE_TEST_ROUTES=false`)

## 📚 Additional Documentation

- [COMMANDS_REFERENCE.md](COMMANDS_REFERENCE.md) – Complete command guide
- [QUICK_REFERENCE.md](QUICK_REFERENCE.md) – Quick lookup cheat sheet

## 🛠️ Tech Stack

- **Runtime:** Node.js + TypeScript
- **Slack:** @slack/bolt (Socket Mode)
- **Database:** MongoDB + Mongoose
- **Web Server:** Express.js
- **Templates:** Handlebars (express-handlebars)
- **Auth:** Clerk (optional)
- **Scheduling:** node-cron
- **Logging:** Winston

## 📄 License

ISC
