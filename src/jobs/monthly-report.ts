import { CronJob } from 'cron';
import { generateMonthlyReport } from '../service/monthly-report.service';
import { APP_TIMEZONE } from '../config';

// Monthly report job - runs on the 1st of each month at 9:00 AM Cairo time
export const monthlyReport = new CronJob(
  process.env.MONTHLY_REPORT_CRON || '0 9 1 * *', // Default: 1st of month at 9 AM
  async () => {
    try {
      console.log('📊 Running monthly report generation...');
      await generateMonthlyReport();
    } catch (err) {
      console.error('❌ Error in monthly report job:', err);
    }
  },
  null,
  false,
  APP_TIMEZONE
);
