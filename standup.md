# Document: Slack Standup Bot Service (Business/Functional Spec)

## 1. Purpose

The service’s goal is to standardize and collect daily standup notes from team members inside Slack, store them in a database (MongoDB), and make the notes available for weekly summaries and reporting. It should reduce manual follow-ups by the team lead and keep all standup data structured.

---

## 2. Stakeholders & Users

1. **Team Members (Engineers)**

   * Submit their daily standup via Slack.
   * Receive confirmation that their input was saved.
   * May receive daily reminders if they didn’t submit.

2. **Team Lead / Manager**

   * Wants a single place to view who submitted standups.
   * Wants weekly aggregated summaries per user.
   * Wants to know who missed submissions.

3. **System / Bot**

   * Listens to Slack events or slash commands.
   * Validates and stores standup submissions.
   * Triggers scheduled tasks (daily reminders, weekly reports).

---

## 3. High-Level Capabilities

1. **Collect standups from Slack**

   * Via slash command (e.g. “/standup”) or direct message to the bot.
   * Bot opens an interactive form/modal.
   * Fields: “What did you do yesterday?”, “What will you do today?”, “Blockers?”.

2. **Persist standups**

   * Each submission is stored in MongoDB.
   * Each record is tied to Slack user, date, and Slack workspace.
   * One standup per user per day.

3. **Daily reminders (optional)**

   * At a configured time (e.g. 09:55 in the team timezone).
   * Bot sends a DM or message to a channel asking users to submit.

4. **Weekly report generation**

   * Cron-based task runs once per week.
   * Fetches standups for last 7 days.
   * Groups them by user.
   * Posts the summary to a configured Slack channel.

5. **Admin / manager configuration (simple)**

   * Environment-based configuration (channel IDs, timezone, report day).
   * No UI required.

---

## 4. Integrations

### 4.1 Slack

* The service must connect using a Slack Bot token and signing secret.
* It must be able to:

  * Receive slash commands or interactive view submissions.
  * Open a modal/form in Slack to collect structured standup data.
  * Post messages to a channel (weekly report).
  * Send direct messages (reminders).

### 4.2 MongoDB

* MongoDB is used as the persistent store.
* The service must connect at startup to MongoDB using a connection string from environment variables.
* All standups must be stored there for reporting.

### 4.3 Scheduling

* The service uses cron to:

  * Send daily reminders.
  * Create/send weekly summaries.

---

## 5. Environment & Configuration (No Code)

The service must be configurable through environment variables. The AI should expect and document (not hardcode) at least:

* Application

  * PORT
  * NODE_ENV

* Slack

  * Slack Bot token
  * Slack signing secret
  * Slack app-level tokens if needed
  * Default channel for weekly reports
  * (Optional) channel or DM behavior for reminders

* Database

  * MongoDB connection string

* Scheduling

  * Daily reminder time (cron expression)
  * Weekly report time (cron expression)
  * Timezone for scheduling

---

## 6. Data Model (Business Description)

### 6.1 Standup Entry

Each standup entry must contain at minimum:

* Slack user ID (who submitted)
* Slack user name (for display)
* Date of the standup (logical standup date, not just timestamp)
* Yesterday’s work (text)
* Today’s plan (text)
* Blockers (text, can be empty)
* Timestamps: createdAt, updatedAt
* Source: how it was submitted (slash command, modal, DM)
* Workspace/team ID (to support multiple workspaces in future)

### 6.2 User (Optional / Derived)

The service may store or derive user details from Slack (e.g. name, email) to make reporting clearer.

---

## 7. Main User Flows

### 7.1 Submit Standup (Happy Path)

1. User in Slack runs the standup entry point (slash command or bot mention).
2. Bot responds with an interactive form/modal asking for:

   * What did you do yesterday?
   * What will you do today?
   * Any blockers?
3. User submits the form.
4. Service validates:

   * User is identified.
   * Date is today.
   * No duplicate for the same user and date (if duplicate, update instead of create).
5. Service saves the standup to MongoDB.
6. Service sends confirmation message to the user.

### 7.2 Duplicate Submission (Same Day)

* If the same user submits again on the same day:

  * Either overwrite the existing one
  * Or create a new version and mark previous as replaced
* Business preference: keep the latest submission for that day.

### 7.3 Daily Reminder

1. At the configured time, the cron job runs.
2. It determines which users have **not** submitted a standup today (optional: requires the service to know expected users).
3. It sends a DM (or posts in a channel) reminding users to submit.

### 7.4 Weekly Report

1. At the configured weekly time, the cron job runs.
2. It fetches all standups from the last 7 days.
3. It groups standups by user.
4. It generates a human-readable summary that, for each user, lists their days and notes.
5. It posts the summary to the configured Slack channel (for the manager/team).
6. Optionally, it can include a “missed days” section.

---

## 8. Reporting Format (Business Requirements)

The weekly report posted to Slack should be readable by non-technical team members. It should include:

1. Report title (example: “Weekly Standup Summary – Week of {date}”)
2. For each user:

   * User display name
   * Up to 5–7 days of entries
   * For each day:

     * Yesterday
     * Today
     * Blockers (only if present)
3. Final section: “Missing submissions / No standup” if the system can detect that.

The AI must format this in a Slack-friendly way (sections, bullets), not as raw JSON.

---

## 9. Error & Validation Rules

* If Slack payload is missing user info, the service must reject and send a friendly error message.
* If MongoDB is not reachable at startup, the service must not start accepting Slack events.
* If a user tries to submit empty fields, the service must ask them to fill mandatory ones (yesterday, today).
* All failures to post to Slack must be logged.

---

## 10. Logging & Observability (Minimum)

* Log every incoming Slack interaction (without sensitive tokens).
* Log every successful standup creation/update.
* Log every scheduled job run (daily and weekly).
* Log errors from MongoDB or Slack.

---

## 11. Non-Functional Requirements

* **Runtime**: Node.js with TypeScript (as per scripts in package.json).
* **Build**: TypeScript builds to `dist/` and app runs from compiled JS.
* **Dependencies**: Use the libraries already defined (Slack Bolt for Slack, Mongoose for DB, Cron for scheduling, dotenv for env).
* **Security**: Slack signing secret must be verified for all incoming Slack requests.
* **Timezones**: Scheduling should respect a configurable timezone (e.g. Africa/Cairo).
