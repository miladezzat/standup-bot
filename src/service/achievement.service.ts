import Achievement from '../models/achievements';
import StandupEntry from '../models/standupEntry';
import { format, subDays } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { getUserStreak } from './contribution-graph.service';
import { logger } from '../utils/logger';
import { APP_TIMEZONE } from '../config';

const TIMEZONE = APP_TIMEZONE;

/**
 * Achievement Service - Award badges for various accomplishments
 */

/**
 * Award achievement to a user
 */
async function awardAchievement(
  userId: string,
  userName: string,
  workspaceId: string,
  achievementType: string,
  badgeName: string,
  badgeIcon: string,
  description: string,
  level: string,
  threshold: number
) {
  try {
    const achievement = await Achievement.findOneAndUpdate(
      {
        slackUserId: userId,
        achievementType,
        level
      },
      {
        slackUserId: userId,
        slackUserName: userName,
        workspaceId,
        achievementType,
        badgeName,
        badgeIcon,
        description,
        level,
        threshold,
        earnedAt: new Date(),
        isActive: true
      },
      {
        upsert: true,
        new: true
      }
    );

    logger.info(`🏆 ${userName} earned: ${badgeName} (${level})`);
    return achievement;
  } catch (error) {
    logger.error('Error awarding achievement:', error);
    return null;
  }
}

/**
 * Check and award streak badges
 */
export async function checkStreakAchievements(userId: string, workspaceId: string) {
  try {
    const streak = await getUserStreak(userId);
    const userName = (await StandupEntry.findOne({ slackUserId: userId }))?.slackUserName || 'Unknown';

    // Bronze: 7 day streak
    if (streak.current >= 7) {
      await awardAchievement(
        userId,
        userName,
        workspaceId,
        'streak',
        'Week Warrior',
        '🔥',
        'Maintained a 7-day standup streak',
        'bronze',
        7
      );
    }

    // Silver: 30 day streak
    if (streak.current >= 30) {
      await awardAchievement(
        userId,
        userName,
        workspaceId,
        'streak',
        'Month Master',
        '🔥🔥',
        'Maintained a 30-day standup streak',
        'silver',
        30
      );
    }

    // Gold: 90 day streak
    if (streak.current >= 90) {
      await awardAchievement(
        userId,
        userName,
        workspaceId,
        'streak',
        'Quarter Champion',
        '🔥🔥🔥',
        'Maintained a 90-day standup streak',
        'gold',
        90
      );
    }

    // Platinum: 180 day streak
    if (streak.current >= 180) {
      await awardAchievement(
        userId,
        userName,
        workspaceId,
        'streak',
        'Consistency Legend',
        '🔥🔥🔥🔥',
        'Maintained a 180-day standup streak',
        'platinum',
        180
      );
    }
  } catch (error) {
    logger.error('Error checking streak achievements:', error);
  }
}

/**
 * Check and award velocity badges (high task completion)
 */
export async function checkVelocityAchievements(userId: string, workspaceId: string) {
  try {
    const now = toZonedTime(new Date(), TIMEZONE);
    const last30Days = format(subDays(now, 30), 'yyyy-MM-dd');

    const standups = await StandupEntry.find({
      slackUserId: userId,
      date: { $gte: last30Days }
    }).lean();

    if (standups.length < 20) return; // Need at least 20 days of data

    const userName = standups[0].slackUserName;

    // Count total tasks
    const totalTasks = standups.reduce((sum, s) => {
      const yesterdayTasks = (s.yesterday.match(/[•\-–*]|\d+\./g) || []).length || 1;
      const todayTasks = (s.today.match(/[•\-–*]|\d+\./g) || []).length || 1;
      return sum + yesterdayTasks + todayTasks;
    }, 0);

    const avgTasksPerDay = totalTasks / standups.length;

    // Bronze: 3+ tasks/day average
    if (avgTasksPerDay >= 3) {
      await awardAchievement(
        userId,
        userName,
        workspaceId,
        'velocity',
        'Speed Demon',
        '⚡',
        'Completed 3+ tasks per day on average',
        'bronze',
        3
      );
    }

    // Silver: 5+ tasks/day average
    if (avgTasksPerDay >= 5) {
      await awardAchievement(
        userId,
        userName,
        workspaceId,
        'velocity',
        'Productivity Pro',
        '⚡⚡',
        'Completed 5+ tasks per day on average',
        'silver',
        5
      );
    }

    // Gold: 8+ tasks/day average
    if (avgTasksPerDay >= 8) {
      await awardAchievement(
        userId,
        userName,
        workspaceId,
        'velocity',
        'Velocity Master',
        '⚡⚡⚡',
        'Completed 8+ tasks per day on average',
        'gold',
        8
      );
    }
  } catch (error) {
    logger.error('Error checking velocity achievements:', error);
  }
}

/**
 * Check and award early bird badges (submits before 9am)
 */
export async function checkEarlyBirdAchievements(userId: string, workspaceId: string) {
  try {
    const now = toZonedTime(new Date(), TIMEZONE);
    const last30Days = format(subDays(now, 30), 'yyyy-MM-dd');

    const standups = await StandupEntry.find({
      slackUserId: userId,
      date: { $gte: last30Days }
    }).lean();

    if (standups.length < 15) return;

    const userName = standups[0].slackUserName;

    // Count early submissions (before 9am)
    const earlySubmissions = standups.filter(s => {
      const hour = new Date(s.createdAt).getHours();
      return hour < 9;
    }).length;

    const earlyRate = (earlySubmissions / standups.length) * 100;

    // Bronze: 50% early submissions
    if (earlyRate >= 50) {
      await awardAchievement(
        userId,
        userName,
        workspaceId,
        'early_bird',
        'Morning Person',
        '🌅',
        '50% of standups submitted before 9am',
        'bronze',
        50
      );
    }

    // Silver: 75% early submissions
    if (earlyRate >= 75) {
      await awardAchievement(
        userId,
        userName,
        workspaceId,
        'early_bird',
        'Early Bird',
        '🌅🌅',
        '75% of standups submitted before 9am',
        'silver',
        75
      );
    }

    // Gold: 90% early submissions
    if (earlyRate >= 90) {
      await awardAchievement(
        userId,
        userName,
        workspaceId,
        'early_bird',
        'Dawn Warrior',
        '🌅🌅🌅',
        '90% of standups submitted before 9am',
        'gold',
        90
      );
    }
  } catch (error) {
    logger.error('Error checking early bird achievements:', error);
  }
}

/**
 * Check and award consistency badges (never miss a day)
 */
export async function checkConsistencyAchievements(userId: string, workspaceId: string) {
  try {
    const now = toZonedTime(new Date(), TIMEZONE);
    const last30Days = format(subDays(now, 30), 'yyyy-MM-dd');

    const standups = await StandupEntry.find({
      slackUserId: userId,
      date: { $gte: last30Days }
    }).lean();

    if (standups.length < 20) return;

    const userName = standups[0].slackUserName;

    // Expected workdays (Sun-Thu): ~22 days per month
    const expectedDays = 22;
    const submissionRate = (standups.length / expectedDays) * 100;

    // Bronze: 80% consistency
    if (submissionRate >= 80) {
      await awardAchievement(
        userId,
        userName,
        workspaceId,
        'consistency',
        'Reliable Reporter',
        '📊',
        'Submitted 80% of expected standups',
        'bronze',
        80
      );
    }

    // Silver: 90% consistency
    if (submissionRate >= 90) {
      await awardAchievement(
        userId,
        userName,
        workspaceId,
        'consistency',
        'Consistency King',
        '📊📊',
        'Submitted 90% of expected standups',
        'silver',
        90
      );
    }

    // Gold: 95% consistency
    if (submissionRate >= 95) {
      await awardAchievement(
        userId,
        userName,
        workspaceId,
        'consistency',
        'Perfect Attendance',
        '📊📊📊',
        'Submitted 95% of expected standups',
        'gold',
        95
      );
    }
  } catch (error) {
    logger.error('Error checking consistency achievements:', error);
  }
}

/**
 * Run all achievement checks for a user
 */
export async function checkAllAchievements(userId: string, workspaceId: string) {
  logger.info(`Checking achievements for user: ${userId}`);

  await Promise.all([
    checkStreakAchievements(userId, workspaceId),
    checkVelocityAchievements(userId, workspaceId),
    checkEarlyBirdAchievements(userId, workspaceId),
    checkConsistencyAchievements(userId, workspaceId)
  ]);

  logger.info(`Achievement check completed for user: ${userId}`);
}

/**
 * Get leaderboard data
 */
export async function getLeaderboard(workspaceId: string) {
  try {
    // Get all achievements
    const achievements = await Achievement.find({
      workspaceId,
      isActive: true
    }).lean();

    // Calculate points per user
    const pointsMap = new Map<string, { name: string, points: number, badges: number }>();

    achievements.forEach(achievement => {
      if (!pointsMap.has(achievement.slackUserId)) {
        pointsMap.set(achievement.slackUserId, {
          name: achievement.slackUserName,
          points: 0,
          badges: 0
        });
      }

      const userData = pointsMap.get(achievement.slackUserId)!;
      userData.badges += 1;

      // Award points based on level
      const levelPoints = {
        bronze: 10,
        silver: 25,
        gold: 50,
        platinum: 100
      };
      userData.points += levelPoints[achievement.level as keyof typeof levelPoints];
    });

    // Convert to array and sort
    const leaderboard = Array.from(pointsMap.entries()).map(([userId, data]) => ({
      userId,
      userName: data.name,
      points: data.points,
      badges: data.badges
    })).sort((a, b) => b.points - a.points);

    return leaderboard;
  } catch (error) {
    logger.error('Error getting leaderboard:', error);
    return [];
  }
}

/**
 * Get user badges
 */
export async function getUserBadges(userId: string) {
  try {
    const badges = await Achievement.find({
      slackUserId: userId,
      isActive: true
    }).sort({ earnedAt: -1 }).lean();

    return badges;
  } catch (error) {
    logger.error('Error getting user badges:', error);
    return [];
  }
}
