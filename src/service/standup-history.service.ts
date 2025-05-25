
import { ConversationsRepliesResponse } from '@slack/web-api';
import StandupThread from '../models/standupThread';
import { formatCairoDate, formatStandupHTML, generateDateAnalytics, getUserName } from '../helper';
import { slackWebClient } from '../singleton';
import { CHANNEL_ID } from '../config';
import { Request, Response } from 'express';


export interface SlackMessage {
    ts: string;
    user?: string;
    text?: string;
    [key: string]: any;
}

export const getStandupHistory =  async (req: Request, res: Response) => {
    let queryDate = req.query.date as string | undefined;

    if (queryDate === 'today') {
        const now = new Date();
        queryDate = now.toISOString().split('T')[0]; // YYYY-MM-DD
    }

    let standupThreads;
    if (queryDate && /^\d{4}-\d{2}-\d{2}$/.test(queryDate)) {
        standupThreads = await StandupThread.find({ date: queryDate }).sort({ date: -1 });
    } else {
        standupThreads = await StandupThread.find().sort({ date: -1 });
    }

    // Update the CSS styles in the HTML template
    let html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>📆 Standup History</title>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <style>
        /* Reset & base */
        * {
          box-sizing: border-box;
        }
        body {
          font-family: 'Inter', Arial, sans-serif;
          background: #f5f7fa;
          color: #2c3e50;
          margin: 0;
          padding: 0 1rem 2rem;
          line-height: 1.6;
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        h1 {
          font-size: 2.5rem;
          margin: 1rem 0 2rem;
          color: #34495e;
          position: sticky;
          top: 0;
          background: #f5f7fa;
          padding: 1rem 0;
          width: 100%;
          max-width: 900px;
          border-bottom: 2px solid #2980b9;
          z-index: 100;
          text-align: center;
        }
        main {
          width: 100%;
          max-width: 900px;
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
        .blocker-badge {
          display: inline-block;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 0.8rem;
          font-weight: 500;
          background: #fdedec;
          color: #e74c3c;
        }
        
        /* Responsive adjustments */
        @media (max-width: 768px) {
          .team-member-details {
            gap: 12px;
          }
        }
        @media (max-width: 600px) {
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
      <h1>📆 Standup History</h1>
      <main>
    `;

    for (const thread of standupThreads) {
        // Add analytics overview for each date
        const dateAnalytics = await generateDateAnalytics(thread);
        html += dateAnalytics;
        
        html += `<section class="date-block"><h2>${thread.date}</h2>`;
        console.log(`Fetching thread for ${thread.date}...`, thread.threadTs, thread.channelId);

        try {
            const result: ConversationsRepliesResponse = await slackWebClient.conversations.replies({
                channel: CHANNEL_ID,
                ts: thread.threadTs,
            });
            const replies: SlackMessage[] =
                result.messages?.filter(
                    (m): m is SlackMessage =>
                        m.ts !== thread.threadTs && typeof m.user === 'string' && typeof m.text === 'string'
                ) || [];

            if (replies.length === 0) {
                html += `<p class="empty">No updates.</p>`;
                html += `</section>`;
                continue;
            }

            const grouped: Record<string, { text: string; ts: string }[]> = replies
                .filter(m => m.user !== 'U08T0FLAJ11')
                .reduce((acc, m) => {
                    if (!m.user || !m.text || !m.ts) return acc;
                    acc[m.user] = acc[m.user] || [];
                    acc[m.user].push({ text: m.text, ts: m.ts });
                    return acc;
                }, {} as Record<string, { text: string; ts: string }[]>);
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
                            <span style="font-size: 1.1em;">🕒</span> ${replyTime}
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

            html += `</section>`;
        } catch (error) {
            console.error(`Error loading thread for ${thread.date}:`, error);
            html += `<p class="error">❌ Failed to load thread for ${thread.date}</p></section>`;
        }
    }

    html += `
      </main>
      <script>
        // Pagination functionality
        document.addEventListener('DOMContentLoaded', function() {
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