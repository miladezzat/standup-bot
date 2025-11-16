import StandupEntry from '../models/standupEntry';
import { slackApp } from '../singleton';
import { CHANNEL_ID } from '../config';
import { format, subDays, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

const TIMEZONE = 'Africa/Cairo';

interface UserStats {
  userId: string;
  userName: string;
  totalSubmissions: number;
  submissionDates: string[];
  blockerCount: number;
  avgTasksPerDay: number;
  missedDays: number;
}

export const generateMonthlyReport = async () => {
  try {
    const now = toZonedTime(new Date(), TIMEZONE);
    
    // Get the previous month's start and end dates
    const lastMonthEnd = endOfMonth(subDays(now, now.getDate()));
    const lastMonthStart = startOfMonth(lastMonthEnd);
    
    const startDate = format(lastMonthStart, 'yyyy-MM-dd');
    const endDate = format(lastMonthEnd, 'yyyy-MM-dd');
    
    const monthName = format(lastMonthEnd, 'MMMM yyyy');

    console.log(`📊 Generating monthly report for ${monthName} (${startDate} to ${endDate})`);

    // Fetch all standups from last month
    const standups = await StandupEntry.find({
      date: { $gte: startDate, $lte: endDate }
    }).sort({ date: 1 });

    if (standups.length === 0) {
      await slackApp.client.chat.postMessage({
        channel: CHANNEL_ID,
        text: `📊 *Monthly Standup Report – ${monthName}*\n\nNo standup submissions found for this month.`
      });
      return;
    }

    // Calculate working days in the month (Sun-Thu)
    const allDaysInMonth = eachDayOfInterval({ start: lastMonthStart, end: lastMonthEnd });
    const workingDays = allDaysInMonth.filter(day => {
      const dayOfWeek = day.getDay();
      return dayOfWeek <= 4; // Sunday = 0, Thursday = 4
    });

    // Group standups by user and calculate statistics
    const userStatsMap = new Map<string, UserStats>();
    
    for (const standup of standups) {
      if (!userStatsMap.has(standup.slackUserId)) {
        userStatsMap.set(standup.slackUserId, {
          userId: standup.slackUserId,
          userName: standup.slackUserName,
          totalSubmissions: 0,
          submissionDates: [],
          blockerCount: 0,
          avgTasksPerDay: 0,
          missedDays: 0
        });
      }

      const stats = userStatsMap.get(standup.slackUserId)!;
      stats.totalSubmissions++;
      stats.submissionDates.push(standup.date);
      
      if (standup.blockers && standup.blockers.trim() && 
          !standup.blockers.toLowerCase().includes('none') &&
          !standup.blockers.toLowerCase().includes('no blocker')) {
        stats.blockerCount++;
      }

      // Estimate tasks (count bullet points or lines)
      const yesterdayTasks = (standup.yesterday.match(/[•\-–]|\d+\./g) || []).length || 1;
      const todayTasks = (standup.today.match(/[•\-–]|\d+\./g) || []).length || 1;
      stats.avgTasksPerDay += (yesterdayTasks + todayTasks) / 2;
    }

    // Calculate missed days for each user
    for (const stats of userStatsMap.values()) {
      stats.avgTasksPerDay = Math.round((stats.avgTasksPerDay / stats.totalSubmissions) * 10) / 10;
      stats.missedDays = workingDays.length - stats.totalSubmissions;
    }

    // Sort users by submission count (descending)
    const sortedUsers = Array.from(userStatsMap.values()).sort((a, b) => 
      b.totalSubmissions - a.totalSubmissions
    );

    // Calculate overall statistics
    const totalSubmissions = standups.length;
    const uniqueUsers = userStatsMap.size;
    const avgSubmissionsPerUser = Math.round((totalSubmissions / uniqueUsers) * 10) / 10;
    const completionRate = Math.round((totalSubmissions / (workingDays.length * uniqueUsers)) * 100);
    const totalBlockers = standups.filter(s => 
      s.blockers && s.blockers.trim() && 
      !s.blockers.toLowerCase().includes('none')
    ).length;

    // Build the report
    let reportBlocks: any[] = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `📊 Monthly Standup Report`
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${monthName}*`
        }
      },
      {
        type: 'divider'
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*📅 Working Days*\n${workingDays.length} days`
          },
          {
            type: 'mrkdwn',
            text: `*👥 Active Users*\n${uniqueUsers} members`
          },
          {
            type: 'mrkdwn',
            text: `*✅ Total Submissions*\n${totalSubmissions}`
          },
          {
            type: 'mrkdwn',
            text: `*📈 Completion Rate*\n${completionRate}%`
          },
          {
            type: 'mrkdwn',
            text: `*📊 Avg per User*\n${avgSubmissionsPerUser} submissions`
          },
          {
            type: 'mrkdwn',
            text: `*🚧 Total Blockers*\n${totalBlockers}`
          }
        ]
      },
      {
        type: 'divider'
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*📋 Individual Performance*'
        }
      }
    ];

    // Add top performers
    const topPerformers = sortedUsers.slice(0, 3);
    if (topPerformers.length > 0) {
      let topPerformersText = '*🏆 Top Contributors:*\n';
      topPerformers.forEach((user, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉';
        const percentage = Math.round((user.totalSubmissions / workingDays.length) * 100);
        topPerformersText += `${medal} <@${user.userId}> – ${user.totalSubmissions}/${workingDays.length} days (${percentage}%)\n`;
      });
      
      reportBlocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: topPerformersText
        }
      });
    }

    // Add detailed user statistics
    reportBlocks.push({
      type: 'divider'
    });

    reportBlocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*📊 Detailed Statistics by User:*'
      }
    });

    for (const user of sortedUsers) {
      const percentage = Math.round((user.totalSubmissions / workingDays.length) * 100);
      const progressBar = generateProgressBar(percentage);
      
      let userText = `*<@${user.userId}>*\n`;
      userText += `${progressBar} ${percentage}%\n`;
      userText += `✅ ${user.totalSubmissions}/${workingDays.length} days`;
      
      if (user.blockerCount > 0) {
        userText += ` • 🚧 ${user.blockerCount} blocker${user.blockerCount > 1 ? 's' : ''}`;
      }
      
      if (user.missedDays > 0) {
        userText += ` • ⚠️ ${user.missedDays} missed`;
      }

      reportBlocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: userText
        }
      });
    }

    // Add insights
    reportBlocks.push({
      type: 'divider'
    });

    let insights = '*💡 Insights:*\n';
    if (completionRate >= 90) {
      insights += '• 🎉 Excellent team engagement! Keep up the great work!\n';
    } else if (completionRate >= 70) {
      insights += '• 👍 Good team participation. Room for improvement!\n';
    } else {
      insights += '• ⚠️ Team participation could be improved. Consider reminders.\n';
    }

    if (totalBlockers > uniqueUsers * 2) {
      insights += '• 🚧 High number of blockers reported. Consider a team sync to address challenges.\n';
    }

    const mostConsistent = sortedUsers.find(u => u.totalSubmissions === workingDays.length);
    if (mostConsistent) {
      insights += `• 🌟 <@${mostConsistent.userId}> had perfect attendance!\n`;
    }

    reportBlocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: insights
      }
    });

    reportBlocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Report generated on ${format(now, 'MMMM d, yyyy')} | View details at your dashboard`
        }
      ]
    });

    // Send the report
    await slackApp.client.chat.postMessage({
      channel: CHANNEL_ID,
      text: `📊 Monthly Standup Report – ${monthName}`,
      blocks: reportBlocks
    });

    console.log('✅ Monthly report sent successfully');

  } catch (error) {
    console.error('❌ Error generating monthly report:', error);
  }
};

function generateProgressBar(percentage: number): string {
  const filled = Math.round(percentage / 10);
  const empty = 10 - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}
