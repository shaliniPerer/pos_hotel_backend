import { ScanCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLES } from './config/dynamodb';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

export async function seedData() {
  console.log('Checking seed data...');

  // Always ensure admin user exists with correct password
  const adminLookup = await docClient.send(
    new QueryCommand({
      TableName: TABLES.USERS,
      IndexName: 'UsernameIndex',
      KeyConditionExpression: 'username = :username',
      ExpressionAttributeValues: { ':username': 'admin' },
      Limit: 1,
    })
  );

  const newHash = bcrypt.hashSync('Admin@2026', 10);

  if (adminLookup.Items && adminLookup.Items.length > 0) {
    const existing = adminLookup.Items[0];
    await docClient.send(
      new UpdateCommand({
        TableName: TABLES.USERS,
        Key: { id: existing.id },
        UpdateExpression: 'SET #pw = :pw',
        ExpressionAttributeNames: { '#pw': 'password' },
        ExpressionAttributeValues: { ':pw': newHash },
      })
    );
    console.log('  Admin password updated.');
  } else {
    await docClient.send(
      new PutCommand({
        TableName: TABLES.USERS,
        Item: { id: uuidv4(), username: 'admin', password: newHash, role: 'admin', name: 'System Admin' },
      })
    );
    console.log('  Admin user created.');
  }

  // Check if other data already seeded
  const usersResult = await docClient.send(
    new ScanCommand({ TableName: TABLES.USERS, Limit: 2 })
  );

  if (usersResult.Items && usersResult.Items.length > 1) {
    console.log('Seed data already exists. Skipping categories/products.');
    return;
  }

  // Check categories
  const catResult = await docClient.send(
    new ScanCommand({ TableName: TABLES.CATEGORIES, Limit: 1 })
  );

  if (catResult.Items && catResult.Items.length > 0) {
    console.log('Categories already seeded. Skipping.');
    return;
  }

  console.log('Seeding categories and products...');

  // Seed Categories
  const categoryDefs = [
    { name: 'Fried Rice', color: 'bg-slate-100', sort_order: 1 },
    { name: 'Cheese Kottu', color: 'bg-slate-100', sort_order: 2 },
    { name: 'Fresh Juice', color: 'bg-slate-100', sort_order: 3 },
    { name: 'Mojito', color: 'bg-slate-100', sort_order: 4 },
    { name: 'Lassi', color: 'bg-slate-100', sort_order: 5 },
    { name: 'Smoothies', color: 'bg-slate-100', sort_order: 6 },
    { name: 'Milkshake', color: 'bg-slate-100', sort_order: 7 },
    { name: 'Hot Beverages', color: 'bg-slate-100', sort_order: 8 },
  ];

  const categoryIds: Record<string, string> = {};
  for (const cat of categoryDefs) {
    const id = uuidv4();
    categoryIds[cat.name] = id;
    await docClient.send(new PutCommand({ TableName: TABLES.CATEGORIES, Item: { id, ...cat } }));
  }
  console.log('  Seeded categories.');

  // Seed Products
  const products = [
    // Fried Rice
    { category: 'Fried Rice', name: 'Vegetable Rice (M)', price: 1390.0, code: '82M' },
    { category: 'Fried Rice', name: 'Vegetable Rice (L)', price: 1800.0, code: '82L' },
    { category: 'Fried Rice', name: 'Egg Rice (M)', price: 1490.0, code: '83M' },
    { category: 'Fried Rice', name: 'Egg Rice (L)', price: 1990.0, code: '83L' },
    { category: 'Fried Rice', name: 'Chicken Rice (M)', price: 1590.0, code: '84M' },
    { category: 'Fried Rice', name: 'Chicken Rice (L)', price: 2100.0, code: '84L' },
    { category: 'Fried Rice', name: 'Mixed Rice (M)', price: 1790.0, code: '85M' },
    { category: 'Fried Rice', name: 'Mixed Rice (L)', price: 2300.0, code: '85L' },
    // Cheese Kottu
    { category: 'Cheese Kottu', name: 'Veg Cheese Kottu (M)', price: 1490.0, code: '86M' },
    { category: 'Cheese Kottu', name: 'Veg Cheese Kottu (L)', price: 1990.0, code: '86L' },
    { category: 'Cheese Kottu', name: 'Chicken Cheese Kottu (M)', price: 1690.0, code: '87M' },
    { category: 'Cheese Kottu', name: 'Chicken Cheese Kottu (L)', price: 2200.0, code: '87L' },
    // Fresh Juice
    { category: 'Fresh Juice', name: 'Orange Juice', price: 690.0, code: 'FJ01' },
    { category: 'Fresh Juice', name: 'Mango Juice', price: 750.0, code: 'FJ02' },
    { category: 'Fresh Juice', name: 'Watermelon Juice', price: 650.0, code: 'FJ03' },
    { category: 'Fresh Juice', name: 'Pineapple Juice', price: 720.0, code: 'FJ04' },
    // Mojito
    { category: 'Mojito', name: 'Classic Mojito', price: 850.0, code: 'MJ01' },
    { category: 'Mojito', name: 'Strawberry Mojito', price: 950.0, code: 'MJ02' },
    { category: 'Mojito', name: 'Mint Mojito', price: 820.0, code: 'MJ03' },
    // Lassi
    { category: 'Lassi', name: 'Sweet Lassi', price: 580.0, code: 'LS01' },
    { category: 'Lassi', name: 'Mango Lassi', price: 650.0, code: 'LS02' },
    { category: 'Lassi', name: 'Rose Lassi', price: 620.0, code: 'LS03' },
    // Smoothies
    { category: 'Smoothies', name: 'Berry Blast', price: 890.0, code: 'SM01' },
    { category: 'Smoothies', name: 'Tropical Mix', price: 920.0, code: 'SM02' },
    { category: 'Smoothies', name: 'Green Detox', price: 950.0, code: 'SM03' },
    // Milkshake
    { category: 'Milkshake', name: 'Chocolate Shake', price: 750.0, code: 'MS01' },
    { category: 'Milkshake', name: 'Vanilla Shake', price: 700.0, code: 'MS02' },
    { category: 'Milkshake', name: 'Strawberry Shake', price: 780.0, code: 'MS03' },
    // Hot Beverages
    { category: 'Hot Beverages', name: 'Tea', price: 250.0, code: 'HB01' },
    { category: 'Hot Beverages', name: 'Coffee', price: 380.0, code: 'HB02' },
    { category: 'Hot Beverages', name: 'Hot Chocolate', price: 450.0, code: 'HB03' },
    { category: 'Hot Beverages', name: 'Cappuccino', price: 490.0, code: 'HB04' },
  ];

  for (const product of products) {
    const id = uuidv4();
    await docClient.send(
      new PutCommand({
        TableName: TABLES.PRODUCTS,
        Item: {
          id,
          category_id: categoryIds[product.category],
          name: product.name,
          price: product.price,
          image: '',
          code: product.code,
        },
      })
    );
  }
  console.log('  Seeded products.');
  console.log('Seed complete.');
}
