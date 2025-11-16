import { CronJob } from 'cron';
import { generateWeeklyReport } from '../service/weekly-report.service';

// Weekly report job - runs every Thursday at 5:00 PM Cairo time
export const weeklyReport = new CronJob(
  process.env.WEEKLY_REPORT_CRON || '0 17 * * 4', // Default: Every Thursday at 5:00 PM
  async () => {
    try {
      console.log('📊 Running weekly report generation...');
      await generateWeeklyReport();
    } catch (err) {
      console.error('❌ Error in weekly report job:', err);
    }
  },
  null,
  true,
  'Africa/Cairo'
);
