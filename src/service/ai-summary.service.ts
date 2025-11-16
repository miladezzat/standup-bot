import OpenAI from 'openai';
import StandupEntry from '../models/standupEntry';
import { slackApp } from '../singleton';
import { CHANNEL_ID } from '../config';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});

/**
 * Generate a natural language summary for a single standup
 */
export async function generateStandupSummary(
  userName: string,
  yesterday: string,
  today: string,
  blockers: string,
  notes: string
): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    return ''; // No AI configured
  }

  try {
    const prompt = `You are a SENIOR ENGINEERING MANAGER writing a professional summary of a developer's standup for performance tracking and team visibility.

Team member: ${userName}

Yesterday's work:
${yesterday}

Today's plan:
${today}

Blockers:
${blockers || 'None'}

Notes:
${notes || 'None'}

Write a 2-3 sentence summary that is:
- HONEST and REALISTIC (don't exaggerate or minimize)
- PROFESSIONAL (third person, clear language)
- ACTIONABLE (highlight important work and real blockers)
- SPECIFIC (mention actual features/tasks, not vague "worked on stuff")

Focus on:
1. Concrete accomplishments (what was delivered)
2. Current work (what's being built)
3. Real blockers (what's preventing progress)
4. Important notes or context to share with the team

Example GOOD summary:
"${userName} completed the payment gateway integration (50% done) and fixed three production bugs yesterday. Today, they're continuing the gateway work, researching email service options, and setting up the mobile development environment. They're blocked by a critical memory leak requiring senior developer assistance and an unstable app affecting users."

Example BAD summary:
"${userName} worked on various tasks yesterday and plans to continue working today. Some issues encountered."

Write ONLY the summary, nothing else. Be honest and specific.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 150,
    });

    const summary = completion.choices[0]?.message?.content?.trim() || '';
    return summary;
  } catch (error) {
    console.error(`Error generating summary for ${userName}:`, error);
    return '';
  }
}

/**
 * Generate daily team summary report
 */
export async function generateDailyTeamSummary(date: string): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    console.warn('OPENAI_API_KEY not configured - skipping daily summary');
    return '';
  }

  try {
    // Get all standups for the date
    const standups = await StandupEntry.find({ date }).sort({ slackUserName: 1 });

    if (standups.length === 0) {
      return '';
    }

    // Build context for the AI
    let teamContext = '';
    const blockersCount = standups.filter(s => s.blockers && s.blockers.trim()).length;
    const totalTeamHours = standups.reduce((sum, s) => sum + (s.yesterdayHoursEstimate || 0) + (s.todayHoursEstimate || 0), 0);
    
    for (const standup of standups) {
      const totalHours = (standup.yesterdayHoursEstimate || 0) + (standup.todayHoursEstimate || 0);
      teamContext += `
${standup.slackUserName} (Est: ${standup.yesterdayHoursEstimate || 0}h yesterday, ${standup.todayHoursEstimate || 0}h today = ${totalHours}h total):
Yesterday: ${standup.yesterday}
Today: ${standup.today}
Blockers: ${standup.blockers || 'None'}
Notes: ${standup.notes || 'None'}
---
`;
    }

    const prompt = `You are a SENIOR ENGINEERING MANAGER reviewing team performance. Write an HONEST, ACTIONABLE summary for leadership (CTO/CEO level).

Date: ${date}
Team Size: ${standups.length} developers
Total Estimated Hours: ${Math.round(totalTeamHours)}h
Active Blockers: ${blockersCount}

Team Standups:
${teamContext}

Write a 3-4 paragraph summary:

**1. Key Accomplishments** (What shipped? Real progress?)
- Be specific: features, bugs, integrations completed
- Note completion percentages (e.g., "50% done")
- Highlight wins worth celebrating
- Call out if progress seems low

**2. Current Focus** (What's being built today?)
- Group similar work (e.g., "3 devs on payment system")
- Mention new initiatives starting
- Note research/setup tasks
- Flag if priorities seem scattered

**3. Blockers & Risks** (What needs immediate attention?)
- CRITICAL blockers first (production issues, team blocked)
- Identify recurring problems
- Suggest what's needed (resources, decisions, help)
- Be urgent if warranted

**4. Team Health** (Honest assessment)
- Is workload reasonable? (${Math.round(totalTeamHours/standups.length)}h avg per person)
- Are estimates realistic or inflated?
- Any red flags (burnout, under-utilization, morale)?
- Overall velocity judgment

BE BRUTALLY HONEST:
- If estimates look suspicious, say so
- If blockers are critical, emphasize urgency
- If team is overloaded, call it out
- If productivity is strong, acknowledge it
- If someone seems stuck, mention it

Write like you're briefing the CEO - truth matters more than politeness.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      max_tokens: 600,
    });

    const summary = completion.choices[0]?.message?.content?.trim() || '';
    return summary;
  } catch (error) {
    console.error('Error generating daily team summary:', error);
    return '';
  }
}

/**
 * Post daily summary to Slack channel
 */
export async function postDailySummaryToSlack(date: string): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    console.log('AI summary disabled - no OpenAI API key configured');
    return;
  }

  try {
    console.log(`📝 Generating daily summary for ${date}...`);
    
    const summary = await generateDailyTeamSummary(date);
    
    if (!summary) {
      console.log('No standups to summarize for today');
      return;
    }

    // Post to Slack
    await slackApp.client.chat.postMessage({
      channel: CHANNEL_ID,
      text: `Daily Team Summary for ${date}`,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `📋 Daily Team Summary`
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${date}*`
          }
        },
        {
          type: 'divider'
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: summary
          }
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: '🤖 _AI-generated summary based on today\'s standups_'
            }
          ]
        }
      ]
    });

    console.log('✅ Daily summary posted to Slack');
  } catch (error) {
    console.error('Error posting daily summary:', error);
  }
}

/**
 * Generate and save individual summary when standup is submitted
 */
export async function generateAndSaveSummary(
  standupId: string,
  userName: string,
  yesterday: string,
  today: string,
  blockers: string,
  notes: string
): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    return '';
  }

  try {
    const summary = await generateStandupSummary(userName, yesterday, today, blockers, notes);
    
    if (summary) {
      // Update the standup entry with the summary
      await StandupEntry.findByIdAndUpdate(standupId, {
        aiSummary: summary
      });
      
      console.log(`✅ Generated summary for ${userName}`);
    }
    
    return summary;
  } catch (error) {
    console.error(`Error generating/saving summary for ${userName}:`, error);
    return '';
  }
}
