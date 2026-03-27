import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import dotenv from 'dotenv';

dotenv.config();

const clientConfig: ConstructorParameters<typeof DynamoDBClient>[0] = {
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
};

// Support DynamoDB Local for development
if (process.env.DYNAMODB_ENDPOINT) {
  clientConfig.endpoint = process.env.DYNAMODB_ENDPOINT;
}

const client = new DynamoDBClient(clientConfig);

export const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: {
    removeUndefinedValues: true,
    convertEmptyValues: false,
  },
});

// Table name constants
export const TABLES = {
  USERS: 'hotelmate-users',
  CATEGORIES: 'hotelmate-categories',
  PRODUCTS: 'hotelmate-products',
  ORDERS: 'hotelmate-orders',
  ORDER_ITEMS: 'hotelmate-order-items',
  COUNTERS: 'hotelmate-counters',
  EVENT_FUNCTIONS: 'hotelmate-event-functions',
  EVENT_BOOKINGS: 'hotelmate-event-bookings',
  ROOMS: 'hotelmate-rooms',
  ROOM_BOOKINGS: 'hotelmate-room-bookings',
  EXPENSE_CATEGORIES: 'hotelmate-expense-categories',
  EXPENSES: 'hotelmate-expenses',
} as const;
