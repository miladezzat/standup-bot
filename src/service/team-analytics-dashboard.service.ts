import { Request, Response } from 'express';
import StandupEntry from '../models/standupEntry';
import PerformanceMetrics from '../models/performanceMetrics';
import { format, subDays, eachDayOfInterval } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { logger } from '../utils/logger';
import { escapeHtml } from '../middleware/security.middleware';
import { APP_TIMEZONE } from '../config';

const TIMEZONE = APP_TIMEZONE;

/**
 * Team Analytics Dashboard - Velocity, Trends, Charts
 * Route: /analytics
 */
export const getTeamAnalyticsDashboard = async (req: Request, res: Response) => {
  try {
    logger.info('Team analytics dashboard accessed');

    const now = toZonedTime(new Date(), TIMEZONE);
    const todayStr = format(now, 'yyyy-MM-dd');
    const last30Days = format(subDays(now, 30), 'yyyy-MM-dd');
    const last60Days = format(subDays(now, 60), 'yyyy-MM-dd');

    const workspaceId = process.env.SLACK_TEAM_ID || 'default';

    // Get all standups from last 30 days
    const standups = await StandupEntry.find({
      workspaceId,
      date: { $gte: last30Days }
    }).sort({ date: -1 }).lean();

    // Get performance metrics
    const metrics = await PerformanceMetrics.find({
      workspaceId,
      period: 'week',
      startDate: { $gte: last60Days }
    }).sort({ startDate: -1 }).lean();

    // Calculate velocity data (submissions per day)
    const dateRange = eachDayOfInterval({
      start: subDays(now, 30),
      end: now
    });

    const velocityData = dateRange.map(date => {
      const dateStr = format(date, 'yyyy-MM-dd');
      const daySubmissions = standups.filter(s => s.date === dateStr);
      const totalTasks = daySubmissions.reduce((sum, s) => {
        const yesterdayTasks = (s.yesterday.match(/[•\-–*]|\d+\./g) || []).length || 1;
        const todayTasks = (s.today.match(/[•\-–*]|\d+\./g) || []).length || 1;
        return sum + yesterdayTasks + todayTasks;
      }, 0);
      
      return {
        date: format(date, 'MM/dd'),
        submissions: daySubmissions.length,
        tasks: totalTasks,
        hours: daySubmissions.reduce((sum, s) => sum + (s.yesterdayHoursEstimate || 0) + (s.todayHoursEstimate || 0), 0)
      };
    });

    // Blocker heatmap data (per user)
    const users = await StandupEntry.distinct('slackUserId', {
      workspaceId,
      date: { $gte: last30Days }
    });

    const blockerHeatmap = await Promise.all(
      users.map(async (userId) => {
        const userStandups = standups.filter(s => s.slackUserId === userId);
        const userName = userStandups[0]?.slackUserName || 'Unknown';
        const blockerDays = userStandups.filter(s => s.blockers && s.blockers.trim()).length;
        const blockerRate = userStandups.length > 0 ? (blockerDays / userStandups.length) * 100 : 0;
        
        return {
          userId,
          userName,
          blockerDays,
          totalDays: userStandups.length,
          blockerRate: Math.round(blockerRate)
        };
      })
    );

    blockerHeatmap.sort((a, b) => b.blockerRate - a.blockerRate);

    // Engagement score by user
    const engagementData = metrics
      .filter((m, index, self) => 
        index === self.findIndex(t => t.slackUserId === m.slackUserId)
      )
      .map(m => ({
        userName: m.slackUserName,
        userId: m.slackUserId,
        score: m.engagementScore || 0,
        consistency: m.consistencyScore || 0,
        velocity: m.totalTasksCompleted || 0
      }))
      .sort((a, b) => b.score - a.score);

    // Workload distribution
    const workloadData = engagementData.map(e => {
      const userStandups = standups.filter(s => s.slackUserId === e.userId);
      const totalHours = userStandups.reduce((sum, s) => 
        sum + (s.yesterdayHoursEstimate || 0) + (s.todayHoursEstimate || 0), 0
      );
      const avgHoursPerWeek = (totalHours / 30) * 7;
      
      return {
        userName: e.userName,
        totalHours: Math.round(totalHours),
        avgHoursPerWeek: Math.round(avgHoursPerWeek * 10) / 10
      };
    }).sort((a, b) => b.totalHours - a.totalHours);

    // Generate HTML
    let html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5" />
    <title>Team Analytics</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
    <style>
        :root {
            --primary: #667eea;
            --secondary: #764ba2;
            --success: #10b981;
            --danger: #ef4444;
            --warning: #f59e0b;
            --info: #3b82f6;
            --dark: #1e293b;
            --gray-50: #f8fafc;
            --gray-100: #f1f5f9;
            --gray-600: #475569;
            --gray-700: #334155;
            --gray-800: #1e293b;
        }
        
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: var(--dark);
            padding: 0;
        }
        
        .container {
            max-width: 1400px;
            margin: 0 auto;
            padding: 2rem 1rem;
        }
        
        .back-link {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            color: white;
            text-decoration: none;
            font-weight: 600;
            font-size: 0.9375rem;
            margin-bottom: 1.5rem;
            padding: 0.75rem 1.25rem;
            background: rgba(255, 255, 255, 0.15);
            border-radius: 50px;
            backdrop-filter: blur(10px);
            transition: all 0.3s;
        }
        
        .back-link:hover {
            background: rgba(255, 255, 255, 0.25);
            transform: translateX(-4px);
        }
        
        .header {
            text-align: center;
            margin-bottom: 2.5rem;
            animation: fadeIn 0.6s ease;
        }
        
        .header h1 {
            font-size: clamp(1.75rem, 5vw, 3rem);
            font-weight: 800;
            color: white;
            margin-bottom: 0.5rem;
            text-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        
        .header p {
            color: rgba(255, 255, 255, 0.9);
            font-size: 1.125rem;
            font-weight: 500;
        }
        
        .chart-section {
            background: white;
            border-radius: 16px;
            padding: 2rem;
            margin-bottom: 2rem;
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
        }
        
        .chart-title {
            font-size: 1.5rem;
            font-weight: 700;
            color: var(--gray-800);
            margin-bottom: 1.5rem;
            padding-bottom: 1rem;
            border-bottom: 3px solid var(--primary);
        }
        
        .chart-container {
            position: relative;
            height: 400px;
            margin-bottom: 1rem;
        }
        
        .data-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 1rem;
        }
        
        .data-table th {
            background: var(--gray-50);
            padding: 1rem;
            text-align: left;
            font-weight: 700;
            font-size: 0.875rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: var(--gray-700);
            border-bottom: 2px solid var(--primary);
        }
        
        .data-table td {
            padding: 1rem;
            border-bottom: 1px solid var(--gray-100);
            color: var(--gray-700);
        }
        
        .data-table tr:hover {
            background: var(--gray-50);
        }
        
        .progress-bar {
            width: 100%;
            height: 10px;
            background: var(--gray-100);
            border-radius: 5px;
            overflow: hidden;
            margin-top: 0.5rem;
        }
        
        .progress-fill {
            height: 100%;
            background: linear-gradient(90deg, var(--primary), var(--secondary));
            transition: width 0.3s ease;
        }
        
        .badge {
            display: inline-block;
            padding: 0.25rem 0.75rem;
            border-radius: 50px;
            font-size: 0.75rem;
            font-weight: 700;
            text-transform: uppercase;
        }
        
        .badge.high {
            background: var(--danger);
            color: white;
        }
        
        .badge.medium {
            background: var(--warning);
            color: white;
        }
        
        .badge.low {
            background: var(--success);
            color: white;
        }
        
        @keyframes fadeIn {
            from {
                opacity: 0;
                transform: translateY(-20px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
        
        @media (max-width: 768px) {
            .container {
                padding: 1rem;
            }
            
            .chart-section {
                padding: 1.5rem;
            }
            
            .chart-container {
                height: 300px;
            }
            
            .data-table {
                font-size: 0.875rem;
            }
            
            .data-table th,
            .data-table td {
                padding: 0.75rem 0.5rem;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <a href="/manager" class="back-link">
            <span>←</span>
            <span>Back to Manager Dashboard</span>
        </a>
        
        <div class="header">
            <h1>📈 Team Analytics</h1>
            <p>Performance Trends & Insights (Last 30 Days)</p>
        </div>
        
        <!-- Velocity Chart -->
        <div class="chart-section">
            <div class="chart-title">📊 Team Velocity & Submissions</div>
            <div class="chart-container">
                <canvas id="velocityChart"></canvas>
            </div>
        </div>
        
        <!-- Blocker Heatmap -->
        <div class="chart-section">
            <div class="chart-title">🚧 Blocker Frequency Heatmap</div>
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Team Member</th>
                        <th>Days with Blockers</th>
                        <th>Total Days</th>
                        <th>Blocker Rate</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
`;

    for (const item of blockerHeatmap) {
      const status = item.blockerRate > 40 ? 'high' : item.blockerRate > 20 ? 'medium' : 'low';
      html += `
                    <tr>
                        <td>
                            <a href="/user/${item.userId}" style="text-decoration: none; color: inherit; font-weight: 600;">
                                ${escapeHtml(item.userName)}
                            </a>
                        </td>
                        <td>${item.blockerDays}</td>
                        <td>${item.totalDays}</td>
                        <td>
                            <div>${item.blockerRate}%</div>
                            <div class="progress-bar">
                                <div class="progress-fill" style="width: ${item.blockerRate}%;"></div>
                            </div>
                        </td>
                        <td><span class="badge ${status}">${status}</span></td>
                    </tr>
`;
    }

    html += `
                </tbody>
            </table>
        </div>
        
        <!-- Engagement Scores -->
        <div class="chart-section">
            <div class="chart-title">⚡ Team Engagement Scores</div>
            <div class="chart-container">
                <canvas id="engagementChart"></canvas>
            </div>
        </div>
        
        <!-- Workload Distribution -->
        <div class="chart-section">
            <div class="chart-title">⏱️ Workload Distribution</div>
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Team Member</th>
                        <th>Total Hours (30 Days)</th>
                        <th>Avg Hours/Week</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
`;

    for (const item of workloadData) {
      const status = item.avgHoursPerWeek > 50 ? 'high' : item.avgHoursPerWeek > 30 ? 'medium' : 'low';
      html += `
                    <tr>
                        <td>
                            <a href="/user/${item.userName}" style="text-decoration: none; color: inherit; font-weight: 600;">
                                ${escapeHtml(item.userName)}
                            </a>
                        </td>
                        <td>${item.totalHours}h</td>
                        <td>${item.avgHoursPerWeek}h/week</td>
                        <td><span class="badge ${status}">${status === 'high' ? 'Overloaded' : status === 'medium' ? 'Normal' : 'Underutilized'}</span></td>
                    </tr>
`;
    }

    html += `
                </tbody>
            </table>
        </div>
    </div>
    
    <script>
        // Velocity Chart
        const velocityCtx = document.getElementById('velocityChart').getContext('2d');
        new Chart(velocityCtx, {
            type: 'line',
            data: {
                labels: ${JSON.stringify(velocityData.map(d => d.date))},
                datasets: [
                    {
                        label: 'Submissions',
                        data: ${JSON.stringify(velocityData.map(d => d.submissions))},
                        borderColor: '#667eea',
                        backgroundColor: 'rgba(102, 126, 234, 0.1)',
                        borderWidth: 3,
                        fill: true,
                        tension: 0.4
                    },
                    {
                        label: 'Tasks Completed',
                        data: ${JSON.stringify(velocityData.map(d => d.tasks))},
                        borderColor: '#10b981',
                        backgroundColor: 'rgba(16, 185, 129, 0.1)',
                        borderWidth: 3,
                        fill: true,
                        tension: 0.4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {
                            font: { size: 14, weight: '600' },
                            padding: 15
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: {
                            color: '#f1f5f9'
                        }
                    },
                    x: {
                        grid: {
                            display: false
                        }
                    }
                }
            }
        });
        
        // Engagement Chart
        const engagementCtx = document.getElementById('engagementChart').getContext('2d');
        new Chart(engagementCtx, {
            type: 'bar',
            data: {
                labels: ${JSON.stringify(engagementData.map(d => d.userName))},
                datasets: [{
                    label: 'Engagement Score',
                    data: ${JSON.stringify(engagementData.map(d => d.score))},
                    backgroundColor: 'rgba(102, 126, 234, 0.8)',
                    borderColor: '#667eea',
                    borderWidth: 2,
                    borderRadius: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 100,
                        grid: {
                            color: '#f1f5f9'
                        }
                    },
                    x: {
                        grid: {
                            display: false
                        }
                    }
                }
            }
        });
    </script>
</body>
</html>
`;

    res.send(html);
  } catch (error) {
    logger.error('Error generating team analytics dashboard:', error);
    res.status(500).send('Error generating analytics');
  }
};
