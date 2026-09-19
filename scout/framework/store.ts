/**
 * One connection for the framework: Atlas collections, LangGraph's checkpointer (per-execution
 * threads) and store (memory), and the Anthropic client.
 *
 * Collections: agents, agent_versions, executions, execution_events, agent_memory,
 * agent_checkpoints, agent_checkpoint_writes.
 */
import Anthropic from "@anthropic-ai/sdk";
import { MongoDBSaver, MongoDBStore } from "@langchain/langgraph-checkpoint-mongodb";
import { MongoClient, type Db } from "mongodb";
import { dbFromUri } from "../../lib/log";

export type Connection = {
  mongo: MongoClient;
  db: Db;
  store: MongoDBStore;
  checkpointer: MongoDBSaver;
  client: Anthropic;
};

export async function connect(options: { client?: Anthropic } = {}): Promise<Connection> {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) throw new Error("MONGODB_URI unset");
  const mongo = new MongoClient(uri, { serverSelectionTimeoutMS: 10000, appName: "saturday-agents" });
  await mongo.connect();
  const db = mongo.db(process.env.MONGODB_DB?.trim() || dbFromUri(uri) || "saturday");

  // Not the app's `checkpoints`: that collection holds deal threads.
  const checkpointer = new MongoDBSaver({
    client: mongo,
    dbName: db.databaseName,
    checkpointCollectionName: "agent_checkpoints",
    checkpointWritesCollectionName: "agent_checkpoint_writes",
  });
  const errors = await checkpointer.setup();
  if (errors.length) throw errors[0];

  const store = new MongoDBStore({ client: mongo, dbName: db.databaseName, collectionName: "agent_memory", enableTimestamps: true });
  await store.start();

  await Promise.all([
    db.collection("executions").createIndex({ status: 1, updatedAt: -1 }),
    db.collection("executions").createIndex({ parentId: 1 }),
    db.collection("execution_events").createIndex({ executionId: 1, step: 1, index: 1 }),
    db.collection("agent_versions").createIndex({ name: 1, version: -1 }),
  ]);

  return { mongo, db, store, checkpointer, client: options.client ?? new Anthropic() };
}
