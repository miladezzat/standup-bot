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
    }
  },
  { 
    timestamps: true 
  }
);

// Compound index to ensure one standup per user per day
StandupEntrySchema.index({ slackUserId: 1, date: 1 }, { unique: true });

// Create and export the model
export default mongoose.model<IStandupEntry>('StandupEntry', StandupEntrySchema);

