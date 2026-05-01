import { WebClient } from '@slack/web-api';
import dotenv from 'dotenv';
import { format, isToday, isYesterday, isThisWeek } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { APP_TIMEZONE } from './config';
import type { SlackMessage } from './service/standup-history.service';
import StandupEntry from './models/standupEntry';
import { getReportUserExclusionFilter, isIncludedInReports } from './utils/report-exclusions';
import { renderIcon } from './config/view-engine';

const timeZone = APP_TIMEZONE;

dotenv.config();

const userCache = new Map<string, any>();

export const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case '\'':
        return '&#39;';
      default:
        return ch;
    }
  });

const token = process.env.SLACK_BOT_TOKEN; // Ensure this has the necessary scopes
const web = new WebClient(token);

export function formatStandupHTML(input: string): string {
  let normalizedInput = input
    .replace(/🕒\s*(Yesterday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i, (m, day) => `${day.toLowerCase()}:`)
    .replace(/🗓️\s*Today/i, 'today:')
    .replace(/🚧\s*Blockers/i, 'blockers:');

  const firstSectionLabels = ['yesterday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

  // Helper to escape regex special chars if needed
  const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Parse a section with flexible label(s) and next sections
  function parseSection(labels: string[] | string, iconName: string, nextSections: string[]): string {
    // Convert single string label to array
    if (typeof labels === 'string') labels = [labels];

    // Build regex for start labels (e.g. yesterday|monday|tuesday)
    const startLabelsRegex = labels.map(escapeRegex).join('|');

    // Build regex for next section headers
    const nextLabelsRegex = nextSections.length > 0 ? nextSections.map(escapeRegex).join('|') : null;

    const regexStr = nextLabelsRegex
      ? `(${startLabelsRegex}):([^]*?)(?=\\b(${nextLabelsRegex}):|$)`
      : `(${startLabelsRegex}):([^]*?)$`;

    const regex = new RegExp(regexStr, 'i');
    const match = normalizedInput.match(regex);

    if (!match) return '';

    // match[2] contains the section content
    const sectionText = match[2];

    // Split items by newlines, bullets, or numbered lists
    const rawItems = sectionText
      .split(/\n|[•\-–]|\d+\./)
      .map(item => item.trim())
      .filter(item => item.length > 0);

    const formattedItems = rawItems.map(parseSlackFormatting);

    // Label display (use the first matched label with first letter capitalized)
    const displayLabel = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();

    return `
      <h3 style="margin-top: 1.5em; display: flex; align-items: center; gap: 8px; font-size: 1.1rem; color: #2c3e50;">
        ${renderIcon(iconName, 'icon-sm')} ${displayLabel}
      </h3>
      <ul style="list-style-type: disc; padding-left: 1.5em;">
        ${formattedItems.map(item => `<li style="margin-bottom: 0.7em; line-height: 1.5;">${item}</li>`).join('\n')}
      </ul>
    `;
  }

  return `
    <div style="font-family: 'Inter', Arial, sans-serif; line-height: 1.6; max-width: 700px; padding: 0.5em 1em; background-color: #fff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
      ${parseSection(firstSectionLabels, 'clock', ['today', 'blockers'])}
      ${parseSection('today', 'calendar-check', ['blockers'])}
      ${parseSection('blockers', 'octagon-alert', [])}
    </div>
  `.trim();
}



export function parseSlackFormatting(text: string) {
    if (!text) return '';

    let formatted = text;

    // Handle user mentions: <@U123ABC> to @U123ABC placeholder
    formatted = formatted.replace(/<@([A-Z0-9]+)>/g, '@$1');

    // Handle links with labels: <https://example.com|Example> -> Example (https://example.com)
    formatted = formatted.replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, '$2 ($1)');

    // Handle plain links: <https://example.com> -> https://example.com
    formatted = formatted.replace(/<(https?:\/\/[^>]+)>/g, '$1');

    // Handle channel mentions: <#C123ABC|channel-name> -> #channel-name
    formatted = formatted.replace(/<#([A-Z0-9]+)\|([^>]+)>/g, '#$2');

    return escapeHtml(formatted);
}


export async function getUserName(userId?: string): Promise<{ name: string, avatarUrl?: string, email?: string }> {
    if (!userId) return {
        name: 'Unknown',
        avatarUrl: undefined,
        email: undefined,
    };

    if (userCache.has(userId)) return userCache.get(userId)!;
    try {
        const result = await web.users.info({ user: userId });
        const avatarUrl = result.user?.profile?.image_72;
        const email = result.user?.profile?.email;

        const name =
            result.user?.profile?.real_name ||
            result.user?.name ||
            `@${userId}`;

        userCache.set(userId, { name, avatarUrl, email });

        return { name, avatarUrl, email };
    } catch (err) {
        console.error(`Error fetching user ${userId}:`, err);
        return { name: `@${userId}`, avatarUrl: undefined, email: undefined };
    }
}


export function formatCairoDate(tsSeconds: number): string {
    const date = new Date(tsSeconds * 1000);
    const cairoDate = toZonedTime(date, timeZone);

    if (isToday(cairoDate)) {
        return `Today at ${format(cairoDate, 'h:mm a')}`;
    } else if (isYesterday(cairoDate)) {
        return `Yesterday at ${format(cairoDate, 'h:mm a')}`;
    } else if (isThisWeek(cairoDate, { weekStartsOn: 1 })) {
        return `${format(cairoDate, 'EEEE')} at ${format(cairoDate, 'h:mm a')}`;
    } else {
        return `${format(cairoDate, 'MMMM do')} at ${format(cairoDate, 'h:mm a')}`;
    }
}

export interface HistoryStandupEntry {
    slackUserId: string;
    slackUserName: string;
    date: string;
    yesterday?: string;
    today?: string;
    blockers?: string;
    notes?: string;
    isDayOff?: boolean;
    dayOffReason?: string;
    createdAt?: Date | string;
    updatedAt?: Date | string;
}

interface GenerateDateAnalyticsOptions {
    replies?: SlackMessage[];
    standupEntries?: HistoryStandupEntry[];
}

const countTasksFromText = (text?: string) => {
    if (!text) return 0;
    const matches = text.match(/[•\-–]|\d+\./g);
    if (matches && matches.length > 0) return matches.length;
    return text.trim().length > 0 ? 1 : 0;
};

const hasMeaningfulBlocker = (blockers?: string) => {
    const value = blockers?.trim().toLowerCase();
    return Boolean(value && value !== 'none' && value !== 'n/a');
};

const collectTopics = (text: string, topics: Map<string, number>) => {
    const stopWords = ['today', 'yesterday', 'blockers', 'working', 'going', 'about', 'with', 'this', 'that', 'have', 'from', 'will', 'would', 'should', 'could', 'been', 'were', 'they', 'their', 'there', 'what', 'when', 'where', 'which', 'while', 'whom', 'whose'];
    const words = text.toLowerCase()
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '')
        .split(/\s+/);

    for (const word of words) {
        if (word.length > 4 && !stopWords.includes(word)) {
            topics.set(word, (topics.get(word) || 0) + 1);
        }
    }
};

export async function generateDateAnalytics(thread: any, options: GenerateDateAnalyticsOptions = {}) {
    try {
        const replies = (options.replies || []).filter(
            (m): m is SlackMessage =>
                m.ts !== thread.threadTs && typeof m.user === 'string' && typeof m.text === 'string'
        );

        const standupsForDate = options.standupEntries ||
            await StandupEntry.find({ date: thread.date, ...getReportUserExclusionFilter() }).lean() as unknown as HistoryStandupEntry[];

        if (replies.length === 0 && standupsForDate.length === 0) {
            return '';
        }

        const participants = new Set<string>();
        const userTaskCounts = new Map<string, number>();
        const userBlockers = new Map<string, string>();
        const standupByUser = new Map<string, HistoryStandupEntry>();

        standupsForDate.forEach(entry => {
            standupByUser.set(entry.slackUserId, entry);
        });

        const topics = new Map();
        let totalMessageLength = 0;
        let yesterdayItemsCount = 0;
        let todayItemsCount = 0;
        let blockerItemsCount = 0;

        const threadStartTime = Number.parseFloat(thread.threadTs || '0');
        const responseTimes: number[] = [];

        for (const entry of standupsForDate) {
            participants.add(entry.slackUserId);
            const taskCount = entry.isDayOff
                ? 0
                : countTasksFromText(entry.yesterday) + countTasksFromText(entry.today);

            userTaskCounts.set(entry.slackUserId, taskCount);
            yesterdayItemsCount += entry.isDayOff ? 0 : countTasksFromText(entry.yesterday);
            todayItemsCount += entry.isDayOff ? 0 : countTasksFromText(entry.today);

            if (hasMeaningfulBlocker(entry.blockers)) {
                userBlockers.set(entry.slackUserId, entry.blockers || 'Has blockers');
                blockerItemsCount += countTasksFromText(entry.blockers);
            }

            const combinedText = [entry.yesterday, entry.today, entry.blockers, entry.notes].filter(Boolean).join(' ');
            totalMessageLength += combinedText.length;
            collectTopics(combinedText, topics);

            if (entry.createdAt && Number.isFinite(threadStartTime) && threadStartTime > 0) {
                const createdAtSeconds = new Date(entry.createdAt).getTime() / 1000;
                responseTimes.push((createdAtSeconds - threadStartTime) / 3600);
            }
        }

        for (const reply of replies) {
            if (!reply.text || !reply.user || reply.user === 'U08T0FLAJ11' || !isIncludedInReports(reply.user)) continue;
            const userId = reply.user;
            const hasStoredEntry = standupByUser.has(userId);
            participants.add(userId);

            if (hasStoredEntry) {
                continue;
            }

            const replyTime = parseFloat(reply.ts);
            if (Number.isFinite(replyTime) && Number.isFinite(threadStartTime) && threadStartTime > 0) {
                responseTimes.push((replyTime - threadStartTime) / 3600);
            }

            totalMessageLength += reply.text.length;
            userTaskCounts.set(userId, userTaskCounts.get(userId) || 0);

            if (reply.text.toLowerCase().includes('blocker:') &&
                !reply.text.toLowerCase().includes('blocker: none') &&
                !reply.text.toLowerCase().includes('blockers: none')) {
                userBlockers.set(userId, 'Having difficulties with current task');
            }

            const days = "yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday";
            const regex = new RegExp(`(${days}):([^]*?)(?=(\\b${days}:|\\bblockers:|$))`, "i");

            if (reply.text.toLowerCase().includes('yesterday:')) {
                const match = reply.text.match(regex);
                if (match) {
                    const sectionText = match[2] || '';
                    const items = sectionText.split(/[•\-–]|\d+\./)
                        .map(item => item.trim())
                        .filter(item => item.length > 0);

                    yesterdayItemsCount += items.length;
                    userTaskCounts.set(userId, (userTaskCounts.get(userId) || 0) + items.length);
                }
            }

            if (reply.text.toLowerCase().includes('today:')) {
                const match = reply.text.match(/today:([^]*?)(?=(\byesterday:|\bblockers:|$))/i);
                if (match) {
                    const items = (match[1] || '').split(/[•\-–]|\d+\./).filter(item => item.trim().length > 0);
                    todayItemsCount += items.length;
                    userTaskCounts.set(userId, (userTaskCounts.get(userId) || 0) + items.length);
                }
            }

            if (reply.text.toLowerCase().includes('blockers:')) {
                const match = reply.text.match(/blockers:([^]*?)(?=(\byesterday:|\btoday:|$))/i);
                if (match) {
                    const blockerText = (match[1] || '').trim().toLowerCase();
                    if (blockerText !== 'none' && blockerText.length > 0) {
                        const items = (match[1] || '').split(/[•\-–]|\d+\./).filter(item => item.trim().length > 0);
                        blockerItemsCount += items.length;
                    }
                }
            }

            collectTopics(reply.text, topics);
        }

        const teamSize = Math.max(standupsForDate.length, 18);
        const responseRate = Math.round((participants.size / teamSize) * 100);
        const totalTasks = yesterdayItemsCount + todayItemsCount;
        const avgTasksPerPerson = participants.size > 0
            ? Math.round((totalTasks / participants.size) * 10) / 10
            : 0;

        const recentStandups = [...standupsForDate]
            .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
            .slice(0, 5);
        const recentReplyUsers = replies
            .map(reply => reply.user)
            .filter((userId): userId is string => Boolean(userId && !standupByUser.has(userId)))
            .slice(0, Math.max(0, 5 - recentStandups.length));
        let recentSubmissionsHTML = '';

        for (const entry of recentStandups) {
            const name = entry.slackUserName || entry.slackUserId;
            const submittedAt = entry.createdAt ? formatCairoDate(new Date(entry.createdAt).getTime() / 1000) : 'Stored submission';
            recentSubmissionsHTML += `
            <div class="submission-item">
                <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=2980b9&color=fff" alt="${escapeHtml(name)}" class="submission-avatar">
                <div class="submission-name">${escapeHtml(name)}</div>
                <div class="submission-time">${submittedAt}</div>
            </div>
            `;
        }

        for (const userId of recentReplyUsers) {
            const { name, avatarUrl } = await getUserName(userId);
            recentSubmissionsHTML += `
            <div class="submission-item">
                <img src="${avatarUrl || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(name) + '&background=2980b9&color=fff'}" alt="${name}" class="submission-avatar">
                <div class="submission-name">${name}</div>
                <div class="submission-time">Slack reply</div>
            </div>
            `;
        }

        let blockersHTML = '';

        for (const [userId, blockerText] of userBlockers.entries()) {
            const standupEntry = standupByUser.get(userId);
            const name = standupEntry?.slackUserName || (await getUserName(userId)).name;
            blockersHTML += `
            <div class="blocker-item">
                <div class="blocker-user">
                    <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=2980b9&color=fff" alt="${escapeHtml(name)}" class="blocker-avatar">
                    <div class="blocker-name">${escapeHtml(name)}</div>
                </div>
                <div class="blocker-text">${escapeHtml(blockerText)}</div>
            </div>
            `;
        }

        const teamMemberIds = new Set<string>(participants as Set<string>);
        for (const entry of standupsForDate) {
            teamMemberIds.add(entry.slackUserId);
        }

        let teamMembersHTML = '';
        for (const userId of teamMemberIds) {
            const standupEntry = standupByUser.get(userId);
            const fallbackUser = standupEntry ? undefined : await getUserName(userId);
            const name = standupEntry?.slackUserName || fallbackUser?.name || userId;
            const avatarUrl = fallbackUser?.avatarUrl;
            const hasBlocker = userBlockers.has(userId);
            const isDayOff = Boolean(standupEntry?.isDayOff);
            const dayOffReason = standupEntry?.dayOffReason ? escapeHtml(standupEntry.dayOffReason) : '';
            const entryTaskCount = !isDayOff && standupEntry
                ? countTasksFromText(standupEntry.yesterday) + countTasksFromText(standupEntry.today)
                : 0;
            const taskCount = userTaskCounts.get(userId) ?? entryTaskCount;
            const statusBadge = isDayOff
                ? '<span class="status-badge status-dayoff">OOO</span>'
                : '<span class="status-badge status-submitted">submitted</span>';

            teamMembersHTML += `
            <div class="team-member-card ${isDayOff ? 'team-member-dayoff' : ''}">
                <div class="team-user">
                    <img src="${avatarUrl || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(name) + '&background=2980b9&color=fff'}" alt="${escapeHtml(name)}" class="team-avatar">
                    <div class="team-name">${escapeHtml(name)}${isDayOff ? ` <span class="team-dayoff-label">${renderIcon('plane', 'icon-sm')} OOO</span>` : ''}</div>
                </div>
                <div class="team-member-details">
                    <div class="team-member-item">
                        <div class="team-member-label">Status</div>
                        ${statusBadge}
                    </div>
                    <div class="team-member-item">
                        <div class="team-member-label">Tasks</div>
                        <div class="team-member-value">${taskCount || 0}</div>
                    </div>
                    <div class="team-member-item">
                        <div class="team-member-label">Blockers</div>
                        <div class="team-member-value">${hasBlocker ? '<span class="blocker-badge">Yes</span>' : 'None'}</div>
                    </div>
                </div>
                ${isDayOff && dayOffReason ? `<div class="dayoff-note">${dayOffReason}</div>` : ''}
            </div>
            `;
        }

        const actualTeamSize = teamMemberIds.size;

        // Format the date for display
        const formattedDate = new Date(thread.date).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });

        const itemsPerPage = 5; // Number of team members per page
        const totalPages = Math.ceil(actualTeamSize / itemsPerPage);
        let paginationHTML = '';

        if (totalPages > 1) {
            paginationHTML = `
            <div class="pagination">
                <div class="page-item page-prev" ${1 === 1 ? 'disabled' : ''}>←</div>
            `;

            for (let i = 1; i <= Math.min(totalPages, 5); i++) {
                paginationHTML += `<div class="page-item ${i === 1 ? 'active' : ''}" data-page="${i}">${i}</div>`;
            }

            paginationHTML += `
                <div class="page-item page-next" ${1 === totalPages ? 'disabled' : ''}>→</div>
            </div>
            `;
        }

        return `
        <div class="dashboard-header">
            <div>
                <div class="dashboard-title">${renderIcon('calendar-days', 'icon-md')} Daily Standup Dashboard</div>
                <div class="dashboard-date">Track team progress and daily activities</div>
            </div>
            <div class="dashboard-actions">
                <div class="dashboard-date">${formattedDate}</div>
                <button class="dashboard-button">${renderIcon('chart-column', 'icon-sm')} Daily Report</button>
            </div>
        </div>
        
        <div class="metrics-grid">
            <div class="metric-card">
                <div class="metric-header">
                    <div>Team Members</div>
                    <div class="metric-icon" style="background-color: #3498db;">${renderIcon('users', 'icon-sm')}</div>
                </div>
                <div class="metric-value">${actualTeamSize}</div>
                <div class="metric-label">Total active members</div>
                <div class="metric-progress">
                    <div class="metric-progress-bar" style="width: 100%; background-color: #3498db;"></div>
                </div>
            </div>
            
            <div class="metric-card">
                <div class="metric-header">
                    <div>Submissions Today</div>
                    <div class="metric-icon" style="background-color: #2ecc71;">${renderIcon('circle-check', 'icon-sm')}</div>
                </div>
                <div class="metric-value">${participants.size}/${teamSize}</div>
                <div class="metric-label">${responseRate}% completion rate</div>
                <div class="metric-progress">
                    <div class="metric-progress-bar" style="width: ${responseRate}%; background-color: #2ecc71;"></div>
                </div>
            </div>
            
            <div class="metric-card">
                <div class="metric-header">
                    <div>Avg Tasks/Day</div>
                    <div class="metric-icon" style="background-color: #9b59b6;">${renderIcon('notebook-pen', 'icon-sm')}</div>
                </div>
                <div class="metric-value">${avgTasksPerPerson}</div>
                <div class="metric-label">Tasks completed per person</div>
                <div class="metric-progress">
                    <div class="metric-progress-bar" style="width: ${Math.min(avgTasksPerPerson * 20, 100)}%; background-color: #9b59b6;"></div>
                </div>
            </div>
            
            <div class="metric-card">
                <div class="metric-header">
                    <div>Active Blockers</div>
                    <div class="metric-icon" style="background-color: #e74c3c;">${renderIcon('octagon-alert', 'icon-sm')}</div>
                </div>
                <div class="metric-value">${userBlockers.size}</div>
                <div class="metric-label">Requiring attention</div>
                <div class="metric-progress">
                    <div class="metric-progress-bar" style="width: ${Math.min(userBlockers.size * 25, 100)}%; background-color: #e74c3c;"></div>
                </div>
            </div>
        </div>
        
        <div class="submissions-section">
            <div class="submissions-header">${renderIcon('refresh-cw', 'icon-sm')} Recent Submissions</div>
            <div class="submission-list">
                ${recentSubmissionsHTML || '<div>No recent submissions</div>'}
            </div>
        </div>
        
        <div class="blockers-section">
            <div class="blockers-header">${renderIcon('triangle-alert', 'icon-sm')} Active Blockers</div>
            <div class="blocker-list">
                ${blockersHTML || '<div>No active blockers</div>'}
            </div>
        </div>
        
        <div class="team-section">
            <div class="team-header">${renderIcon('users', 'icon-sm')} Team Members (${actualTeamSize})</div>
            <div class="team-members-grid">
                ${teamMembersHTML}
            </div>
            ${paginationHTML}
        </div>
        `;
    } catch (error) {
        console.error(`Error generating analytics for ${thread.date}:`, error);
        return '';
    }
}

// ============================================
// 🔧 SHARED UTILITY FUNCTIONS
// ============================================

/**
 * Parse duration string to minutes
 * Examples: "20mins", "1hr", "30m", "2hours"
 */
export function parseDurationToMinutes(durationStr: string): number | null {
  const match = durationStr.trim().match(/^(\d+)\s*(mins?|minutes?|m|hrs?|hours?|h)$/i);
  if (!match) return null;
  
  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  
  if (unit.startsWith('h')) {
    return value * 60;
  }
  return value;
}

/**
 * Format minutes to human-readable duration
 */
export function formatMinutesToDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min${minutes !== 1 ? 's' : ''}`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  if (remainingMins === 0) {
    return `${hours} hour${hours !== 1 ? 's' : ''}`;
  }
  return `${hours}h ${remainingMins}m`;
}

/**
 * Parse time string (HH:mm) to { hours, minutes }
 */
export function parseTimeString(timeStr: string): { hours: number; minutes: number } | null {
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }
  
  return { hours, minutes };
}

/**
 * Escape HTML characters to prevent XSS
 */
export function escapeHtmlChars(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return ch;
    }
  });
}

/**
 * Sanitize user input for display
 */
export function sanitizeInput(input: string): string {
  return escapeHtmlChars(input.trim());
}
