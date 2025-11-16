import { Request, Response } from 'express';
import StandupEntry from '../models/standupEntry';
import PerformanceMetrics from '../models/performanceMetrics';
import Alert from '../models/alerts';
import Achievement from '../models/achievements';
import { format, subDays, startOfMonth, endOfMonth } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { logger } from '../utils/logger';
import { APP_TIMEZONE } from '../config';

const TIMEZONE = APP_TIMEZONE;

/**
 * Export Service - Generate CSV/JSON exports of performance data
 */

/**
 * Convert array of objects to CSV
 */
function arrayToCSV(data: any[], headers: string[]): string {
  if (data.length === 0) return '';

  // Create CSV header row
  const headerRow = headers.join(',');

  // Create CSV data rows
  const dataRows = data.map(item => {
    return headers.map(header => {
      let value = item[header];
      
      // Handle different data types
      if (value === null || value === undefined) {
        return '';
      }
      
      if (typeof value === 'object') {
        value = JSON.stringify(value);
      }
      
      value = String(value);
      
      // Escape double quotes and wrap in quotes if contains comma or newline
      if (value.includes(',') || value.includes('\n') || value.includes('"')) {
        value = '"' + value.replace(/"/g, '""') + '"';
      }
      
      return value;
    }).join(',');
  });

  return headerRow + '\n' + dataRows.join('\n');
}

/**
 * Export all standups to CSV
 */
export const exportStandupsCSV = async (req: Request, res: Response) => {
  try {
    logger.info('Exporting standups to CSV');

    const period = (req.query.period as string) || 'month';
    const userId = req.query.userId as string; // Optional: filter by user

    const now = toZonedTime(new Date(), TIMEZONE);
    let startDate: string;

    switch (period) {
      case 'week':
        startDate = format(subDays(now, 7), 'yyyy-MM-dd');
        break;
      case 'month':
        startDate = format(startOfMonth(now), 'yyyy-MM-dd');
        break;
      case 'quarter':
        startDate = format(subDays(now, 90), 'yyyy-MM-dd');
        break;
      case 'year':
        startDate = format(subDays(now, 365), 'yyyy-MM-dd');
        break;
      default:
        startDate = format(startOfMonth(now), 'yyyy-MM-dd');
    }

    const query: any = { date: { $gte: startDate } };
    if (userId) {
      query.slackUserId = userId;
    }

    const standups = await StandupEntry.find(query)
      .sort({ date: -1, slackUserName: 1 })
      .lean();

    // Prepare data for CSV
    const csvData = standups.map(s => ({
      date: s.date,
      user: s.slackUserName,
      userId: s.slackUserId,
      yesterday: s.yesterday,
      today: s.today,
      blockers: s.blockers || '',
      notes: s.notes || '',
      yesterdayHours: s.yesterdayHoursEstimate || 0,
      todayHours: s.todayHoursEstimate || 0,
      totalHours: (s.yesterdayHoursEstimate || 0) + (s.todayHoursEstimate || 0),
      source: s.source,
      submittedAt: format(new Date(s.createdAt), 'yyyy-MM-dd HH:mm:ss')
    }));

    const headers = [
      'date',
      'user',
      'userId',
      'yesterday',
      'today',
      'blockers',
      'notes',
      'yesterdayHours',
      'todayHours',
      'totalHours',
      'source',
      'submittedAt'
    ];

    const csv = arrayToCSV(csvData, headers);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="standups-${period}-${format(now, 'yyyy-MM-dd')}.csv"`);
    res.send(csv);

    logger.info(`Exported ${standups.length} standups to CSV`);
  } catch (error) {
    logger.error('Error exporting standups:', error);
    res.status(500).send('Error exporting data');
  }
};

/**
 * Export performance metrics to CSV
 */
export const exportPerformanceMetricsCSV = async (req: Request, res: Response) => {
  try {
    logger.info('Exporting performance metrics to CSV');

    const period = (req.query.period as string) || 'week';
    const userId = req.query.userId as string;

    const query: any = { period };
    if (userId) {
      query.slackUserId = userId;
    }

    const metrics = await PerformanceMetrics.find(query)
      .sort({ startDate: -1, slackUserName: 1 })
      .lean();

    const csvData = metrics.map(m => ({
      startDate: m.startDate,
      endDate: m.endDate,
      period: m.period,
      user: m.slackUserName,
      userId: m.slackUserId,
      overallScore: m.overallScore,
      consistencyScore: m.consistencyScore,
      engagementScore: m.engagementScore,
      velocityTrend: m.velocityTrend,
      totalSubmissions: m.totalSubmissions,
      expectedSubmissions: m.expectedSubmissions,
      totalTasks: m.totalTasksCompleted,
      totalHours: m.totalHoursEstimated,
      avgTasksPerDay: m.averageTasksPerDay,
      blockerCount: m.blockerCount,
      blockerFrequency: m.blockerFrequency,
      sentimentScore: m.sentimentScore,
      riskLevel: m.riskLevel,
      teamAverage: m.teamAverageScore,
      percentile: m.percentileRank
    }));

    const headers = [
      'startDate',
      'endDate',
      'period',
      'user',
      'userId',
      'overallScore',
      'consistencyScore',
      'engagementScore',
      'velocityTrend',
      'totalSubmissions',
      'expectedSubmissions',
      'totalTasks',
      'totalHours',
      'avgTasksPerDay',
      'blockerCount',
      'blockerFrequency',
      'sentimentScore',
      'riskLevel',
      'teamAverage',
      'percentile'
    ];

    const csv = arrayToCSV(csvData, headers);

    const now = toZonedTime(new Date(), TIMEZONE);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="performance-metrics-${period}-${format(now, 'yyyy-MM-dd')}.csv"`);
    res.send(csv);

    logger.info(`Exported ${metrics.length} performance metrics to CSV`);
  } catch (error) {
    logger.error('Error exporting performance metrics:', error);
    res.status(500).send('Error exporting data');
  }
};

/**
 * Export alerts to CSV
 */
export const exportAlertsCSV = async (req: Request, res: Response) => {
  try {
    logger.info('Exporting alerts to CSV');

    const workspaceId = process.env.SLACK_TEAM_ID || 'default';
    const status = req.query.status as string; // 'active', 'resolved', etc.

    const query: any = { workspaceId };
    if (status) {
      query.status = status;
    }

    const alerts = await Alert.find(query)
      .sort({ createdAt: -1 })
      .lean();

    const csvData = alerts.map(a => ({
      createdAt: format(new Date(a.createdAt), 'yyyy-MM-dd HH:mm:ss'),
      type: a.type,
      severity: a.severity,
      status: a.status,
      user: a.affectedUserName,
      userId: a.affectedUserId,
      title: a.title,
      description: a.description,
      metric: a.metric || '',
      currentValue: a.currentValue || '',
      threshold: a.threshold || '',
      priority: a.priority,
      isRecurring: a.isRecurring,
      occurrenceCount: a.occurrenceCount,
      suggestedActions: a.suggestedActions.join('; ')
    }));

    const headers = [
      'createdAt',
      'type',
      'severity',
      'status',
      'user',
      'userId',
      'title',
      'description',
      'metric',
      'currentValue',
      'threshold',
      'priority',
      'isRecurring',
      'occurrenceCount',
      'suggestedActions'
    ];

    const csv = arrayToCSV(csvData, headers);

    const now = toZonedTime(new Date(), TIMEZONE);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="alerts-${format(now, 'yyyy-MM-dd')}.csv"`);
    res.send(csv);

    logger.info(`Exported ${alerts.length} alerts to CSV`);
  } catch (error) {
    logger.error('Error exporting alerts:', error);
    res.status(500).send('Error exporting data');
  }
};

/**
 * Export achievements to CSV
 */
export const exportAchievementsCSV = async (req: Request, res: Response) => {
  try {
    logger.info('Exporting achievements to CSV');

    const workspaceId = process.env.SLACK_TEAM_ID || 'default';
    const userId = req.query.userId as string;

    const query: any = { workspaceId, isActive: true };
    if (userId) {
      query.slackUserId = userId;
    }

    const achievements = await Achievement.find(query)
      .sort({ earnedAt: -1 })
      .lean();

    const csvData = achievements.map(a => ({
      earnedAt: format(new Date(a.earnedAt), 'yyyy-MM-dd HH:mm:ss'),
      user: a.slackUserName,
      userId: a.slackUserId,
      badgeName: a.badgeName,
      badgeIcon: a.badgeIcon,
      description: a.description,
      achievementType: a.achievementType,
      level: a.level,
      threshold: a.threshold
    }));

    const headers = [
      'earnedAt',
      'user',
      'userId',
      'badgeName',
      'badgeIcon',
      'description',
      'achievementType',
      'level',
      'threshold'
    ];

    const csv = arrayToCSV(csvData, headers);

    const now = toZonedTime(new Date(), TIMEZONE);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="achievements-${format(now, 'yyyy-MM-dd')}.csv"`);
    res.send(csv);

    logger.info(`Exported ${achievements.length} achievements to CSV`);
  } catch (error) {
    logger.error('Error exporting achievements:', error);
    res.status(500).send('Error exporting data');
  }
};

/**
 * Export comprehensive user report to CSV
 */
export const exportUserReportCSV = async (req: Request, res: Response) => {
  try {
    const userId = req.params.userId;
    logger.info(`Exporting user report for ${userId}`);

    const now = toZonedTime(new Date(), TIMEZONE);
    const last90Days = format(subDays(now, 90), 'yyyy-MM-dd');

    // Get user data
    const standups = await StandupEntry.find({
      slackUserId: userId,
      date: { $gte: last90Days }
    }).sort({ date: -1 }).lean();

    const metrics = await PerformanceMetrics.find({
      slackUserId: userId
    }).sort({ startDate: -1 }).lean();

    const achievements = await Achievement.find({
      slackUserId: userId,
      isActive: true
    }).lean();

    const alerts = await Alert.find({
      affectedUserId: userId
    }).sort({ createdAt: -1 }).lean();

    if (standups.length === 0) {
      res.status(404).send('No data found for this user');
      return;
    }

    const userName = standups[0].slackUserName;

    // Create comprehensive report
    const reportSections = [];

    // Section 1: Summary
    reportSections.push('=== USER SUMMARY ===');
    reportSections.push(`User,${userName}`);
    reportSections.push(`User ID,${userId}`);
    reportSections.push(`Total Standups,${standups.length}`);
    reportSections.push(`Achievements,${achievements.length}`);
    reportSections.push(`Active Alerts,${alerts.filter(a => a.status === 'active').length}`);
    reportSections.push('');

    // Section 2: Recent Standups
    reportSections.push('=== RECENT STANDUPS ===');
    reportSections.push('Date,Yesterday,Today,Blockers,Notes,Hours');
    standups.slice(0, 30).forEach(s => {
      const totalHours = (s.yesterdayHoursEstimate || 0) + (s.todayHoursEstimate || 0);
      reportSections.push(`${s.date},"${s.yesterday.replace(/"/g, '""')}","${s.today.replace(/"/g, '""')}","${(s.blockers || '').replace(/"/g, '""')}","${(s.notes || '').replace(/"/g, '""')}",${totalHours}`);
    });
    reportSections.push('');

    // Section 3: Performance Metrics
    if (metrics.length > 0) {
      reportSections.push('=== PERFORMANCE METRICS ===');
      reportSections.push('Period,Start Date,Overall Score,Consistency,Engagement,Velocity,Risk Level');
      metrics.forEach(m => {
        reportSections.push(`${m.period},${m.startDate},${m.overallScore},${m.consistencyScore},${m.engagementScore},${m.velocityTrend},${m.riskLevel}`);
      });
      reportSections.push('');
    }

    // Section 4: Achievements
    if (achievements.length > 0) {
      reportSections.push('=== ACHIEVEMENTS ===');
      reportSections.push('Badge Name,Level,Earned At,Description');
      achievements.forEach(a => {
        reportSections.push(`${a.badgeName},${a.level},${format(new Date(a.earnedAt), 'yyyy-MM-dd')},${a.description}`);
      });
      reportSections.push('');
    }

    // Section 5: Alerts
    if (alerts.length > 0) {
      reportSections.push('=== ALERTS ===');
      reportSections.push('Created At,Type,Severity,Status,Title');
      alerts.forEach(a => {
        reportSections.push(`${format(new Date(a.createdAt), 'yyyy-MM-dd')},${a.type},${a.severity},${a.status},${a.title}`);
      });
    }

    const csv = reportSections.join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="user-report-${userName}-${format(now, 'yyyy-MM-dd')}.csv"`);
    res.send(csv);

    logger.info(`Exported comprehensive report for ${userName}`);
  } catch (error) {
    logger.error('Error exporting user report:', error);
    res.status(500).send('Error exporting report');
  }
};
