import StandupEntry from '../models/standupEntry';
import { format, subDays, startOfDay, endOfDay } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { APP_TIMEZONE } from '../config';

const TIMEZONE = APP_TIMEZONE;

/**
 * Generate contribution graph data for a user
 * Similar to GitHub's contribution graph
 * OPTIMIZED: Uses single query instead of N queries
 */
export async function getUserContributions(
  slackUserId: string,
  days: number = 90
): Promise<ContributionDay[]> {
  const now = toZonedTime(new Date(), TIMEZONE);
  const startDate = format(subDays(now, days - 1), 'yyyy-MM-dd');
  
  // Fetch all standups for the date range in ONE query
  const standups = await StandupEntry.find({
    slackUserId,
    date: { $gte: startDate },
  }).lean();

  // Create a map for quick lookup
  const standupMap = new Map(
    standups.map((s) => [s.date, s])
  );

  // Generate array of dates for the last N days
  const contributions: ContributionDay[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = subDays(now, i);
    const dateString = format(date, 'yyyy-MM-dd');
    const standup = standupMap.get(dateString);

    contributions.push({
      date: dateString,
      count: standup ? 1 : 0,
      hasSubmission: !!standup,
      hasBlockers: standup?.blockers ? standup.blockers.trim().length > 0 : false,
      estimatedHours: (standup?.yesterdayHoursEstimate || 0) + (standup?.todayHoursEstimate || 0),
    });
  }

  return contributions;
}

/**
 * Get user's current streak
 * OPTIMIZED: Uses single query instead of 365 queries
 */
export async function getUserStreak(slackUserId: string): Promise<StreakInfo> {
  const now = toZonedTime(new Date(), TIMEZONE);
  const startDate = format(subDays(now, 364), 'yyyy-MM-dd');
  
  // Fetch all standups for the last 365 days in ONE query
  const standups = await StandupEntry.find({
    slackUserId,
    date: { $gte: startDate },
  })
    .select('date')
    .lean();

  // Create a Set for O(1) lookup
  const submissionDates = new Set(standups.map((s) => s.date));
  
  let currentStreak = 0;
  let longestStreak = 0;
  let tempStreak = 0;
  const totalSubmissions = standups.length;

  // Check last 365 days
  for (let i = 0; i < 365; i++) {
    const date = subDays(now, i);
    const dateString = format(date, 'yyyy-MM-dd');
    const hasSubmission = submissionDates.has(dateString);

    if (hasSubmission) {
      tempStreak++;
      
      if (i === 0 || currentStreak > 0) {
        currentStreak = tempStreak;
      }
      
      if (tempStreak > longestStreak) {
        longestStreak = tempStreak;
      }
    } else {
      if (currentStreak > 0 && i === 0) {
        // Streak broke today
        currentStreak = 0;
      }
      tempStreak = 0;
    }
  }

  return {
    current: currentStreak,
    longest: longestStreak,
    total: totalSubmissions,
  };
}

/**
 * Generate HTML for contribution graph
 */
export function generateContributionGraphHTML(
  contributions: ContributionDay[],
  streak: StreakInfo
): string {
  // Group contributions by week
  const weeks: ContributionDay[][] = [];
  let currentWeek: ContributionDay[] = [];

  contributions.forEach((day, index) => {
    currentWeek.push(day);
    if (currentWeek.length === 7 || index === contributions.length - 1) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
  });

  let html = `
<div class="contribution-section">
    <div class="streak-stats">
        <div class="streak-stat">
            <div class="streak-number">${streak.current}</div>
            <div class="streak-label">🔥 Current Streak</div>
        </div>
        <div class="streak-stat">
            <div class="streak-number">${streak.longest}</div>
            <div class="streak-label">🏆 Longest Streak</div>
        </div>
        <div class="streak-stat">
            <div class="streak-number">${streak.total}</div>
            <div class="streak-label">📊 Total Standups</div>
        </div>
    </div>

    <div class="contribution-graph">
        <div class="graph-label">${contributions.length} days of activity</div>
        <div class="graph-grid">
`;

  // Generate grid of contribution cells
  weeks.forEach((week) => {
    html += '<div class="graph-week">';
    week.forEach((day) => {
      const level = getContributionLevel(day);
      const tooltip = formatTooltip(day);
      
      html += `
            <div class="graph-day ${level}" 
                 data-date="${day.date}" 
                 data-count="${day.count}"
                 data-hours="${day.estimatedHours}"
                 title="${tooltip}">
            </div>
      `;
    });
    html += '</div>';
  });

  html += `
        </div>
        <div class="graph-legend">
            <span>Less</span>
            <div class="legend-day level-0"></div>
            <div class="legend-day level-1"></div>
            <div class="legend-day level-2"></div>
            <div class="legend-day level-3"></div>
            <div class="legend-day level-4"></div>
            <span>More</span>
        </div>
    </div>
</div>
`;

  return html;
}

/**
 * Get contribution level (0-4) based on activity
 */
function getContributionLevel(day: ContributionDay): string {
  if (!day.hasSubmission) return 'level-0';
  
  // Level based on estimated hours
  const hours = day.estimatedHours;
  
  if (hours === 0) return 'level-1'; // Submitted but no estimate
  if (hours < 4) return 'level-2';
  if (hours < 7) return 'level-3';
  return 'level-4'; // 7+ hours
}

/**
 * Format tooltip for contribution day
 */
function formatTooltip(day: ContributionDay): string {
  if (!day.hasSubmission) {
    return `${day.date}: No standup`;
  }

  let tooltip = `${day.date}: Standup submitted`;
  
  if (day.estimatedHours > 0) {
    tooltip += ` (${day.estimatedHours}h)`;
  }
  
  if (day.hasBlockers) {
    tooltip += ' ⚠️ Had blockers';
  }

  return tooltip;
}

/**
 * Get contribution graph CSS
 */
export function getContributionGraphCSS(): string {
  return `
<style>
.contribution-section {
    background: white;
    padding: 2.5rem;
    border-radius: 16px;
    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
    margin-bottom: 2rem;
    border: 1px solid rgba(102, 126, 234, 0.1);
    position: relative;
    overflow: hidden;
}

.contribution-section::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 4px;
    background: linear-gradient(90deg, #667eea, #764ba2);
}

.streak-stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 1.5rem;
    margin-bottom: 2.5rem;
}

.streak-stat {
    text-align: center;
    padding: 1.75rem 1.5rem;
    background: linear-gradient(135deg, #f8fafc, #ffffff);
    border-radius: 12px;
    border: 2px solid #f1f5f9;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    position: relative;
    overflow: hidden;
}

.streak-stat::before {
    content: '';
    position: absolute;
    top: 0;
    left: -100%;
    width: 100%;
    height: 100%;
    background: linear-gradient(90deg, transparent, rgba(102, 126, 234, 0.05), transparent);
    transition: left 0.5s;
}

.streak-stat:hover::before {
    left: 100%;
}

.streak-stat:hover {
    transform: translateY(-4px);
    box-shadow: 0 10px 20px rgba(102, 126, 234, 0.15);
    border-color: #667eea;
}

.streak-number {
    font-size: 3rem;
    font-weight: 800;
    background: linear-gradient(135deg, #667eea, #764ba2);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    line-height: 1;
    margin-bottom: 0.5rem;
}

.streak-label {
    font-size: 0.875rem;
    font-weight: 600;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-top: 0.75rem;
}

.contribution-graph {
    overflow-x: auto;
    padding: 1.5rem 0;
}

.contribution-graph::-webkit-scrollbar {
    height: 8px;
}

.contribution-graph::-webkit-scrollbar-track {
    background: #f1f5f9;
    border-radius: 10px;
}

.contribution-graph::-webkit-scrollbar-thumb {
    background: linear-gradient(90deg, #667eea, #764ba2);
    border-radius: 10px;
}

.graph-label {
    font-size: 0.9375rem;
    font-weight: 600;
    color: #475569;
    margin-bottom: 1.5rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

.graph-label::before {
    content: '📊';
    font-size: 1.25rem;
}

.graph-grid {
    display: flex;
    gap: 4px;
    padding: 1rem;
    background: #f8fafc;
    border-radius: 12px;
    border: 1px solid #e2e8f0;
}

.graph-week {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.graph-day {
    width: 14px;
    height: 14px;
    border-radius: 3px;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    cursor: pointer;
    border: 1px solid transparent;
}

.graph-day:hover {
    transform: scale(1.4);
    z-index: 10;
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
    border-color: rgba(102, 126, 234, 0.3);
}

.graph-day.level-0 {
    background: #e2e8f0;
}

.graph-day.level-0:hover {
    background: #cbd5e1;
}

.graph-day.level-1 {
    background: linear-gradient(135deg, #bfdbfe, #93c5fd);
}

.graph-day.level-2 {
    background: linear-gradient(135deg, #93c5fd, #60a5fa);
}

.graph-day.level-3 {
    background: linear-gradient(135deg, #60a5fa, #3b82f6);
}

.graph-day.level-4 {
    background: linear-gradient(135deg, #3b82f6, #2563eb);
}

.graph-legend {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.75rem;
    font-size: 0.8125rem;
    font-weight: 600;
    color: #64748b;
    margin-top: 1rem;
    padding: 0 1rem;
}

.legend-day {
    width: 14px;
    height: 14px;
    border-radius: 3px;
    transition: all 0.2s;
}

.legend-day:hover {
    transform: scale(1.2);
}

@media (max-width: 768px) {
    .contribution-section {
        padding: 1.5rem;
    }
    
    .streak-stats {
        grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
        gap: 1rem;
    }
    
    .streak-stat {
        padding: 1.25rem 1rem;
    }
    
    .streak-number {
        font-size: 2.25rem;
    }
    
    .graph-day {
        width: 11px;
        height: 11px;
    }
    
    .legend-day {
        width: 11px;
        height: 11px;
    }
    
    .graph-grid {
        padding: 0.75rem;
    }
}

@media (max-width: 480px) {
    .streak-stats {
        grid-template-columns: 1fr;
    }
    
    .graph-day {
        width: 10px;
        height: 10px;
    }
    
    .legend-day {
        width: 10px;
        height: 10px;
    }
}
</style>
`;
}

// Types
export interface ContributionDay {
  date: string;
  count: number;
  hasSubmission: boolean;
  hasBlockers: boolean;
  estimatedHours: number;
}

export interface StreakInfo {
  current: number;
  longest: number;
  total: number;
}
