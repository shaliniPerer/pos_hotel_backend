import { Router, Response } from 'express';
import { ScanCommand, PutCommand, GetCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { docClient, TABLES } from '../config/dynamodb';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = Router();

// ── Image upload setup ────────────────────────────────────────────────────────
const uploadsDir = path.join(process.cwd(), 'uploads', 'expenses');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

// POST /api/expenses/upload-image
router.post('/upload-image', authenticate, upload.single('image'), (req: AuthenticatedRequest, res: Response): void => {
  if (!req.file) { res.status(400).json({ error: 'No image file provided' }); return; }
  res.json({ url: `/uploads/expenses/${req.file.filename}` });
});

// ─────────────────────────────────────────────────────────────────────────────
// EXPENSE CATEGORIES
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/expenses/categories
router.get('/categories', authenticate, async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const result = await docClient.send(new ScanCommand({ TableName: TABLES.EXPENSE_CATEGORIES }));
    const cats = (result.Items || []).sort((a, b) => a.name.localeCompare(b.name));
    res.json(cats);
  } catch (err) {
    console.error('Fetch expense categories error:', err);
    res.status(500).json({ error: 'Failed to fetch expense categories' });
  }
});

// POST /api/expenses/categories
router.post('/categories', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { name, description } = req.body;
  if (!name) {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  const now = new Date().toISOString();
  const category = {
    id: uuidv4(),
    name: String(name).trim(),
    description: description ? String(description).trim() : '',
    status: 'active',
    created_at: now,
    updated_at: now,
  };
  try {
    await docClient.send(new PutCommand({ TableName: TABLES.EXPENSE_CATEGORIES, Item: category }));
    res.status(201).json(category);
  } catch (err) {
    console.error('Create expense category error:', err);
    res.status(500).json({ error: 'Failed to create expense category' });
  }
});

// PUT /api/expenses/categories/:id
router.put('/categories/:id', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { name, description, status } = req.body;
  try {
    const existing = await docClient.send(new GetCommand({ TableName: TABLES.EXPENSE_CATEGORIES, Key: { id } }));
    if (!existing.Item) {
      res.status(404).json({ error: 'Expense category not found' });
      return;
    }
    const updated = {
      ...existing.Item,
      name: name ? String(name).trim() : existing.Item.name,
      description: description !== undefined ? String(description).trim() : existing.Item.description,
      status: status || existing.Item.status,
      updated_at: new Date().toISOString(),
    };
    await docClient.send(new PutCommand({ TableName: TABLES.EXPENSE_CATEGORIES, Item: updated }));
    res.json(updated);
  } catch (err) {
    console.error('Update expense category error:', err);
    res.status(500).json({ error: 'Failed to update expense category' });
  }
});

// DELETE /api/expenses/categories/:id
router.delete('/categories/:id', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  try {
    await docClient.send(new DeleteCommand({ TableName: TABLES.EXPENSE_CATEGORIES, Key: { id } }));
    res.json({ success: true });
  } catch (err) {
    console.error('Delete expense category error:', err);
    res.status(500).json({ error: 'Failed to delete expense category' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// EXPENSES
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/expenses
router.get('/', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const result = await docClient.send(new ScanCommand({ TableName: TABLES.EXPENSES }));
    const expenses = (result.Items || []).sort((a, b) => b.expense_date.localeCompare(a.expense_date));
    res.json(expenses);
  } catch (err) {
    console.error('Fetch expenses error:', err);
    res.status(500).json({ error: 'Failed to fetch expenses' });
  }
});

// POST /api/expenses
router.post('/', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { expense_date, category_id, category_name, expense_for, amount, reference_no, note, image } = req.body;
  if (!expense_date || !category_id || !expense_for || amount === undefined) {
    res.status(400).json({ error: 'expense_date, category_id, expense_for, amount are required' });
    return;
  }
  const now = new Date().toISOString();
  const expense = {
    id: uuidv4(),
    expense_date: String(expense_date),
    category_id: String(category_id),
    category_name: category_name ? String(category_name) : '',
    expense_for: String(expense_for).trim(),
    amount: typeof amount === 'number' ? amount : parseFloat(amount) || 0,
    reference_no: reference_no ? String(reference_no).trim() : '',
    image: image ? String(image) : '',
    note: note ? String(note).trim() : '',
    created_by: (req as any).user?.username || '',
    created_at: now,
    updated_at: now,
  };
  try {
    await docClient.send(new PutCommand({ TableName: TABLES.EXPENSES, Item: expense }));
    res.status(201).json(expense);
  } catch (err) {
    console.error('Create expense error:', err);
    res.status(500).json({ error: 'Failed to create expense' });
  }
});

// PUT /api/expenses/:id
router.put('/:id', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { expense_date, category_id, category_name, expense_for, amount, reference_no, note, image } = req.body;
  try {
    const existing = await docClient.send(new GetCommand({ TableName: TABLES.EXPENSES, Key: { id } }));
    if (!existing.Item) {
      res.status(404).json({ error: 'Expense not found' });
      return;
    }
    const updated = {
      ...existing.Item,
      expense_date: expense_date ?? existing.Item.expense_date,
      category_id: category_id ?? existing.Item.category_id,
      category_name: category_name !== undefined ? String(category_name) : existing.Item.category_name,
      expense_for: expense_for ? String(expense_for).trim() : existing.Item.expense_for,
      amount: amount !== undefined ? (typeof amount === 'number' ? amount : parseFloat(amount) || 0) : existing.Item.amount,
      reference_no: reference_no !== undefined ? String(reference_no).trim() : existing.Item.reference_no,
      image: image !== undefined ? String(image) : existing.Item.image,
      note: note !== undefined ? String(note).trim() : existing.Item.note,
      updated_at: new Date().toISOString(),
    };
    await docClient.send(new PutCommand({ TableName: TABLES.EXPENSES, Item: updated }));
    res.json(updated);
  } catch (err) {
    console.error('Update expense error:', err);
    res.status(500).json({ error: 'Failed to update expense' });
  }
});

// DELETE /api/expenses/:id
router.delete('/:id', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  try {
    await docClient.send(new DeleteCommand({ TableName: TABLES.EXPENSES, Key: { id } }));
    res.json({ success: true });
  } catch (err) {
    console.error('Delete expense error:', err);
    res.status(500).json({ error: 'Failed to delete expense' });
  }
});

export default router;
