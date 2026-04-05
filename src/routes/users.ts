import { Router, Response } from 'express';
import { ScanCommand, PutCommand, GetCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { docClient, TABLES } from '../config/dynamodb';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// GET /api/users — list all staff users (admin only)
router.get('/', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (req.user?.role !== 'admin' && req.user?.role !== 'manager') {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  try {
    const result = await docClient.send(new ScanCommand({ TableName: TABLES.USERS }));
    const users = (result.Items || []).map(({ password: _pw, ...rest }) => rest);
    res.json(users);
  } catch (err) {
    console.error('Fetch users error:', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// POST /api/users — create a new staff user (admin only)
router.post('/', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  const { username, password, name, role } = req.body;
  if (!username || !password || !name || !role) {
    res.status(400).json({ error: 'username, password, name, and role are required' });
    return;
  }
  try {
    const hashed = bcrypt.hashSync(password, 10);
    const user = {
      id: uuidv4(),
      username,
      password: hashed,
      name,
      role,
    };
    await docClient.send(new PutCommand({ TableName: TABLES.USERS, Item: user }));
    const { password: _pw, ...safeUser } = user;
    res.status(201).json(safeUser);
  } catch (err) {
    console.error('Create user error:', err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// PUT /api/users/:id — update a staff user (admin only)
router.put('/:id', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  const id = req.params['id'] as string;
  const { name, role, password } = req.body;
  try {
    const existing = await docClient.send(new GetCommand({ TableName: TABLES.USERS, Key: { id } }));
    if (!existing.Item) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const updated = {
      ...existing.Item,
      name: name ?? existing.Item.name,
      role: role ?? existing.Item.role,
      ...(password ? { password: bcrypt.hashSync(password, 10) } : {}),
    };
    await docClient.send(new PutCommand({ TableName: TABLES.USERS, Item: updated }));
    const { password: _pw, ...safeUser } = updated;
    res.json(safeUser);
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// DELETE /api/users/:id — delete a staff user (admin only)
router.delete('/:id', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  const id = req.params['id'] as string;
  if (id === req.user?.id) {
    res.status(400).json({ error: 'Cannot delete your own account' });
    return;
  }
  try {
    await docClient.send(new DeleteCommand({ TableName: TABLES.USERS, Key: { id } }));
    res.json({ message: 'User deleted' });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

export default router;
