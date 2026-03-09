import { Router, Response } from 'express';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLES } from '../config/dynamodb';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// GET /api/reports/daily?date=YYYY-MM-DD
router.get('/daily', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const date = (req.query.date as string) || new Date().toISOString().split('T')[0];

  try {
    // Scan all completed orders and filter in-app by date
    const result = await docClient.send(
      new ScanCommand({
        TableName: TABLES.ORDERS,
        FilterExpression: '#s = :completed',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':completed': 'completed' },
      })
    );

    const orders = (result.Items || []).filter((order) => {
      const orderDate = order.created_at?.split('T')[0];
      return orderDate === date;
    });

    const stats = orders.reduce(
      (acc, order) => ({
        total_orders: acc.total_orders + 1,
        total_revenue: acc.total_revenue + (order.total || 0),
        total_tax: acc.total_tax + (order.tax || 0),
        total_discount: acc.total_discount + (order.discount || 0),
      }),
      { total_orders: 0, total_revenue: 0, total_tax: 0, total_discount: 0 }
    );

    res.json(stats);
  } catch (err) {
    console.error('Daily report error:', err);
    res.status(500).json({ error: 'Failed to fetch daily report' });
  }
});

// GET /api/reports/summary  (7-day revenue summary)
router.get('/summary', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const result = await docClient.send(
      new ScanCommand({
        TableName: TABLES.ORDERS,
        FilterExpression: '#s = :completed',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':completed': 'completed' },
      })
    );

    const orders = result.Items || [];
    const byDate: Record<string, { total_orders: number; total_revenue: number }> = {};

    for (const order of orders) {
      const d = order.created_at?.split('T')[0];
      if (!d) continue;
      if (!byDate[d]) byDate[d] = { total_orders: 0, total_revenue: 0 };
      byDate[d].total_orders += 1;
      byDate[d].total_revenue += order.total || 0;
    }

    const summary = Object.entries(byDate)
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-7);

    res.json(summary);
  } catch (err) {
    console.error('Summary report error:', err);
    res.status(500).json({ error: 'Failed to fetch summary report' });
  }
});

// GET /api/reports/item-sales?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
router.get('/item-sales', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const startDate = req.query.start_date as string;
  const endDate = req.query.end_date as string;

  try {
    // Get all completed orders in date range
    const ordersResult = await docClient.send(
      new ScanCommand({
        TableName: TABLES.ORDERS,
        FilterExpression: '#s = :completed',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':completed': 'completed' },
      })
    );

    const orders = (ordersResult.Items || []).filter((order) => {
      const orderDate = order.created_at?.split('T')[0];
      return orderDate >= startDate && orderDate <= endDate;
    });

    if (orders.length === 0) {
      res.json([]);
      return;
    }

    // Get all order items for these orders
    const orderIds = orders.map(o => o.id);
    const itemsResult = await docClient.send(
      new ScanCommand({
        TableName: TABLES.ORDER_ITEMS,
      })
    );

    const orderItems = (itemsResult.Items || []).filter(item => orderIds.includes(item.order_id));

    // Aggregate by product
    const itemSales: Record<string, { quantity: number; total_amount: number }> = {};

    for (const item of orderItems) {
      const name = item.product_name || 'Unknown';
      if (!itemSales[name]) {
        itemSales[name] = { quantity: 0, total_amount: 0 };
      }
      itemSales[name].quantity += item.quantity || 0;
      itemSales[name].total_amount += (item.price || 0) * (item.quantity || 0);
    }

    const result = Object.entries(itemSales)
      .map(([product_name, data]) => ({
        product_name,
        quantity: data.quantity,
        total_amount: data.total_amount,
      }))
      .sort((a, b) => b.total_amount - a.total_amount);

    res.json(result);
  } catch (err) {
    console.error('Item sales report error:', err);
    res.status(500).json({ error: 'Failed to fetch item sales report' });
  }
});

// GET /api/reports/payments?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
router.get('/payments', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const startDate = req.query.start_date as string;
  const endDate = req.query.end_date as string;

  try {
    const result = await docClient.send(
      new ScanCommand({
        TableName: TABLES.ORDERS,
        FilterExpression: '#s = :completed',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':completed': 'completed' },
      })
    );

    const orders = (result.Items || []).filter((order) => {
      const orderDate = order.created_at?.split('T')[0];
      return orderDate >= startDate && orderDate <= endDate;
    });

    // Aggregate by payment method
    const paymentData: Record<string, { order_count: number; total_amount: number }> = {};

    for (const order of orders) {
      const method = order.payment_method || 'cash';
      if (!paymentData[method]) {
        paymentData[method] = { order_count: 0, total_amount: 0 };
      }
      paymentData[method].order_count += 1;
      paymentData[method].total_amount += order.total || 0;
    }

    const paymentResult = Object.entries(paymentData)
      .map(([payment_method, data]) => ({
        payment_method,
        order_count: data.order_count,
        total_amount: data.total_amount,
      }))
      .sort((a, b) => b.total_amount - a.total_amount);

    res.json(paymentResult);
  } catch (err) {
    console.error('Payment report error:', err);
    res.status(500).json({ error: 'Failed to fetch payment report' });
  }
});

// GET /api/reports/kot?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
router.get('/kot', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const startDate = req.query.start_date as string;
  const endDate = req.query.end_date as string;

  try {
    // Get all orders in date range
    const ordersResult = await docClient.send(
      new ScanCommand({
        TableName: TABLES.ORDERS,
      })
    );

    const orders = (ordersResult.Items || []).filter((order) => {
      const orderDate = order.created_at?.split('T')[0];
      return orderDate >= startDate && orderDate <= endDate;
    });

    if (orders.length === 0) {
      res.json([]);
      return;
    }

    // Get all order items for these orders
    const orderIds = orders.map(o => o.id);
    const itemsResult = await docClient.send(
      new ScanCommand({
        TableName: TABLES.ORDER_ITEMS,
      })
    );

    const allOrderItems = itemsResult.Items || [];

    // Build KOT data
    const kotData = orders.map(order => {
      const items = allOrderItems
        .filter(item => item.order_id === order.id)
        .map(item => ({
          product_name: item.product_name || 'Unknown',
          quantity: item.quantity || 0,
        }));

      return {
        order_id: order.id,
        order_number: order.order_number || '',
        table_no: order.table_no,
        room_no: order.room_no,
        items,
        created_at: order.created_at,
        status: order.status || 'pending',
      };
    }).sort((a, b) => b.created_at.localeCompare(a.created_at));

    res.json(kotData);
  } catch (err) {
    console.error('KOT report error:', err);
    res.status(500).json({ error: 'Failed to fetch KOT report' });
  }
});

// GET /api/reports/top-items?limit=5
router.get('/top-items', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const limit = parseInt(req.query.limit as string) || 10;

  try {
    // Get all completed orders
    const ordersResult = await docClient.send(
      new ScanCommand({
        TableName: TABLES.ORDERS,
        FilterExpression: '#s = :completed',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':completed': 'completed' },
      })
    );

    const orders = ordersResult.Items || [];

    if (orders.length === 0) {
      res.json([]);
      return;
    }

    const orderIds = orders.map(o => o.id);

    // Get all order items
    const itemsResult = await docClient.send(
      new ScanCommand({
        TableName: TABLES.ORDER_ITEMS,
      })
    );

    const orderItems = (itemsResult.Items || []).filter(item => orderIds.includes(item.order_id));

    // Aggregate by product
    const itemStats: Record<string, number> = {};
    let totalQuantity = 0;

    for (const item of orderItems) {
      const name = item.product_name || 'Unknown';
      itemStats[name] = (itemStats[name] || 0) + (item.quantity || 0);
      totalQuantity += item.quantity || 0;
    }

    // Get top N items with percentages
    const topItems = Object.entries(itemStats)
      .map(([product_name, quantity]) => ({
        product_name,
        quantity,
        percentage: totalQuantity > 0 ? (quantity / totalQuantity) * 100 : 0,
      }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, limit);

    res.json(topItems);
  } catch (err) {
    console.error('Top items report error:', err);
    res.status(500).json({ error: 'Failed to fetch top items report' });
  }
});

export default router;
