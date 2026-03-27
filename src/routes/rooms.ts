import { Router, Response } from 'express';
import {
  ScanCommand,
  PutCommand,
  GetCommand,
  DeleteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { docClient, TABLES } from '../config/dynamodb';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// ROOMS (CRUD)
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/rooms
router.get('/', authenticate, async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const result = await docClient.send(new ScanCommand({ TableName: TABLES.ROOMS, ConsistentRead: true }));
    const rooms = (result.Items || []).sort((a, b) => a.name.localeCompare(b.name));
    res.json(rooms);
  } catch (err) {
    console.error('Fetch rooms error:', err);
    res.status(500).json({ error: 'Failed to fetch rooms' });
  }
});

// POST /api/rooms
router.post('/', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { name, status, room_type, price, amenities, room_size, adults, children, rate_plan, discount } = req.body;
  if (!name) {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  const room = {
    id: uuidv4(),
    name: String(name).trim(),
    room_type: room_type || 'standard',
    price: typeof price === 'number' ? price : parseFloat(price) || 0,
    amenities: Array.isArray(amenities) ? amenities : [],
    room_size: room_size ? String(room_size).trim() : '',
    adults: typeof adults === 'number' ? adults : parseInt(adults) || 1,
    children: typeof children === 'number' ? children : parseInt(children) || 0,
    status: status || 'available',
    rate_plan: Array.isArray(rate_plan) ? rate_plan : (rate_plan ? [String(rate_plan)] : []),
    discount: typeof discount === 'number' ? discount : parseFloat(discount) || 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  try {
    await docClient.send(new PutCommand({ TableName: TABLES.ROOMS, Item: room }));
    res.status(201).json(room);
  } catch (err) {
    console.error('Create room error:', err);
    res.status(500).json({ error: 'Failed to create room' });
  }
});

// PUT /api/rooms/:id
router.put('/:id', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { name, status, room_type, price, amenities, room_size, adults, children, rate_plan, discount } = req.body;
  try {
    const existing = await docClient.send(new GetCommand({ TableName: TABLES.ROOMS, Key: { id } }));
    if (!existing.Item) {
      res.status(404).json({ error: 'Room not found' });
      return;
    }
    const updated = {
      ...existing.Item,
      ...(name !== undefined && { name: String(name).trim() }),
      ...(status !== undefined && { status }),
      ...(room_type !== undefined && { room_type }),
      ...(price !== undefined && { price: typeof price === 'number' ? price : parseFloat(price) || 0 }),
      ...(amenities !== undefined && { amenities: Array.isArray(amenities) ? amenities : [] }),
      ...(room_size !== undefined && { room_size: String(room_size).trim() }),
      ...(adults !== undefined && { adults: typeof adults === 'number' ? adults : parseInt(adults) || 1 }),
      ...(children !== undefined && { children: typeof children === 'number' ? children : parseInt(children) || 0 }),
      ...(rate_plan !== undefined && { rate_plan: Array.isArray(rate_plan) ? rate_plan : (rate_plan ? [String(rate_plan)] : []) }),
      ...(discount !== undefined && { discount: typeof discount === 'number' ? discount : parseFloat(discount) || 0 }),
      updated_at: new Date().toISOString(),
    };
    await docClient.send(new PutCommand({ TableName: TABLES.ROOMS, Item: updated }));
    res.json(updated);
  } catch (err) {
    console.error('Update room error:', err);
    res.status(500).json({ error: 'Failed to update room' });
  }
});

// DELETE /api/rooms/:id
router.delete('/:id', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  try {
    await docClient.send(new DeleteCommand({ TableName: TABLES.ROOMS, Key: { id } }));
    res.json({ success: true });
  } catch (err) {
    console.error('Delete room error:', err);
    res.status(500).json({ error: 'Failed to delete room' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ROOM BOOKINGS
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/rooms/bookings — list all bookings
router.get('/bookings', authenticate, async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const result = await docClient.send(new ScanCommand({ TableName: TABLES.ROOM_BOOKINGS }));
    const bookings = (result.Items || []).sort(
      (a, b) => new Date(a.checkin_date).getTime() - new Date(b.checkin_date).getTime()
    );
    res.json(bookings);
  } catch (err) {
    console.error('Fetch room bookings error:', err);
    res.status(500).json({ error: 'Failed to fetch room bookings' });
  }
});

// GET /api/rooms/bookings/today — arrivals and departures today
router.get('/bookings/today', authenticate, async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  const today = new Date().toISOString().split('T')[0];
  try {
    const result = await docClient.send(new ScanCommand({ TableName: TABLES.ROOM_BOOKINGS }));
    const all = (result.Items || []).filter((b) => b.status !== 'cancelled');
    const arrivals = all.filter((b) => b.checkin_date === today);
    const departures = all.filter((b) => b.checkout_date === today);
    res.json({ arrivals, departures });
  } catch (err) {
    console.error('Today arrivals/departures error:', err);
    res.status(500).json({ error: 'Failed to fetch today data' });
  }
});

// GET /api/rooms/bookings/check-availability — check for overlapping bookings
// query: room_id, checkin_date, checkout_date, exclude_id (optional)
router.get('/bookings/check-availability', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { room_id, checkin_date, checkout_date, exclude_id } = req.query as Record<string, string>;
  if (!room_id || !checkin_date || !checkout_date) {
    res.status(400).json({ error: 'room_id, checkin_date and checkout_date are required' });
    return;
  }
  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLES.ROOM_BOOKINGS,
        IndexName: 'RoomCheckinIndex',
        KeyConditionExpression: 'room_id = :rid',
        ExpressionAttributeValues: { ':rid': room_id },
      })
    );
    const conflicts = (result.Items || []).filter((b) => {
      if (b.status === 'cancelled') return false;
      if (exclude_id && b.id === exclude_id) return false;
      // Overlap: new check-in < existing checkout AND new checkout > existing check-in
      return checkin_date < b.checkout_date && checkout_date > b.checkin_date;
    });
    res.json({ available: conflicts.length === 0, conflicts });
  } catch (err) {
    console.error('Check availability error:', err);
    res.status(500).json({ error: 'Failed to check availability' });
  }
});

// GET /api/rooms/bookings/:id
router.get('/bookings/:id', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  try {
    const result = await docClient.send(new GetCommand({ TableName: TABLES.ROOM_BOOKINGS, Key: { id } }));
    if (!result.Item) {
      res.status(404).json({ error: 'Room booking not found' });
      return;
    }
    res.json(result.Item);
  } catch (err) {
    console.error('Get room booking error:', err);
    res.status(500).json({ error: 'Failed to get room booking' });
  }
});

// POST /api/rooms/bookings
router.post('/bookings', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { room_id, room_name, customer_name, contact_number, checkin_date, checkout_date, notes,
    reservation_number, channel, email, rate_plan_name, num_rooms, adults, children,
    room_type, payment_type, payment_status, room_amount, rate_plan_amount, total_amount } = req.body;
  if (!room_id || !customer_name || !checkin_date || !checkout_date) {
    res.status(400).json({ error: 'room_id, customer_name, checkin_date, checkout_date are required' });
    return;
  }
  if (checkin_date >= checkout_date) {
    res.status(400).json({ error: 'checkout_date must be after checkin_date' });
    return;
  }
  // Check for overlaps
  try {
    const existing = await docClient.send(
      new QueryCommand({
        TableName: TABLES.ROOM_BOOKINGS,
        IndexName: 'RoomCheckinIndex',
        KeyConditionExpression: 'room_id = :rid',
        ExpressionAttributeValues: { ':rid': room_id },
      })
    );
    const conflicts = (existing.Items || []).filter((b) => {
      if (b.status === 'cancelled') return false;
      return checkin_date < b.checkout_date && checkout_date > b.checkin_date;
    });
    if (conflicts.length > 0) {
      res.status(409).json({ error: 'Room is already booked for the selected dates', conflicts });
      return;
    }
    const now = new Date().toISOString();
    const booking = {
      id: uuidv4(),
      room_id: String(room_id),
      room_name: room_name || '',
      reservation_number: reservation_number || `RES-${Date.now().toString(36).slice(-6).toUpperCase()}`,
      channel: channel || 'FIT',
      customer_name: String(customer_name).trim(),
      contact_number: contact_number ? String(contact_number).trim() : '',
      email: email ? String(email).trim() : '',
      checkin_date: String(checkin_date),
      checkout_date: String(checkout_date),
      rate_plan_name: rate_plan_name || '',
      num_rooms: typeof num_rooms === 'number' ? num_rooms : parseInt(num_rooms) || 1,
      adults: typeof adults === 'number' ? adults : parseInt(adults) || 1,
      children: typeof children === 'number' ? children : parseInt(children) || 0,
      room_type: room_type || '',
      payment_type: payment_type || 'Cash',
      payment_status: payment_status || 'Pending',
      room_amount: typeof room_amount === 'number' ? room_amount : parseFloat(room_amount) || 0,
      rate_plan_amount: typeof rate_plan_amount === 'number' ? rate_plan_amount : parseFloat(rate_plan_amount) || 0,
      total_amount: typeof total_amount === 'number' ? total_amount : parseFloat(total_amount) || 0,
      status: 'confirmed',
      notes: notes || '',
      created_at: now,
      updated_at: now,
    };
    await docClient.send(new PutCommand({ TableName: TABLES.ROOM_BOOKINGS, Item: booking }));
    res.status(201).json(booking);
  } catch (err) {
    console.error('Create room booking error:', err);
    res.status(500).json({ error: 'Failed to create room booking' });
  }
});

// PUT /api/rooms/bookings/:id
router.put('/bookings/:id', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { room_id, room_name, customer_name, contact_number, checkin_date, checkout_date, status, notes,
    channel, email, rate_plan_name, num_rooms, adults, children,
    room_type, payment_type, payment_status, room_amount, rate_plan_amount, total_amount } = req.body;
  try {
    const existing = await docClient.send(new GetCommand({ TableName: TABLES.ROOM_BOOKINGS, Key: { id } }));
    if (!existing.Item) {
      res.status(404).json({ error: 'Room booking not found' });
      return;
    }
    const newCheckin = checkin_date ?? existing.Item.checkin_date;
    const newCheckout = checkout_date ?? existing.Item.checkout_date;
    const newRoomId = room_id ?? existing.Item.room_id;
    if (newCheckin >= newCheckout) {
      res.status(400).json({ error: 'checkout_date must be after checkin_date' });
      return;
    }
    // Conflict check (excluding self)
    const scanResult = await docClient.send(
      new QueryCommand({
        TableName: TABLES.ROOM_BOOKINGS,
        IndexName: 'RoomCheckinIndex',
        KeyConditionExpression: 'room_id = :rid',
        ExpressionAttributeValues: { ':rid': newRoomId },
      })
    );
    const conflicts = (scanResult.Items || []).filter((b) => {
      if (b.status === 'cancelled') return false;
      if (b.id === id) return false;
      return newCheckin < b.checkout_date && newCheckout > b.checkin_date;
    });
    if (conflicts.length > 0) {
      res.status(409).json({ error: 'Room is already booked for the selected dates', conflicts });
      return;
    }
    const updated = {
      ...existing.Item,
      room_id: newRoomId,
      room_name: room_name ?? existing.Item.room_name,
      customer_name: customer_name ? String(customer_name).trim() : existing.Item.customer_name,
      contact_number: contact_number !== undefined ? String(contact_number).trim() : existing.Item.contact_number,
      ...(email !== undefined && { email: String(email).trim() }),
      ...(channel !== undefined && { channel }),
      ...(rate_plan_name !== undefined && { rate_plan_name }),
      ...(num_rooms !== undefined && { num_rooms: typeof num_rooms === 'number' ? num_rooms : parseInt(num_rooms) || 1 }),
      ...(adults !== undefined && { adults: typeof adults === 'number' ? adults : parseInt(adults) || 1 }),
      ...(children !== undefined && { children: typeof children === 'number' ? children : parseInt(children) || 0 }),
      ...(room_type !== undefined && { room_type }),
      ...(payment_type !== undefined && { payment_type }),
      ...(payment_status !== undefined && { payment_status }),
      ...(room_amount !== undefined && { room_amount: typeof room_amount === 'number' ? room_amount : parseFloat(room_amount) || 0 }),
      ...(rate_plan_amount !== undefined && { rate_plan_amount: typeof rate_plan_amount === 'number' ? rate_plan_amount : parseFloat(rate_plan_amount) || 0 }),
      ...(total_amount !== undefined && { total_amount: typeof total_amount === 'number' ? total_amount : parseFloat(total_amount) || 0 }),
      checkin_date: newCheckin,
      checkout_date: newCheckout,
      status: status ?? existing.Item.status,
      notes: notes !== undefined ? notes : existing.Item.notes,
      updated_at: new Date().toISOString(),
    };
    await docClient.send(new PutCommand({ TableName: TABLES.ROOM_BOOKINGS, Item: updated }));
    res.json(updated);
  } catch (err) {
    console.error('Update room booking error:', err);
    res.status(500).json({ error: 'Failed to update room booking' });
  }
});

// DELETE /api/rooms/bookings/:id
router.delete('/bookings/:id', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  try {
    await docClient.send(new DeleteCommand({ TableName: TABLES.ROOM_BOOKINGS, Key: { id } }));
    res.json({ success: true });
  } catch (err) {
    console.error('Delete room booking error:', err);
    res.status(500).json({ error: 'Failed to delete room booking' });
  }
});

export default router;
