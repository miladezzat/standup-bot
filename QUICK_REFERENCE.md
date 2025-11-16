# ⚡ Quick Reference Cheat Sheet

One-page overview of all commands and actions.

---

## 🤖 Slack Commands

| Command | What It Does |
|---------|-------------|
| `/standup` | Open standup submission modal |

---

## 💬 Ask the Bot (@Standup)

### Quick Status
```
@Standup where is @user?              # Availability & OOO
@Standup what is @user doing?         # Current work
@Standup status of ABC-123            # Linear ticket
```

### Performance & Reports
```
@Standup how is @user performing?     # Performance metrics
@Standup @user stats                  # Weekly/monthly stats
@Standup profile of @user             # Full detailed profile
```

### Natural Questions
```
@Standup who's working today?         # Team overview
@Standup what has @user been doing?   # Recent activity
@Standup help                         # Show help menu
```

---

## 🌐 Web Dashboards

| URL | Page |
|-----|------|
| `/` or `/submissions` | Today's submissions |
| `/user/:userId` | Individual user report |
| `/daily-summary` | AI-powered daily summary |
| `/manager` | Manager insights & alerts |
| `/analytics` | Team analytics & charts |
| `/history` | Historical thread view |

---

## 📥 Export Data (CSV)

| URL | Export |
|-----|--------|
| `/export/standups` | All submissions |
| `/export/metrics` | Performance metrics |
| `/export/alerts` | Alerts & warnings |
| `/export/achievements` | Badges & achievements |
| `/export/user/:userId` | User report |

---

## ⏰ Automated Jobs

| Time | Job | Action |
|------|-----|--------|
| 9:00 AM | Standup Reminder | Posts reminder message |
| 10:30 AM | Non-Submitter Reminder | DMs who haven't submitted |
| 10:00 PM | Alert Checks | Analyzes patterns, generates alerts |
| 11:30 PM | Calculate Metrics | Updates performance scores |
| Thu 5PM | Weekly Report | Posts weekly summary |
| 1st 9AM | Monthly Report | Posts monthly summary |

*All times configurable via environment variables*

---

## 🎯 What You Get in Profiles

✅ Current availability & status  
📊 Performance scores (0-100)  
🔥 Submission streak  
🏆 Earned achievements  
⚠️ Active alerts  
📈 Velocity & consistency  
🎯 Active Linear issues  
💡 AI insights  

---

## 🧪 Test Endpoints (Dev Only)

**Set `ENABLE_TEST_ROUTES=true` to enable**

```
GET /trigger/standup-reminder
GET /trigger/daily-summary?date=2025-11-15
```

---

## 🔑 Quick Setup

1. Copy `.env.example` to `.env`
2. Fill in Slack tokens & MongoDB URI
3. Configure Clerk for auth (or set `ALLOW_PUBLIC_DASHBOARD=true`)
4. Run `npm install && npm run dev`
5. Type `/standup` in Slack

---

## 📱 Mobile Access

All web dashboards are mobile-responsive!  
Access from your phone: `https://your-domain/`

---

## 🆘 Emergency Commands

| Issue | Solution |
|-------|----------|
| Check if running | Visit `/health` |
| View logs | Check `logs/` directory |
| Test Slack | Type `/standup` |
| Test Linear | `@Standup test linear` |
| Reset auth | Visit `/auth/sign-out` |

---

**Pro Tip:** The bot understands natural language! Just ask questions like you would a teammate.

**Example:**  
"@Standup has john been consistent this week?" → Shows performance data  
"@Standup who needs help?" → Shows team members with blockers  
"@Standup tell me everything about sarah" → Full profile with all data
