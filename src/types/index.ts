export interface User {
  id: string;
  username: string;
  password: string;
  role: 'admin' | 'manager' | 'cashier';
  name: string;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  sort_order: number;
}

export interface Product {
  id: string;
  category_id: string;
  name: string;
  price: number;
  image: string;
  code?: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  price: number;
}

export interface Order {
  id: string;
  order_number: string;
  type: string;
  reference: string;
  status: 'open' | 'active' | 'completed' | 'cancelled' | 'void';
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  payment_method: string;
  paid_amount?: number;
  cashier_id: string;
  created_at: string;
  updated_at: string;
  items?: OrderItem[];
}

export interface AuthRequest extends Request {
  user?: {
    id: string;
    role: string;
    name: string;
  };
}
