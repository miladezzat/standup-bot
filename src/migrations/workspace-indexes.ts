import mongoose from 'mongoose';
import 'dotenv/config';

// Create the replacement before dropping only the known legacy global unique
// indexes. Never syncIndexes(): that could drop unrelated operational indexes.
export async function migrateWorkspaceIndexes(db: mongoose.mongo.Db, apply = false) {
  const changes = [
    { collection: 'standupentries', legacy: 'slackUserId_1_date_1',
      keys: { workspaceId: 1, slackUserId: 1, date: 1 } },
    { collection: 'achievements', legacy: 'slackUserId_1_achievementType_1_level_1',
      keys: { workspaceId: 1, slackUserId: 1, achievementType: 1, level: 1 } },
    { collection: 'standupthreads', legacy: 'date_1',
      keys: { channelId: 1, date: 1 } },
  ] as const;
  for (const change of changes) {
    const collection = db.collection(change.collection);
    const indexes = await collection.indexes().catch((error: { code?: number }) => {
      if (error.code === 26) return []; // Collection may not exist before first startup.
      throw error;
    });
    const legacy = indexes.find(index => index.name === change.legacy && index.unique);
    console.log(`${change.collection}: create scoped unique index${legacy ? `, then drop ${change.legacy}` : ''}${apply ? '' : ' (dry run)'}`);
    if (!apply) continue;
    await collection.createIndex(change.keys, { unique: true });
    if (legacy) await collection.dropIndex(change.legacy);
  }
}

if (require.main === module) {
  (async () => {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
    await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false });
    try {
      await migrateWorkspaceIndexes(mongoose.connection.db!, process.argv.includes('--apply'));
    } finally {
      await mongoose.disconnect();
    }
  })().catch(error => { console.error(error); process.exitCode = 1; });
}
