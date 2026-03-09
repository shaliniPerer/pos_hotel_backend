import {
  CreateTableCommand,
  DescribeTableCommand,
  ResourceNotFoundException,
  BillingMode,
} from '@aws-sdk/client-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import dotenv from 'dotenv';
import { TABLES } from './dynamodb';

dotenv.config();

const clientConfig: ConstructorParameters<typeof DynamoDBClient>[0] = {
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
};

if (process.env.DYNAMODB_ENDPOINT) {
  clientConfig.endpoint = process.env.DYNAMODB_ENDPOINT;
}

const rawClient = new DynamoDBClient(clientConfig);

async function tableExists(tableName: string): Promise<boolean> {
  try {
    await rawClient.send(new DescribeTableCommand({ TableName: tableName }));
    return true;
  } catch (err) {
    if (err instanceof ResourceNotFoundException) return false;
    throw err;
  }
}

/** Poll DescribeTable until the table status is ACTIVE (max ~60 s). */
async function waitForTableActive(tableName: string): Promise<void> {
  const maxAttempts = 30;
  const delayMs = 2000;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const result = await rawClient.send(new DescribeTableCommand({ TableName: tableName }));
      if (result.Table?.TableStatus === 'ACTIVE') return;
    } catch {
      // table may not be visible yet — keep polling
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`Table "${tableName}" did not become ACTIVE within ${(maxAttempts * delayMs) / 1000}s`);
}

export async function setupTables() {
  console.log('Setting up DynamoDB tables...');

  // Users table
  if (!(await tableExists(TABLES.USERS))) {
    await rawClient.send(
      new CreateTableCommand({
        TableName: TABLES.USERS,
        BillingMode: BillingMode.PAY_PER_REQUEST,
        AttributeDefinitions: [
          { AttributeName: 'id', AttributeType: 'S' },
          { AttributeName: 'username', AttributeType: 'S' },
        ],
        KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
        GlobalSecondaryIndexes: [
          {
            IndexName: 'UsernameIndex',
            KeySchema: [{ AttributeName: 'username', KeyType: 'HASH' }],
            Projection: { ProjectionType: 'ALL' },
          },
        ],
      })
    );
    console.log(`  Created table "${TABLES.USERS}". Waiting for ACTIVE...`);
    await waitForTableActive(TABLES.USERS);
    console.log(`  Table "${TABLES.USERS}" is ACTIVE.`);
  } else {
    console.log(`  Table "${TABLES.USERS}" already exists.`);
  }

  // Categories table
  if (!(await tableExists(TABLES.CATEGORIES))) {
    await rawClient.send(
      new CreateTableCommand({
        TableName: TABLES.CATEGORIES,
        BillingMode: BillingMode.PAY_PER_REQUEST,
        AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
        KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      })
    );
    console.log(`  Created table "${TABLES.CATEGORIES}". Waiting for ACTIVE...`);
    await waitForTableActive(TABLES.CATEGORIES);
    console.log(`  Table "${TABLES.CATEGORIES}" is ACTIVE.`);
  } else {
    console.log(`  Table "${TABLES.CATEGORIES}" already exists.`);
  }

  // Products table
  if (!(await tableExists(TABLES.PRODUCTS))) {
    await rawClient.send(
      new CreateTableCommand({
        TableName: TABLES.PRODUCTS,
        BillingMode: BillingMode.PAY_PER_REQUEST,
        AttributeDefinitions: [
          { AttributeName: 'id', AttributeType: 'S' },
          { AttributeName: 'category_id', AttributeType: 'S' },
        ],
        KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
        GlobalSecondaryIndexes: [
          {
            IndexName: 'CategoryIndex',
            KeySchema: [{ AttributeName: 'category_id', KeyType: 'HASH' }],
            Projection: { ProjectionType: 'ALL' },
          },
        ],
      })
    );
    console.log(`  Created table "${TABLES.PRODUCTS}". Waiting for ACTIVE...`);
    await waitForTableActive(TABLES.PRODUCTS);
    console.log(`  Table "${TABLES.PRODUCTS}" is ACTIVE.`);
  } else {
    console.log(`  Table "${TABLES.PRODUCTS}" already exists.`);
  }

  // Orders table
  if (!(await tableExists(TABLES.ORDERS))) {
    await rawClient.send(
      new CreateTableCommand({
        TableName: TABLES.ORDERS,
        BillingMode: BillingMode.PAY_PER_REQUEST,
        AttributeDefinitions: [
          { AttributeName: 'id', AttributeType: 'S' },
          { AttributeName: 'status', AttributeType: 'S' },
          { AttributeName: 'created_at', AttributeType: 'S' },
        ],
        KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
        GlobalSecondaryIndexes: [
          {
            IndexName: 'StatusIndex',
            KeySchema: [
              { AttributeName: 'status', KeyType: 'HASH' },
              { AttributeName: 'created_at', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
        ],
      })
    );
    console.log(`  Created table "${TABLES.ORDERS}". Waiting for ACTIVE...`);
    await waitForTableActive(TABLES.ORDERS);
    console.log(`  Table "${TABLES.ORDERS}" is ACTIVE.`);
  } else {
    console.log(`  Table "${TABLES.ORDERS}" already exists.`);
  }

  // Order Items table
  if (!(await tableExists(TABLES.ORDER_ITEMS))) {
    await rawClient.send(
      new CreateTableCommand({
        TableName: TABLES.ORDER_ITEMS,
        BillingMode: BillingMode.PAY_PER_REQUEST,
        AttributeDefinitions: [
          { AttributeName: 'id', AttributeType: 'S' },
          { AttributeName: 'order_id', AttributeType: 'S' },
        ],
        KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
        GlobalSecondaryIndexes: [
          {
            IndexName: 'OrderIndex',
            KeySchema: [{ AttributeName: 'order_id', KeyType: 'HASH' }],
            Projection: { ProjectionType: 'ALL' },
          },
        ],
      })
    );
    console.log(`  Created table "${TABLES.ORDER_ITEMS}". Waiting for ACTIVE...`);
    await waitForTableActive(TABLES.ORDER_ITEMS);
    console.log(`  Table "${TABLES.ORDER_ITEMS}" is ACTIVE.`);
  } else {
    console.log(`  Table "${TABLES.ORDER_ITEMS}" already exists.`);
  }

  // Counters table
  if (!(await tableExists(TABLES.COUNTERS))) {
    await rawClient.send(
      new CreateTableCommand({
        TableName: TABLES.COUNTERS,
        BillingMode: BillingMode.PAY_PER_REQUEST,
        AttributeDefinitions: [{ AttributeName: 'counter_name', AttributeType: 'S' }],
        KeySchema: [{ AttributeName: 'counter_name', KeyType: 'HASH' }],
      })
    );
    console.log(`  Created table "${TABLES.COUNTERS}". Waiting for ACTIVE...`);
    await waitForTableActive(TABLES.COUNTERS);
    console.log(`  Table "${TABLES.COUNTERS}" is ACTIVE.`);
  } else {
    console.log(`  Table "${TABLES.COUNTERS}" already exists.`);
  }

  console.log('DynamoDB table setup complete.');
}
