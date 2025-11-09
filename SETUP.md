# Slack Standup Bot - Setup Guide

## Overview

This bot automates daily standup collection and reporting for your Slack workspace. Team members submit their standups through an interactive modal form, and the bot generates weekly reports.

## Features

✅ **Slash Command**: `/standup` opens an interactive form
✅ **Daily Reminders**: Automated reminders at 9 AM (configurable)
✅ **Non-Submitter Reminders**: Sends DMs to team members who haven't submitted
✅ **Weekly Reports**: Automatic weekly summary posted to your channel
✅ **Web Dashboard**: View all submissions at `http://localhost:3001/submissions`
✅ **Duplicate Prevention**: One standup per user per day (updates allowed)

## Prerequisites

- Node.js 16+ and npm
- MongoDB instance (local or remote)
- Slack workspace with admin access

## Step 1: Create Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click "Create New App" → "From scratch"
3. Name it "Standup Bot" and select your workspace

### Required Scopes (OAuth & Permissions)

Add these **Bot Token Scopes**:
- `chat:write` - Send messages
- `chat:write.public` - Post to channels without joining
- `commands` - Add slash commands
- `users:read` - Read user information
- `channels:read` - Read channel information
- `groups:read` - Read private channel information
- `conversations.history` - Read message history (for thread-based features)
- `im:write` - Send DMs to users

### Enable Socket Mode

1. Go to "Socket Mode" in the sidebar
2. Enable Socket Mode
3. Generate an app-level token with `connections:write` scope
4. Save the token (starts with `xapp-`)

### Add Slash Command

1. Go to "Slash Commands"
2. Create `/standup` command
3. Description: "Submit your daily standup"
4. Usage hint: ""
5. Click Save

### Enable Interactivity

1. Go to "Interactivity & Shortcuts"
2. Turn on Interactivity
3. No Request URL needed (Socket Mode handles this)

### Subscribe to Bot Events

1. Go to "Event Subscriptions"
2. Enable Events
3. Add these bot events:
   - `app_mention` - Bot mentions

### Install App to Workspace

1. Go to "Install App"
2. Click "Install to Workspace"
3. Authorize the app
4. Copy the "Bot User OAuth Token" (starts with `xoxb-`)

## Step 2: Environment Configuration

Create a `.env` file in the project root:

```bash
# Application
PORT=3001
NODE_ENV=development

# Slack Configuration
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_APP_TOKEN=xapp-your-app-token
CHANNEL_ID=C0123456789

# MongoDB
MONGODB_URI=mongodb://localhost:27017/slack-standup-bot

# Scheduling (Cron Expressions - Africa/Cairo timezone)
DAILY_REMINDER_CRON=0 9 * * 1-5
NON_SUBMITTER_REMINDER_CRON=30 10 * * 1-5
WEEKLY_REPORT_CRON=0 17 * * 5
```

### Finding Your Channel ID

1. Open Slack, right-click on the channel
2. Click "View channel details"
3. Scroll down to find the Channel ID
4. Copy it to your `.env` file

## Step 3: Install and Run

```bash
# Install dependencies
npm install

# Development mode (with hot reload)
npm run dev

# Build for production
npm run build

# Run production
npm start
```

## Step 4: Test

1. In any Slack channel or DM, type `/standup`
2. Fill out the modal form
3. Submit
4. Check the dashboard at `http://localhost:3001/submissions`

## Cron Schedule Reference

Format: `minute hour day month dayOfWeek`

Examples:
- `0 9 * * 1-5` = 9:00 AM Monday-Friday
- `30 10 * * 1-5` = 10:30 AM Monday-Friday
- `0 17 * * 5` = 5:00 PM Friday

Timezone: All jobs run in `Africa/Cairo` timezone (configurable in code)

## Web Endpoints

- `/` or `/submissions` - Modern submission-based dashboard
- `/history` - Legacy thread-based view
- `/health` - Health check

## Database Schema

### StandupEntry Collection
```typescript
{
  slackUserId: string       // Slack user ID
  slackUserName: string     // Display name
  date: string              // YYYY-MM-DD
  yesterday: string         // What did you do yesterday?
  today: string             // What will you do today?
  blockers: string          // Any blockers? (optional)
  source: string            // 'modal' | 'slash_command' | 'dm'
  workspaceId: string       // Slack workspace ID
  createdAt: Date
  updatedAt: Date
}
```

## Troubleshooting

### Bot doesn't respond to `/standup`
- Check Socket Mode is enabled
- Verify app is installed to workspace
- Check console for errors

### Reminders not being sent
- Verify MongoDB connection
- Check cron expressions in `.env`
- Look for job logs in console

### User not getting DM reminders
- Ensure bot has `im:write` scope
- User may need to allow DMs from apps in Slack settings

## Development

### Add a new scheduled job

1. Create file in `src/jobs/your-job.ts`
2. Export a CronJob
3. Import and start it in `src/jobs/index.ts`

### Modify the standup form

Edit `src/service/standup-submission.service.ts` → `openStandupModal` function

### Change dashboard styling

Edit HTML/CSS in `src/service/submissions-dashboard.service.ts`

## Production Deployment

### Recommended Services

- **Hosting**: Railway, Render, Heroku, DigitalOcean
- **Database**: MongoDB Atlas (free tier available)
- **Environment Variables**: Set in your hosting platform

### Environment Variables to Set

All variables from `.env` file must be configured in your hosting platform.

## Support

For issues, check the logs in your console. Most errors are related to:
1. Missing environment variables
2. Incorrect Slack permissions
3. MongoDB connection issues

