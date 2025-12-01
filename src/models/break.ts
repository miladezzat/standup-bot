import mongoose, { Schema, Document } from 'mongoose';

/**
 * Break Model
 * Tracks team member break times throughout the day
 * Examples: lunch break, coffee break, doctor appointment, etc.
 */

export interface IBreak extends Document {
  slackUserId: string;        // Slack user ID
  slackUserName: string;      // Slack user display name
  date: string;               // Date of break (YYYY-MM-DD)
  durationMinutes: number;    // Duration in minutes
  reason: string;             // Reason for break (lunch, coffee, etc.)
  startTime?: string;         // Optional start time (HH:mm)
  endTime?: string;           // Optional calculated end time (HH:mm)
  workspaceId: string;        // Slack workspace/team ID
  isActive: boolean;          // Whether break is currently active
  createdAt: Date;
  updatedAt: Date;
}

const BreakSchema: Schema = new Schema(
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
    date: {
      type: String,
      required: true,
      index: true
    },
    durationMinutes: {
      type: Number,
      required: true,
      min: 1,
      max: 480 // Max 8 hours
    },
    reason: {
      type: String,
      default: ''
    },
    startTime: {
      type: String,
      default: ''
    },
    endTime: {
      type: String,
      default: ''
    },
    workspaceId: {
      type: String,
      required: true
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

// Indexes for common queries
BreakSchema.index({ slackUserId: 1, date: 1 }); // User's breaks for a day
BreakSchema.index({ workspaceId: 1, date: 1 }); // All breaks for a workspace on a day
BreakSchema.index({ date: -1 }); // Recent breaks
BreakSchema.index({ slackUserId: 1, isActive: 1 }); // Active breaks for a user

export default mongoose.model<IBreak>('Break', BreakSchema);
