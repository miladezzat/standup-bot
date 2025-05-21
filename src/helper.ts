import { WebClient } from '@slack/web-api';
import dotenv from 'dotenv';
import { format, isToday, isYesterday, isThisWeek } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

const timeZone = 'Africa/Cairo';

dotenv.config();

const userCache = new Map<string, any>();

const token = process.env.SLACK_BOT_TOKEN; // Ensure this has the necessary scopes
const web = new WebClient(token);

export function formatStandupHTML(input: string): string {
    const parseSection = (label: string, icon: string): string => {
        const regex = new RegExp(`${label}:([^]*?)(?=(\\bYesterday:|\\bToday:|\\bBlockers:|$))`, 'i');
        const match = input.match(regex);
        if (!match) return '';

        // Split by bullets or numbered format
        const rawItems = match[1]
            .replace(/\n/g, ' ')                 // Flatten newlines
            .split(/(?:^|\s)[•\-–]\s+|(?:\d+\.\s+)/g) // Split on • or 1./2./3.
            .map(item => item.trim())
            .filter(item => item.length > 0);

        return `
      <h3 style="margin-top: 1.5em;">${icon} ${label}</h3>
      <ul>
        ${rawItems.map(item => `<li>${item}</li>`).join('\n')}
      </ul>
    `;
    };

    return `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; max-width: 700px; padding: 0 1em;">
      ${parseSection('Yesterday', '🕒')}
      ${parseSection('Today', '🗓️')}
      ${parseSection('Blockers', '🚧')}
    </div>
  `.trim();
}


export async function getUserName(userId?: string): Promise<{name: string, avatarUrl?: string}> {
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
        return {name: `@${userId}`, avatarUrl: undefined};
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