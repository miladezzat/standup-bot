import { endWeek } from "./end-week";
import { standupHuddleFollowUp } from "./stand-up-huddle-follow-up";
import { standupReminder } from "./stand-up-reminder";
import { startWeek } from "./start-week";
import { weeklyReport } from "./weekly-report";
import { monthlyReport } from "./monthly-report";
import { reminderNonSubmitters } from "./reminder-non-submitters";
import { hourlyReminderNonSubmitters } from "./hourly-reminder-non-submitters";
import { dailySummary } from "./daily-summary";
import { calculateMetricsJob } from "./calculate-metrics";
import { runAlertChecksJob } from "./run-alert-checks";
import { pushCodeReminder } from "./push-code-reminder";
import { logInfo } from "../utils/logger";

export const runJobs = () => {
    logInfo('✅ Starting scheduled jobs...');
    
    logInfo('🕘 Starting standupReminder...');
    standupReminder.start();
    
    logInfo('🕘 Starting reminderNonSubmitters...');
    reminderNonSubmitters.start();
    
    logInfo('🕘 Starting hourlyReminderNonSubmitters...');
    hourlyReminderNonSubmitters.start();
  
    logInfo('🕘 Starting standupHuddleFollowUp...');
    standupHuddleFollowUp.start();
    
    // Daily summary disabled - view on dashboard instead
    // logInfo('🕘 Starting dailySummary...');
    // dailySummary.start();
  
    logInfo('🕘 Starting startWeek...');
    startWeek.start();
  
    logInfo('🕘 Starting endWeek...');
    endWeek.start();
  
    logInfo('🕘 Starting weeklyReport...');
    weeklyReport.start();
  
    logInfo('🕘 Starting monthlyReport...');
    monthlyReport.start();
  
    logInfo('🕘 Starting calculateMetricsJob...');
    calculateMetricsJob.start();
  
    logInfo('🕘 Starting runAlertChecksJob...');
    runAlertChecksJob.start();
  
    logInfo('🕘 Starting pushCodeReminder...');
    pushCodeReminder.start();
  
    logInfo('🚀 All jobs scheduled successfully!');
  };
  