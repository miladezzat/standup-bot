import { CronJob } from 'cron';
import { postDailySummaryToSlack } from '../service/ai-summary.service';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

const TIMEZONE = 'Africa/Cairo';

// Daily summary job - runs at 4:00 PM Cairo time Mon-Fri
export const dailySummary = new CronJob(
  process.env.DAILY_SUMMARY_CRON || '0 16 * * 1-5', // Default: 4:00 PM Mon-Fri
  async () => {
    try {
      const now = toZonedTime(new Date(), TIMEZONE);
      const today = format(now, 'yyyy-MM-dd');
      
      console.log('📋 Running daily summary generation...');
      await postDailySummaryToSlack(today);
    } catch (err) {
      console.error('❌ Error in daily summary job:', err);
    }
  },
  null,
  true,
  TIMEZONE
);

