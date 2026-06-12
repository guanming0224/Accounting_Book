export type TransactionType = 'expense' | 'income';
export type PaymentMethod =
  | 'cash'
  | 'line_pay'
  | 'alipay'
  | 'cathay_credit_card'
  | 'okx_credit_card';

export interface User {
  userId: number;
  username: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Ledger {
  ledgerId: number;
  userId: number;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Transaction {
  transactionId: number;
  ledgerId: number;
  type: TransactionType;
  amount: number;
  category: string;
  subcategory: string;
  paymentMethod: PaymentMethod;
  description: string;
  createdAt: Date;
}

export interface UserSession {
  userId: number;
  step: SessionStep;
  selectedLedger?: number;
  selectedRenameLedger?: number;
  selectedType?: TransactionType;
  selectedCategory?: string;
  selectedSubcategory?: string;
  selectedPayment?: PaymentMethod;
  selectedAmount?: number;
}

export type SessionStep =
  | 'start'
  | 'select_type'
  | 'select_ledger'
  | 'select_category'
  | 'select_subcategory'
  | 'select_payment'
  | 'input_amount'
  | 'ask_note'
  | 'input_note'
  | 'confirm'
  | 'select_query_ledger'
  | 'select_rename_ledger'
  | 'input_ledger_name';
