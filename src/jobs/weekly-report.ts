import { CronJob } from 'cron';
import { generateWeeklyReport } from '../service/weekly-report.service';
import { APP_TIMEZONE } from '../config';
import { logInfo, logError } from '../utils/logger';

// Weekly report job - runs every Thursday at 5:00 PM Cairo time
export const weeklyReport = new CronJob(
  process.env.WEEKLY_REPORT_CRON || '0 17 * * 4', // Default: Every Thursday at 5:00 PM
  async () => {
    try {
      logInfo('📊 Running weekly report generation...');
      await generateWeeklyReport();
    } catch (err) {
      logError('❌ Error in weekly report job:', err);
    }
  },
  null,
  false,
  APP_TIMEZONE
);
