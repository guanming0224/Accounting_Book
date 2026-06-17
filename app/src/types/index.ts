export type TransactionType = 'expense' | 'income';
export type PaymentMethod = string;
export type SettingTarget =
  | 'payment'
  | 'expense_category'
  | 'income_category'
  | 'expense_subcategory'
  | 'income_subcategory';
export type SettingAction = 'add' | 'rename' | 'delete';
export type LedgerAction = 'add' | 'rename' | 'archive' | 'unarchive';
export type TransactionAction = 'edit_amount' | 'edit_note' | 'delete';

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
  selectedTransaction?: number;
  selectedTransactionAction?: TransactionAction;
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
  | 'input_query_month'
  | 'input_query_date_range'
  | 'select_manage_transaction_ledger'
  | 'select_manage_transaction'
  | 'select_transaction_action'
  | 'input_transaction_amount'
  | 'input_transaction_note'
  | 'ledger_settings'
  | 'select_rename_ledger'
  | 'select_archive_ledger'
  | 'select_unarchive_ledger'
  | 'input_ledger_name'
  | 'settings_select_target'
  | 'settings_select_category'
  | 'settings_select_action'
  | 'settings_select_item'
  | 'settings_input_name';
