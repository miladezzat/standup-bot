import mongoose, { Schema, Document } from 'mongoose';

/**
 * Team Goals Model
 * Tracks OKRs, goals, and objectives linked to standup entries
 */

export interface ITeamGoal extends Document {
  workspaceId: string;
  
  // Goal Details
  title: string;
  description: string;
  category: 'okr' | 'sprint' | 'milestone' | 'personal' | 'team';
  
  // Ownership
  ownerId: string; // Slack user ID
  ownerName: string;
  teamMembers: string[]; // Additional Slack user IDs involved
  
  // Timeline
  startDate: string; // YYYY-MM-DD
  targetDate: string;
  completedDate?: string;
  
  // Progress
  status: 'not_started' | 'in_progress' | 'blocked' | 'completed' | 'cancelled';
  progress: number; // 0-100 percentage
  
  // Metrics
  targetMetric?: string; // e.g., "Complete 50 tasks"
  currentValue?: number;
  targetValue?: number;
  unit?: string; // e.g., "tasks", "hours", "points"
  
  // Tracking
  relatedStandupIds: string[]; // IDs of standup entries mentioning this goal
  lastMentionedDate?: string;
  mentionCount: number;
  
  // Blockers
  hasBlockers: boolean;
  blockerDescription?: string;
  
  // Tags
  tags: string[];
  priority: 'low' | 'medium' | 'high' | 'critical';
  
  createdAt: Date;
  updatedAt: Date;
}

const TeamGoalSchema: Schema = new Schema(
  {
    workspaceId: {
      type: String,
      required: true,
      index: true
    },
    // Goal Details
    title: {
      type: String,
      required: true
    },
    description: {
      type: String,
      default: ''
    },
    category: {
      type: String,
      enum: ['okr', 'sprint', 'milestone', 'personal', 'team'],
      default: 'team'
    },
    // Ownership
    ownerId: {
      type: String,
      required: true,
      index: true
    },
    ownerName: {
      type: String,
      required: true
    },
    teamMembers: [{
      type: String
    }],
    // Timeline
    startDate: {
      type: String,
      required: true
    },
    targetDate: {
      type: String,
      required: true,
      index: true
    },
    completedDate: {
      type: String
    },
    // Progress
    status: {
      type: String,
      enum: ['not_started', 'in_progress', 'blocked', 'completed', 'cancelled'],
      default: 'not_started',
      index: true
    },
    progress: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },
    // Metrics
    targetMetric: {
      type: String
    },
    currentValue: {
      type: Number
    },
    targetValue: {
      type: Number
    },
    unit: {
      type: String
    },
    // Tracking
    relatedStandupIds: [{
      type: String
    }],
    lastMentionedDate: {
      type: String
    },
    mentionCount: {
      type: Number,
      default: 0
    },
    // Blockers
    hasBlockers: {
      type: Boolean,
      default: false
    },
    blockerDescription: {
      type: String
    },
    // Tags
    tags: [{
      type: String
    }],
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium',
      index: true
    }
  },
  {
    timestamps: true
  }
);

// Compound indexes for efficient queries
TeamGoalSchema.index({ ownerId: 1, status: 1 });
TeamGoalSchema.index({ workspaceId: 1, targetDate: 1 });
TeamGoalSchema.index({ workspaceId: 1, status: 1, priority: -1 });
TeamGoalSchema.index({ targetDate: 1, status: 1 });

export default mongoose.model<ITeamGoal>('TeamGoal', TeamGoalSchema);

