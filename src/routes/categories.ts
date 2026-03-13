import { Router, Response } from 'express';
import { ScanCommand, PutCommand, DeleteCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { docClient, TABLES } from '../config/dynamodb';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// GET /api/categories
router.get('/', authenticate, async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const result = await docClient.send(new ScanCommand({ TableName: TABLES.CATEGORIES }));
    const categories = (result.Items || []).sort((a, b) => a.sort_order - b.sort_order);
    res.json(categories);
  } catch (err) {
    console.error('Fetch categories error:', err);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// POST /api/categories
router.post('/', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { name, color, sort_order, menu_type } = req.body;
  if (!name) {
    res.status(400).json({ error: 'Name is required' });
    return;
  }
  const item = { id: uuidv4(), name, color: color || 'bg-slate-100', sort_order: sort_order || 0, menu_type: menu_type || 'restaurant' };
  try {
    await docClient.send(new PutCommand({ TableName: TABLES.CATEGORIES, Item: item }));
    res.status(201).json(item);
  } catch (err) {
    console.error('Create category error:', err);
    res.status(500).json({ error: 'Failed to create category' });
  }
});

// PUT /api/categories/:id
router.put('/:id', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { name, color, sort_order } = req.body;
  try {
    const existing = await docClient.send(new GetCommand({ TableName: TABLES.CATEGORIES, Key: { id } }));
    if (!existing.Item) {
      res.status(404).json({ error: 'Category not found' });
      return;
    }
    const updated = { ...existing.Item, name: name ?? existing.Item.name, color: color ?? existing.Item.color, sort_order: sort_order ?? existing.Item.sort_order, menu_type: req.body.menu_type ?? existing.Item.menu_type ?? 'restaurant' };
    await docClient.send(new PutCommand({ TableName: TABLES.CATEGORIES, Item: updated }));
    res.json(updated);
  } catch (err) {
    console.error('Update category error:', err);
    res.status(500).json({ error: 'Failed to update category' });
  }
});

// DELETE /api/categories/:id
router.delete('/:id', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  try {
    await docClient.send(new DeleteCommand({ TableName: TABLES.CATEGORIES, Key: { id } }));
    res.json({ message: 'Category deleted' });
  } catch (err) {
    console.error('Delete category error:', err);
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

export default router;
