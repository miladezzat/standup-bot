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

      await calculateTeamMetrics(workspaceId, 'month');
      await calculateTeamMetrics(workspaceId, 'quarter');

      logger.info('✅ Performance metrics calculation completed');
    } catch (error) {
      logger.error('❌ Error calculating performance metrics:', error);
    }
  },
  null,
  false,
  TIMEZONE
);
