import { Router, Response } from 'express';
import { ScanCommand, PutCommand, DeleteCommand, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { docClient, TABLES } from '../config/dynamodb';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// GET /api/products
router.get('/', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const category_id = req.query.category_id as string | undefined;
  try {
    let items;
    if (category_id) {
      const result = await docClient.send(
        new QueryCommand({
          TableName: TABLES.PRODUCTS,
          IndexName: 'CategoryIndex',
          KeyConditionExpression: 'category_id = :cid',
          ExpressionAttributeValues: { ':cid': category_id },
        })
      );
      items = result.Items || [];
    } else {
      const result = await docClient.send(new ScanCommand({ TableName: TABLES.PRODUCTS }));
      items = result.Items || [];
    }
    res.json(items);
  } catch (err) {
    console.error('Fetch products error:', err);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// GET /api/products/:id
router.get('/:id', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const result = await docClient.send(
      new GetCommand({ TableName: TABLES.PRODUCTS, Key: { id: req.params.id } })
    );
    if (!result.Item) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }
    res.json(result.Item);
  } catch (err) {
    console.error('Get product error:', err);
    res.status(500).json({ error: 'Failed to get product' });
  }
});

// POST /api/products
router.post('/', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { category_id, name, price, image, code } = req.body;
  if (!category_id || !name || price === undefined) {
    res.status(400).json({ error: 'category_id, name, and price are required' });
    return;
  }
  const item = {
    id: uuidv4(),
    category_id,
    name,
    price: Number(price),
    image: image || '',
    code: code || '',
    description: req.body.description || '',
    kot: req.body.kot ?? false,
    bot: req.body.bot ?? false,
    visible: req.body.visible !== undefined ? req.body.visible : true,
  };
  try {
    await docClient.send(new PutCommand({ TableName: TABLES.PRODUCTS, Item: item }));
    res.status(201).json(item);
  } catch (err) {
    console.error('Create product error:', err);
    res.status(500).json({ error: 'Failed to create product' });
  }
});

// PUT /api/products/:id
router.put('/:id', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { category_id, name, price, image, code, description, kot, bot } = req.body;
  try {
    const existing = await docClient.send(new GetCommand({ TableName: TABLES.PRODUCTS, Key: { id } }));
    if (!existing.Item) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }
    const { visible } = req.body;
    const updated = {
      ...existing.Item,
      category_id: category_id ?? existing.Item.category_id,
      name: name ?? existing.Item.name,
      price: price !== undefined ? Number(price) : existing.Item.price,
      image: image ?? existing.Item.image,
      code: code ?? existing.Item.code,
      description: description ?? existing.Item.description ?? '',
      kot: kot ?? existing.Item.kot ?? false,
      bot: bot ?? existing.Item.bot ?? false,
      visible: visible !== undefined ? visible : (existing.Item.visible !== undefined ? existing.Item.visible : true),
    };
    await docClient.send(new PutCommand({ TableName: TABLES.PRODUCTS, Item: updated }));
    res.json(updated);
  } catch (err) {
    console.error('Update product error:', err);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

// DELETE /api/products/:id
router.delete('/:id', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    await docClient.send(new DeleteCommand({ TableName: TABLES.PRODUCTS, Key: { id: req.params.id } }));
    res.json({ message: 'Product deleted' });
  } catch (err) {
    console.error('Delete product error:', err);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

export default router;
