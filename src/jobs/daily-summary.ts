import { CronJob } from 'cron';
import { postDailySummaryToSlack } from '../service/ai-summary.service';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { APP_TIMEZONE } from '../config';
import { logInfo, logError } from '../utils/logger';

const TIMEZONE = APP_TIMEZONE;

// Daily summary job - runs at 4:00 PM Cairo time Sun-Thu
export const dailySummary = new CronJob(
  process.env.DAILY_SUMMARY_CRON || '0 16 * * 0-4', // Default: 4:00 PM Sun-Thu
  async () => {
    try {
      const now = toZonedTime(new Date(), TIMEZONE);
      const today = format(now, 'yyyy-MM-dd');
      
      logInfo('📋 Running daily summary generation...');
      await postDailySummaryToSlack(today);
    } catch (err) {
      logError('❌ Error in daily summary job:', err);
    }
  },
  null,
  false,
  TIMEZONE
);
