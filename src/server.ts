import 'dotenv/config';
import express from 'express';
import http from 'http';
import cors from 'cors';
import path from 'path';
import { Server } from 'socket.io';

import { setupTables } from './config/setupTables';
import { seedData } from './seed';

import authRoutes from './routes/auth';
import usersRoutes from './routes/users';
import categoriesRoutes from './routes/categories';
import productsRoutes from './routes/products';
import ordersRoutes, { setIO } from './routes/orders';
import reportsRoutes from './routes/reports';
import eventsRoutes from './routes/events';
import roomsRoutes from './routes/rooms';
import expensesRoutes from './routes/expenses';

const PORT = parseInt(process.env.PORT || '3002', 10);

const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:5173,https://hotelpos.clickinmo.com')
  .split(',')
  .map((o) => o.trim());

async function startServer() {
  // 1. Ensure DynamoDB tables exist and are seeded
  await setupTables();
  await seedData();

  // 2. Create Express app & HTTP server
  const app = express();
  const httpServer = http.createServer(app);

  // 3. Socket.IO
  const io = new Server(httpServer, {
    cors: { origin: allowedOrigins, methods: ['GET', 'POST'] },
  });
  setIO(io);

  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);
    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.id}`);
    });
  });

  // 4. Middleware
  app.use(
    cors({
      origin: allowedOrigins,
      credentials: true,
    })
  );
  app.options('*', cors());
  app.use(express.json({ limit: '10mb' }));

  // Static file serving for uploaded images
  app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

  // 5. Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // 6. API Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/users', usersRoutes);
  app.use('/api/categories', categoriesRoutes);
  app.use('/api/products', productsRoutes);
  app.use('/api/orders', ordersRoutes);
  app.use('/api/reports', reportsRoutes);
  app.use('/api/events', eventsRoutes);
  app.use('/api/rooms', roomsRoutes);
  app.use('/api/expenses', expensesRoutes);

  // 7. Start listening
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`\nHotelMate POS Backend running on http://localhost:${PORT}`);
    console.log(`Allowed CORS origins: ${allowedOrigins.join(', ')}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
