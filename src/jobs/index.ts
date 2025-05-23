import { endWeek } from "./end-week";
import { standupHuddleFollowUp } from "./stand-up-huddle-follow-up";
import { standupReminder } from "./stand-up-reminder";
import { startWeek } from "./start-week";

export const runJobs = () => {
    console.log('✅ Starting scheduled jobs...');
    
    console.log('🕘 Starting standupHuddleFollowUp...');
    standupHuddleFollowUp.start();
  
    console.log('🕘 Starting standupReminder...');
    standupReminder.start();
  
    console.log('🕘 Starting startWeek...');
    startWeek.start();
  
    console.log('🕘 Starting endWeek...');
    endWeek.start();
  
    console.log('🚀 All jobs scheduled successfully!');
  };
  