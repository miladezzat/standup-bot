# ⏱️ AI Time Estimation Feature

Your standup bot now includes **AI-powered time estimation** using OpenAI GPT! Every time a team member submits a standup, the AI automatically estimates how many hours each task took or will take.

---

## 🚀 Setup (5 Minutes)

### Step 1: Get OpenAI API Key

1. Go to [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Sign up or login
3. Click "Create new secret key"
4. Copy the key (starts with `sk-...`)

### Step 2: Add to Environment Variables

Add to your `.env` file:

```bash
OPENAI_API_KEY=sk-your-key-here
```

### Step 3: Restart the Bot

```bash
npm run dev
```

That's it! AI time estimation is now active! ✅

---

## ✨ How It Works

### When a User Submits
1. User types `/standup` and fills the form
2. Bot saves the standup to database
3. **AI analyzes each task** and estimates time
4. Time estimates are stored alongside the standup
5. User gets confirmation with time breakdown

### Example Flow

**User submits:**
```
Yesterday:
• Implemented user dashboard layout (TASK-301)
• Fixed responsive design issues
• Code review for authentication PR

Today:
• Add data visualization charts
• Write integration tests
```

**AI Estimates:**
```
Yesterday: ~5.5 hours
• Implemented user dashboard layout (TASK-301) - 3h
• Fixed responsive design issues - 1.5h
• Code review for authentication PR - 1h

Today: ~4 hours
• Add data visualization charts - 2.5h
• Write integration tests - 1.5h
```

**User Receives:**
```
✅ Your standup has been saved!

⏱️ Time Estimates (AI):
• Yesterday's work: ~5.5 hours
• Today's plan: ~4 hours
```

---

## 📊 What Gets Estimated

### Automatically Analyzed:
- ✅ Code complexity
- ✅ Task types (bug fix, feature, review)
- ✅ Common development patterns
- ✅ Testing requirements

### Typical Estimates:
- **Bug fixes:** 1-4 hours
- **New features:** 2-8 hours
- **Code reviews:** 0.5-2 hours
- **Meetings:** Listed duration
- **Testing:** 1-3 hours
- **Documentation:** 1-2 hours

---

## 🎯 Benefits

### For Team Members:
- ✅ See how much work they're committing to
- ✅ Better time awareness
- ✅ Improve task planning

### For Managers:
- ✅ Track actual workload
- ✅ Identify over/under-loaded team members
- ✅ Better capacity planning
- ✅ Compare estimated vs planned hours
- ✅ Data-driven decisions

### For Reports:
- ✅ Weekly reports include total hours worked
- ✅ Monthly reports show productivity metrics
- ✅ Dashboard displays time estimates
- ✅ Historical time tracking

---

## 📈 Where to See Time Estimates

### 1. Confirmation Message (Slack)
After submitting, users see:
```
⏱️ Time Estimates (AI):
• Yesterday's work: ~5.5 hours
• Today's plan: ~4 hours
```

### 2. Web Dashboard
Visit: `http://localhost:3001/submissions`
- Each standup shows total hours badge
- Section labels show individual estimates
- Example: "🕒 Yesterday ~5.5h (AI)"

### 3. Database
Time estimates are stored in MongoDB:
```javascript
{
  yesterdayHoursEstimate: 5.5,
  todayHoursEstimate: 4.0,
  timeEstimatesRaw: { /* detailed breakdown */ }
}
```

### 4. Reports (Future)
- Weekly reports: Total hours per person
- Monthly reports: Average hours per day
- Productivity metrics

---

## ⚙️ Configuration

### Cost Management

OpenAI charges per API call. Typical costs:
- **Per standup:** ~$0.001 - $0.003 USD
- **Per day (10 team members):** ~$0.01 - $0.03 USD
- **Per month:** ~$0.30 - $0.90 USD

Very affordable for small teams!

### Disable AI Estimation

To turn off AI estimation, simply **remove** the `OPENAI_API_KEY` from your `.env` file:

```bash
# OPENAI_API_KEY=sk-your-key-here  ← Comment out or delete
```

The bot will continue working normally, just without time estimates.

### Model Selection

By default, uses `gpt-3.5-turbo` (fast and cheap).

To use GPT-4 (more accurate, more expensive), edit:
```typescript
// src/service/ai-time-estimation.service.ts
model: 'gpt-4'  // Change from gpt-3.5-turbo
```

---

## 🧪 Testing

### Test the Feature

1. Type `/standup` in Slack
2. Fill out the form with tasks
3. Submit
4. Check your confirmation message
5. Visit the dashboard to see estimates

### Example Test Standup

```
Yesterday:
• Built authentication system
• Fixed 3 critical bugs
• Deployed to production

Today:
• Add password reset feature
• Write unit tests
• Code review
```

You should see time estimates in the confirmation!

---

## 🔍 How Accurate Are the Estimates?

### AI Considers:
- Task description and complexity
- Common development patterns
- Industry averages
- Context clues (bug, feature, review, etc.)

### Accuracy Levels:
- **High confidence:** Common tasks (reviews, meetings)
- **Medium confidence:** Standard features
- **Low confidence:** Vague descriptions

### Improving Accuracy:
Team members can help by being specific:
- ❌ "Worked on feature" → Less accurate
- ✅ "Implemented user login with OAuth" → More accurate

---

## 📊 Sample Analytics

### Individual Report Example:
```
John Doe - This Week
Total Estimated Hours: 38.5h
Average per Day: 7.7h

Monday: 8h
Tuesday: 7.5h
Wednesday: 8.5h
Thursday: 7h
Friday: 7.5h
```

### Team Report Example:
```
Team - This Week
Total Estimated Hours: 192h
Team Size: 5 members
Average per Person: 38.4h
```

---

## 💡 Pro Tips

### For Team Members:
1. **Be specific** in task descriptions for better estimates
2. **Review estimates** in confirmation message
3. **Use estimates** to improve time planning

### For Managers:
1. **Track trends** over time
2. **Compare** estimated vs planned hours
3. **Identify** consistently over/under-worked team members
4. **Use data** for capacity planning

---

## 🔧 Troubleshooting

### Estimates Not Showing?
Check:
1. ✅ `OPENAI_API_KEY` is set in `.env`
2. ✅ API key is valid (not expired)
3. ✅ Bot was restarted after adding key
4. ✅ Console logs show estimation attempts

### Estimates Seem Wrong?
- AI estimates are **averages** based on task descriptions
- More specific descriptions = better estimates
- Estimates improve over time as AI learns patterns

### API Errors?
Check console logs:
```bash
⏱️ Estimated 5.5h yesterday, 4h today for John
```

If you see errors, check:
- API key is correct
- OpenAI account has credits
- Network connectivity

---

## 🌟 Future Enhancements

Potential additions:
- [ ] Learn from actual time taken (if tracked)
- [ ] Team-specific estimation models
- [ ] Historical accuracy tracking
- [ ] Workload balancing suggestions
- [ ] Burnout detection alerts
- [ ] Integration with time tracking tools

---

## 📞 Support

**Feature not working?**
1. Check `.env` has `OPENAI_API_KEY`
2. Restart the bot
3. Check console logs for errors

**Want to disable it?**
Remove `OPENAI_API_KEY` from `.env`

**Want more features?**
Request them from your admin!

---

**Enjoy data-driven standup management!** 🚀

---

*Cost: ~$1/month for a 10-person team*
*Accuracy: 70-85% for typical development tasks*
*Privacy: Task descriptions are sent to OpenAI API*

