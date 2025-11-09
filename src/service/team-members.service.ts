import { slackWebClient } from '../singleton';
import { CHANNEL_ID } from '../config';
import StandupEntry from '../models/standupEntry';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

const TIMEZONE = 'Africa/Cairo';

interface TeamMember {
  id: string;
  name: string;
  realName: string;
  isBot: boolean;
}

// Cache for team members
let teamMembersCache: TeamMember[] | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

export async function getTeamMembers(): Promise<TeamMember[]> {
  // Check if cache is still valid
  if (teamMembersCache && (Date.now() - cacheTimestamp) < CACHE_TTL) {
    return teamMembersCache;
  }

  try {
    // Get channel members
    const result = await slackWebClient.conversations.members({
      channel: CHANNEL_ID
    });

    if (!result.members) {
      console.error('No members found in channel');
      return [];
    }

    // Fetch user details for each member
    const members: TeamMember[] = [];
    
    for (const userId of result.members) {
      try {
        const userInfo = await slackWebClient.users.info({ user: userId });
        
        if (userInfo.user && !userInfo.user.is_bot && !userInfo.user.deleted) {
          members.push({
            id: userInfo.user.id!,
            name: userInfo.user.name || 'Unknown',
            realName: userInfo.user.real_name || userInfo.user.name || 'Unknown',
            isBot: userInfo.user.is_bot || false
          });
        }
      } catch (error) {
        console.error(`Error fetching user info for ${userId}:`, error);
      }
    }

    // Update cache
    teamMembersCache = members;
    cacheTimestamp = Date.now();

    return members;
  } catch (error) {
    console.error('Error fetching team members:', error);
    return [];
  }
}

export async function getTeamMembersWhoHaventSubmitted(): Promise<TeamMember[]> {
  const today = format(toZonedTime(new Date(), TIMEZONE), 'yyyy-MM-dd');
  
  // Get all team members
  const allMembers = await getTeamMembers();
  
  // Get users who have submitted today
  const submissions = await StandupEntry.find({ date: today });
  const submittedUserIds = new Set(submissions.map(s => s.slackUserId));
  
  // Filter out those who have submitted
  const notSubmitted = allMembers.filter(member => !submittedUserIds.has(member.id));
  
  return notSubmitted;
}

export async function invalidateTeamMembersCache() {
  teamMembersCache = null;
  cacheTimestamp = 0;
}

