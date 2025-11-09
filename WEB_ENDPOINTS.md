# Web Dashboard Endpoints

Your standup bot now has a comprehensive web interface! Here's what you can access:

## 📊 Main Dashboards

### 1. **All Submissions** 
**URL:** `http://localhost:3001/` or `http://localhost:3001/submissions`

**What you'll see:**
- All standup submissions from all team members
- Grouped by date (most recent first)
- Statistics: total submissions, active users, days tracked
- Click on any user's name to see their individual report
- Highlights users with blockers

**Perfect for:** Daily check-ins, seeing who submitted today, quick team overview

---

### 2. **Individual User Report** 
**URL:** `http://localhost:3001/user/{USER_ID}`

**Example:** `http://localhost:3001/user/U12345ABCD`

**What you'll see:**
- Beautiful header with user avatar and stats
- All standup submissions for that specific user
- Statistics:
  - Total submissions
  - Average tasks per day
  - Blockers reported
  - Attendance percentage
- Filter by time period:
  - Last 7 days: `?period=week`
  - This month: `?period=month`
  - All time: `?period=all`

**Perfect for:** 1-on-1s, performance reviews, tracking individual progress

**Finding User IDs:**
From the main dashboard (`/submissions`), click on any user's name and you'll be taken to their individual report. The URL will contain their User ID.

---

### 3. **Legacy Thread History** 
**URL:** `http://localhost:3001/history`

**What you'll see:**
- Old thread-based standup data
- Parsed replies from Slack threads
- Analytics dashboard for thread-based submissions

**Perfect for:** Viewing historical data from before the form-based system

---

### 4. **Health Check** 
**URL:** `http://localhost:3001/health`

**What you'll see:**
- Simple "OK" response
- Used for monitoring and uptime checks

---

## 🎯 How to Use

### Finding Milad's Report (or any user):

**Method 1: From Main Dashboard**
1. Go to `http://localhost:3001/submissions`
2. Find "Milad" in the list
3. Click on his name
4. You'll be taken to his individual report

**Method 2: Direct URL (if you know the Slack User ID)**
1. Go to `http://localhost:3001/user/U12345ABCD`
2. Replace `U12345ABCD` with Milad's actual Slack User ID

**How to find Slack User ID:**
- In Slack, click on Milad's profile
- Click "..." (More actions)
- Select "Copy member ID"
- Use that ID in the URL

---

## 📅 Reports

### Weekly Report (Automated)
- **When:** Every Friday at 5:00 PM Cairo time
- **Where:** Posted to your configured Slack channel
- **What:** Summary of all standups from the past 7 days, grouped by user

### Monthly Report (Automated)
- **When:** 1st of each month at 9:00 AM Cairo time
- **Where:** Posted to your configured Slack channel
- **What:** 
  - Complete month summary
  - Individual performance metrics
  - Top contributors with medals 🥇🥈🥉
  - Completion rates
  - Blocker analysis
  - Progress bars for each team member
  - Insights and recommendations

---

## 🎨 Dashboard Features

### Main Dashboard Features:
- ✅ Real-time submission data
- ✅ Date grouping (newest first)
- ✅ Blocker highlighting (red border)
- ✅ Clickable user names
- ✅ Submission counts
- ✅ Clean, modern design
- ✅ Mobile responsive

### Individual User Report Features:
- ✅ Beautiful gradient header
- ✅ User avatar
- ✅ Key statistics cards
- ✅ Time period filters
- ✅ Blocker highlighting
- ✅ Hover effects
- ✅ Chronological standup list
- ✅ Back to main dashboard link

---

## 🔧 Customization

### Change the Port
In `.env`:
```bash
PORT=3001  # Change to your preferred port
```

### Query Parameters

**Submissions Dashboard:**
- `?date=today` - Show only today's submissions
- `?date=2024-01-15` - Show submissions for a specific date

**User Report:**
- `?period=week` - Last 7 days
- `?period=month` - This month
- `?period=all` - All time (last year)

---

## 📱 Access from Anywhere

### Local Development:
```
http://localhost:3001/submissions
http://localhost:3001/user/U12345ABCD
```

### Production (after deployment):
```
https://your-app.railway.app/submissions
https://your-app.railway.app/user/U12345ABCD
```

---

## 💡 Pro Tips

1. **Bookmark Individual Reports:** 
   - Bookmark your direct reports' individual pages for quick access

2. **Weekly Check-ins:** 
   - Use the weekly view (`?period=week`) for 1-on-1 meetings

3. **Monthly Reviews:** 
   - Use the monthly view (`?period=month`) for performance reviews

4. **Share Reports:** 
   - Copy the URL and share with team members or managers

5. **Quick Today's View:** 
   - Use `http://localhost:3001/submissions?date=today` to see only today

---

## 📊 Data Refresh

- **Real-time:** Web dashboards show real-time data from MongoDB
- **No caching:** Every page load fetches fresh data
- **Refresh:** Simply reload the page to see latest submissions

---

## 🎯 Example Scenarios

### Scenario 1: Morning Team Check-in
1. Open `http://localhost:3001/submissions?date=today`
2. See who has/hasn't submitted
3. Review any blockers
4. Follow up with non-submitters

### Scenario 2: 1-on-1 with Milad
1. Open Milad's report: `http://localhost:3001/user/U12345ABCD?period=week`
2. Review his last 7 days of standups
3. Discuss blockers, achievements, and plans

### Scenario 3: Monthly Performance Review
1. Wait for monthly report in Slack (automatic)
2. Or visit individual user report with `?period=month`
3. Review completion rates, task counts, and blocker patterns

### Scenario 4: Historical Review
1. Open user report with `?period=all`
2. See all historical standups
3. Track progress over time

---

## 🚀 Coming Soon (Potential Enhancements)

Want these features? Let me know!
- 📊 Team-wide analytics dashboard
- 📈 Charts and graphs (submissions over time)
- 🔍 Search and filter functionality
- 📥 Export to PDF/CSV
- 📧 Email reports
- 🎨 Dark mode toggle
- 📱 Mobile app

---

## ❓ Need Help?

- **Dashboard not loading?** Check MongoDB connection and console logs
- **User not found?** Verify the Slack User ID is correct
- **Old data missing?** Check the `/history` endpoint for thread-based data
- **Styling issues?** Try hard refresh (Ctrl+Shift+R or Cmd+Shift+R)

---

Enjoy your new standup dashboard! 🎉

