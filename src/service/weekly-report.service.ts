import StandupEntry from '../models/standupEntry';
import { slackApp } from '../singleton';
import { CHANNEL_ID } from '../config';
import { format, subDays } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

const TIMEZONE = 'Africa/Cairo';

export const generateWeeklyReport = async () => {
  try {
    const now = toZonedTime(new Date(), TIMEZONE);
    const endDate = format(now, 'yyyy-MM-dd');
    const startDate = format(subDays(now, 6), 'yyyy-MM-dd'); // Last 7 days

    console.log(`📊 Generating weekly report from ${startDate} to ${endDate}`);

    // Fetch all standups from the last 7 days
    const standups = await StandupEntry.find({
      date: { $gte: startDate, $lte: endDate }
    }).sort({ date: 1, slackUserName: 1 });

    if (standups.length === 0) {
      await slackApp.client.chat.postMessage({
        channel: CHANNEL_ID,
        text: `📊 *Weekly Standup Summary – Week of ${startDate} to ${endDate}*\n\nNo standup submissions found for this week.`
      });
      return;
    }

    // Group standups by user
    const userStandups = new Map<string, typeof standups>();
    
    for (const standup of standups) {
      const userId = standup.slackUserId;
      if (!userStandups.has(userId)) {
        userStandups.set(userId, []);
      }
      userStandups.get(userId)!.push(standup);
    }

    // Build the report
    let reportBlocks: any[] = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `📊 Weekly Standup Summary`
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Week of ${format(subDays(now, 6), 'MMM d')} – ${format(now, 'MMM d, yyyy')}*\n${userStandups.size} team members submitted standups this week.`
        }
      },
      {
        type: 'divider'
      }
    ];

    // Add each user's summary
    for (const [userId, userEntries] of userStandups) {
      const userName = userEntries[0].slackUserName;
      
      reportBlocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*<@${userId}>* – ${userEntries.length} day${userEntries.length > 1 ? 's' : ''} submitted`
        }
      });

      // Add each day's standup
      for (const entry of userEntries) {
        const dateFormatted = format(new Date(entry.date), 'EEEE, MMM d');
        
        let standupText = `*${dateFormatted}*\n`;
        standupText += `• *Yesterday:* ${entry.yesterday}\n`;
        standupText += `• *Today:* ${entry.today}`;
        
        if (entry.blockers && entry.blockers.trim()) {
          standupText += `\n• *Blockers:* ${entry.blockers}`;
        }

        if (entry.notes && entry.notes.trim()) {
          standupText += `\n• *Notes:* ${entry.notes}`;
        }

        reportBlocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: standupText
          }
        });
      }

      reportBlocks.push({
        type: 'divider'
      });
    }

    // Calculate missing submissions (optional - requires knowing expected team members)
    const daysInWeek = 5; // Sun-Thu
    const totalPossibleSubmissions = userStandups.size * daysInWeek;
    const actualSubmissions = standups.length;
    const missedSubmissions = totalPossibleSubmissions - actualSubmissions;

    if (missedSubmissions > 0) {
      reportBlocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `ℹ️ *Note:* ${missedSubmissions} submission${missedSubmissions > 1 ? 's' : ''} were missed this week based on ${daysInWeek} working days.`
          }
        ]
      });
    }

    // Send the report
    await slackApp.client.chat.postMessage({
      channel: CHANNEL_ID,
      text: `📊 Weekly Standup Summary – Week of ${startDate} to ${endDate}`,
      blocks: reportBlocks
    });

    console.log('✅ Weekly report sent successfully');

  } catch (error) {
    console.error('❌ Error generating weekly report:', error);
  }
};
