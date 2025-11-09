import { Request, Response } from 'express';
import StandupEntry from '../models/standupEntry';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { getTeamMembers } from './team-members.service';

const TIMEZONE = 'Africa/Cairo';

export const getSubmissionsDashboard = async (req: Request, res: Response) => {
    try {
        let queryDate = req.query.date as string | undefined;

        if (queryDate === 'today') {
            const now = toZonedTime(new Date(), TIMEZONE);
            queryDate = format(now, 'yyyy-MM-dd');
        }

        let standupEntries;
        if (queryDate && /^\d{4}-\d{2}-\d{2}$/.test(queryDate)) {
            standupEntries = await StandupEntry.find({ date: queryDate }).sort({ createdAt: -1 });
        } else {
            // Get last 30 days of standups
            const thirtyDaysAgo = format(
                toZonedTime(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), TIMEZONE),
                'yyyy-MM-dd'
            );
            standupEntries = await StandupEntry.find({ 
                date: { $gte: thirtyDaysAgo } 
            }).sort({ date: -1, createdAt: -1 });
        }

        // Group by date
        const entriesByDate = new Map<string, typeof standupEntries>();
        for (const entry of standupEntries) {
            if (!entriesByDate.has(entry.date)) {
                entriesByDate.set(entry.date, []);
            }
            entriesByDate.get(entry.date)!.push(entry);
        }

        // Generate HTML
        let html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>📊 Standup Submissions Dashboard</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
    <style>
        * { box-sizing: border-box; }
        body {
            font-family: 'Inter', Arial, sans-serif;
            background: #f5f7fa;
            color: #2c3e50;
            margin: 0;
            padding: 1rem 1rem 2rem;
            line-height: 1.6;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        h1 {
            font-size: 2.5rem;
            margin: 1rem 0 2rem;
            color: #34495e;
            text-align: center;
        }
        .filters {
            background: white;
            padding: 1.5rem;
            border-radius: 12px;
            margin-bottom: 2rem;
            box-shadow: 0 2px 8px rgba(0,0,0,0.05);
        }
        .date-section {
            background: white;
            border-radius: 12px;
            padding: 2rem;
            margin-bottom: 2rem;
            box-shadow: 0 2px 8px rgba(0,0,0,0.05);
        }
        .date-header {
            font-size: 1.8rem;
            font-weight: 700;
            color: #2c3e50;
            margin-bottom: 1.5rem;
            padding-bottom: 1rem;
            border-bottom: 3px solid #3498db;
        }
        .standup-card {
            background: #f8f9fa;
            border-left: 4px solid #3498db;
            border-radius: 8px;
            padding: 1.5rem;
            margin-bottom: 1.5rem;
        }
        .standup-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1rem;
        }
        .user-info {
            display: flex;
            align-items: center;
            gap: 0.75rem;
        }
        .user-name {
            font-size: 1.2rem;
            font-weight: 600;
            color: #2c3e50;
        }
        .user-name a:hover {
            color: #3498db !important;
            text-decoration: underline !important;
        }
        .timestamp {
            font-size: 0.85rem;
            color: #7f8c8d;
        }
        .standup-section {
            margin-bottom: 1rem;
        }
        .section-label {
            font-size: 0.9rem;
            font-weight: 600;
            color: #7f8c8d;
            text-transform: uppercase;
            margin-bottom: 0.5rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        .section-content {
            font-size: 1rem;
            color: #34495e;
            line-height: 1.6;
            white-space: pre-wrap;
        }
        .no-submissions {
            text-align: center;
            padding: 3rem;
            color: #7f8c8d;
            font-size: 1.1rem;
        }
        .stats-bar {
            background: #3498db;
            color: white;
            padding: 1rem 1.5rem;
            border-radius: 8px;
            display: flex;
            justify-content: space-around;
            margin-bottom: 1rem;
        }
        .stat {
            text-align: center;
        }
        .stat-value {
            font-size: 1.8rem;
            font-weight: 700;
        }
        .stat-label {
            font-size: 0.85rem;
            opacity: 0.9;
        }
        .blocker-highlight {
            border-left-color: #e74c3c;
        }
        .blocker-badge {
            background: #e74c3c;
            color: white;
            padding: 0.25rem 0.5rem;
            border-radius: 4px;
            font-size: 0.75rem;
            font-weight: 600;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>📊 Standup Submissions Dashboard</h1>
        
        <div class="filters">
            <div class="stats-bar">
                <div class="stat">
                    <div class="stat-value">${standupEntries.length}</div>
                    <div class="stat-label">Total Submissions</div>
                </div>
                <div class="stat">
                    <div class="stat-value">${entriesByDate.size}</div>
                    <div class="stat-label">Days Tracked</div>
                </div>
                <div class="stat">
                    <div class="stat-value">${new Set(standupEntries.map(e => e.slackUserId)).size}</div>
                    <div class="stat-label">Active Users</div>
                </div>
            </div>
        </div>
`;

        if (entriesByDate.size === 0) {
            html += `
        <div class="no-submissions">
            <p>No standup submissions found.</p>
            <p>Team members can submit by typing <code>/standup</code> in Slack.</p>
        </div>
`;
        } else {
            for (const [date, entries] of Array.from(entriesByDate.entries()).sort((a, b) => b[0].localeCompare(a[0]))) {
                const dateFormatted = format(new Date(date), 'EEEE, MMMM d, yyyy');
                const hasBlockers = entries.some(e => e.blockers && e.blockers.trim());

                html += `
        <div class="date-section">
            <div class="date-header">
                ${dateFormatted}
                <span style="font-size: 0.8rem; font-weight: 400; color: #7f8c8d;">${entries.length} submission${entries.length > 1 ? 's' : ''}</span>
            </div>
`;

                for (const entry of entries) {
                    const hasBlocker = entry.blockers && entry.blockers.trim();
                    const submittedAt = format(new Date(entry.createdAt), 'h:mm a');

                    html += `
            <div class="standup-card ${hasBlocker ? 'blocker-highlight' : ''}">
                <div class="standup-header">
                    <div class="user-info">
                        <div class="user-name">
                            <a href="/user/${entry.slackUserId}" style="text-decoration: none; color: #2c3e50;">${entry.slackUserName}</a>
                        </div>
                        ${hasBlocker ? '<span class="blocker-badge">HAS BLOCKERS</span>' : ''}
                    </div>
                    <div class="timestamp">Submitted at ${submittedAt}</div>
                </div>
                
                <div class="standup-section">
                    <div class="section-label">🕒 Yesterday</div>
                    <div class="section-content">${escapeHtml(entry.yesterday)}</div>
                </div>
                
                <div class="standup-section">
                    <div class="section-label">🗓️ Today</div>
                    <div class="section-content">${escapeHtml(entry.today)}</div>
                </div>
                
                ${hasBlocker ? `
                <div class="standup-section">
                    <div class="section-label">🚧 Blockers</div>
                    <div class="section-content">${escapeHtml(entry.blockers)}</div>
                </div>
                ` : ''}
            </div>
`;
                }

                html += `
        </div>
`;
            }
        }

        html += `
    </div>
</body>
</html>
`;

        res.send(html);
    } catch (error) {
        console.error('Error generating submissions dashboard:', error);
        res.status(500).send('Error generating dashboard');
    }
};

function escapeHtml(text: string): string {
    const map: { [key: string]: string } = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

