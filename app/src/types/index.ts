export type TransactionType = 'expense' | 'income';
export type PaymentMethod = string;
export type SettingTarget =
  | 'payment'
  | 'expense_category'
  | 'income_category'
  | 'expense_subcategory'
  | 'income_subcategory';
export type SettingAction = 'add' | 'rename' | 'delete';

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
  selectedSettingTarget?: SettingTarget;
  selectedSettingAction?: SettingAction;
  selectedSettingCategory?: string;
  selectedSettingItem?: string;
}

export type SessionStep =
  | 'start'
  | 'settings'
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
  | 'input_ledger_name'
  | 'settings_select_target'
  | 'settings_select_category'
  | 'settings_select_action'
  | 'settings_select_item'
  | 'settings_input_name';
