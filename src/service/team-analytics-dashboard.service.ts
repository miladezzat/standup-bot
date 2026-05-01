import { Request, Response } from 'express';
import StandupEntry from '../models/standupEntry';
import PerformanceMetrics from '../models/performanceMetrics';
import { format, subDays, eachDayOfInterval } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { logger } from '../utils/logger';
import { hasClerk } from '../index';
import { APP_TIMEZONE } from '../config';
import { createBaseViewData } from '../config/view-engine';
import { getReportUserExclusionFilter } from '../utils/report-exclusions';

const TIMEZONE = APP_TIMEZONE;

interface VelocityDataPoint {
  date: string;
  submissions: number;
  tasks: number;
  hours: number;
}

interface BlockerHeatmapItem {
  userId: string;
  userName: string;
  blockerDays: number;
  totalDays: number;
  blockerRate: number;
}

interface EngagementDataItem {
  userName: string;
  userId: string;
  score: number;
  consistency: number;
  velocity: number;
}

interface WorkloadDataItem {
  userName: string;
  totalHours: number;
  avgHoursPerWeek: number;
}

/**
 * Team Analytics Dashboard - Velocity, Trends, Charts
 * Route: /analytics
 */
export const getTeamAnalyticsDashboard = async (req: Request, res: Response) => {
  try {
    logger.info('Team analytics dashboard accessed');

    const now = toZonedTime(new Date(), TIMEZONE);
    const last30Days = format(subDays(now, 30), 'yyyy-MM-dd');
    const last60Days = format(subDays(now, 60), 'yyyy-MM-dd');

    const workspaceId = process.env.SLACK_TEAM_ID || 'default';

    // Get all standups from last 30 days
    const standups = await StandupEntry.find({
      workspaceId,
            date: { $gte: last30Days },
            ...getReportUserExclusionFilter()
    }).sort({ date: -1 }).lean();

    // Get performance metrics
    const metrics = await PerformanceMetrics.find({
      workspaceId,
      period: 'week',
            startDate: { $gte: last60Days },
            ...getReportUserExclusionFilter()
    }).sort({ startDate: -1 }).lean();

    // Calculate velocity data (submissions per day)
    const dateRange = eachDayOfInterval({
      start: subDays(now, 30),
      end: now
    });

    const velocityData: VelocityDataPoint[] = dateRange.map(date => {
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
            date: { $gte: last30Days },
            ...getReportUserExclusionFilter()
    });

    const blockerHeatmap: BlockerHeatmapItem[] = await Promise.all(
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
    const engagementData: EngagementDataItem[] = metrics
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
    const workloadData: WorkloadDataItem[] = engagementData.map(e => {
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

    // Calculate summary stats
    const totalSubmissions = standups.length;
    const totalUsers = users.length;
    const totalHours = standups.reduce((sum, s) => sum + (s.yesterdayHoursEstimate || 0) + (s.todayHoursEstimate || 0), 0);
    const avgEngagement = engagementData.length > 0 
      ? Math.round(engagementData.reduce((sum, e) => sum + e.score, 0) / engagementData.length)
      : 0;

    // Render template
    res.render('analytics', {
      ...createBaseViewData('Team Analytics', 'analytics', !!hasClerk),
      velocityData,
      velocityDataJson: JSON.stringify(velocityData),
      blockerHeatmap,
      engagementData,
      engagementDataJson: JSON.stringify(engagementData),
      workloadData,
      workloadDataJson: JSON.stringify(workloadData),
      totalSubmissions,
      totalUsers,
      totalHours: Math.round(totalHours),
      avgEngagement,
      pageStyles: analyticsStyles,
      pageScripts: getChartScripts(velocityData, engagementData, workloadData)
    });
  } catch (error) {
    logger.error('Error generating team analytics dashboard:', error);
    res.status(500).send('Error generating analytics');
  }
};

// Generate Chart.js initialization scripts
function getChartScripts(
  velocityData: VelocityDataPoint[],
  engagementData: EngagementDataItem[],
  workloadData: WorkloadDataItem[]
): string {
  return `
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<script>
document.addEventListener('DOMContentLoaded', function() {
    if (!window.Chart) return;

    Chart.defaults.font.family = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    Chart.defaults.color = '#475569';
    Chart.defaults.plugins.tooltip.backgroundColor = '#1e293b';
    Chart.defaults.plugins.tooltip.titleColor = '#ffffff';
    Chart.defaults.plugins.tooltip.bodyColor = '#e2e8f0';
    Chart.defaults.plugins.tooltip.padding = 12;
    Chart.defaults.plugins.tooltip.cornerRadius = 10;
    Chart.defaults.plugins.tooltip.displayColors = false;

    const chartPalette = ['#667eea', '#10b981', '#f59e0b', '#3b82f6', '#ef4444', '#8b5cf6', '#14b8a6', '#f97316'];
    const softGrid = 'rgba(148, 163, 184, 0.18)';

    function areaGradient(context, color) {
        const chart = context.chart;
        const chartArea = chart.chartArea;
        if (!chartArea) return color + '24';
        const gradient = chart.ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
        gradient.addColorStop(0, color + '05');
        gradient.addColorStop(1, color + '3d');
        return gradient;
    }

    function horizontalGradient(context, color) {
        const chart = context.chart;
        const chartArea = chart.chartArea;
        if (!chartArea) return color + 'cc';
        const gradient = chart.ctx.createLinearGradient(chartArea.left, 0, chartArea.right, 0);
        gradient.addColorStop(0, color + 'a6');
        gradient.addColorStop(1, color);
        return gradient;
    }

    const velocityEl = document.getElementById('velocityChart');
    if (velocityEl) {
    new Chart(velocityEl.getContext('2d'), {
        type: 'line',
        data: {
            labels: ${JSON.stringify(velocityData.map(d => d.date))},
            datasets: [
                {
                    label: 'Submissions',
                    data: ${JSON.stringify(velocityData.map(d => d.submissions))},
                    borderColor: '#667eea',
                    backgroundColor: (ctx) => areaGradient(ctx, '#667eea'),
                    borderWidth: 3,
                    fill: true,
                    tension: 0.42,
                    pointRadius: 3,
                    pointHoverRadius: 6,
                    pointBackgroundColor: '#ffffff',
                    pointBorderWidth: 2
                },
                {
                    label: 'Tasks Completed',
                    data: ${JSON.stringify(velocityData.map(d => d.tasks))},
                    borderColor: '#10b981',
                    backgroundColor: (ctx) => areaGradient(ctx, '#10b981'),
                    borderWidth: 3,
                    fill: true,
                    tension: 0.42,
                    pointRadius: 3,
                    pointHoverRadius: 6,
                    pointBackgroundColor: '#ffffff',
                    pointBorderWidth: 2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            animation: { duration: 1200, easing: 'easeInOutQuart' },
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        usePointStyle: true,
                        pointStyle: 'circle',
                        font: { size: 13, weight: '700' },
                        padding: 18
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: softGrid },
                    border: { display: false },
                    ticks: { precision: 0 }
                },
                x: {
                    grid: { display: false },
                    border: { display: false }
                }
            }
        }
    });
    }

    const engagementEl = document.getElementById('engagementChart');
    if (engagementEl) {
    new Chart(engagementEl.getContext('2d'), {
        type: 'bar',
        data: {
            labels: ${JSON.stringify(engagementData.map(d => d.userName))},
            datasets: [{
                label: 'Engagement Score',
                data: ${JSON.stringify(engagementData.map(d => d.score))},
                backgroundColor: (ctx) => horizontalGradient(ctx, chartPalette[ctx.dataIndex % chartPalette.length]),
                borderColor: 'rgba(255, 255, 255, 0.9)',
                borderWidth: 1,
                borderRadius: 10,
                borderSkipped: false
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 1000, easing: 'easeInOutQuart' },
            plugins: { legend: { display: false } },
            scales: {
                x: {
                    beginAtZero: true,
                    max: 100,
                    grid: { color: softGrid },
                    border: { display: false },
                    ticks: { callback: (value) => value + '%' }
                },
                y: {
                    grid: { display: false },
                    border: { display: false }
                }
            }
        }
    });
    }

    const workloadEl = document.getElementById('workloadChart');
    if (workloadEl) {
    new Chart(workloadEl.getContext('2d'), {
        type: 'bar',
        data: {
            labels: ${JSON.stringify(workloadData.map(d => d.userName))},
            datasets: [{
                label: 'Total Hours',
                data: ${JSON.stringify(workloadData.map(d => d.totalHours))},
                backgroundColor: (ctx) => horizontalGradient(ctx, chartPalette[(ctx.dataIndex + 2) % chartPalette.length]),
                borderColor: 'rgba(255, 255, 255, 0.9)',
                borderWidth: 1,
                borderRadius: 10,
                borderSkipped: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 1000, easing: 'easeInOutQuart' },
            plugins: { legend: { display: false } },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: softGrid },
                    border: { display: false },
                    ticks: { precision: 0 }
                },
                x: {
                    grid: { display: false },
                    border: { display: false }
                }
            }
        }
    });
    }
});
</script>`;
}

// Additional styles specific to analytics dashboard
const analyticsStyles = `
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

.dashboard-actions-bar {
    display: flex;
    justify-content: center;
    gap: 0.75rem;
    margin: -0.75rem 0 1.5rem;
    flex-wrap: wrap;
}

/* Summary Stats */
.summary-stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 1rem;
    margin-bottom: 2rem;
}

.stat-card {
    background: white;
    border-radius: 12px;
    padding: 1.5rem;
    text-align: center;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
}

.stat-icon {
    font-size: 2rem;
    margin-bottom: 0.5rem;
}

.stat-value {
    font-size: 2rem;
    font-weight: 800;
    color: var(--gray-800);
}

.stat-label {
    font-size: 0.875rem;
    color: var(--gray-600);
}

/* Charts Grid */
.charts-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
    gap: 1.5rem;
    margin-bottom: 2rem;
}

.chart-card {
    background: white;
    border-radius: 16px;
    padding: 1.5rem;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.75);
    transition: transform 0.25s ease, box-shadow 0.25s ease;
}

.chart-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 16px 32px rgba(15, 23, 42, 0.12);
}

.chart-card.full-width {
    grid-column: 1 / -1;
}

.chart-header {
    margin-bottom: 1rem;
}

.chart-header h3 {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--gray-800);
    margin-bottom: 0.25rem;
}

.chart-header p {
    font-size: 0.875rem;
    color: var(--gray-600);
}

.chart-container {
    height: 300px;
    position: relative;
}

/* Heatmap Section */
.heatmap-section {
    background: white;
    border-radius: 16px;
    padding: 1.5rem;
    margin-bottom: 2rem;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
}

.section-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1.5rem;
}

.section-header h3 {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--gray-800);
    margin-bottom: 0.25rem;
}

.section-header p {
    font-size: 0.875rem;
    color: var(--gray-600);
}

.heatmap-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    gap: 1rem;
}

.heatmap-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem;
    border-radius: 10px;
    transition: transform 0.2s;
}

.heatmap-item:hover {
    transform: translateY(-2px);
}

.heatmap-item.heat-high {
    background: linear-gradient(135deg, #fef2f2, #fee2e2);
    border: 1px solid #fecaca;
}

.heatmap-item.heat-medium {
    background: linear-gradient(135deg, #fef9c3, #fef08a);
    border: 1px solid #fde047;
}

.heatmap-item.heat-low {
    background: linear-gradient(135deg, #f0fdf4, #dcfce7);
    border: 1px solid #bbf7d0;
}

.heatmap-item.heat-none {
    background: var(--gray-50);
    border: 1px solid var(--gray-100);
}

.heatmap-user {
    display: flex;
    align-items: center;
    gap: 0.75rem;
}

.user-initial {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-weight: 700;
    font-size: 1rem;
}

.user-info {
    display: flex;
    flex-direction: column;
}

.user-info a {
    font-weight: 600;
    color: var(--gray-800);
    text-decoration: none;
}

.user-info a:hover {
    color: #667eea;
}

.days-info {
    font-size: 0.75rem;
    color: var(--gray-600);
}

.heatmap-rate {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--gray-800);
}

/* Table Section */
.table-section {
    background: white;
    border-radius: 16px;
    padding: 1.5rem;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
}

.table-container {
    overflow-x: auto;
}

.data-table {
    width: 100%;
    border-collapse: collapse;
}

.data-table th,
.data-table td {
    padding: 1rem;
    text-align: left;
    border-bottom: 1px solid var(--gray-100);
}

.data-table th {
    position: sticky;
    top: 0;
    z-index: 2;
    font-weight: 600;
    color: var(--gray-700);
    font-size: 0.875rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    background: var(--gray-50);
}

.data-table td {
    color: var(--gray-800);
}

.data-table td a {
    color: #667eea;
    text-decoration: none;
    font-weight: 500;
}

.data-table td a:hover {
    text-decoration: underline;
}

.data-table tbody tr:hover {
    background: var(--gray-50);
}

.score-badge {
    display: inline-block;
    padding: 0.25rem 0.75rem;
    border-radius: 50px;
    font-size: 0.875rem;
    font-weight: 600;
}

.score-badge.score-excellent {
    background: #dcfce7;
    color: #166534;
}

.score-badge.score-good {
    background: #dbeafe;
    color: #1e40af;
}

.score-badge.score-fair {
    background: #fef9c3;
    color: #854d0e;
}

.score-badge.score-low {
    background: #fee2e2;
    color: #991b1b;
}

/* Responsive */
@media (max-width: 768px) {
    .dashboard-actions-bar {
        align-items: stretch;
        flex-direction: column;
    }

    .dashboard-actions-bar .btn {
        width: 100%;
    }

    .section-header {
        flex-direction: column;
    }

    .charts-grid {
        grid-template-columns: 1fr;
    }
    
    .chart-container {
        height: 250px;
    }
    
    .summary-stats {
        grid-template-columns: repeat(2, 1fr);
    }
    
    .heatmap-grid {
        grid-template-columns: 1fr;
    }
}
`;
