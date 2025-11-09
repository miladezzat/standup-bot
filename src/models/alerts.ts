import mongoose, { Schema, Document } from 'mongoose';

/**
 * Alerts Model
 * Stores automated alerts and notifications for managers
 */

export interface IAlert extends Document {
  workspaceId: string;
  
  // Alert Details
  type: 'performance' | 'blocker' | 'sentiment' | 'capacity' | 'consistency' | 'goal' | 'commitment';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  description: string;
  
  // User Context
  affectedUserId: string; // Slack user ID
  affectedUserName: string;
  
  // Alert Specifics
  metric?: string; // e.g., "consistencyScore", "blockerFrequency"
  currentValue?: number;
  threshold?: number;
  trend?: 'improving' | 'stable' | 'declining';
  
  // Related Data
  relatedStandupIds: string[];
  relatedGoalId?: string;
  
  // Action Items
  suggestedActions: string[]; // AI-generated suggestions
  
  // Status
  status: 'active' | 'acknowledged' | 'resolved' | 'dismissed';
  acknowledgedBy?: string; // Manager user ID
  acknowledgedAt?: Date;
  resolvedAt?: Date;
  resolution?: string;
  
  // Recurrence
  isRecurring: boolean;
  lastOccurrence?: Date;
  occurrenceCount: number;
  
  // Priority
  priority: number; // 1-10, higher = more urgent
  expiresAt?: Date; // Auto-dismiss after this date
  
  createdAt: Date;
  updatedAt: Date;
}

const AlertSchema: Schema = new Schema(
  {
    workspaceId: {
      type: String,
      required: true,
      index: true
    },
    // Alert Details
    type: {
      type: String,
      enum: ['performance', 'blocker', 'sentiment', 'capacity', 'consistency', 'goal', 'commitment'],
      required: true,
      index: true
    },
    severity: {
      type: String,
      enum: ['info', 'warning', 'critical'],
      required: true,
      index: true
    },
    title: {
      type: String,
      required: true
    },
    description: {
      type: String,
      required: true
    },
    // User Context
    affectedUserId: {
      type: String,
      required: true,
      index: true
    },
    affectedUserName: {
      type: String,
      required: true
    },
    // Alert Specifics
    metric: {
      type: String
    },
    currentValue: {
      type: Number
    },
    threshold: {
      type: Number
    },
    trend: {
      type: String,
      enum: ['improving', 'stable', 'declining']
    },
    // Related Data
    relatedStandupIds: [{
      type: String
    }],
    relatedGoalId: {
      type: String
    },
    // Action Items
    suggestedActions: [{
      type: String
    }],
    // Status
    status: {
      type: String,
      enum: ['active', 'acknowledged', 'resolved', 'dismissed'],
      default: 'active',
      index: true
    },
    acknowledgedBy: {
      type: String
    },
    acknowledgedAt: {
      type: Date
    },
    resolvedAt: {
      type: Date
    },
    resolution: {
      type: String
    },
    // Recurrence
    isRecurring: {
      type: Boolean,
      default: false
    },
    lastOccurrence: {
      type: Date
    },
    occurrenceCount: {
      type: Number,
      default: 1
    },
    // Priority
    priority: {
      type: Number,
      default: 5,
      min: 1,
      max: 10
    },
    expiresAt: {
      type: Date
    }
  },
  {
    timestamps: true
  }
);

// Compound indexes for efficient queries
AlertSchema.index({ workspaceId: 1, status: 1, severity: -1 });
AlertSchema.index({ affectedUserId: 1, status: 1 });
AlertSchema.index({ workspaceId: 1, type: 1, status: 1 });
AlertSchema.index({ priority: -1, createdAt: -1 });
AlertSchema.index({ expiresAt: 1 }, { sparse: true });

export default mongoose.model<IAlert>('Alert', AlertSchema);

