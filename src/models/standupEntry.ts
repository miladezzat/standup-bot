import mongoose, { Schema, Document } from 'mongoose';

// Interface for the StandupEntry document
export interface IStandupEntry extends Document {
  slackUserId: string;        // Slack user ID who submitted
  slackUserName: string;      // Slack user display name
  date: string;               // Date of standup (YYYY-MM-DD)
  yesterday: string;          // What did you do yesterday?
  today: string;              // What will you do today?
  blockers: string;           // Any blockers? (can be empty)
  source: 'slash_command' | 'modal' | 'dm'; // How it was submitted
  workspaceId: string;        // Slack workspace/team ID
  // AI Time Estimates (optional)
  yesterdayHoursEstimate?: number;  // Estimated hours for yesterday's work
  todayHoursEstimate?: number;      // Estimated hours for today's plan
  timeEstimatesRaw?: any;           // Raw AI estimates data
  // AI Summary (optional)
  aiSummary?: string;               // Natural language summary of standup
  createdAt: Date;
  updatedAt: Date;
}

// Schema definition
const StandupEntrySchema: Schema = new Schema(
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
    yesterday: { 
      type: String, 
      required: true 
    },
    today: { 
      type: String, 
      required: true 
    },
    blockers: { 
      type: String, 
      default: '' 
    },
    source: { 
      type: String, 
      enum: ['slash_command', 'modal', 'dm'],
      default: 'modal'
    },
    workspaceId: { 
      type: String, 
      required: true 
    },
    // AI Time Estimates
    yesterdayHoursEstimate: {
      type: Number,
      default: 0
    },
    todayHoursEstimate: {
      type: Number,
      default: 0
    },
    timeEstimatesRaw: {
      type: Schema.Types.Mixed,
      default: null
    },
    // AI Summary
    aiSummary: {
      type: String,
      default: ''
    }
  },
  { 
    timestamps: true 
  }
);

// Compound index to ensure one standup per user per day
StandupEntrySchema.index({ slackUserId: 1, date: 1 }, { unique: true });

// Additional indexes for performance
StandupEntrySchema.index({ date: -1 }); // Daily submissions view
StandupEntrySchema.index({ workspaceId: 1, date: -1 }); // Multi-workspace queries
StandupEntrySchema.index({ createdAt: -1 }); // Recent submissions
StandupEntrySchema.index({ slackUserId: 1, createdAt: -1 }); // User history

// Create and export the model
export default mongoose.model<IStandupEntry>('StandupEntry', StandupEntrySchema);

