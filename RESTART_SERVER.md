# 🔧 How to Restart the Server (Fix Rate Limit Error)

## Problem
You're seeing "ERR_TOO_MANY_REDIRECTS" or "Too many requests" because:
1. The old server with strict rate limiting is still running
2. The new code changes haven't loaded yet

## Solution

### Step 1: Stop ALL Node Processes
Run one of these commands:

**Option A (Gentle):**
```bash
# In your terminal, press Ctrl+C to stop the server
```

**Option B (Force kill if Ctrl+C doesn't work):**
```bash
# Kill all node processes
pkill -f node

# OR on macOS/Linux
killall node

# OR find and kill specific process
lsof -ti:4000 | xargs kill -9
```

### Step 2: Clear Browser Cache
1. In Chrome/Brave: Press `Cmd+Shift+R` (Mac) or `Ctrl+Shift+R` (Windows/Linux)
2. Or clear cookies for localhost:
   - Chrome → Settings → Privacy → Cookies → See all site data → Search "localhost" → Remove

### Step 3: Start Fresh Server
```bash
cd /Users/miladfahmy/Desktop/sakneen/standup-bot

# Start the dev server
npm run dev
```

### Step 4: Access the Dashboard
Open: http://localhost:4000

You should now see:
- ✨ NEW FEATURES BANNER at the top
- 🚀 4 Quick Access Cards (Manager Dashboard, Analytics, AI Summary, Export)
- 📊 Stats grid
- Recent standups

---

## If Still Not Working

### Check if server is running:
```bash
lsof -i:4000
```

### Check if database is connected:
```bash
# Should see connection logs in terminal
```

### View server logs:
Look for these lines in terminal:
```
✅ Starting scheduled jobs...
🚀 All jobs scheduled successfully!
Server is running on http://localhost:4000
```

---

## Quick Test Commands

### Test the dashboard is working:
```bash
curl http://localhost:4000/
```

### Test manager dashboard:
```bash
curl http://localhost:4000/manager
```

If you get HTML back, it's working! 🎉

