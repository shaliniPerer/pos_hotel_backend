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

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// EVENT FUNCTIONS (packages/templates)
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/events/functions
router.get('/functions', authenticate, async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const result = await docClient.send(new ScanCommand({ TableName: TABLES.EVENT_FUNCTIONS }));
    const items = (result.Items || []).sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
    res.json(items);
  } catch (err) {
    console.error('Fetch event functions error:', err);
    res.status(500).json({ error: 'Failed to fetch event functions' });
  }
});

// POST /api/events/functions
router.post('/functions', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { name, items, type } = req.body;
  if (!name) {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  const now = new Date().toISOString();
  const fn = {
    id: uuidv4(),
    name: String(name).trim(),
    type: type === 'menu' ? 'menu' : 'function',
    items: Array.isArray(items) ? items : [],
    created_at: now,
    updated_at: now,
  };
  await docClient.send(new PutCommand({ TableName: TABLES.EVENT_FUNCTIONS, Item: fn }));
  res.status(201).json(fn);
});

// PUT /api/events/functions/:id
router.put('/functions/:id', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const id = req.params['id'] as string;
  const { name, items } = req.body;
  try {
    const existing = await docClient.send(new GetCommand({ TableName: TABLES.EVENT_FUNCTIONS, Key: { id } }));
    if (!existing.Item) {
      res.status(404).json({ error: 'Event function not found' });
      return;
    }
    const updated = {
      ...existing.Item,
      ...(name !== undefined && { name: String(name).trim() }),
      ...(items !== undefined && { items }),
      ...(req.body.type !== undefined && { type: req.body.type }),
      updated_at: new Date().toISOString(),
    };
    await docClient.send(new PutCommand({ TableName: TABLES.EVENT_FUNCTIONS, Item: updated }));
    res.json(updated);
  } catch (err) {
    console.error('Update event function error:', err);
    res.status(500).json({ error: 'Failed to update event function' });
  }
});

// DELETE /api/events/functions/:id
router.delete('/functions/:id', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const id = req.params['id'] as string;
  try {
    await docClient.send(new DeleteCommand({ TableName: TABLES.EVENT_FUNCTIONS, Key: { id } }));
    res.json({ success: true });
  } catch (err) {
    console.error('Delete event function error:', err);
    res.status(500).json({ error: 'Failed to delete event function' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// EVENT BOOKINGS
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/events/bookings/check-conflict?date=YYYY-MM-DD&time=HH:MM&excludeId=optional
router.get('/bookings/check-conflict', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { date, time, excludeId } = req.query as Record<string, string>;
  if (!date || !time) {
    res.status(400).json({ error: 'date and time are required' });
    return;
  }
  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLES.EVENT_BOOKINGS,
        IndexName: 'DateIndex',
        KeyConditionExpression: 'event_date = :d',
        ExpressionAttributeValues: { ':d': date },
      })
    );
    const conflicts = (result.Items || []).filter(
      (b) =>
        b.event_time === time &&
        b.status !== 'void' &&
        (!excludeId || b.id !== excludeId)
    );
    res.json({ conflict: conflicts.length > 0, conflicts });
  } catch (err) {
    console.error('Check conflict error:', err);
    res.status(500).json({ error: 'Failed to check conflict' });
  }
});

// GET /api/events/bookings
router.get('/bookings', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const result = await docClient.send(new ScanCommand({ TableName: TABLES.EVENT_BOOKINGS }));
    const bookings = (result.Items || []).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    res.json(bookings);
  } catch (err) {
    console.error('Fetch event bookings error:', err);
    res.status(500).json({ error: 'Failed to fetch event bookings' });
  }
});

// GET /api/events/bookings/:id
router.get('/bookings/:id', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const id = req.params['id'] as string;
  try {
    const result = await docClient.send(new GetCommand({ TableName: TABLES.EVENT_BOOKINGS, Key: { id } }));
    if (!result.Item) {
      res.status(404).json({ error: 'Booking not found' });
      return;
    }
    res.json(result.Item);
  } catch (err) {
    console.error('Get event booking error:', err);
    res.status(500).json({ error: 'Failed to get booking' });
  }
});

// POST /api/events/bookings
router.post('/bookings', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const {
    customer_name, customer_phone, event_date, event_time, pax,
    function_id, function_name, items,
    subtotal, total, advance_payment, balance,
    payment_method, payment_status, notes,
  } = req.body;

  if (!customer_name || !event_date || !event_time) {
    res.status(400).json({ error: 'customer_name, event_date, event_time are required' });
    return;
  }

  const now = new Date().toISOString();
  const booking = {
    id: uuidv4(),
    customer_name: String(customer_name).trim(),
    customer_phone: customer_phone ? String(customer_phone).trim() : '',
    event_date: String(event_date),
    event_time: String(event_time),
    pax: Number(pax) || 1,
    function_id: function_id || '',
    function_name: function_name || '',
    items: Array.isArray(items) ? items : [],
    subtotal: Number(subtotal) || 0,
    total: Number(total) || 0,
    advance_payment: Number(advance_payment) || 0,
    balance: Number(balance) || 0,
    payment_method: payment_method || 'cash',
    payment_status: payment_status || 'pending',
    status: 'upcoming',
    notes: notes || '',
    created_at: now,
    updated_at: now,
  };

  try {
    await docClient.send(new PutCommand({ TableName: TABLES.EVENT_BOOKINGS, Item: booking }));
    res.status(201).json(booking);
  } catch (err) {
    console.error('Create event booking error:', err);
    res.status(500).json({ error: 'Failed to create booking' });
  }
});

// PUT /api/events/bookings/:id
router.put('/bookings/:id', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const id = req.params['id'] as string;
  try {
    const existing = await docClient.send(new GetCommand({ TableName: TABLES.EVENT_BOOKINGS, Key: { id } }));
    if (!existing.Item) {
      res.status(404).json({ error: 'Booking not found' });
      return;
    }
    const updated = {
      ...existing.Item,
      ...req.body,
      id,
      updated_at: new Date().toISOString(),
    };
    await docClient.send(new PutCommand({ TableName: TABLES.EVENT_BOOKINGS, Item: updated }));
    res.json(updated);
  } catch (err) {
    console.error('Update event booking error:', err);
    res.status(500).json({ error: 'Failed to update booking' });
  }
});

// POST /api/events/bookings/:id/void
router.post('/bookings/:id/void', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const id = req.params['id'] as string;
  try {
    const existing = await docClient.send(new GetCommand({ TableName: TABLES.EVENT_BOOKINGS, Key: { id } }));
    if (!existing.Item) {
      res.status(404).json({ error: 'Booking not found' });
      return;
    }
    const updated = { ...existing.Item, status: 'void', updated_at: new Date().toISOString() };
    await docClient.send(new PutCommand({ TableName: TABLES.EVENT_BOOKINGS, Item: updated }));
    res.json(updated);
  } catch (err) {
    console.error('Void event booking error:', err);
    res.status(500).json({ error: 'Failed to void booking' });
  }
});

// POST /api/events/bookings/:id/complete
router.post('/bookings/:id/complete', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const id = req.params['id'] as string;
  try {
    const existing = await docClient.send(new GetCommand({ TableName: TABLES.EVENT_BOOKINGS, Key: { id } }));
    if (!existing.Item) {
      res.status(404).json({ error: 'Booking not found' });
      return;
    }
    const updated = { ...existing.Item, status: 'completed', updated_at: new Date().toISOString() };
    await docClient.send(new PutCommand({ TableName: TABLES.EVENT_BOOKINGS, Item: updated }));
    res.json(updated);
  } catch (err) {
    console.error('Complete event booking error:', err);
    res.status(500).json({ error: 'Failed to complete booking' });
  }
});

// DELETE /api/events/bookings/:id
router.delete('/bookings/:id', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const id = req.params['id'] as string;
  try {
    await docClient.send(new DeleteCommand({ TableName: TABLES.EVENT_BOOKINGS, Key: { id } }));
    res.json({ success: true });
  } catch (err) {
    console.error('Delete event booking error:', err);
    res.status(500).json({ error: 'Failed to delete booking' });
  }
});

export default router;
