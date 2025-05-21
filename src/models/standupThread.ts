import mongoose, { Schema, Document } from 'mongoose';

// Interface for the StandupThread document
export interface IStandupThread extends Document {
  date: string;       // Format: YYYY-MM-DD
  threadTs: string;   // Slack thread timestamp
  channelId: string;  // Slack channel ID
  createdAt: Date;
  updatedAt: Date;
}

// Schema definition
const StandupThreadSchema: Schema = new Schema(
  {
    date: { 
      type: String, 
      required: true,
      index: true,
      unique: true
    },
    threadTs: { 
      type: String, 
      required: true 
    },
    channelId: { 
      type: String, 
      required: true 
    }
  },
  { timestamps: true }
);

// Create and export the model
export default mongoose.model<IStandupThread>('StandupThread', StandupThreadSchema);