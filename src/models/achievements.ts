import mongoose, { Schema, Document } from 'mongoose';

/**
 * Achievements Model
 * Tracks badges and achievements earned by team members
 */

export interface IAchievement extends Document {
  slackUserId: string;
  slackUserName: string;
  workspaceId: string;
  
  // Achievement Details
  achievementType: 'streak' | 'velocity' | 'helper' | 'early_bird' | 'consistency' | 'team_player';
  badgeName: string;
  badgeIcon: string;
  description: string;
  
  // Criteria
  level: 'bronze' | 'silver' | 'gold' | 'platinum';
  threshold: number; // The value that triggered the achievement
  
  // Metadata
  earnedAt: Date;
  isActive: boolean; // Can be revoked if criteria no longer met
  
  createdAt: Date;
  updatedAt: Date;
}

const AchievementSchema: Schema = new Schema(
  {
    slackUserId: {
      type: String,
      required: true,
      index: true
    },
    slackUserName: {
      type: String,
      required: true
    },
    workspaceId: {
      type: String,
      required: true,
      index: true
    },
    // Achievement Details
    achievementType: {
      type: String,
      enum: ['streak', 'velocity', 'helper', 'early_bird', 'consistency', 'team_player'],
      required: true,
      index: true
    },
    badgeName: {
      type: String,
      required: true
    },
    badgeIcon: {
      type: String,
      required: true
    },
    description: {
      type: String,
      required: true
    },
    // Criteria
    level: {
      type: String,
      enum: ['bronze', 'silver', 'gold', 'platinum'],
      required: true
    },
    threshold: {
      type: Number,
      required: true
    },
    // Metadata
    earnedAt: {
      type: Date,
      default: Date.now
    },
    isActive: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: true
  }
);

// Compound indexes for efficient queries
AchievementSchema.index({ slackUserId: 1, achievementType: 1, level: 1 }, { unique: true });
AchievementSchema.index({ workspaceId: 1, earnedAt: -1 });
AchievementSchema.index({ achievementType: 1, level: 1 });

export default mongoose.model<IAchievement>('Achievement', AchievementSchema);

