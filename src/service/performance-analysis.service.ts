import StandupEntry from '../models/standupEntry';
import PerformanceMetrics from '../models/performanceMetrics';
import { format, subDays, startOfWeek, startOfMonth, startOfQuarter } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { logger } from '../utils/logger';
import { APP_TIMEZONE, SLACK_TEAM_ID } from '../config';
import { getReportUserExclusionFilter } from '../utils/report-exclusions';

import { completedTasks, reportedHours, hasBlockers, isFullDayOff, submissionRate } from '../utils/standup-metrics';

const TIMEZONE = APP_TIMEZONE;
const WORKING_WEEK_START = 0;

/**
 * Detect recurring blocker patterns
 */
export function detectRecurringBlockers(standups: any[]): string[] {
  const blockerKeywords: Map<string, number> = new Map();

  standups.forEach(standup => {
    if (!hasBlockers(standup)) return;

    // Extract keywords from blockers
    const words = standup.blockers
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((word: string) => word.length > 3); // Filter short words

    new Set<string>(words).forEach((word: string) => {
      blockerKeywords.set(word, (blockerKeywords.get(word) || 0) + 1);
    });
  });

  // Return keywords that appear 3+ times
  return Array.from(blockerKeywords.entries())
    .filter(([_, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word as string);
}

/**
 * Assess risk level for a team member
 */
export async function assessRiskLevel(
  slackUserId: string,
  days: number = 30,
  workspaceId: string = SLACK_TEAM_ID,
  asOf: Date = new Date()
): Promise<{ level: 'low' | 'medium' | 'high'; factors: string[]; score: number }> {
  const now = toZonedTime(asOf, TIMEZONE);
  const startDate = format(subDays(now, days - 1), 'yyyy-MM-dd');

  const standups = await StandupEntry.find({
    workspaceId,
    slackUserId,
    date: { $gte: startDate, $lte: format(now, 'yyyy-MM-dd') }
  }).sort({ date: -1 }).lean();

  if (standups.length === 0) {
    return { level: 'low', factors: [], score: 0 };
  }

  const factors: string[] = [];
  let riskScore = 0;

  // Factor 1: Low submission rate
  const rate = submissionRate(standups, startDate, format(now, 'yyyy-MM-dd')).rate;
  if (rate < 0.5) {
    factors.push(`Low submission rate (${Math.round(rate * 100)}%)`);
    riskScore += 30;
  } else if (rate < 0.7) {
    factors.push(`Inconsistent submissions (${Math.round(rate * 100)}%)`);
    riskScore += 15;
  }

  // Factor 2: High blocker frequency
  const blockerCount = standups.filter(hasBlockers).length;
  const blockerRate = blockerCount / Math.max(1, standups.filter(s => !isFullDayOff(s)).length);
  if (blockerRate > 0.5) {
    factors.push(`Frequent blockers (${Math.round(blockerRate * 100)}% of days)`);
    riskScore += 25;
  } else if (blockerRate > 0.3) {
    factors.push(`Regular blockers (${Math.round(blockerRate * 100)}% of days)`);
    riskScore += 10;
  }

  // Compare disjoint date windows, including days with no submission.
  const splitDate = format(subDays(now, Math.ceil(days / 2) - 1), 'yyyy-MM-dd');
  const olderEnd = format(subDays(now, Math.ceil(days / 2)), 'yyyy-MM-dd');
  const endDate = format(now, 'yyyy-MM-dd');
  const recentRate = submissionRate(standups, splitDate, endDate);
  const olderRate = submissionRate(standups, startDate, olderEnd);
  if (recentRate.expected && olderRate.expected && olderRate.count > 0 && recentRate.rate < olderRate.rate * 0.7) {
    factors.push('Declining submission frequency');
    riskScore += 20;
  }

  const lastWeekStart = format(subDays(now, 6), 'yyyy-MM-dd');
  const recentHours = standups.filter(s => s.date >= lastWeekStart).reduce((sum, s) => sum + reportedHours(s), 0);

  if (recentHours > 70) {
    factors.push(`High workload (${recentHours}h in last week)`);
    riskScore += 15;
  }

  // Determine level
  let level: 'low' | 'medium' | 'high';
  if (riskScore >= 50) {
    level = 'high';
  } else if (riskScore >= 25) {
    level = 'medium';
  } else {
    level = 'low';
  }

  return { level, factors, score: Math.min(100, riskScore) };
}

/**
 * Calculate velocity trend
 */
export function calculateVelocityTrend(standups: any[]): 'increasing' | 'stable' | 'decreasing' {
  if (standups.length < 10) return 'stable';

  const sorted = standups.filter(s => !isFullDayOff(s)).sort((a, b) => b.date.localeCompare(a.date));
  const midpoint = Math.floor(sorted.length / 2);
  if (!midpoint) return 'stable';
  const recentStandups = sorted.slice(0, midpoint);
  const olderStandups = sorted.slice(midpoint);
  const recentTaskCount = recentStandups.reduce((sum, s) => sum + completedTasks(s), 0);
  const olderTaskCount = olderStandups.reduce((sum, s) => sum + completedTasks(s), 0);

  const recentAvg = recentTaskCount / Math.max(1, recentStandups.length);
  const olderAvg = olderTaskCount / Math.max(1, olderStandups.length);

  const changePercent = ((recentAvg - olderAvg) / Math.max(0.1, olderAvg)) * 100;

  if (changePercent > 15) return 'increasing';
  if (changePercent < -15) return 'decreasing';
  return 'stable';
}

/**
 * Calculate performance metrics for a user over a period
 */
export async function calculatePerformanceMetrics(
  slackUserId: string,
  period: 'week' | 'month' | 'quarter',
  workspaceId: string,
  asOf: Date = new Date()
): Promise<any> {
  const now = toZonedTime(asOf, TIMEZONE);
  const startDate = period === 'week' ? startOfWeek(now, { weekStartsOn: WORKING_WEEK_START })
    : period === 'month' ? startOfMonth(now) : startOfQuarter(now);
  // Current periods are measured only through today, not against future days.
  const endDate = now;

  const startDateStr = format(startDate, 'yyyy-MM-dd');
  const endDateStr = format(endDate, 'yyyy-MM-dd');

  // Fetch standups
  const standups = await StandupEntry.find({
    workspaceId,
    slackUserId,
    date: { $gte: startDateStr, $lte: endDateStr }
  }).sort({ date: -1 }).lean();

  if (standups.length === 0) {
    return null; // No data
  }

  const userName = standups[0].slackUserName;

  // Calculate metrics
  const workEntries = standups.filter(s => !isFullDayOff(s));
  const totalSubmissions = workEntries.length;
  const attendance = submissionRate(standups, startDateStr, endDateStr);
  const expectedSubmissions = attendance.expected;
  const consistencyScore = Math.min(100, Math.round(attendance.rate * 100));
  const totalTasks = workEntries.reduce((sum, s) => sum + completedTasks(s), 0);
  const totalHoursEstimated = workEntries.reduce((sum, s) => sum + reportedHours(s), 0);
  const averageTasksPerDay = totalTasks / Math.max(1, totalSubmissions);

  // Blocker metrics
  const blockerStandups = standups.filter(hasBlockers);
  const blockerCount = blockerStandups.length;
  const blockerFrequency = (blockerCount / Math.max(1, totalSubmissions)) * 100;
  const recurringBlockers = detectRecurringBlockers(standups);

  // Submission time analysis
  const submissionTimes = workEntries.map(s => {
    const local = toZonedTime(new Date(s.createdAt), TIMEZONE);
    const hour = local.getHours();
    const minute = local.getMinutes();
    return hour * 60 + minute; // Minutes since midnight
  });
  
  const avgSubmissionMinutes = submissionTimes.reduce((sum, t) => sum + t, 0) / Math.max(1, submissionTimes.length);
  const roundedMinutes = Math.round(avgSubmissionMinutes) % 1440;
  const avgHour = Math.floor(roundedMinutes / 60);
  const avgMinute = roundedMinutes % 60;
  const averageSubmissionTime = `${String(avgHour).padStart(2, '0')}:${String(avgMinute).padStart(2, '0')}`;
  
  const lateSubmissions = submissionTimes.filter(t => t > 12 * 60).length; // After 12pm

  // Sentiment & Risk
  const riskAssessment = await assessRiskLevel(slackUserId, 30, workspaceId, asOf);
  
  // Velocity trend
  const velocityTrend = calculateVelocityTrend(standups);

  // Engagement score (0-100)
  let engagementScore = 0;
  engagementScore += Math.min(40, consistencyScore * 0.4); // 40 points for consistency
  engagementScore += Math.min(30, averageTasksPerDay * 5); // 30 points for task output
  engagementScore += blockerFrequency < 30 ? 20 : 10; // 20 points for low blockers
  engagementScore += lateSubmissions < totalSubmissions * 0.3 ? 10 : 5; // 10 points for timely submissions

  // Overall performance score (0-100)
  let overallScore = 0;
  overallScore += Math.min(30, consistencyScore * 0.3); // 30% weight
  overallScore += Math.min(25, engagementScore * 0.25); // 25% weight
  overallScore += velocityTrend === 'increasing' ? 20 : velocityTrend === 'stable' ? 15 : 5; // 20% weight
  overallScore += riskAssessment.level === 'low' ? 25 : riskAssessment.level === 'medium' ? 15 : 5; // 25% weight

  return {
    slackUserId,
    slackUserName: userName,
    workspaceId,
    period,
    startDate: startDateStr,
    endDate: endDateStr,
    totalSubmissions,
    expectedSubmissions,
    consistencyScore,
    totalTasksCompleted: totalTasks,
    totalHoursEstimated: Math.round(totalHoursEstimated),
    averageTasksPerDay: Math.round(averageTasksPerDay * 10) / 10,
    velocityTrend,
    blockerCount,
    blockerDays: blockerCount,
    blockerFrequency: Math.round(blockerFrequency),
    recurringBlockers,
    engagementScore: Math.round(engagementScore),
    averageSubmissionTime,
    lateSubmissions,
    sentimentScore: 0,
    sentimentTrend: 'stable',
    riskLevel: riskAssessment.level,
    riskFactors: riskAssessment.factors,
    overallScore: Math.round(overallScore),
    teamAverageScore: 0, // Will be calculated separately
    percentileRank: 50, // Will be calculated separately
  };
}

/**
 * Calculate team-wide metrics and update percentiles
 */
export async function calculateTeamMetrics(
  workspaceId: string,
  period: 'week' | 'month' | 'quarter'
): Promise<void> {
  logger.info(`Calculating team metrics for period: ${period}`);

  // Get all unique users
  const users = await StandupEntry.distinct('slackUserId', {
    workspaceId,
    ...getReportUserExclusionFilter()
  });

  // Calculate metrics for each user
  const allMetrics = [];
  for (const userId of users) {
    const metrics = await calculatePerformanceMetrics(userId, period, workspaceId);
    if (metrics) {
      allMetrics.push(metrics);
    }
  }

  if (allMetrics.length === 0) return;

  // Calculate team average
  const teamAverageScore = allMetrics.reduce((sum, m) => sum + m.overallScore, 0) / allMetrics.length;

  // Sort by overall score for percentile calculation
  allMetrics.sort((a, b) => b.overallScore - a.overallScore);

  // Update each metric with team average and percentile
  for (let i = 0; i < allMetrics.length; i++) {
    const metrics = allMetrics[i];
    const percentileRank = ((allMetrics.length - i) / allMetrics.length) * 100;

    metrics.teamAverageScore = Math.round(teamAverageScore);
    metrics.percentileRank = Math.round(percentileRank);

    // Save or update in database
    await PerformanceMetrics.findOneAndUpdate(
      {
        workspaceId,
        slackUserId: metrics.slackUserId,
        period: metrics.period,
        startDate: metrics.startDate
      },
      metrics,
      { upsert: true, new: true }
    );
  }

  logger.info(`Team metrics calculated for ${allMetrics.length} users`);
}
