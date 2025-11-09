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
  blockers: string
): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    return ''; // No AI configured
  }

  try {
    const prompt = `You are writing a brief, professional summary of a developer's daily standup update.

Team member: ${userName}

Yesterday's work:
${yesterday}

Today's plan:
${today}

Blockers:
${blockers || 'None'}

Write a 2-3 sentence natural language summary in third person. Be concise and professional. Focus on what matters.

Example format: "${userName} completed the user authentication feature and fixed several bugs yesterday. Today, they're working on implementing the password reset functionality and writing unit tests. They're currently blocked waiting for API documentation from the backend team."

Write only the summary, nothing else.`;

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

    // Generate summaries for each team member
    const summaries: string[] = [];
    
    for (const standup of standups) {
      const summary = await generateStandupSummary(
        standup.slackUserName,
        standup.yesterday,
        standup.today,
        standup.blockers
      );
      
      if (summary) {
        summaries.push(`• ${summary}`);
      }
    }

    // Combine all summaries
    const fullReport = summaries.join('\n\n');
    
    return fullReport;
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
  blockers: string
): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    return '';
  }

  try {
    const summary = await generateStandupSummary(userName, yesterday, today, blockers);
    
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

