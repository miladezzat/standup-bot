import { CronJob } from 'cron';
import { calculateTeamMetrics } from '../service/performance-analysis.service';
import { logger } from '../utils/logger';
import { APP_TIMEZONE } from '../config';

const TIMEZONE = APP_TIMEZONE;

/**
 * Daily job to calculate performance metrics for all team members
 * Runs at 11:30 PM every day
 */
export const calculateMetricsJob = new CronJob(
  process.env.CALCULATE_METRICS_CRON || '30 23 * * *',
  async () => {
    try {
      logger.info('🔄 Starting daily performance metrics calculation...');

      // Get workspace ID from environment (for now, single workspace)
      const workspaceId = process.env.SLACK_TEAM_ID || 'default';

      // Calculate weekly metrics
      await calculateTeamMetrics(workspaceId, 'week');
      logger.info('✅ Weekly metrics calculated');

      // Calculate monthly metrics (on first day of month)
      const today = new Date();
      if (today.getDate() === 1) {
        await calculateTeamMetrics(workspaceId, 'month');
        logger.info('✅ Monthly metrics calculated');
      }

      // Calculate quarterly metrics (first day of quarter)
      const month = today.getMonth();
      if (today.getDate() === 1 && (month === 0 || month === 3 || month === 6 || month === 9)) {
        await calculateTeamMetrics(workspaceId, 'quarter');
        logger.info('✅ Quarterly metrics calculated');
      }

      logger.info('✅ Performance metrics calculation completed');
    } catch (error) {
      logger.error('❌ Error calculating performance metrics:', error);
    }
  },
  null,
  false,
  TIMEZONE
);
