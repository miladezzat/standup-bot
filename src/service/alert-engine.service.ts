import StandupEntry from '../models/standupEntry';
import PerformanceMetrics from '../models/performanceMetrics';
import Alert from '../models/alerts';
import { format, subDays } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { assessRiskLevel, analyzeSentiment } from './ai-performance-analysis.service';
import { logger } from '../utils/logger';
import { APP_TIMEZONE } from '../config';

const TIMEZONE = APP_TIMEZONE;

/**
 * Alert Engine - Automatically generates alerts based on performance patterns
 */

/**
 * Create or update an alert
 */
async function createOrUpdateAlert(
  workspaceId: string,
  type: string,
  severity: string,
  userId: string,
  userName: string,
  title: string,
  description: string,
  suggestedActions: string[],
  relatedStandupIds: string[] = [],
  metric?: string,
  currentValue?: number,
  threshold?: number
) {
  try {
    // Check if similar alert already exists (to avoid duplicates)
    const existingAlert = await Alert.findOne({
      workspaceId,
      type,
      affectedUserId: userId,
      status: 'active',
      createdAt: { $gte: subDays(new Date(), 7) } // Within last 7 days
    });

    if (existingAlert) {
      // Update existing alert
      existingAlert.occurrenceCount += 1;
      existingAlert.lastOccurrence = new Date();
      existingAlert.isRecurring = existingAlert.occurrenceCount >= 2;
      existingAlert.relatedStandupIds = [
        ...new Set([...existingAlert.relatedStandupIds, ...relatedStandupIds])
      ];
      await existingAlert.save();
      logger.info(`Updated recurring alert for ${userName}: ${title}`);
      return existingAlert;
    }

    // Create new alert
    const priority = severity === 'critical' ? 10 : severity === 'warning' ? 7 : 5;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // Expire after 30 days

    const alert = await Alert.create({
      workspaceId,
      type,
      severity,
      title,
      description,
      affectedUserId: userId,
      affectedUserName: userName,
      metric,
      currentValue,
      threshold,
      relatedStandupIds,
      suggestedActions,
      status: 'active',
      isRecurring: false,
      occurrenceCount: 1,
      priority,
      expiresAt
    });

    logger.info(`Created new alert for ${userName}: ${title}`);
    return alert;
  } catch (error) {
    logger.error('Error creating/updating alert:', error);
    return null;
  }
}

/**
 * Check for declining performance (low submission rate over time)
 */
async function checkDecliningPerformance(workspaceId: string) {
  logger.info('Checking for declining performance...');

  const now = toZonedTime(new Date(), TIMEZONE);
  const last7Days = format(subDays(now, 7), 'yyyy-MM-dd');
  const last14Days = format(subDays(now, 14), 'yyyy-MM-dd');

  // Get all active users
  const users = await StandupEntry.distinct('slackUserId', {
    workspaceId,
    date: { $gte: last14Days }
  });

  for (const userId of users) {
    // Get recent 7 days and previous 7 days
    const recentStandups = await StandupEntry.countDocuments({
      slackUserId: userId,
      date: { $gte: last7Days }
    });

    const previousStandups = await StandupEntry.countDocuments({
      slackUserId: userId,
      date: { $gte: last14Days, $lt: last7Days }
    });

    // Alert if significant decline
    if (previousStandups >= 4 && recentStandups <= 2) {
      const userName = (await StandupEntry.findOne({ slackUserId: userId }))?.slackUserName || 'Unknown';
      
      await createOrUpdateAlert(
        workspaceId,
        'performance',
        'warning',
        userId,
        userName,
        'Declining Submission Rate',
        `${userName} had ${previousStandups} submissions last week but only ${recentStandups} this week. This represents a ${Math.round(((previousStandups - recentStandups) / previousStandups) * 100)}% decline.`,
        [
          'Schedule a 1-on-1 check-in',
          'Review workload and blockers',
          'Ensure team member has necessary support'
        ],
        [],
        'submissionRate',
        recentStandups,
        4
      );
    }

    // Alert if no submissions for 3+ days
    if (recentStandups === 0 && previousStandups > 0) {
      const userName = (await StandupEntry.findOne({ slackUserId: userId }))?.slackUserName || 'Unknown';
      
      await createOrUpdateAlert(
        workspaceId,
        'consistency',
        'critical',
        userId,
        userName,
        'No Recent Submissions',
        `${userName} has not submitted any standups in the last 7 days. Previous week had ${previousStandups} submissions.`,
        [
          'Reach out immediately to check if everything is okay',
          'Verify if team member is on leave or has technical issues',
          'Review onboarding/training if this is a new team member'
        ],
        [],
        'daysWithoutSubmission',
        7,
        3
      );
    }
  }
}

/**
 * Check for repeated blockers (same blocker multiple times)
 */
async function checkRepeatedBlockers(workspaceId: string) {
  logger.info('Checking for repeated blockers...');

  const now = toZonedTime(new Date(), TIMEZONE);
  const last14Days = format(subDays(now, 14), 'yyyy-MM-dd');

  const standups = await StandupEntry.find({
    workspaceId,
    date: { $gte: last14Days },
    blockers: { $ne: '', $exists: true }
  }).lean();

  // Group by user
  const userBlockers = new Map<string, any[]>();
  standups.forEach(standup => {
    if (!userBlockers.has(standup.slackUserId)) {
      userBlockers.set(standup.slackUserId, []);
    }
    userBlockers.get(standup.slackUserId)?.push(standup);
  });

  // Check for repeated blockers
  for (const [userId, userStandups] of userBlockers.entries()) {
    if (userStandups.length >= 3) {
      const userName = userStandups[0].slackUserName;
      const blockerTexts = userStandups.map(s => s.blockers.toLowerCase());
      
      // Simple keyword matching for recurring blockers
      const keywords = new Set<string>();
      blockerTexts.forEach(text => {
        const words = text
          .replace(/[^\w\s]/g, ' ')
          .split(/\s+/)
          .filter((w: string) => w.length > 4);
        words.forEach((w: string) => keywords.add(w));
      });

      // Find words that appear in multiple blockers
      const recurringKeywords = Array.from(keywords).filter(keyword => {
        const count = blockerTexts.filter(text => text.includes(keyword)).length;
        return count >= 3;
      });

      if (recurringKeywords.length > 0) {
        const standupIds = userStandups.map(s => s._id.toString());
        
        await createOrUpdateAlert(
          workspaceId,
          'blocker',
          'warning',
          userId,
          userName,
          'Recurring Blockers Detected',
          `${userName} has reported similar blockers ${userStandups.length} times in the last 14 days. Common themes: ${recurringKeywords.slice(0, 3).join(', ')}.`,
          [
            'Schedule time to help resolve persistent blockers',
            'Identify if this is a systemic issue affecting the team',
            'Provide additional resources or training',
            'Consider pair programming or mentorship'
          ],
          standupIds,
          'blockerFrequency',
          userStandups.length,
          3
        );
      }
    }
  }
}

/**
 * Check for sentiment red flags (burnout indicators)
 */
async function checkSentimentFlags(workspaceId: string) {
  if (!process.env.OPENAI_API_KEY) {
    logger.warn('OpenAI not configured - skipping sentiment analysis');
    return;
  }

  logger.info('Checking for sentiment red flags...');

  const now = toZonedTime(new Date(), TIMEZONE);
  const last7Days = format(subDays(now, 7), 'yyyy-MM-dd');

  const users = await StandupEntry.distinct('slackUserId', {
    workspaceId,
    date: { $gte: last7Days }
  });

  for (const userId of users) {
    const standups = await StandupEntry.find({
      slackUserId: userId,
      date: { $gte: last7Days }
    }).sort({ date: -1 }).limit(5).lean();

    if (standups.length < 3) continue;

    // Analyze sentiment of recent standups
    const sentiments = await Promise.all(
      standups.map(s => analyzeSentiment(`${s.yesterday} ${s.today} ${s.blockers}`))
    );

    const avgSentiment = sentiments.reduce((sum, s) => sum + s, 0) / sentiments.length;
    const negativeDays = sentiments.filter(s => s < -0.3).length;

    // Alert if consistently negative sentiment
    if (avgSentiment < -0.4 || negativeDays >= 3) {
      const userName = standups[0].slackUserName;
      const standupIds = standups.map(s => s._id.toString());

      await createOrUpdateAlert(
        workspaceId,
        'sentiment',
        'critical',
        userId,
        userName,
        'Potential Burnout Detected',
        `${userName}'s recent standups show negative sentiment patterns (score: ${(avgSentiment * 100).toFixed(0)}). ${negativeDays} out of ${standups.length} recent updates indicate stress or frustration.`,
        [
          'Schedule immediate 1-on-1 to discuss wellbeing',
          'Review workload and consider redistributing tasks',
          'Discuss work-life balance and time off options',
          'Check for team conflicts or external stressors'
        ],
        standupIds,
        'sentimentScore',
        Math.round(avgSentiment * 100),
        -30
      );
    }
  }
}

/**
 * Check for overwork risk (too many hours)
 */
async function checkOverworkRisk(workspaceId: string) {
  logger.info('Checking for overwork risk...');

  const now = toZonedTime(new Date(), TIMEZONE);
  const last7Days = format(subDays(now, 7), 'yyyy-MM-dd');

  const users = await StandupEntry.distinct('slackUserId', {
    workspaceId,
    date: { $gte: last7Days }
  });

  for (const userId of users) {
    const standups = await StandupEntry.find({
      slackUserId: userId,
      date: { $gte: last7Days }
    }).lean();

    const totalHours = standups.reduce((sum, s) => 
      sum + (s.yesterdayHoursEstimate || 0) + (s.todayHoursEstimate || 0), 0
    );

    // Alert if working >50 hours per week (assuming 5-day week)
    if (totalHours > 50 && standups.length >= 3) {
      const userName = standups[0].slackUserName;
      const avgHoursPerDay = Math.round(totalHours / standups.length);
      const standupIds = standups.map(s => s._id.toString());

      await createOrUpdateAlert(
        workspaceId,
        'capacity',
        'warning',
        userId,
        userName,
        'High Workload Detected',
        `${userName} is estimated to be working ${totalHours}h over ${standups.length} days (avg ${avgHoursPerDay}h/day). This may lead to burnout.`,
        [
          'Review task priorities and defer non-critical work',
          'Redistribute tasks to other team members',
          'Discuss realistic deadlines and expectations',
          'Ensure team member takes breaks and time off'
        ],
        standupIds,
        'weeklyHours',
        totalHours,
        50
      );
    }
  }
}

/**
 * Check for underutilization (<20 hours per week)
 */
async function checkUnderutilization(workspaceId: string) {
  logger.info('Checking for underutilization...');

  const now = toZonedTime(new Date(), TIMEZONE);
  const last7Days = format(subDays(now, 7), 'yyyy-MM-dd');

  const users = await StandupEntry.distinct('slackUserId', {
    workspaceId,
    date: { $gte: last7Days }
  });

  for (const userId of users) {
    const standups = await StandupEntry.find({
      slackUserId: userId,
      date: { $gte: last7Days }
    }).lean();

    // Only check if they've been submitting regularly
    if (standups.length < 4) continue;

    const totalHours = standups.reduce((sum, s) => 
      sum + (s.yesterdayHoursEstimate || 0) + (s.todayHoursEstimate || 0), 0
    );

    // Alert if working <20 hours per week
    if (totalHours < 20) {
      const userName = standups[0].slackUserName;
      const standupIds = standups.map(s => s._id.toString());

      await createOrUpdateAlert(
        workspaceId,
        'capacity',
        'info',
        userId,
        userName,
        'Low Activity Detected',
        `${userName} reported only ${totalHours}h of work over ${standups.length} days. They may be blocked or have capacity for additional tasks.`,
        [
          'Check if team member has sufficient work assigned',
          'Identify any hidden blockers preventing progress',
          'Consider assigning new projects or initiatives',
          'Verify if this is accurate or if estimates need calibration'
        ],
        standupIds,
        'weeklyHours',
        totalHours,
        20
      );
    }
  }
}

/**
 * Run all alert checks
 */
export async function runAlertChecks(workspaceId: string) {
  logger.info('Running alert engine checks...');

  try {
    await checkDecliningPerformance(workspaceId);
    await checkRepeatedBlockers(workspaceId);
    await checkSentimentFlags(workspaceId);
    await checkOverworkRisk(workspaceId);
    await checkUnderutilization(workspaceId);

    // Auto-resolve old alerts (no longer relevant)
    const resolvedCount = await Alert.updateMany(
      {
        workspaceId,
        status: 'active',
        expiresAt: { $lt: new Date() }
      },
      {
        status: 'dismissed',
        resolution: 'Auto-resolved: Alert expired'
      }
    );

    if (resolvedCount.modifiedCount > 0) {
      logger.info(`Auto-resolved ${resolvedCount.modifiedCount} expired alerts`);
    }

    logger.info('Alert engine checks completed');
  } catch (error) {
    logger.error('Error running alert checks:', error);
  }
}
