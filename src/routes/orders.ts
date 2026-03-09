import { Router, Response } from 'express';
import {
  ScanCommand,
  PutCommand,
  GetCommand,
  QueryCommand,
  DeleteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { docClient, TABLES } from '../config/dynamodb';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { Server } from 'socket.io';

const router = Router();

// Inject socket.io instance
let io: Server;
export function setIO(ioInstance: Server) {
  io = ioInstance;
}

async function getOrderItems(order_id: string) {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLES.ORDER_ITEMS,
      IndexName: 'OrderIndex',
      KeyConditionExpression: 'order_id = :oid',
      ExpressionAttributeValues: { ':oid': order_id },
    })
  );
  return result.Items || [];
}

// GET /api/orders
router.get('/', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { status } = req.query;
  try {
    let orders;
    if (status && typeof status === 'string') {
      // Query via StatusIndex GSI
      const result = await docClient.send(
        new QueryCommand({
          TableName: TABLES.ORDERS,
          IndexName: 'StatusIndex',
          KeyConditionExpression: '#s = :status',
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: { ':status': status },
          ScanIndexForward: false, // most recent first
        })
      );
      orders = result.Items || [];
    } else {
      // Full scan, sort by created_at desc
      const result = await docClient.send(new ScanCommand({ TableName: TABLES.ORDERS }));
      orders = (result.Items || []).sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    }

    // Attach items to each order
    const ordersWithItems = await Promise.all(
      orders.map(async (order) => {
        const items = await getOrderItems(order.id);
        return { ...order, items };
      })
    );

    res.json(ordersWithItems);
  } catch (err) {
    console.error('Fetch orders error:', err);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// POST /api/orders/:id/void  (void/delete KOT order) - MUST be before /:id routes
router.post('/:id/void', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const id = req.params['id'] as string;
  try {
    const existing = await docClient.send(new GetCommand({ TableName: TABLES.ORDERS, Key: { id } }));
    if (!existing.Item) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }
    const updated = { ...existing.Item, status: 'void', updated_at: new Date().toISOString() };
    await docClient.send(new PutCommand({ TableName: TABLES.ORDERS, Item: updated }));
    
    const savedItems = await getOrderItems(id);
    const fullOrder = { ...updated, items: savedItems };
    if (io) io.emit('order:updated', fullOrder);
    
    res.json(fullOrder);
  } catch (err) {
    console.error('Void order error:', err);
    res.status(500).json({ error: 'Failed to void order' });
  }
});

// GET /api/orders/:id
router.get('/:id', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const orderId = req.params['id'] as string;
  try {
    const orderResult = await docClient.send(
      new GetCommand({ TableName: TABLES.ORDERS, Key: { id: orderId } })
    );
    if (!orderResult.Item) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }
    const items = await getOrderItems(orderId);
    res.json({ ...orderResult.Item, items });
  } catch (err) {
    console.error('Get order error:', err);
    res.status(500).json({ error: 'Failed to get order' });
  }
});

// POST /api/orders
router.post('/', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { type, reference, items, subtotal, tax, discount, total, payment_method, paid_amount, status } = req.body;

  if (!items || !Array.isArray(items)) {
    res.status(400).json({ error: 'Items array is required' });
    return;
  }

  const orderId = uuidv4();
  const now = new Date().toISOString();

  // Atomically increment order counter and get sequential order number
  const counterResult = await docClient.send(new UpdateCommand({
    TableName: TABLES.COUNTERS,
    Key: { counter_name: 'order_number' },
    UpdateExpression: 'ADD #val :one',
    ExpressionAttributeNames: { '#val': 'value' },
    ExpressionAttributeValues: { ':one': 1 },
    ReturnValues: 'UPDATED_NEW',
  }));
  const orderNumber = String(counterResult.Attributes?.value || 1).padStart(3, '0');

  const order = {
    id: orderId,
    order_number: orderNumber,
    type: type || 'table',
    reference: reference || '',
    status: status || 'open',
    subtotal: Number(subtotal) || 0,
    tax: Number(tax) || 0,
    discount: Number(discount) || 0,
    total: Number(total) || 0,
    payment_method: payment_method || 'cash',
    paid_amount: paid_amount ? Number(paid_amount) : undefined,
    cashier_id: req.user?.id || '',
    created_at: now,
    updated_at: now,
  };

  try {
    // Save order
    await docClient.send(new PutCommand({ TableName: TABLES.ORDERS, Item: order }));

    // Save order items
    const savedItems = [];
    for (const item of items) {
      const orderItem = {
        id: uuidv4(),
        order_id: orderId,
        product_id: item.product_id,
        product_name: item.product_name,
        quantity: Number(item.quantity),
        price: Number(item.price),
      };
      await docClient.send(new PutCommand({ TableName: TABLES.ORDER_ITEMS, Item: orderItem }));
      savedItems.push(orderItem);
    }

    const fullOrder = { ...order, items: savedItems };
    if (io) io.emit('order:created', fullOrder);
    res.status(201).json(fullOrder);
  } catch (err) {
    console.error('Create order error:', err);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// PUT /api/orders/:id
router.put('/:id', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const id = req.params['id'] as string;
  const { status, payment_method, paid_amount, items, subtotal, tax, discount, total } = req.body;

  try {
    const existing = await docClient.send(new GetCommand({ TableName: TABLES.ORDERS, Key: { id } }));
    if (!existing.Item) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    const now = new Date().toISOString();
    const updated = {
      ...existing.Item,
      status: status ?? existing.Item.status,
      payment_method: payment_method ?? existing.Item.payment_method,
      paid_amount: paid_amount !== undefined ? Number(paid_amount) : existing.Item.paid_amount,
      subtotal: subtotal !== undefined ? Number(subtotal) : existing.Item.subtotal,
      tax: tax !== undefined ? Number(tax) : existing.Item.tax,
      discount: discount !== undefined ? Number(discount) : existing.Item.discount,
      total: total !== undefined ? Number(total) : existing.Item.total,
      updated_at: now,
    };

    await docClient.send(new PutCommand({ TableName: TABLES.ORDERS, Item: updated }));

    let savedItems;
    if (items && Array.isArray(items)) {
      // Delete old items
      const oldItems = await getOrderItems(id);
      for (const oldItem of oldItems) {
        await docClient.send(
          new DeleteCommand({ TableName: TABLES.ORDER_ITEMS, Key: { id: oldItem.id } })
        );
      }
      // Insert new items
      savedItems = [];
      for (const item of items) {
        const orderItem = {
          id: uuidv4(),
          order_id: id,
          product_id: item.product_id,
          product_name: item.product_name,
          quantity: Number(item.quantity),
          price: Number(item.price),
        };
        await docClient.send(new PutCommand({ TableName: TABLES.ORDER_ITEMS, Item: orderItem }));
        savedItems.push(orderItem);
      }
    } else {
      savedItems = await getOrderItems(id);
    }

    const fullOrder = { ...updated, items: savedItems };
    if (io) io.emit('order:updated', fullOrder);
    res.json(fullOrder);
  } catch (err) {
    console.error('Update order error:', err);
    res.status(500).json({ error: 'Failed to update order' });
  }
});

// DELETE /api/orders/:id  (cancel order)
router.delete('/:id', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const id = req.params['id'] as string;
  try {
    const existing = await docClient.send(new GetCommand({ TableName: TABLES.ORDERS, Key: { id } }));
    if (!existing.Item) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }
    const updated = { ...existing.Item, status: 'cancelled', updated_at: new Date().toISOString() };
    await docClient.send(new PutCommand({ TableName: TABLES.ORDERS, Item: updated }));
    res.json({ message: 'Order cancelled' });
  } catch (err) {
    console.error('Cancel order error:', err);
    res.status(500).json({ error: 'Failed to cancel order' });
  }
});

export default router;
