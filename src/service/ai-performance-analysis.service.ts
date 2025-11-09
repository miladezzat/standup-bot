import OpenAI from 'openai';
import StandupEntry from '../models/standupEntry';
import PerformanceMetrics from '../models/performanceMetrics';
import { format, subDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { logger } from '../utils/logger';

const TIMEZONE = 'Africa/Cairo';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});

/**
 * Analyze sentiment from standup text
 * Returns score from -1 (very negative) to 1 (very positive)
 */
export async function analyzeSentiment(text: string): Promise<number> {
  if (!process.env.OPENAI_API_KEY || !text) return 0;

  try {
    const prompt = `Analyze the sentiment and emotional state of this standup update. Consider:
- Stress indicators (urgent, blocked, struggling, overwhelmed)
- Positive indicators (completed, accomplished, productive, excited)
- Burnout signals (tired, exhausted, too many tasks)
- Engagement level (detailed updates vs minimal effort)

Text: "${text}"

Rate sentiment from -1 (very negative/burned out) to 1 (very positive/engaged).
Respond with ONLY a number between -1 and 1.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 10,
    });

    const score = parseFloat(response.choices[0]?.message?.content?.trim() || '0');
    return Math.max(-1, Math.min(1, score));
  } catch (error) {
    logger.error('Error analyzing sentiment:', error);
    return 0;
  }
}

/**
 * Detect recurring blocker patterns
 */
export function detectRecurringBlockers(standups: any[]): string[] {
  const blockerKeywords: Map<string, number> = new Map();

  standups.forEach(standup => {
    if (!standup.blockers) return;

    // Extract keywords from blockers
    const words = standup.blockers
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((word: string) => word.length > 3); // Filter short words

    words.forEach((word: string) => {
      blockerKeywords.set(word, (blockerKeywords.get(word) || 0) + 1);
    });
  });

  // Return keywords that appear 3+ times
  return Array.from(blockerKeywords.entries())
    .filter(([_, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word as string);
}

/**
 * Assess risk level for a team member
 */
export async function assessRiskLevel(
  slackUserId: string,
  days: number = 30
): Promise<{ level: 'low' | 'medium' | 'high'; factors: string[]; score: number }> {
  const now = toZonedTime(new Date(), TIMEZONE);
  const startDate = format(subDays(now, days), 'yyyy-MM-dd');

  const standups = await StandupEntry.find({
    slackUserId,
    date: { $gte: startDate }
  }).sort({ date: -1 }).lean();

  if (standups.length === 0) {
    return { level: 'low', factors: [], score: 0 };
  }

  const factors: string[] = [];
  let riskScore = 0;

  // Factor 1: Low submission rate
  const expectedDays = days;
  const submissionRate = standups.length / expectedDays;
  if (submissionRate < 0.5) {
    factors.push(`Low submission rate (${Math.round(submissionRate * 100)}%)`);
    riskScore += 30;
  } else if (submissionRate < 0.7) {
    factors.push(`Inconsistent submissions (${Math.round(submissionRate * 100)}%)`);
    riskScore += 15;
  }

  // Factor 2: High blocker frequency
  const blockerCount = standups.filter(s => s.blockers && s.blockers.trim()).length;
  const blockerRate = blockerCount / standups.length;
  if (blockerRate > 0.5) {
    factors.push(`Frequent blockers (${Math.round(blockerRate * 100)}% of days)`);
    riskScore += 25;
  } else if (blockerRate > 0.3) {
    factors.push(`Regular blockers (${Math.round(blockerRate * 100)}% of days)`);
    riskScore += 10;
  }

  // Factor 3: Declining activity (comparing first half vs second half)
  const midpoint = Math.floor(standups.length / 2);
  const recentStandups = standups.slice(0, midpoint);
  const olderStandups = standups.slice(midpoint);
  
  if (recentStandups.length > 0 && olderStandups.length > 0) {
    const recentRate = recentStandups.length / (days / 2);
    const olderRate = olderStandups.length / (days / 2);
    
    if (recentRate < olderRate * 0.7) {
      factors.push('Declining submission frequency');
      riskScore += 20;
    }
  }

  // Factor 4: Sentiment analysis (check last 5 standups)
  const recentTexts = recentStandups.slice(0, 5);
  if (recentTexts.length >= 3) {
    const sentiments = await Promise.all(
      recentTexts.map(s => analyzeSentiment(`${s.yesterday} ${s.today} ${s.blockers}`))
    );
    const avgSentiment = sentiments.reduce((sum, s) => sum + s, 0) / sentiments.length;
    
    if (avgSentiment < -0.3) {
      factors.push('Negative sentiment detected');
      riskScore += 25;
    } else if (avgSentiment < 0) {
      factors.push('Low engagement signals');
      riskScore += 10;
    }
  }

  // Factor 5: Overwork indicators
  const recentHours = recentStandups
    .slice(0, 7)
    .reduce((sum, s) => sum + (s.yesterdayHoursEstimate || 0) + (s.todayHoursEstimate || 0), 0);
  
  if (recentHours > 70) {
    factors.push(`High workload (${recentHours}h in last week)`);
    riskScore += 15;
  }

  // Determine level
  let level: 'low' | 'medium' | 'high';
  if (riskScore >= 50) {
    level = 'high';
  } else if (riskScore >= 25) {
    level = 'medium';
  } else {
    level = 'low';
  }

  return { level, factors, score: Math.min(100, riskScore) };
}

/**
 * Calculate velocity trend
 */
export function calculateVelocityTrend(standups: any[]): 'increasing' | 'stable' | 'decreasing' {
  if (standups.length < 10) return 'stable';

  const midpoint = Math.floor(standups.length / 2);
  const recentStandups = standups.slice(0, midpoint);
  const olderStandups = standups.slice(midpoint);

  // Count tasks (bullet points) in each period
  const countTasks = (list: any[]) => {
    return list.reduce((total, s) => {
      const yesterdayTasks = (s.yesterday.match(/[•\-–*]|\d+\./g) || []).length || 1;
      const todayTasks = (s.today.match(/[•\-–*]|\d+\./g) || []).length || 1;
      return total + yesterdayTasks + todayTasks;
    }, 0);
  };

  const recentTaskCount = countTasks(recentStandups);
  const olderTaskCount = countTasks(olderStandups);

  const recentAvg = recentTaskCount / Math.max(1, recentStandups.length);
  const olderAvg = olderTaskCount / Math.max(1, olderStandups.length);

  const changePercent = ((recentAvg - olderAvg) / Math.max(0.1, olderAvg)) * 100;

  if (changePercent > 15) return 'increasing';
  if (changePercent < -15) return 'decreasing';
  return 'stable';
}

/**
 * Calculate performance metrics for a user over a period
 */
export async function calculatePerformanceMetrics(
  slackUserId: string,
  period: 'week' | 'month' | 'quarter',
  workspaceId: string
): Promise<any> {
  const now = toZonedTime(new Date(), TIMEZONE);
  let startDate: Date;
  let endDate: Date;
  let expectedSubmissions: number;

  if (period === 'week') {
    startDate = startOfWeek(now, { weekStartsOn: 1 });
    endDate = endOfWeek(now, { weekStartsOn: 1 });
    expectedSubmissions = 5; // Weekdays
  } else if (period === 'month') {
    startDate = startOfMonth(now);
    endDate = endOfMonth(now);
    expectedSubmissions = 22; // Approximate workdays
  } else {
    startDate = subDays(now, 90);
    endDate = now;
    expectedSubmissions = 65; // Approximate workdays in quarter
  }

  const startDateStr = format(startDate, 'yyyy-MM-dd');
  const endDateStr = format(endDate, 'yyyy-MM-dd');

  // Fetch standups
  const standups = await StandupEntry.find({
    slackUserId,
    date: { $gte: startDateStr, $lte: endDateStr }
  }).sort({ date: -1 }).lean();

  if (standups.length === 0) {
    return null; // No data
  }

  const userName = standups[0].slackUserName;

  // Calculate metrics
  const totalSubmissions = standups.length;
  const consistencyScore = Math.round((totalSubmissions / expectedSubmissions) * 100);

  // Task counting
  const totalTasks = standups.reduce((total, s) => {
    const yesterdayTasks = (s.yesterday.match(/[•\-–*]|\d+\./g) || []).length || 1;
    const todayTasks = (s.today.match(/[•\-–*]|\d+\./g) || []).length || 1;
    return total + yesterdayTasks + todayTasks;
  }, 0);

  const totalHoursEstimated = standups.reduce((total, s) => {
    return total + (s.yesterdayHoursEstimate || 0) + (s.todayHoursEstimate || 0);
  }, 0);

  const averageTasksPerDay = totalTasks / Math.max(1, totalSubmissions);

  // Blocker metrics
  const blockerStandups = standups.filter(s => s.blockers && s.blockers.trim());
  const blockerCount = blockerStandups.length;
  const blockerFrequency = (blockerCount / totalSubmissions) * 100;
  const recurringBlockers = detectRecurringBlockers(standups);

  // Submission time analysis
  const submissionTimes = standups.map(s => {
    const hour = new Date(s.createdAt).getHours();
    const minute = new Date(s.createdAt).getMinutes();
    return hour * 60 + minute; // Minutes since midnight
  });
  
  const avgSubmissionMinutes = submissionTimes.reduce((sum, t) => sum + t, 0) / submissionTimes.length;
  const avgHour = Math.floor(avgSubmissionMinutes / 60);
  const avgMinute = Math.round(avgSubmissionMinutes % 60);
  const averageSubmissionTime = `${String(avgHour).padStart(2, '0')}:${String(avgMinute).padStart(2, '0')}`;
  
  const lateSubmissions = submissionTimes.filter(t => t > 12 * 60).length; // After 12pm

  // Sentiment & Risk
  const riskAssessment = await assessRiskLevel(slackUserId, 30);
  
  // Get sentiment trend
  const recentSentiments = await Promise.all(
    standups.slice(0, Math.min(10, standups.length))
      .map(s => analyzeSentiment(`${s.yesterday} ${s.today} ${s.blockers}`))
  );
  const avgSentiment = recentSentiments.reduce((sum, s) => sum + s, 0) / recentSentiments.length;

  // Velocity trend
  const velocityTrend = calculateVelocityTrend(standups);

  // Engagement score (0-100)
  let engagementScore = 0;
  engagementScore += Math.min(40, consistencyScore * 0.4); // 40 points for consistency
  engagementScore += Math.min(30, (avgSentiment + 1) * 15); // 30 points for sentiment
  engagementScore += blockerFrequency < 30 ? 20 : 10; // 20 points for low blockers
  engagementScore += lateSubmissions < totalSubmissions * 0.3 ? 10 : 5; // 10 points for timely submissions

  // Overall performance score (0-100)
  let overallScore = 0;
  overallScore += Math.min(30, consistencyScore * 0.3); // 30% weight
  overallScore += Math.min(25, engagementScore * 0.25); // 25% weight
  overallScore += velocityTrend === 'increasing' ? 20 : velocityTrend === 'stable' ? 15 : 5; // 20% weight
  overallScore += riskAssessment.level === 'low' ? 25 : riskAssessment.level === 'medium' ? 15 : 5; // 25% weight

  return {
    slackUserId,
    slackUserName: userName,
    workspaceId,
    period,
    startDate: startDateStr,
    endDate: endDateStr,
    totalSubmissions,
    expectedSubmissions,
    consistencyScore,
    totalTasksCompleted: totalTasks,
    totalHoursEstimated: Math.round(totalHoursEstimated),
    averageTasksPerDay: Math.round(averageTasksPerDay * 10) / 10,
    velocityTrend,
    blockerCount,
    blockerDays: blockerCount,
    blockerFrequency: Math.round(blockerFrequency),
    recurringBlockers,
    engagementScore: Math.round(engagementScore),
    averageSubmissionTime,
    lateSubmissions,
    sentimentScore: Math.round(avgSentiment * 100) / 100,
    sentimentTrend: avgSentiment > 0.2 ? 'improving' : avgSentiment < -0.2 ? 'declining' : 'stable',
    riskLevel: riskAssessment.level,
    riskFactors: riskAssessment.factors,
    overallScore: Math.round(overallScore),
    teamAverageScore: 0, // Will be calculated separately
    percentileRank: 50, // Will be calculated separately
  };
}

/**
 * Calculate team-wide metrics and update percentiles
 */
export async function calculateTeamMetrics(
  workspaceId: string,
  period: 'week' | 'month' | 'quarter'
): Promise<void> {
  logger.info(`Calculating team metrics for period: ${period}`);

  // Get all unique users
  const users = await StandupEntry.distinct('slackUserId', { workspaceId });

  // Calculate metrics for each user
  const allMetrics = [];
  for (const userId of users) {
    const metrics = await calculatePerformanceMetrics(userId, period, workspaceId);
    if (metrics) {
      allMetrics.push(metrics);
    }
  }

  if (allMetrics.length === 0) return;

  // Calculate team average
  const teamAverageScore = allMetrics.reduce((sum, m) => sum + m.overallScore, 0) / allMetrics.length;

  // Sort by overall score for percentile calculation
  allMetrics.sort((a, b) => b.overallScore - a.overallScore);

  // Update each metric with team average and percentile
  for (let i = 0; i < allMetrics.length; i++) {
    const metrics = allMetrics[i];
    const percentileRank = ((allMetrics.length - i) / allMetrics.length) * 100;

    metrics.teamAverageScore = Math.round(teamAverageScore);
    metrics.percentileRank = Math.round(percentileRank);

    // Save or update in database
    await PerformanceMetrics.findOneAndUpdate(
      {
        slackUserId: metrics.slackUserId,
        period: metrics.period,
        startDate: metrics.startDate
      },
      metrics,
      { upsert: true, new: true }
    );
  }

  logger.info(`Team metrics calculated for ${allMetrics.length} users`);
}

/**
 * Generate AI insights for a user
 */
export async function generatePerformanceInsights(
  slackUserId: string,
  days: number = 30
): Promise<{ strengths: string[]; improvements: string[]; recommendations: string[] }> {
  if (!process.env.OPENAI_API_KEY) {
    return { strengths: [], improvements: [], recommendations: [] };
  }

  const now = toZonedTime(new Date(), TIMEZONE);
  const startDate = format(subDays(now, days), 'yyyy-MM-dd');

  const standups = await StandupEntry.find({
    slackUserId,
    date: { $gte: startDate }
  }).sort({ date: -1 }).limit(15).lean();

  if (standups.length < 3) {
    return { strengths: [], improvements: [], recommendations: [] };
  }

  const userName = standups[0].slackUserName;
  const standupSummary = standups.slice(0, 10).map(s => ({
    date: s.date,
    yesterday: s.yesterday.substring(0, 200),
    today: s.today.substring(0, 200),
    blockers: s.blockers.substring(0, 150),
    hours: (s.yesterdayHoursEstimate || 0) + (s.todayHoursEstimate || 0)
  }));

  try {
    const prompt = `You are a senior engineering manager analyzing ${userName}'s performance over the last ${days} days.

Recent standup data:
${JSON.stringify(standupSummary, null, 2)}

Provide 3 specific insights in each category:

1. STRENGTHS (what they're doing well)
2. IMPROVEMENTS (areas to develop)
3. RECOMMENDATIONS (actionable next steps)

Format as JSON:
{
  "strengths": ["strength 1", "strength 2", "strength 3"],
  "improvements": ["improvement 1", "improvement 2", "improvement 3"],
  "recommendations": ["recommendation 1", "recommendation 2", "recommendation 3"]
}

Be specific, professional, and actionable. Reference actual work patterns.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 500,
    });

    const content = response.choices[0]?.message?.content?.trim() || '{}';
    const insights = JSON.parse(content);

    return {
      strengths: insights.strengths || [],
      improvements: insights.improvements || [],
      recommendations: insights.recommendations || []
    };
  } catch (error) {
    logger.error('Error generating performance insights:', error);
    return { strengths: [], improvements: [], recommendations: [] };
  }
}

