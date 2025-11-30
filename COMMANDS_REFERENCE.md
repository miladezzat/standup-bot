# 📚 Complete Commands & Actions Reference

Comprehensive guide to all available commands, actions, web routes, and automated features in the Standup Bot.

---

## 🤖 Slack Commands

### `/standup` - Submit Daily Standup
**Usage:** Type `/standup` in any Slack channel or DM

**What it does:**
- Opens an interactive modal to submit your daily standup
- Collects: Yesterday's work, Today's plans, Blockers, Notes
- Option to mark day off (partial or full day)
- Saves to MongoDB and triggers AI analysis

**Examples:**
```
/standup
```

**Notes:**
- Can be used from any channel or direct message
- Available 24/7, but reminders sent on workdays
- Supports OOO (Out of Office) scheduling

---

### `/standup ooo` - Mark Out of Office
**Usage:** Type `/standup ooo` followed by time window and/or reason

**What it does:**
- Quickly mark yourself as out of office without opening the modal
- Supports full day, partial day, or specific time windows
- Notifies team in channel and updates your status
- Tracks time off in your profile

**Examples:**

**Quick OOO Today:**
```
/standup ooo taking my kid to the doctor
/standup ooo sick day
/standup ooo lunch break
```

**Schedule Full Day Ahead:**
```
/standup ooo 2025-12-25 Christmas holiday
/standup ooo 2025-11-30 vacation
```

**Partial Day (Time Window):**
```
/standup ooo today 1pm-3pm home repair
/standup ooo today 12:00-12:30 eating lunch
/standup ooo 2025-11-20 13:00-15:00 dentist appointment
```

**What Happens:**
- 📢 Channel alert notifies your team
- ✈️ Dashboard shows OOO badge
- 💌 You receive DM confirmation
- 📊 Profile tracks all your days off
- 🔕 Reminders won't be sent during OOO period

**Notes:**
- Time format: `HH:MM` (24-hour) or `HHam/pm` (12-hour)
- Date format: `YYYY-MM-DD` or `today`
- Can be used for short breaks (eating, meetings, appointments)
- Alternative: Use `/standup` modal and check "Out of office today?"

---

## 🎯 Slack Interactive Actions

### `open_standup_modal` - Button Click Handler
**Triggered by:** Clicking "Submit Standup" button in reminder messages

**What it does:**
- Opens the standup submission modal
- Same functionality as `/standup` command
- Convenient one-click access from reminders

---

## 💬 Slack App Mentions (AI Assistant)

### Basic Syntax
```
@Standup [your question or command]
```

### Available Commands

#### **1. Availability & Status Checks**
```
@Standup where is @username?
@Standup is @username available?
@Standup @username's status
@Standup who is OOO today?
@Standup when is @username back?
```
**Shows:** Current availability, OOO status, upcoming time off

---

#### **2. Work & Activity Queries**
```
@Standup what is @username working on?
@Standup what is @username doing?
@Standup @username's current work
@Standup show me @username's tasks
```
**Shows:** Today's standup content, active Linear issues, current assignments

---

#### **3. Performance & Metrics**
```
@Standup how is @username performing?
@Standup @username's performance
@Standup @username stats
@Standup @username metrics
@Standup report on @username
```
**Shows:** Performance scores, velocity, consistency, team ranking

---

#### **4. Full Profile**
```
@Standup profile of @username
@Standup tell me about @username
@Standup everything about @username
@Standup detailed report on @username
@Standup @username's full profile
```
**Shows:** Complete profile with:
- Current status & availability
- Performance metrics (weekly/monthly)
- Current streak
- Recent achievements & badges
- Active alerts
- Today's standup
- Active Linear issues
- AI insights & risk factors

---

#### **5. Recent Activity & History**
```
@Standup what has @username been working on?
@Standup @username's recent activity
@Standup show me @username's progress
@Standup @username's history
```
**Shows:** Last 7-14 days of standup submissions and patterns

---

#### **6. Blockers & Issues**
```
@Standup what blockers did @username face?
@Standup @username's blockers
@Standup is @username blocked?
```
**Shows:** Recent blockers mentioned in standups

---

#### **7. Linear Integration**
```
@Standup status of SAK-123
@Standup check ticket ABC-456
@Standup what's the status of PROJ-789?
@Standup test linear
@Standup check linear
```
**Shows:** Linear issue details, status, assignee, priority

---

#### **8. Team Overview**
```
@Standup who's working today?
@Standup team status
@Standup who submitted today?
@Standup team overview
```
**Shows:** Overview of team availability and submissions

---

#### **9. Standup Thread Summaries**
```
@Standup standup
```
**(In a standup thread)** Generates summary of all submissions in that thread

---

#### **10. Help & Information**
```
@Standup help
@Standup what can you do?
@Standup commands
```
**Shows:** Interactive help menu with all capabilities

---

## 🌐 Web Dashboard Routes

All dashboard routes require authentication (unless `ALLOW_PUBLIC_DASHBOARD=true`)

### Public Routes (No Auth Required)

#### `GET /health`
**Purpose:** Health check endpoint  
**Response:** `{ status: 'OK', timestamp: '...' }`  
**Usage:** Monitoring, uptime checks

---

### Authentication Routes

#### `GET /auth/sign-in`
**Purpose:** Redirect to Clerk sign-in page  
**Returns:** Clerk hosted authentication page

#### `GET /auth/sign-out`
**Purpose:** Sign out current user  
**Action:** Clears session cookies, redirects to home

---

### Dashboard Pages (Require Auth)

#### `GET /` or `GET /submissions`
**Page:** Submissions Dashboard  
**Shows:**
- All standup submissions for today
- Quick filters by status (submitted, pending, OOO)
- Recent submissions with content
- Team activity overview

---

#### `GET /user/:userId`
**Page:** Individual User Report  
**Shows:**
- User's complete standup history
- Performance trends over time
- Submission consistency
- Work patterns and velocity
- Blocker analysis

**Example:** `/user/U123456789`

---

#### `GET /daily-summary`
**Page:** AI-Powered Daily Summary  
**Shows:**
- AI-generated summary of day's standups
- Key highlights and themes
- Team-wide progress
- Notable blockers or risks
- Sentiment analysis

---

#### `GET /history`
**Page:** Historical Thread View  
**Shows:**
- Legacy standup threads by date
- Thread-based conversation history
- Original Slack message format

---

#### `GET /manager`
**Page:** Manager Insights Dashboard  
**Shows:**
- Team health score
- Individual performance metrics
- Active alerts and risks
- Top performers
- At-risk team members
- Blocker frequency analysis
- Velocity trends

---

#### `GET /analytics`
**Page:** Team Analytics Dashboard  
**Shows:**
- Interactive charts and graphs
- Submission trends over time
- Performance distribution
- Consistency metrics
- Team velocity comparisons
- Achievement statistics

---

### Export Routes (CSV Download)

#### `GET /export/standups`
**Format:** CSV  
**Contains:** All standup submissions with dates, users, content

---

#### `GET /export/metrics`
**Format:** CSV  
**Contains:** Performance metrics for all users (weekly/monthly)

---

#### `GET /export/alerts`
**Format:** CSV  
**Contains:** All alerts with severity, status, affected users

---

#### `GET /export/achievements`
**Format:** CSV  
**Contains:** All earned achievements and badges

---

#### `GET /export/user/:userId`
**Format:** CSV  
**Contains:** Comprehensive report for specific user  
**Example:** `/export/user/U123456789`

---

## 🧪 Test/Trigger Endpoints

**⚠️ Only available when `ENABLE_TEST_ROUTES=true`**

#### `GET /trigger/standup-reminder`
**Purpose:** Manually trigger standup reminder  
**Action:** Sends reminder message to configured channel  
**Usage:** Testing, manual reminders

---

#### `GET /trigger/daily-summary?date=YYYY-MM-DD`
**Purpose:** Manually generate daily summary  
**Action:** Creates and posts AI summary for specified date  
**Parameters:**
- `date` (optional): YYYY-MM-DD format, defaults to today  
**Usage:** Testing, backfilling summaries

**Example:** `/trigger/daily-summary?date=2025-11-15`

---

## ⏰ Automated Scheduled Jobs

These run automatically via cron schedules (configurable in `.env`)

### Daily Jobs

#### 1. **Standup Reminder**
**Default Time:** 9:00 AM (Mon-Fri)  
**Cron:** `DAILY_REMINDER_CRON`  
**Action:** Posts reminder message in configured channel  
**Message:** "Good morning! Time for daily standup"

---

#### 2. **Non-Submitter Reminder**
**Default Time:** 10:30 AM (Mon-Fri)  
**Cron:** `NON_SUBMITTER_REMINDER_CRON`  
**Action:** Sends DM to users who haven't submitted yet  
**Message:** Gentle reminder with submit button

---

#### 3. **Daily Summary** *(Optional - currently disabled)*
**Default Time:** 4:00 PM (Mon-Fri)  
**Cron:** `DAILY_SUMMARY_CRON`  
**Action:** Posts AI-generated summary to channel  
**Note:** Available on `/daily-summary` dashboard instead

---

#### 4. **Alert Checks**
**Default Time:** 10:00 PM daily  
**Cron:** `ALERT_CHECKS_CRON`  
**Action:** Analyzes patterns, generates alerts for managers  
**Checks:**
- Declining performance
- Recurring blockers
- Negative sentiment trends
- Consistency drops
- Goal misalignment

---

#### 5. **Calculate Metrics**
**Default Time:** 11:30 PM daily  
**Cron:** `CALCULATE_METRICS_CRON`  
**Action:** Calculates performance metrics for all users  
**Generates:**
- Weekly performance scores
- Monthly velocity metrics
- Team rankings
- Risk assessments

---

### Weekly Jobs

#### 6. **Start Week**
**Default Time:** Monday 9:00 AM  
**Action:** Posts motivational week start message

---

#### 7. **End Week**
**Default Time:** Friday 5:00 PM  
**Action:** Posts week wrap-up message

---

#### 8. **Weekly Report**
**Default Time:** Thursday 5:00 PM  
**Cron:** `WEEKLY_REPORT_CRON`  
**Action:** Generates and posts comprehensive weekly summary  
**Includes:**
- Team progress
- Key achievements
- Blockers resolved
- Performance highlights

---

### Monthly Jobs

#### 9. **Monthly Report**
**Default Time:** 1st of month, 9:00 AM  
**Cron:** `MONTHLY_REPORT_CRON`  
**Action:** Generates monthly performance report  
**Includes:**
- Month-over-month trends
- Top performers
- Achievement highlights
- Team statistics

---

#### 10. **Standup Huddle Follow-Up**
**Default Time:** (Configurable)  
**Action:** Follows up on standup threads  
**Purpose:** Ensure engagement and response

---

## 🎮 Interactive Modal Views

### `standup_submission` - Standup Form Modal
**Triggered by:** `/standup` command or "Submit Standup" button

**Fields:**
1. **Yesterday** (Multi-line text)
   - What did you accomplish yesterday?
   - Optional field
   
2. **Today** (Multi-line text)
   - What are your plans for today?
   - Optional field
   
3. **Blockers** (Multi-line text)
   - Any blockers or challenges?
   - Optional field
   
4. **Notes** (Multi-line text)
   - Additional context or notes
   - Optional field
   
5. **Day Off Toggle** (Checkbox)
   - Mark if you're taking time off
   
6. **Day Off Details** (Conditional, shown if toggle checked)
   - Start Time (dropdown)
   - End Time (dropdown)
   - Reason (text input)

**On Submit:**
- Saves to MongoDB
- Triggers AI analysis
- Updates metrics
- Checks for achievements
- Posts thank you message

---

## 📊 Data Models & Storage

### Database Collections

1. **StandupEntry** - Individual submissions
2. **PerformanceMetrics** - Calculated weekly/monthly metrics
3. **Achievement** - Earned badges and achievements
4. **Alert** - Generated alerts and warnings
5. **StandupThread** - Legacy thread tracking
6. **TeamGoals** - Team objectives (if configured)

---

## 🔧 Environment Variables & Configuration

### Cron Schedule Overrides

All job schedules are configurable via environment variables:

```bash
# Daily Jobs
DAILY_REMINDER_CRON=0 9 * * 1-5           # 9 AM, Mon-Fri
NON_SUBMITTER_REMINDER_CRON=30 10 * * 1-5 # 10:30 AM, Mon-Fri
DAILY_SUMMARY_CRON=0 16 * * 1-5           # 4 PM, Mon-Fri
ALERT_CHECKS_CRON=0 22 * * *              # 10 PM daily
CALCULATE_METRICS_CRON=30 23 * * *        # 11:30 PM daily

# Weekly Jobs
WEEKLY_REPORT_CRON=0 17 * * 4             # Thursday 5 PM

# Monthly Jobs
MONTHLY_REPORT_CRON=0 9 1 * *             # 1st of month, 9 AM
```

### Feature Toggles

```bash
ENABLE_TEST_ROUTES=false        # Enable /trigger/* endpoints
ALLOW_PUBLIC_DASHBOARD=false    # Disable auth requirement
APP_TIMEZONE=Africa/Cairo       # Timezone for cron jobs
```

---

## 🚀 Quick Reference Card

### Most Common Commands

| Action | Command |
|--------|---------|
| Submit standup | `/standup` |
| Check someone's status | `@Standup where is @user?` |
| Full user profile | `@Standup profile of @user` |
| Check ticket | `@Standup status of ABC-123` |
| Team overview | `@Standup who's working today?` |
| Get help | `@Standup help` |
| View dashboard | Visit: `http://your-domain/` |
| Export data | `http://your-domain/export/standups` |

---

## 💡 Pro Tips

1. **Natural Language**: The bot understands natural questions - just ask!
2. **Multiple Users**: Ask about multiple people: `@Standup how are @john and @sarah?`
3. **Date Queries**: Include dates: `@Standup summary for 2025-11-15`
4. **Export Everything**: Use export routes for data analysis
5. **Test Routes**: Enable for development/testing only
6. **Customize Crons**: Adjust schedules to match your team's hours
7. **Dashboard First**: Most info available on web dashboards
8. **Mobile Access**: Web dashboards are mobile-responsive

---

## 🔒 Security Notes

- All dashboard routes protected by Clerk authentication (unless explicitly disabled)
- Test routes disabled by default
- Rate limiting applied to all API endpoints
- Helmet security headers enabled
- HTTPS recommended for production
- Environment variables never exposed in responses

---

## 📞 Need Help?

- Check `/health` endpoint to verify bot is running
- Review logs in `logs/` directory
- Type `@Standup help` in Slack
- Visit dashboard at `/` for visual interface
- Check `AUTHENTICATION_SETUP.md` for auth issues
- Review `ENHANCED_FEATURES.md` for feature details

---

**Last Updated:** November 16, 2025  
**Bot Version:** 1.0.0
