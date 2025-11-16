import { CronJob } from 'cron';
import { runAlertChecks } from '../service/alert-engine.service';
import { logger } from '../utils/logger';
import { APP_TIMEZONE } from '../config';

const TIMEZONE = APP_TIMEZONE;

/**
 * Daily job to run alert engine checks
 * Runs at 10:00 PM every day
 */
export const runAlertChecksJob = new CronJob(
  process.env.ALERT_CHECKS_CRON || '0 22 * * *',
  async () => {
    try {
      logger.info('🚨 Starting alert engine checks...');

      // Get workspace ID from environment (for now, single workspace)
      const workspaceId = process.env.SLACK_TEAM_ID || 'default';

      await runAlertChecks(workspaceId);

      logger.info('✅ Alert engine checks completed');
    } catch (error) {
      logger.error('❌ Error running alert checks:', error);
    }
  },
  null,
  false,
  TIMEZONE
);
