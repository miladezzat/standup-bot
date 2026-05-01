
import { ConversationsRepliesResponse } from '@slack/web-api';
import StandupThread from '../models/standupThread';
import StandupEntry from '../models/standupEntry';
import { escapeHtml, formatCairoDate, formatStandupHTML, generateDateAnalytics, getUserName, type HistoryStandupEntry } from '../helper';
import { slackWebClient } from '../singleton';
import { CHANNEL_ID } from '../config';
import { Request, Response } from 'express';
import { getReportUserExclusionFilter, isIncludedInReports } from '../utils/report-exclusions';
import { renderIcon } from '../config/view-engine';


export interface SlackMessage {
    ts: string;
    user?: string;
    text?: string;
    [key: string]: any;
}

interface HistoryThreadRecord {
    date: string;
    threadTs?: string;
    channelId?: string;
}

interface ThreadFetchResult {
    available: boolean;
    replies: SlackMessage[];
    reason?: string;
}

const unavailableThreadErrors = new Set(['thread_not_found', 'channel_not_found', 'not_in_channel']);

function getSlackErrorCode(error: any): string {
    return error?.data?.error || error?.code || error?.message || 'unknown_error';
}

async function fetchHistoryThreadReplies(thread?: HistoryThreadRecord): Promise<ThreadFetchResult> {
    if (!thread?.threadTs) {
        return { available: false, replies: [], reason: 'No Slack thread is stored for this date.' };
    }

    try {
        const result: ConversationsRepliesResponse = await slackWebClient.conversations.replies({
            channel: thread.channelId || CHANNEL_ID,
            ts: thread.threadTs,
        });

        const replies: SlackMessage[] =
            result.messages?.filter(
                (m): m is SlackMessage =>
                    m.ts !== thread.threadTs && typeof m.user === 'string' && typeof m.text === 'string'
            ) || [];

        return { available: true, replies };
    } catch (error) {
        const code = getSlackErrorCode(error);

        if (unavailableThreadErrors.has(code)) {
            return {
                available: false,
                replies: [],
                reason: 'Slack thread unavailable. Showing stored standup submissions instead.'
            };
        }

        console.error(`Unexpected error loading Slack thread for ${thread.date}:`, error);
        return {
            available: false,
            replies: [],
            reason: 'Slack thread could not be loaded. Showing stored standup submissions instead.'
        };
    }
}

function groupRepliesByUser(replies: SlackMessage[]): Record<string, { text: string; ts: string }[]> {
    return replies
        .filter(m => m.user !== 'U08T0FLAJ11' && isIncludedInReports(m.user))
        .reduce((acc, m) => {
            if (!m.user || !m.text || !m.ts) return acc;
            acc[m.user] = acc[m.user] || [];
            acc[m.user].push({ text: m.text, ts: m.ts });
            return acc;
        }, {} as Record<string, { text: string; ts: string }[]>);
}

function renderTextSection(label: string, iconName: string, text?: string): string {
    if (!text?.trim()) return '';

    return `
        <div class="history-entry-section">
            <div class="history-entry-label">${renderIcon(iconName, 'icon-sm')} ${label}</div>
            <div class="history-entry-text">${escapeHtml(text).replace(/\n/g, '<br>')}</div>
        </div>
    `;
}

function renderStoredStandupEntries(entries: HistoryStandupEntry[]): string {
    if (entries.length === 0) {
        return `<p class="empty">No stored standup submissions for this date.</p>`;
    }

    return entries.map(entry => {
        const name = entry.slackUserName || entry.slackUserId;
        const submittedAt = entry.createdAt
            ? formatCairoDate(new Date(entry.createdAt).getTime() / 1000)
            : 'Stored submission';
        const blockerSection = entry.isDayOff
            ? ''
            : renderTextSection('Blockers', 'octagon-alert', entry.blockers);

        return `
            <div class="history-entry-card">
                <div class="history-entry-header">
                    <div class="history-entry-avatar">${escapeHtml(name.charAt(0).toUpperCase() || '?')}</div>
                    <div>
                        <h3>${escapeHtml(name)}</h3>
                        <div class="history-entry-time">${renderIcon('clock', 'icon-sm')} ${submittedAt}</div>
                    </div>
                </div>
                ${entry.isDayOff
                    ? renderTextSection('Out of Office', 'plane', entry.dayOffReason || 'Marked as out of office')
                    : `
                        ${renderTextSection('Yesterday', 'clock', entry.yesterday)}
                        ${renderTextSection('Today', 'calendar-check', entry.today)}
                        ${blockerSection}
                        ${renderTextSection('Notes', 'notebook-pen', entry.notes)}
                    `}
            </div>
        `;
    }).join('');
}

const historyNavItems = [
    { href: '/submissions', label: 'Submissions', icon: 'notebook-pen' },
    { href: '/breaks', label: 'Breaks', icon: 'coffee' },
    { href: '/workflow', label: 'Workflow', icon: 'workflow' },
    { href: '/linear-notes', label: 'Linear Notes', icon: 'notebook-tabs' },
    { href: '/analytics', label: 'Analytics', icon: 'chart-column' },
    { href: '/manager', label: 'Manager', icon: 'briefcase-business' },
    { href: '/history', label: 'History', icon: 'history' },
];

function renderHistoryNavLink(item: typeof historyNavItems[number]): string {
    const isActive = item.href === '/history';

    return `
        <a href="${item.href}" class="topbar-nav-link ${isActive ? 'is-active' : ''}" ${isActive ? 'aria-current="page"' : ''}>
            ${renderIcon(item.icon, 'topbar-nav-icon')}
            <span>${item.label}</span>
        </a>
    `;
}

function renderHistoryTopBar(): string {
    return `
        <header class="topbar-wrap">
            <div class="topbar">
                <a href="/" class="topbar-logo" aria-label="Standup Bot home">
                    <svg class="topbar-logo-icon" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                        <rect width="40" height="40" rx="10" fill="white"/>
                        <path d="M12 28V16L20 12L28 16V28L20 32L12 28Z" stroke="url(#history-topbar-gradient)" stroke-width="2" fill="none"/>
                        <circle cx="20" cy="20" r="4" fill="url(#history-topbar-gradient)"/>
                        <path d="M20 8V12M20 28V32M8 20H12M28 20H32" stroke="url(#history-topbar-gradient)" stroke-width="2" stroke-linecap="round"/>
                        <defs>
                            <linearGradient id="history-topbar-gradient" x1="8" y1="8" x2="32" y2="32" gradientUnits="userSpaceOnUse">
                                <stop stop-color="#667eea"/>
                                <stop offset="1" stop-color="#764ba2"/>
                            </linearGradient>
                        </defs>
                    </svg>
                    <span class="topbar-logo-copy">
                        <span class="topbar-logo-title">Standup Bot</span>
                        <span class="topbar-logo-subtitle">Team Dashboard</span>
                    </span>
                </a>

                <button class="topbar-menu-toggle" type="button" data-nav-toggle aria-label="Toggle navigation" aria-controls="historyPrimaryNavigation" aria-expanded="false">
                    ${renderIcon('menu', 'topbar-menu-icon')}
                </button>

                <nav class="topbar-nav" id="historyPrimaryNavigation" aria-label="Primary navigation">
                    ${historyNavItems.map(renderHistoryNavLink).join('')}
                    <a href="/auth/sign-out" class="topbar-nav-link topbar-mobile-signout">
                        ${renderIcon('log-out', 'topbar-nav-icon')}
                        <span>Sign out</span>
                    </a>
                </nav>

                <div class="topbar-actions">
                    <a href="/auth/sign-out" class="topbar-user-button" title="Sign out">
                        <span class="topbar-user-avatar" aria-hidden="true">A</span>
                        <span class="topbar-user-meta">
                            <span class="topbar-user-title">Account</span>
                            <span class="topbar-user-action">Sign out</span>
                        </span>
                        ${renderIcon('log-out', 'icon-sm')}
                    </a>
                </div>
            </div>
        </header>
    `;
}

export const getStandupHistory =  async (req: Request, res: Response) => {
    let queryDate = req.query.date as string | undefined;

    if (queryDate === 'today') {
        const now = new Date();
        queryDate = now.toISOString().split('T')[0]; // YYYY-MM-DD
    }

    const hasDateFilter = Boolean(queryDate && /^\d{4}-\d{2}-\d{2}$/.test(queryDate));
    const dateFilter = hasDateFilter ? { date: queryDate } : {};
    const [standupThreads, storedStandups] = await Promise.all([
        StandupThread.find(dateFilter).sort({ date: -1 }).lean() as unknown as Promise<HistoryThreadRecord[]>,
        StandupEntry.find({ ...dateFilter, ...getReportUserExclusionFilter() })
            .sort({ date: -1, createdAt: -1 })
            .lean() as unknown as Promise<HistoryStandupEntry[]>
    ]);

    const threadByDate = new Map<string, HistoryThreadRecord>();
    standupThreads.forEach(thread => threadByDate.set(thread.date, thread));

    const standupsByDate = new Map<string, HistoryStandupEntry[]>();
    storedStandups.forEach(entry => {
        const entries = standupsByDate.get(entry.date) || [];
        entries.push(entry);
        standupsByDate.set(entry.date, entries);
    });

    const dates = Array.from(new Set([
        ...standupThreads.map(thread => thread.date),
        ...storedStandups.map(entry => entry.date),
        ...(hasDateFilter && queryDate ? [queryDate] : [])
    ])).sort((a, b) => b.localeCompare(a));

    // Update the CSS styles in the HTML template
    let html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Standup History</title>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <style>
        /* Reset & base */
        * {
          box-sizing: border-box;
        }
        :root {
          --primary: #667eea;
          --secondary: #764ba2;
          --gray-500: #64748b;
          --gray-800: #1e293b;
          --glass-bg: rgba(255, 255, 255, 0.16);
          --glass-border: rgba(255, 255, 255, 0.24);
          --transition: all 0.24s cubic-bezier(0.4, 0, 0.2, 1);
        }
        html {
          scroll-behavior: smooth;
        }
        body {
          font-family: 'Inter', Arial, sans-serif;
          background: #f5f7fa;
          color: #2c3e50;
          margin: 0;
          padding: 0 0 2rem;
          line-height: 1.6;
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          overflow-x: hidden;
        }
        a {
          color: inherit;
        }
        .icon {
          display: inline-block;
          width: 1em;
          height: 1em;
          stroke: currentColor;
          fill: none;
          flex-shrink: 0;
          vertical-align: -0.125em;
        }
        .icon-sm {
          font-size: 0.9rem;
        }
        .icon-md {
          font-size: 1.15rem;
        }
        .topbar-wrap {
          position: sticky;
          top: 0;
          z-index: 1000;
          width: 100%;
          padding: 0.75rem 1rem 0;
        }
        .topbar {
          max-width: 1280px;
          min-height: 64px;
          margin: 0 auto;
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.625rem 0.75rem;
          background: linear-gradient(135deg, rgba(102, 126, 234, 0.96), rgba(118, 75, 162, 0.96));
          border: 1px solid var(--glass-border);
          border-radius: 16px;
          box-shadow: 0 16px 40px rgba(15, 23, 42, 0.16);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
        }
        .topbar-logo {
          display: inline-flex;
          align-items: center;
          gap: 0.75rem;
          min-width: max-content;
          text-decoration: none;
          color: white;
          padding: 0.25rem 0.35rem;
          border-radius: 12px;
          transition: var(--transition);
        }
        .topbar-logo:hover {
          background: rgba(255, 255, 255, 0.12);
        }
        .topbar-logo-icon {
          width: 40px;
          height: 40px;
          flex: 0 0 auto;
          filter: drop-shadow(0 6px 14px rgba(15, 23, 42, 0.16));
        }
        .topbar-logo-copy {
          display: flex;
          flex-direction: column;
          line-height: 1.15;
        }
        .topbar-logo-title {
          font-size: 1.05rem;
          font-weight: 800;
          letter-spacing: 0;
        }
        .topbar-logo-subtitle {
          font-size: 0.7rem;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.76);
        }
        .topbar-menu-toggle {
          display: none;
          align-items: center;
          justify-content: center;
          width: 40px;
          height: 40px;
          border: 1px solid rgba(255, 255, 255, 0.24);
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.12);
          color: white;
          cursor: pointer;
          transition: var(--transition);
        }
        .topbar-menu-toggle:hover,
        .topbar-menu-toggle[aria-expanded="true"] {
          background: rgba(255, 255, 255, 0.22);
        }
        .topbar-menu-icon {
          font-size: 1.1rem;
        }
        .topbar-nav {
          display: flex;
          align-items: center;
          gap: 0.25rem;
          min-width: 0;
          flex: 1 1 auto;
        }
        .topbar-nav-link {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          min-height: 40px;
          padding: 0.5rem 0.75rem;
          color: rgba(255, 255, 255, 0.88);
          text-decoration: none;
          border-radius: 999px;
          font-size: 0.84rem;
          font-weight: 700;
          white-space: nowrap;
          transition: var(--transition);
        }
        .topbar-nav-link:hover,
        .topbar-nav-link.is-active {
          background: rgba(255, 255, 255, 0.94);
          color: var(--primary);
          box-shadow: 0 8px 18px rgba(15, 23, 42, 0.1);
        }
        .topbar-nav-icon {
          font-size: 0.95rem;
          line-height: 1;
        }
        .topbar-mobile-signout {
          display: none;
        }
        .topbar-actions {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-left: auto;
        }
        .topbar-user-button {
          display: inline-flex;
          align-items: center;
          gap: 0.65rem;
          min-height: 42px;
          padding: 0.35rem 0.85rem 0.35rem 0.35rem;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.92);
          color: var(--gray-800);
          border: 1px solid rgba(255, 255, 255, 0.45);
          text-decoration: none;
          box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
          transition: var(--transition);
        }
        .topbar-user-button:hover {
          transform: translateY(-1px);
          box-shadow: 0 8px 24px rgba(15, 23, 42, 0.09);
        }
        .topbar-user-avatar {
          width: 34px;
          height: 34px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-weight: 800;
          font-size: 0.9rem;
          background: linear-gradient(135deg, var(--primary), var(--secondary));
        }
        .topbar-user-meta {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          line-height: 1.1;
        }
        .topbar-user-title {
          font-size: 0.82rem;
          font-weight: 800;
        }
        .topbar-user-action {
          font-size: 0.72rem;
          font-weight: 600;
          color: var(--gray-500);
        }
        h1 {
          font-size: 2.5rem;
          margin: 1.5rem auto 2rem;
          color: #34495e;
          padding: 1rem 1rem;
          width: 100%;
          max-width: 900px;
          border-bottom: 2px solid #2980b9;
          text-align: center;
        }
        main {
          width: 100%;
          max-width: 900px;
          padding: 0 1rem;
        }
        /* Dashboard Header */
        .dashboard-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1.5rem;
        }
        .dashboard-title {
          font-size: 1.8rem;
          font-weight: 700;
          color: #2c3e50;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .dashboard-date {
          font-size: 0.9rem;
          color: #7f8c8d;
          font-weight: 500;
        }
        .dashboard-actions {
          display: flex;
          gap: 10px;
        }
        .dashboard-button {
          background: #3498db;
          color: white;
          border: none;
          border-radius: 6px;
          padding: 8px 16px;
          font-size: 0.9rem;
          font-weight: 600;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 6px;
          transition: all 0.2s ease;
        }
        .dashboard-button:hover {
          background: #2980b9;
          transform: translateY(-2px);
          box-shadow: 0 4px 8px rgba(0,0,0,0.1);
        }
        /* Metrics Cards */
        .metrics-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 16px;
          margin-bottom: 24px;
        }
        .metric-card {
          background: white;
          border-radius: 12px;
          padding: 16px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.05);
          transition: all 0.3s ease;
        }
        .metric-card:hover {
          transform: translateY(-3px);
          box-shadow: 0 6px 12px rgba(0,0,0,0.1);
        }
        .metric-header {
          display: flex;
          justify-content: space-between;
          margin-bottom: 8px;
          color: #7f8c8d;
          font-size: 0.85rem;
          font-weight: 600;
        }
        .metric-value {
          font-size: 1.8rem;
          font-weight: 700;
          color: #2c3e50;
          margin-bottom: 4px;
        }
        .metric-label {
          font-size: 0.8rem;
          color: #95a5a6;
        }
        .metric-progress {
          height: 6px;
          background: #ecf0f1;
          border-radius: 3px;
          margin-top: 8px;
          overflow: hidden;
        }
        .metric-progress-bar {
          height: 100%;
          border-radius: 3px;
        }
        .metric-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border-radius: 8px;
          color: white;
          font-size: 1.2rem;
        }
        /* Standup Section */
        .standup-section {
          background: white;
          border-radius: 12px;
          padding: 20px;
          margin-bottom: 24px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.05);
        }
        .standup-header {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 16px;
          padding-bottom: 12px;
          border-bottom: 1px solid #ecf0f1;
        }
        .standup-user {
          font-size: 1.2rem;
          font-weight: 600;
          color: #2c3e50;
        }
        .standup-date {
          font-size: 0.85rem;
          color: #7f8c8d;
        }
        .standup-category {
          margin-bottom: 16px;
        }
        .category-header {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 1rem;
          font-weight: 600;
          color: #2c3e50;
          margin-bottom: 8px;
        }
        .task-list {
          list-style-type: none;
          padding-left: 28px;
          margin: 0;
        }
        .task-item {
          position: relative;
          padding: 4px 0;
          display: flex;
          align-items: flex-start;
        }
        .task-item:before {
          content: "";
          position: absolute;
          left: -20px;
          top: 12px;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #2ecc71;
        }
        /* Recent Submissions */
        .submissions-section {
          background: white;
          border-radius: 12px;
          padding: 20px;
          margin-bottom: 24px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.05);
        }
        .submissions-header {
          font-size: 1.1rem;
          font-weight: 600;
          color: #2c3e50;
          margin-bottom: 16px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .submission-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .submission-item {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .submission-avatar {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          object-fit: cover;
        }
        .submission-name {
          font-size: 0.95rem;
          font-weight: 500;
          color: #2c3e50;
        }
        .submission-time {
          margin-left: auto;
          font-size: 0.85rem;
          color: #7f8c8d;
        }
        /* Blockers Section */
        .blockers-section {
          background: white;
          border-radius: 12px;
          padding: 20px;
          margin-bottom: 24px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.05);
        }
        .blockers-header {
          font-size: 1.1rem;
          font-weight: 600;
          color: #2c3e50;
          margin-bottom: 16px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .blocker-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .blocker-item {
          background: #fff9e6;
          border-left: 4px solid #f1c40f;
          padding: 12px;
          border-radius: 6px;
        }
        .blocker-user {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 8px;
        }
        .blocker-avatar {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          object-fit: cover;
        }
        .blocker-name {
          font-size: 0.9rem;
          font-weight: 500;
          color: #2c3e50;
        }
        .blocker-text {
          font-size: 0.9rem;
          color: #34495e;
        }
        /* Team Members Table */
        .team-section {
          background: white;
          border-radius: 12px;
          padding: 20px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.05);
        }
        .team-header {
          font-size: 1.1rem;
          font-weight: 600;
          color: #2c3e50;
          margin-bottom: 16px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .team-members-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 12px;
          margin-bottom: 16px;
        }
        .team-member-card {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px;
          background: #f8f9fa;
          border-radius: 8px;
          border-left: 4px solid #3498db;
          width: 100%;
          transition: all 0.2s ease;
        }
        .team-member-card:hover {
          box-shadow: 0 4px 12px rgba(0,0,0,0.08);
          transform: translateY(-2px);
        }
        .team-member-card.team-member-dayoff {
          border-left-color: #f39c12;
          background: linear-gradient(90deg, rgba(243, 156, 18, 0.08), #fdf6e3);
        }
        .team-user {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .team-avatar {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          object-fit: cover;
        }
        .team-name {
          font-weight: 600;
          color: #2c3e50;
          font-size: 1rem;
        }
        .team-dayoff-label {
          font-size: 0.85rem;
          color: #b9770e;
          font-weight: 600;
          margin-left: 6px;
        }
        .team-member-details {
          display: flex;
          align-items: center;
          gap: 24px;
        }
        .team-member-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
        }
        .team-member-label {
          font-size: 0.75rem;
          color: #7f8c8d;
          font-weight: 500;
        }
        .team-member-value {
          font-size: 0.9rem;
          font-weight: 600;
          color: #2c3e50;
        }
        .status-badge {
          display: inline-block;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 0.8rem;
          font-weight: 500;
        }
        .status-submitted {
          background: #e8f8f5;
          color: #27ae60;
        }
        .status-pending {
          background: #fef9e7;
          color: #f39c12;
        }
        .status-dayoff {
          background: #fef3c7;
          color: #b45309;
        }
        .dayoff-note {
          margin-top: 10px;
          font-size: 0.85rem;
          color: #b9770e;
          background: rgba(243, 156, 18, 0.15);
          padding: 8px 10px;
          border-radius: 6px;
        }
        .blocker-badge {
          display: inline-block;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 0.8rem;
          font-weight: 500;
          background: #fdedec;
          color: #e74c3c;
        }
        .history-notice {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #7f8c8d;
          background: #eef6ff;
          border: 1px solid #d6eaff;
          border-radius: 8px;
          padding: 10px 12px;
          margin-bottom: 16px;
          font-size: 0.9rem;
        }
        .history-entry-card {
          background: #fff;
          border: 1px solid #e8edf2;
          border-radius: 12px;
          padding: 16px;
          margin-bottom: 16px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.04);
        }
        .history-entry-header {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 14px;
        }
        .history-entry-avatar {
          width: 42px;
          height: 42px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-weight: 700;
          background: linear-gradient(135deg, #667eea, #764ba2);
        }
        .history-entry-header h3 {
          margin: 0 0 2px;
          color: #2c3e50;
        }
        .history-entry-time {
          display: flex;
          align-items: center;
          gap: 4px;
          color: #7f8c8d;
          font-size: 0.85rem;
        }
        .history-entry-section {
          margin-top: 12px;
        }
        .history-entry-label {
          display: flex;
          align-items: center;
          gap: 6px;
          color: #34495e;
          font-weight: 700;
          margin-bottom: 4px;
        }
        .history-entry-text {
          color: #34495e;
          background: #f8fafc;
          border-radius: 8px;
          padding: 10px 12px;
        }
        
        /* Responsive adjustments */
        @media (max-width: 1020px) {
          .topbar {
            flex-wrap: wrap;
          }
          .topbar-menu-toggle {
            display: inline-flex;
            flex: 0 0 40px;
            order: 2;
          }
          .topbar-actions {
            order: 3;
            margin-left: 0;
            flex: 0 0 auto;
          }
          .topbar-user-meta {
            display: none;
          }
          .topbar-user-button {
            padding: 0.35rem;
            width: 42px;
            height: 42px;
          }
          .topbar-user-button > .icon {
            display: none;
          }
          .topbar-nav {
            display: none;
            order: 4;
            flex: 1 0 100%;
            flex-direction: column;
            align-items: stretch;
            gap: 0.35rem;
            padding-top: 0.75rem;
            margin-top: 0.25rem;
            border-top: 1px solid rgba(255, 255, 255, 0.16);
          }
          .topbar-nav.is-open {
            display: flex;
          }
          .topbar-nav-link {
            justify-content: flex-start;
            border-radius: 10px;
            padding: 0.7rem 0.8rem;
          }
        }
        @media (max-width: 768px) {
          .team-member-details {
            gap: 12px;
          }
        }
        @media (max-width: 600px) {
          .topbar {
            position: relative;
            width: calc(100vw - 1.5rem);
            max-width: calc(100vw - 1.5rem);
            padding-right: 3.75rem;
          }
          .topbar-menu-toggle {
            position: absolute;
            top: 0.625rem;
            right: 0.75rem;
          }
          .topbar-actions {
            display: none;
          }
          .topbar-mobile-signout {
            display: inline-flex;
          }
          .topbar-logo-title {
            font-size: 0.95rem;
          }
          .topbar-logo-icon {
            width: 36px;
            height: 36px;
          }
          h1 {
            font-size: 1.8rem;
            margin-top: 1rem;
          }
          .team-member-card {
            flex-direction: column;
            align-items: flex-start;
            gap: 12px;
          }
          .team-member-details {
            width: 100%;
            justify-content: space-between;
          }
        }
        @media print {
          .topbar-wrap {
            display: none !important;
          }
          body {
            background: white;
            padding: 0;
          }
          main,
          h1 {
            max-width: none;
          }
        }
        .team-table {
          width: 100%;
          border-collapse: collapse;
        }
        .team-table th {
          text-align: left;
          padding: 12px 16px;
          font-size: 0.85rem;
          font-weight: 600;
          color: #7f8c8d;
          border-bottom: 1px solid #ecf0f1;
        }
        .team-table td {
          padding: 12px 16px;
          font-size: 0.9rem;
          border-bottom: 1px solid #ecf0f1;
        }
        .team-user {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .team-avatar {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          object-fit: cover;
        }
        .team-name {
          font-weight: 500;
          color: #2c3e50;
        }
        .status-badge {
          display: inline-block;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 0.8rem;
          font-weight: 500;
        }
        .status-submitted {
          background: #e8f8f5;
          color: #27ae60;
        }
        .status-pending {
          background: #fef9e7;
          color: #f39c12;
        }
        .blocker-badge {
          display: inline-block;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 0.8rem;
          font-weight: 500;
          background: #fdedec;
          color: #e74c3c;
        }
        .pagination {
          display: flex;
          justify-content: center;
          gap: 8px;
          margin-top: 20px;
        }
        .page-item {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border-radius: 6px;
          font-size: 0.9rem;
          font-weight: 500;
          color: #7f8c8d;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .page-item:hover {
          background: #ecf0f1;
          color: #2c3e50;
        }
        .page-item.active {
          background: #3498db;
          color: white;
        }
        .page-item.disabled,
        .page-item[disabled] {
          opacity: 0.5;
          cursor: not-allowed;
          pointer-events: none;
        }
        @media (max-width: 768px) {
          .metrics-grid {
            grid-template-columns: repeat(2, 1fr);
          }
          .team-table th:nth-child(3),
          .team-table td:nth-child(3) {
            display: none;
          }
        }
        @media (max-width: 600px) {
          h1 {
            font-size: 1.8rem;
            padding: 0.8rem 0;
          }
          .metrics-grid {
            grid-template-columns: 1fr;
          }
          .dashboard-header {
            flex-direction: column;
            align-items: flex-start;
            gap: 12px;
          }
          .dashboard-actions {
            width: 100%;
          }
          .dashboard-button {
            flex: 1;
            justify-content: center;
          }
          .team-table th:nth-child(4),
          .team-table td:nth-child(4) {
            display: none;
          }
        }
      </style>
    </head>
    <body>
      ${renderHistoryTopBar()}
      <h1>${renderIcon('calendar-days', 'icon-md')} Standup History</h1>
      <main>
    `;

    if (dates.length === 0) {
        html += `<p class="empty">No standup history found.</p>`;
    }

    for (const date of dates) {
        const thread = threadByDate.get(date);
        const standupEntries = standupsByDate.get(date) || [];
        const threadResult = await fetchHistoryThreadReplies(thread);
        const dateAnalytics = await generateDateAnalytics(
            { date, threadTs: thread?.threadTs },
            { replies: threadResult.replies, standupEntries }
        );
        html += dateAnalytics;
        
        html += `<section class="date-block"><h2>${date}</h2>`;

        if (!threadResult.available && threadResult.reason) {
            html += `<div class="history-notice">${renderIcon('info', 'icon-sm')} ${threadResult.reason}</div>`;
        }

        if (threadResult.replies.length > 0) {
            const grouped = groupRepliesByUser(threadResult.replies);
            for (const [user, messages] of Object.entries(grouped)) {
                const { name, avatarUrl } = await getUserName(user);

                const replyTime = messages.length
                    ? formatCairoDate(parseFloat(messages[0].ts))
                    : '';

                html += `
                    <div class="user-block" style="display: flex; align-items: flex-start; margin-bottom: 2rem; border-bottom: 1px solid #ddd; padding-bottom: 1.5rem; background-color: #fff; padding: 1rem;">
                    <div style="text-align: center; margin-right: 1rem;">
                        <img src="${avatarUrl || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(name) + '&background=2980b9&color=fff'}" 
                             alt="${name}'s avatar" 
                             style="width: 48px; height: 48px; border-radius: 50%; object-fit: cover; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                        <div style="font-size: 0.85rem; color: #888; margin-top: 0.3rem; display: flex; align-items: center; justify-content: center; gap: 4px;">
                            ${renderIcon('clock', 'icon-sm')} ${replyTime}
                        </div>
                    </div>
                    <div>
                        <h3 style="margin: 0 0 0.5rem;">
                        <a href="https://slack.com/team/${user}" target="_blank" rel="noopener noreferrer" style="text-decoration: none; color: #0077cc; display: flex; align-items: center; gap: 4px;">
                            @${name}
                        </a>
                        </h3>
                `;

                for (const msgObj of messages) {
                    if (!msgObj.text || !formatStandupHTML(msgObj.text).length) continue;
                    html += formatStandupHTML(msgObj.text);
                }

                html += `
                    </div>
                    </div>
                `;
            }
        } else {
            html += renderStoredStandupEntries(standupEntries);
        }

        html += `</section>`;
    }

    html += `
      </main>
      <script>
        // Pagination functionality
        document.addEventListener('DOMContentLoaded', function() {
          const toggle = document.querySelector('[data-nav-toggle]');
          const nav = document.getElementById('historyPrimaryNavigation');

          if (toggle && nav) {
            function setOpen(isOpen) {
              nav.classList.toggle('is-open', isOpen);
              toggle.setAttribute('aria-expanded', String(isOpen));
            }

            toggle.addEventListener('click', function() {
              setOpen(toggle.getAttribute('aria-expanded') !== 'true');
            });

            nav.querySelectorAll('a').forEach(function(link) {
              link.addEventListener('click', function() {
                setOpen(false);
              });
            });
          }

          const teamSections = document.querySelectorAll('.team-section');
          
          teamSections.forEach(section => {
            const teamMembersGrid = section.querySelector('.team-members-grid');
            const cards = teamMembersGrid.querySelectorAll('.team-member-card');
            const itemsPerPage = 5;
            const totalPages = Math.ceil(cards.length / itemsPerPage);
            
            // Initialize pagination
            let currentPage = 1;
            
            // Function to show appropriate cards for current page
            function showPage(page) {
              // Hide all cards
              cards.forEach(card => card.style.display = 'none');
              
              // Calculate start and end indices
              const start = (page - 1) * itemsPerPage;
              const end = Math.min(start + itemsPerPage, cards.length);
              
              // Show cards for current page
              for (let i = start; i < end; i++) {
                if (cards[i]) cards[i].style.display = 'flex';
              }
              
              // Update active page in pagination
              const pagination = section.querySelector('.pagination');
              if (pagination) {
                const pageItems = pagination.querySelectorAll('.page-item[data-page]');
                pageItems.forEach(item => {
                  if (parseInt(item.getAttribute('data-page')) === page) {
                    item.classList.add('active');
                  } else {
                    item.classList.remove('active');
                  }
                });
                
                // Update prev/next buttons
                const prevBtn = pagination.querySelector('.page-prev');
                const nextBtn = pagination.querySelector('.page-next');
                
                if (prevBtn) {
                  if (page === 1) {
                    prevBtn.setAttribute('disabled', '');
                    prevBtn.classList.add('disabled');
                  } else {
                    prevBtn.removeAttribute('disabled');
                    prevBtn.classList.remove('disabled');
                  }
                }
                
                if (nextBtn) {
                  if (page === totalPages) {
                    nextBtn.setAttribute('disabled', '');
                    nextBtn.classList.add('disabled');
                  } else {
                    nextBtn.removeAttribute('disabled');
                    nextBtn.classList.remove('disabled');
                  }
                }
              }
            }
            
            // Add event listeners to pagination controls
            const pagination = section.querySelector('.pagination');
            if (pagination) {
              // Page number buttons
              pagination.querySelectorAll('.page-item[data-page]').forEach(item => {
                item.addEventListener('click', function() {
                  currentPage = parseInt(this.getAttribute('data-page'));
                  showPage(currentPage);
                });
              });
              
              // Previous button
              const prevBtn = pagination.querySelector('.page-prev');
              if (prevBtn) {
                prevBtn.addEventListener('click', function() {
                  if (currentPage > 1) {
                    currentPage--;
                    showPage(currentPage);
                  }
                });
              }
              
              // Next button
              const nextBtn = pagination.querySelector('.page-next');
              if (nextBtn) {
                nextBtn.addEventListener('click', function() {
                  if (currentPage < totalPages) {
                    currentPage++;
                    showPage(currentPage);
                  }
                });
              }
            }
            
            // Initialize first page
            showPage(1);
          });
        });
      </script>
    </body>
    </html>
    `;
    res.send(html);
}
