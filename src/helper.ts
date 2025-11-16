import { WebClient } from '@slack/web-api';
import dotenv from 'dotenv';
import { format, isToday, isYesterday, isThisWeek } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { slackWebClient } from './singleton';
import { CHANNEL_ID } from './config';
import { SlackMessage } from './service/standup-history.service';
import StandupEntry from './models/standupEntry';

const timeZone = 'Africa/Cairo';

dotenv.config();

const userCache = new Map<string, any>();

const escapeHtml = (text: string) =>
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
  function parseSection(labels: string[] | string, icon: string, nextSections: string[]): string {
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
        <span style="font-size: 1.2em;">${icon}</span> ${displayLabel}
      </h3>
      <ul style="list-style-type: disc; padding-left: 1.5em;">
        ${formattedItems.map(item => `<li style="margin-bottom: 0.7em; line-height: 1.5;">${item}</li>`).join('\n')}
      </ul>
    `;
  }

  return `
    <div style="font-family: 'Inter', Arial, sans-serif; line-height: 1.6; max-width: 700px; padding: 0.5em 1em; background-color: #fff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
      ${parseSection(firstSectionLabels, '🕒', ['today', 'blockers'])}
      ${parseSection('today', '🗓️', ['blockers'])}
      ${parseSection('blockers', '🚧', [])}
    </div>
  `.trim();
}



export function parseSlackFormatting(text: string) {
    if (!text) return '';

    // Handle user mentions: <@U123ABC> to @username
    let formatted = text.replace(/<@([A-Z0-9]+)>/g, '@user');

    // Handle links: <https://example.com|Example> to <a href="https://example.com">Example</a>
    formatted = formatted.replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, '<a href="$1" target="_blank" rel="noopener noreferrer" style="color: #2980b9; text-decoration: none; border-bottom: 1px dotted #2980b9; transition: color 0.2s ease;">$2</a>');

    // Handle plain links: <https://example.com> to <a href="https://example.com">https://example.com</a>
    formatted = formatted.replace(/<(https?:\/\/[^>]+)>/g, '<a href="$1" target="_blank" rel="noopener noreferrer" style="color: #2980b9; text-decoration: none; border-bottom: 1px dotted #2980b9; transition: color 0.2s ease;">$1</a>');

    // Handle channel mentions: <#C123ABC|channel-name> to #channel-name
    formatted = formatted.replace(/<#([A-Z0-9]+)\|([^>]+)>/g, '<span style="color: #2980b9; font-weight: 500;">#$2</span>');

    // Handle emojis: :smile: (leave as is for now, could replace with actual emojis)

    return formatted;
}


export async function getUserName(userId?: string): Promise<{ name: string, avatarUrl?: string }> {
    if (!userId) return {
        name: 'Unknown',
        avatarUrl: undefined,
    };

    if (userCache.has(userId)) return userCache.get(userId)!;
    try {
        const result = await web.users.info({ user: userId });
        const avatarUrl = result.user?.profile?.image_72;

        const name =
            result.user?.profile?.real_name ||
            result.user?.name ||
            `@${userId}`;

        userCache.set(userId, { name, avatarUrl });

        return { name, avatarUrl };
    } catch (err) {
        console.error(`Error fetching user ${userId}:`, err);
        return { name: `@${userId}`, avatarUrl: undefined };
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

export async function generateDateAnalytics(thread: any) {
    try {
        const result = await slackWebClient.conversations.replies({
            channel: CHANNEL_ID,
            ts: thread.threadTs,
        });

        const replies = result.messages?.filter(
            (m): m is SlackMessage =>
                m.ts !== thread.threadTs && typeof m.user === 'string' && typeof m.text === 'string'
        ) || [];

        // Skip if no replies
        if (replies.length === 0) {
            return '';
        }

        // Count unique participants (excluding the bot)
        const participants = new Set();
        const userTaskCounts = new Map();
        const userBlockers = new Map();
        const userStatuses = new Map();

        // Track all team members (active and inactive)
        // In a real implementation, you would fetch this from your user database or Slack API
        const teamSize = 18; // Adjusted based on the design

        // Extract common topics and blockers
        const topics = new Map();
        let blockerCount = 0;
        let totalMessageLength = 0;
        let yesterdayItemsCount = 0;
        let todayItemsCount = 0;
        let blockerItemsCount = 0;

        // Track response times
        const threadStartTime = parseFloat(thread.threadTs);
        const responseTimes: number[] = [];

        // Track days of the week for participation
        const date = new Date(threadStartTime * 1000);
        const dayOfWeek = date.getDay(); // 0 = Sunday, 1 = Monday, etc.

        // Track message lengths for distribution
        const messageLengths: number[] = [];

        for (const reply of replies) {
            if (!reply.text || reply.user === 'U08T0FLAJ11') continue;

            // Calculate response time in hours
            const replyTime = parseFloat(reply.ts);
            const responseTimeHours = (replyTime - threadStartTime) / 3600;
            responseTimes.push(responseTimeHours);

            // Track message length
            totalMessageLength += reply.text.length;
            messageLengths.push(reply.text.length);

            // Track user status and participation
            if (reply.user) {
                participants.add(reply.user);
                userStatuses.set(reply.user, 'submitted');

                // Initialize task count if not exists
                if (!userTaskCounts.has(reply.user)) {
                    userTaskCounts.set(reply.user, 0);
                }
            }

            // Count blockers
            let hasBlocker = false;
            if (reply.text.toLowerCase().includes('blocker:') &&
                !reply.text.toLowerCase().includes('blocker: none') &&
                !reply.text.toLowerCase().includes('blockers: none')) {
                blockerCount++;
                hasBlocker = true;
                if (reply.user) {
                    userBlockers.set(reply.user, true);
                }
            }

            // Count section items
            // Count section items
            const days = "yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday";
            const regex = new RegExp(`(${days}):([^]*?)(?=(\\b${days}:|\\bblockers:|$))`, "i");


            if (reply.text.toLowerCase().includes('yesterday:')) { // You can keep or remove this check as optimization
                const match = reply.text.match(regex);
                if (match) {
                    // match[1] is the day name ("yesterday" or "monday", etc)
                    // match[2] is the section text we want to split into items
                    const sectionText = match[2];

                    // Split by common bullet characters or numbered lists
                    const items = sectionText.split(/[•\-–]|\d+\./)
                        .map(item => item.trim())
                        .filter(item => item.length > 0);

                    yesterdayItemsCount += items.length;

                    // Add to user's task count safely
                    if (reply.user) {
                        const currentCount = userTaskCounts.get(reply.user) || 0;
                        userTaskCounts.set(reply.user, currentCount + items.length);
                    }
                }
            }


            if (reply.text.toLowerCase().includes('today:')) {
                const match = reply.text.match(/today:([^]*?)(?=(\byesterday:|\bblockers:|$))/i);
                if (match) {
                    const items = match[1].split(/[•\-–]|\d+\./).filter(item => item.trim().length > 0);
                    todayItemsCount += items.length;

                    // Add to user's task count
                    if (reply.user) {
                        userTaskCounts.set(reply.user, userTaskCounts.get(reply.user) + items.length);
                    }
                }
            }

            if (reply.text.toLowerCase().includes('blockers:')) {
                const match = reply.text.match(/blockers:([^]*?)(?=(\byesterday:|\btoday:|$))/i);
                if (match) {
                    const blockerText = match[1].trim().toLowerCase();
                    // Check if blocker is "none" or empty
                    if (blockerText !== 'none' && blockerText.length > 0) {
                        const items = match[1].split(/[•\-–]|\d+\./).filter(item => item.trim().length > 0);
                        blockerItemsCount += items.length;
                    }
                }
            }

            // Extract keywords for topics (improved approach)
            const words = reply.text.toLowerCase()
                .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '')
                .split(/\s+/);

            const stopWords = ['today', 'yesterday', 'blockers', 'working', 'going', 'about', 'with', 'this', 'that', 'have', 'from', 'will', 'would', 'should', 'could', 'been', 'were', 'they', 'their', 'there', 'what', 'when', 'where', 'which', 'while', 'whom', 'whose'];

            for (const word of words) {
                // Only consider words of reasonable length that aren't common stopwords
                if (word.length > 4 && !stopWords.includes(word)) {
                    const count = topics.get(word) || 0;
                    topics.set(word, count + 1);
                }
            }
        }

        // Get top topics
        const topTopics = Array.from(topics.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(entry => ({ text: entry[0], count: entry[1] }));

        // Calculate response rate
        const responseRate = Math.round((participants.size / teamSize) * 100);

        // Calculate average message length
        const avgMessageLength = Math.round(totalMessageLength / participants.size);

        // Calculate response time distribution
        const earlyResponses = responseTimes.filter(time => time <= 1).length;
        const normalResponses = responseTimes.filter(time => time > 1 && time <= 3).length;
        const lateResponses = responseTimes.filter(time => time > 3 && time <= 8).length;
        const veryLateResponses = responseTimes.filter(time => time > 8).length;

        // Calculate total tasks
        const totalTasks = yesterdayItemsCount + todayItemsCount;

        // Calculate average tasks per person
        const avgTasksPerPerson = Math.round((totalTasks / participants.size) * 10) / 10;

        // Generate recent submissions (last 5 users)
        const recentUsers = Array.from(participants).slice(0, 5);
        let recentSubmissionsHTML = '';

        for (const userId of recentUsers) {
            const { name, avatarUrl } = await getUserName(userId as string);
            recentSubmissionsHTML += `
            <div class="submission-item">
                <img src="${avatarUrl || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(name) + '&background=2980b9&color=fff'}" alt="${name}" class="submission-avatar">
                <div class="submission-name">${name}</div>
                <div class="submission-time">Today</div>
            </div>
            `;
        }

        // Generate blockers list
        let blockersHTML = '';

        for (const [userId, hasBlocker] of userBlockers.entries()) {
            if (hasBlocker) {
                const { name, avatarUrl } = await getUserName(userId);
                blockersHTML += `
                <div class="blocker-item">
                    <div class="blocker-user">
                        <img src="${avatarUrl || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(name) + '&background=2980b9&color=fff'}" alt="${name}" class="blocker-avatar">
                        <div class="blocker-name">${name}</div>
                    </div>
                    <div class="blocker-text">Having difficulties with current task</div>
                </div>
                `;
            }
        }

        const standupsForDate = await StandupEntry.find({ date: thread.date }).lean();
        const standupByUser = new Map<string, (typeof standupsForDate)[number]>();
        standupsForDate.forEach(entry => {
            standupByUser.set(entry.slackUserId, entry);
        });

        const teamMemberIds = new Set<string>(participants as Set<string>);
        for (const entry of standupsForDate) {
            teamMemberIds.add(entry.slackUserId);
        }

        const countTasksFromText = (text?: string) => {
            if (!text) return 0;
            const matches = text.match(/[•\-–]|\d+\./g);
            if (matches && matches.length > 0) return matches.length;
            return text.trim().length > 0 ? 1 : 0;
        };

        // Generate team members table - DYNAMICALLY from actual participants and standup submissions
        let teamMembersHTML = '';
        for (const userId of teamMemberIds) {
            const { name, avatarUrl } = await getUserName(userId as string);
            const standupEntry = standupByUser.get(userId as string);
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
                    <img src="${avatarUrl || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(name) + '&background=2980b9&color=fff'}" alt="${name}" class="team-avatar">
                    <div class="team-name">${name}${isDayOff ? ' <span class="team-dayoff-label">🛫 OOO</span>' : ''}</div>
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

        // Calculate pagination values
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
                <div class="dashboard-title">📆 Daily Standup Dashboard</div>
                <div class="dashboard-date">Track team progress and daily activities</div>
            </div>
            <div class="dashboard-actions">
                <div class="dashboard-date">${formattedDate}</div>
                <button class="dashboard-button">📊 Today's Report</button>
            </div>
        </div>
        
        <div class="metrics-grid">
            <div class="metric-card">
                <div class="metric-header">
                    <div>Team Members</div>
                    <div class="metric-icon" style="background-color: #3498db;">👥</div>
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
                    <div class="metric-icon" style="background-color: #2ecc71;">✅</div>
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
                    <div class="metric-icon" style="background-color: #9b59b6;">📝</div>
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
                    <div class="metric-icon" style="background-color: #e74c3c;">🚧</div>
                </div>
                <div class="metric-value">${blockerCount}</div>
                <div class="metric-label">Requiring attention</div>
                <div class="metric-progress">
                    <div class="metric-progress-bar" style="width: ${Math.min(blockerCount * 25, 100)}%; background-color: #e74c3c;"></div>
                </div>
            </div>
        </div>
        
        <div class="submissions-section">
            <div class="submissions-header">🔄 Recent Submissions</div>
            <div class="submission-list">
                ${recentSubmissionsHTML || '<div>No recent submissions</div>'}
            </div>
        </div>
        
        <div class="blockers-section">
            <div class="blockers-header">⚠️ Active Blockers</div>
            <div class="blocker-list">
                ${blockersHTML || '<div>No active blockers</div>'}
            </div>
        </div>
        
        <div class="team-section">
            <div class="team-header">👥 Team Members (${actualTeamSize})</div>
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
