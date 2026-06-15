export type TransactionType = 'expense' | 'income';
export type PaymentMethod = string;
export type SettingTarget =
  | 'payment'
  | 'expense_category'
  | 'income_category'
  | 'expense_subcategory'
  | 'income_subcategory';
export type SettingAction = 'add' | 'rename' | 'delete';
export type LedgerAction = 'add' | 'rename' | 'archive';

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
  isArchived?: number;
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
  selectedQueryLedger?: number;
  selectedRenameLedger?: number;
  selectedLedgerAction?: LedgerAction;
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
  | 'input_note'
  | 'confirm'
  | 'select_query_ledger'
  | 'select_query_range'
  | 'ledger_settings'
  | 'select_rename_ledger'
  | 'select_archive_ledger'
  | 'input_ledger_name'
  | 'settings_select_target'
  | 'settings_select_category'
  | 'settings_select_action'
  | 'settings_select_item'
  | 'settings_input_name';
