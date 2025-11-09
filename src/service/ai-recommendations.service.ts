import OpenAI from 'openai';
import StandupEntry from '../models/standupEntry';
import PerformanceMetrics from '../models/performanceMetrics';
import { format, subDays } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { logger } from '../utils/logger';

const TIMEZONE = 'Africa/Cairo';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});

/**
 * Generate task prioritization recommendations for a user
 */
export async function generateTaskPrioritizationRecommendations(
  slackUserId: string
): Promise<string[]> {
  if (!process.env.OPENAI_API_KEY) return [];

  try {
    const now = toZonedTime(new Date(), TIMEZONE);
    const last7Days = format(subDays(now, 7), 'yyyy-MM-dd');

    const standups = await StandupEntry.find({
      slackUserId,
      date: { $gte: last7Days }
    }).sort({ date: -1 }).limit(5).lean();

    if (standups.length < 2) return [];

    const userName = standups[0].slackUserName;
    const context = standups.map(s => ({
      date: s.date,
      yesterday: s.yesterday.substring(0, 200),
      today: s.today.substring(0, 200),
      blockers: s.blockers.substring(0, 150)
    }));

    const prompt = `You are a senior engineering manager helping ${userName} prioritize their work.

Recent standups:
${JSON.stringify(context, null, 2)}

Based on patterns in their work:
1. What tasks should they prioritize?
2. What can be delegated or deferred?
3. What requires immediate attention?

Provide 3-4 specific, actionable prioritization recommendations as a JSON array of strings.
Format: ["recommendation 1", "recommendation 2", ...]`;

    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 300,
    });

    const content = response.choices[0]?.message?.content?.trim() || '[]';
    const recommendations = JSON.parse(content);

    return Array.isArray(recommendations) ? recommendations : [];
  } catch (error) {
    logger.error('Error generating task prioritization:', error);
    return [];
  }
}

/**
 * Generate resource reallocation recommendations for the team
 */
export async function generateResourceReallocationRecommendations(
  workspaceId: string
): Promise<{ from: string, to: string, reason: string }[]> {
  if (!process.env.OPENAI_API_KEY) return [];

  try {
    // Get team performance metrics
    const metrics = await PerformanceMetrics.find({
      workspaceId,
      period: 'week'
    }).sort({ startDate: -1 }).limit(20).lean();

    // Identify overloaded and underutilized members
    const overloaded = metrics.filter(m => m.totalHoursEstimated > 50);
    const underutilized = metrics.filter(m => m.totalHoursEstimated < 20 && m.totalSubmissions >= 4);

    if (overloaded.length === 0 || underutilized.length === 0) return [];

    const reallocations: { from: string, to: string, reason: string }[] = [];

    for (const over of overloaded) {
      for (const under of underutilized) {
        reallocations.push({
          from: over.slackUserName,
          to: under.slackUserName,
          reason: `${over.slackUserName} is overloaded (${over.totalHoursEstimated}h/week) while ${under.slackUserName} has capacity (${under.totalHoursEstimated}h/week). Consider redistributing non-critical tasks.`
        });
      }
    }

    return reallocations.slice(0, 5); // Top 5 recommendations
  } catch (error) {
    logger.error('Error generating resource reallocation:', error);
    return [];
  }
}

/**
 * Generate skill development recommendations
 */
export async function generateSkillDevelopmentRecommendations(
  slackUserId: string
): Promise<string[]> {
  if (!process.env.OPENAI_API_KEY) return [];

  try {
    const now = toZonedTime(new Date(), TIMEZONE);
    const last30Days = format(subDays(now, 30), 'yyyy-MM-dd');

    const standups = await StandupEntry.find({
      slackUserId,
      date: { $gte: last30Days }
    }).sort({ date: -1 }).limit(15).lean();

    if (standups.length < 5) return [];

    const userName = standups[0].slackUserName;
    
    // Extract work patterns
    const allText = standups.map(s => `${s.yesterday} ${s.today}`).join(' ');

    const prompt = `You are a senior engineering manager analyzing ${userName}'s work patterns over the last month.

Sample work activities:
${allText.substring(0, 1500)}

Based on their work patterns:
1. What skills should they develop?
2. What training would be beneficial?
3. What areas show gaps or opportunities for growth?

Provide 3-4 specific skill development recommendations as a JSON array of strings.
Format: ["skill recommendation 1", "skill recommendation 2", ...]`;

    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 300,
    });

    const content = response.choices[0]?.message?.content?.trim() || '[]';
    const recommendations = JSON.parse(content);

    return Array.isArray(recommendations) ? recommendations : [];
  } catch (error) {
    logger.error('Error generating skill development:', error);
    return [];
  }
}

/**
 * Generate team pairing recommendations
 */
export async function generateTeamPairingRecommendations(
  workspaceId: string
): Promise<{ user1: string, user2: string, reason: string }[]> {
  try {
    const now = toZonedTime(new Date(), TIMEZONE);
    const last14Days = format(subDays(now, 14), 'yyyy-MM-dd');

    // Get all team members and their blockers
    const standups = await StandupEntry.find({
      workspaceId,
      date: { $gte: last14Days }
    }).lean();

    // Group by user
    const userBlockers = new Map<string, { name: string, blockers: string[] }>();
    standups.forEach(s => {
      if (!userBlockers.has(s.slackUserId)) {
        userBlockers.set(s.slackUserId, { name: s.slackUserName, blockers: [] });
      }
      if (s.blockers && s.blockers.trim()) {
        userBlockers.get(s.slackUserId)?.blockers.push(s.blockers);
      }
    });

    const pairings: { user1: string, user2: string, reason: string }[] = [];

    // Simple heuristic: pair people with blockers with those who have capacity
    const withBlockers = Array.from(userBlockers.entries()).filter(([_, data]) => data.blockers.length >= 2);
    const withCapacity = Array.from(userBlockers.entries()).filter(([_, data]) => data.blockers.length === 0);

    for (const [userId1, data1] of withBlockers) {
      for (const [userId2, data2] of withCapacity) {
        if (userId1 !== userId2) {
          pairings.push({
            user1: data1.name,
            user2: data2.name,
            reason: `${data1.name} has ${data1.blockers.length} blockers. ${data2.name} has capacity and could help unblock or pair program.`
          });
        }
      }
    }

    return pairings.slice(0, 5); // Top 5
  } catch (error) {
    logger.error('Error generating team pairing:', error);
    return [];
  }
}

/**
 * Generate process improvement recommendations
 */
export async function generateProcessImprovementRecommendations(
  workspaceId: string
): Promise<string[]> {
  if (!process.env.OPENAI_API_KEY) return [];

  try {
    const now = toZonedTime(new Date(), TIMEZONE);
    const last30Days = format(subDays(now, 30), 'yyyy-MM-dd');

    // Get all blockers from the last month
    const standups = await StandupEntry.find({
      workspaceId,
      date: { $gte: last30Days },
      blockers: { $ne: '', $exists: true }
    }).lean();

    if (standups.length < 10) return [];

    // Sample blockers
    const sampleBlockers = standups
      .slice(0, 20)
      .map(s => s.blockers)
      .join('\n');

    const prompt = `You are a senior engineering manager analyzing team blockers over the last month.

Sample blockers:
${sampleBlockers}

Total blockers reported: ${standups.length}

Based on these recurring issues:
1. What process improvements would help?
2. What systemic changes are needed?
3. What tools or practices should the team adopt?

Provide 3-4 specific process improvement recommendations as a JSON array of strings.
Focus on actionable, systemic changes that address root causes.
Format: ["improvement 1", "improvement 2", ...]`;

    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 400,
    });

    const content = response.choices[0]?.message?.content?.trim() || '[]';
    const recommendations = JSON.parse(content);

    return Array.isArray(recommendations) ? recommendations : [];
  } catch (error) {
    logger.error('Error generating process improvements:', error);
    return [];
  }
}

/**
 * Get all recommendations for the team
 */
export async function getAllTeamRecommendations(workspaceId: string) {
  logger.info('Generating team recommendations...');

  const [resourceReallocation, teamPairing, processImprovements] = await Promise.all([
    generateResourceReallocationRecommendations(workspaceId),
    generateTeamPairingRecommendations(workspaceId),
    generateProcessImprovementRecommendations(workspaceId)
  ]);

  return {
    resourceReallocation,
    teamPairing,
    processImprovements
  };
}

