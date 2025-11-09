import { endWeek } from "./end-week";
import { standupHuddleFollowUp } from "./stand-up-huddle-follow-up";
import { standupReminder } from "./stand-up-reminder";
import { startWeek } from "./start-week";
import { weeklyReport } from "./weekly-report";
import { monthlyReport } from "./monthly-report";
import { reminderNonSubmitters } from "./reminder-non-submitters";
import { dailySummary } from "./daily-summary";

export const runJobs = () => {
    console.log('✅ Starting scheduled jobs...');
    
    console.log('🕘 Starting standupReminder...');
    standupReminder.start();
    
    console.log('🕘 Starting reminderNonSubmitters...');
    reminderNonSubmitters.start();
  
    console.log('🕘 Starting standupHuddleFollowUp...');
    standupHuddleFollowUp.start();
    
    console.log('🕘 Starting dailySummary...');
    dailySummary.start();
  
    console.log('🕘 Starting startWeek...');
    startWeek.start();
  
    console.log('🕘 Starting endWeek...');
    endWeek.start();
  
    console.log('🕘 Starting weeklyReport...');
    weeklyReport.start();
  
    console.log('🕘 Starting monthlyReport...');
    monthlyReport.start();
  
    console.log('🚀 All jobs scheduled successfully!');
  };
  