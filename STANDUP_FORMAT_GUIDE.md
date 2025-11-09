# 📋 Standup Format Guide

## Overview

Your standup bot collects three key pieces of information from each team member daily. This guide shows the best practices for formatting standup notes.

---

## ✅ The Three Questions

### 1. 🕒 What did you do yesterday?

**Purpose:** Share completed work and achievements from the previous working day.

**Best Format:**
- Use bullet points for multiple items
- Be specific and actionable
- Include task IDs or ticket numbers if applicable
- Focus on outcomes, not just activities

**Good Examples:**
```
• Completed user authentication API (TASK-123)
• Fixed bug in payment processing module
• Reviewed PR for dashboard redesign
• Deployed staging environment update
```

**Even Better (with details):**
```
• Completed user authentication API (TASK-123) - Now supports OAuth and JWT
• Fixed critical bug in payment processing (BUG-456) - Reduced transaction failures by 90%
• Reviewed 3 PRs for dashboard redesign - Approved with minor suggestions
• Deployed staging environment - Version 2.3.1 with new features
```

**Avoid:**
```
• Worked on stuff
• Did some coding
• Had meetings
```

---

### 2. 🗓️ What will you do today?

**Purpose:** Share your plan and priorities for the current day.

**Best Format:**
- List 3-5 concrete tasks
- Prioritize in order of importance
- Be realistic about what can be completed
- Include dependencies if relevant

**Good Examples:**
```
• Implement password reset feature (TASK-124)
• Write unit tests for authentication module
• Attend sprint planning meeting at 2 PM
• Start work on email notification service
```

**Even Better (with priorities):**
```
• [HIGH] Implement password reset feature (TASK-124) - Target: End of day
• [HIGH] Write unit tests for authentication module - Need 80% coverage
• [MEDIUM] Attend sprint planning meeting at 2 PM
• [LOW] Start research on email notification service options
```

**Avoid:**
```
• Will work on the project
• Continue yesterday's tasks
• Do some stuff
```

---

### 3. 🚧 Any blockers?

**Purpose:** Identify obstacles preventing progress so team can help.

**Best Format:**
- Be specific about what's blocking you
- Mention who can help (if known)
- Indicate urgency level
- Leave blank or write "None" if no blockers

**Good Examples:**
```
• Waiting for API documentation from backend team (need by EOD)
• Database credentials expired - need DevOps support
• Unclear requirements for payment flow - need PM clarification
```

**Even Better (with action items):**
```
• [URGENT] Production database access denied - @DevOps can you reset my credentials?
• [BLOCKER] Waiting for design mockups from @Sarah for checkout page - needed to continue
• [QUESTION] Payment gateway integration - should we use Stripe or PayPal? Need decision from @TeamLead
```

**Common Blockers:**
- Waiting for code review
- Missing documentation
- Environment/access issues
- Unclear requirements
- Dependencies on other teams
- Technical challenges needing discussion

**If No Blockers:**
```
None
```
or
```
No blockers today
```
or simply leave it empty.

---

## 📏 Format Guidelines

### Length Recommendations

**Yesterday & Today:**
- Minimum: 1-2 items
- Ideal: 3-5 items
- Maximum: 7-8 items (if more, summarize)

**Blockers:**
- Only mention real blockers (not just challenges)
- Each blocker should be something that prevents progress
- Optional field - leave blank if none

---

## 🎯 Writing Tips

### DO ✅

1. **Be Specific**
   - ❌ "Worked on the feature"
   - ✅ "Completed user registration form with validation"

2. **Use Action Verbs**
   - Completed, Implemented, Fixed, Reviewed, Deployed, Tested, Created, Updated

3. **Include Context**
   - Add ticket numbers: (TASK-123)
   - Add outcomes: "Reduced load time by 50%"
   - Add metrics: "Fixed 5 bugs"

4. **Be Concise**
   - Each item should be one line
   - Use bullet points
   - Get to the point quickly

5. **Show Progress**
   - "Completed 60% of dashboard redesign"
   - "Started work on X, will finish today"

### DON'T ❌

1. **Don't Be Vague**
   - Avoid: "Did some work", "Had meetings", "Worked on stuff"

2. **Don't Write Essays**
   - Keep each item to 1-2 lines
   - Details can be discussed if needed

3. **Don't List Non-Work Items**
   - Focus on project/work-related tasks
   - Skip personal appointments unless affecting availability

4. **Don't Overcommit**
   - Be realistic about today's plan
   - Better to complete 3 items than list 10 and finish 2

5. **Don't Skip Details in Blockers**
   - If blocked, explain what you're blocked on
   - Mention who can help

---

## 🌟 Example Complete Standups

### Example 1: Developer

**🕒 Yesterday:**
```
• Implemented user dashboard layout (TASK-301)
• Fixed responsive design issues on mobile
• Code review for authentication PR
• Updated documentation for API endpoints
```

**🗓️ Today:**
```
• Add data visualization charts to dashboard
• Write integration tests for new features
• Team meeting at 3 PM
• Begin work on notification system
```

**🚧 Blockers:**
```
• Waiting for design assets from @Sarah for the charts
• Need staging environment access - credentials expired
```

---

### Example 2: Designer

**🕒 Yesterday:**
```
• Created mockups for checkout flow (5 screens)
• Updated design system with new color palette
• User testing session - gathered feedback on navigation
• Revised homepage hero section based on PM feedback
```

**🗓️ Today:**
```
• Finalize checkout flow designs
• Create prototype in Figma
• Share designs with development team
• Start work on mobile app onboarding screens
```

**🚧 Blockers:**
```
None
```

---

### Example 3: Product Manager

**🕒 Yesterday:**
```
• Sprint planning meeting with team
• Prioritized backlog for next sprint
• Customer interview with 3 users
• Reviewed analytics data - 15% increase in engagement
```

**🗓️ Today:**
```
• Write user stories for payment integration
• Sync with stakeholders on Q2 roadmap
• Review design mockups from Sarah
• Update project timeline in Jira
```

**🚧 Blockers:**
```
• Need budget approval for third-party API integration
• Waiting on legal review of new Terms of Service
```

---

## 🔄 Special Cases

### When Starting a New Task
```
🗓️ Today:
• [NEW] Research options for email service provider
• [NEW] Set up development environment for mobile app
```

### When Continuing Yesterday's Work
```
🕒 Yesterday:
• Started implementing payment gateway (50% complete)

🗓️ Today:
• Continue payment gateway implementation
• Complete testing and deploy to staging
```

### When You're Stuck
```
🚧 Blockers:
• Spent 4 hours debugging memory leak in production
• Need senior developer to pair program on this issue
• [URGENT] App is unstable, affecting users
```

### When You Have No Blockers
```
🚧 Blockers:
None - All systems go! 🚀
```

---

## 📊 How This Data is Used

Your standups are tracked and analyzed for:

1. **Daily Dashboard** (`/submissions`)
   - See who submitted
   - View everyone's updates
   - Spot blockers quickly

2. **Individual Reports** (`/user/{USER_ID}`)
   - Track personal progress
   - Review past submissions
   - Prepare for 1-on-1s

3. **Weekly Reports** (Automated - Every Friday)
   - Team summary for the week
   - Submission rates
   - Blocker tracking

4. **Monthly Reports** (Automated - 1st of Month)
   - Performance metrics
   - Completion rates
   - Top contributors
   - Trends and insights

5. **Team Analytics**
   - Task completion rates
   - Average tasks per person
   - Blocker frequency
   - Attendance tracking

---

## 🎓 Training Your Team

### Quick Guide for New Team Members

> **How to Write a Great Standup:**
> 
> 1. Type `/standup` in Slack
> 2. Fill out the form:
>    - **Yesterday:** What you finished (3-5 bullet points)
>    - **Today:** What you plan to do (3-5 items)
>    - **Blockers:** What's stopping you (or "None")
> 3. Use bullet points: `• Task description (TASK-123)`
> 4. Be specific and actionable
> 5. Submit by 9:30 AM daily
>
> **Pro Tips:**
> - Include ticket numbers
> - Mention outcomes/results
> - Real blockers only (not just challenges)
> - Update anytime by running `/standup` again

---

## ⚡ Quick Reference

### Bullet Point Symbols
Use any of these:
- `•` bullet
- `-` dash
- `–` en-dash
- Numbered: `1.`, `2.`, `3.`

### Task Reference Format
- `(TASK-123)` - Task/ticket number
- `[BUG-456]` - Bug number
- `#789` - Issue number
- Whatever system you use!

### Priority Indicators
- `[HIGH]` or `[P1]` - Critical
- `[MEDIUM]` or `[P2]` - Normal
- `[LOW]` or `[P3]` - Nice to have
- `[BLOCKED]` - Can't proceed

### Status Indicators
- `[NEW]` - Just starting
- `[WIP]` - Work in progress
- `[REVIEW]` - In code review
- `[DONE]` - Completed
- `[50%]` - Percentage complete

---

## 📈 Metrics to Track

For managers reviewing standups, look for:

1. **Consistency**
   - Daily submission rate
   - Quality of updates

2. **Productivity Patterns**
   - Tasks completed vs planned
   - Completion time
   - Task types

3. **Blocker Frequency**
   - How often blocked
   - Type of blockers
   - Time to resolution

4. **Communication Quality**
   - Specificity level
   - Context provided
   - Clarity

5. **Team Health**
   - Overall engagement
   - Collaboration mentions
   - Help requests

---

## 🤝 Need Help?

- **Forgot to submit?** Run `/standup` anytime - you'll get a reminder at 10:30 AM
- **Made a mistake?** Run `/standup` again to update your submission
- **Questions about format?** Share this guide with your team!

---

**Remember:** Standups are about communication, not reporting. Keep them concise, relevant, and helpful for your team! 🚀

