import TelegramBot from 'telegram-bot-api';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, PAYMENT_METHODS } from '../constants';
import { Transaction, UserSession } from '../types';
import { cacheManager } from '../db/cache';
import { userModule } from '../modules/user/user';
import { ledgerModule } from '../modules/ledger/ledger';
import { transactionModule } from '../modules/transaction/transaction';
import { settingsModule } from '../modules/settings/settings';
import { googleSheetsIntegration } from '../integrations/GoogleSheets';

const MAIN_MENU: string[][] = [['記帳', '查詢'], ['交易管理', '設定'], ['說明']];
const NAVIGATION_BUTTONS = ['上一步', '回主畫面'];
const SETTINGS_MENU: string[][] = [
  ['帳本設定'],
  ['付款方式設定'],
  ['支出類別設定', '收入類別設定'],
  ['支出子類別設定', '收入子類別設定'],
  ['備份目前設定'],
  ['恢復備份設定', '恢復初始設定'],
  NAVIGATION_BUTTONS,
];
const LEDGER_SETTINGS_MENU: string[][] = [
  ['新增帳本'],
  ['修改帳本名稱', '封存帳本'],
  ['查看封存帳本', '取消封存帳本'],
  NAVIGATION_BUTTONS,
];
const SETTING_ACTION_MENU: string[][] = [['新增', '修改', '刪除'], NAVIGATION_BUTTONS];
const QUERY_RANGE_MENU: string[][] = [
  ['本月', '上月'],
  ['本週', '上週'],
  ['自訂月份', '自訂區間'],
  NAVIGATION_BUTTONS,
];
const TRANSACTION_ACTION_MENU: string[][] = [['修改金額', '修改備註'], ['刪除交易'], NAVIGATION_BUTTONS];

export class BotHandlers {
  private bot: TelegramBot;

  constructor(token: string) {
    this.bot = new TelegramBot({ token });
    this.bot.setMessageProvider(new TelegramBot.GetUpdateMessageProvider());
  }

  private sendKeyboard(chatId: number, text: string, buttons: string[][]): void {
    this.sendKeyboardWithRetry(chatId, text, buttons).catch((err) =>
      console.error('Failed to send message after retries:', err)
    );
  }

  private async sendKeyboardWithRetry(
    chatId: number,
    text: string,
    buttons: string[][],
    maxAttempts = 3
  ): Promise<void> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.bot.sendMessage({
          chat_id: chatId,
          text,
          reply_markup: {
            keyboard: buttons,
            resize_keyboard: true,
            one_time_keyboard: true,
          },
        });
        return;
      } catch (err) {
        lastError = err;
        console.error(`Failed to send message, attempt ${attempt}/${maxAttempts}:`, err);

        if (attempt === 1) {
          await this.sendRetryNotice(chatId);
        }

        if (attempt < maxAttempts) {
          await this.delay(1500 * attempt);
        }
      }
    }

    throw lastError;
  }

  private async sendRetryNotice(chatId: number): Promise<void> {
    try {
      await this.bot.sendMessage({
        chat_id: chatId,
        text: '目前 Telegram 連線較慢，系統正在重新傳送訊息，請稍候。',
      });
    } catch (err) {
      console.error('Failed to send retry notice:', err);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private getSettingType(session: UserSession): 'expense' | 'income' {
    return session.selectedSettingTarget?.startsWith('income') ? 'income' : 'expense';
  }

  private isSubcategoryTarget(session: UserSession): boolean {
    return (
      session.selectedSettingTarget === 'expense_subcategory' ||
      session.selectedSettingTarget === 'income_subcategory'
    );
  }

  private withNavigation(buttons: string[][] = []): string[][] {
    return [...buttons, NAVIGATION_BUTTONS];
  }

  private ledgerButtons(ledgers: { name: string }[]): string[][] {
    const rows: string[][] = [];
    for (let i = 0; i < ledgers.length; i += 2) {
      rows.push(ledgers.slice(i, i + 2).map((ledger) => ledger.name));
    }
    return this.withNavigation(rows);
  }

  private itemButtons(items: string[]): string[][] {
    const rows: string[][] = [];
    for (let i = 0; i < items.length; i += 2) {
      rows.push(items.slice(i, i + 2));
    }
    return this.withNavigation(rows);
  }

  private formatSqliteDate(date: Date): string {
    return date.toISOString().slice(0, 19).replace('T', ' ');
  }

  private getTaipeiDateParts(date = new Date()): { year: number; month: number; day: number } {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    return { year: get('year'), month: get('month'), day: get('day') };
  }

  private taipeiMidnightUtc(year: number, month: number, day: number): Date {
    return new Date(Date.UTC(year, month - 1, day) - 8 * 60 * 60 * 1000);
  }

  private getQueryDateRange(range: string): {
    label: string;
    displayStart: string;
    displayEnd: string;
    startDate: string;
    endDate: string;
  } | null {
    const { year, month, day } = this.getTaipeiDateParts();
    const todayUtc = this.taipeiMidnightUtc(year, month, day);
    const dayOfWeek = (todayUtc.getUTCDay() + 6) % 7;
    const weekStart = new Date(todayUtc.getTime() - dayOfWeek * 24 * 60 * 60 * 1000);

    let start: Date;
    let end: Date;

    if (range === '本月') {
      start = this.taipeiMidnightUtc(year, month, 1);
      end = month === 12 ? this.taipeiMidnightUtc(year + 1, 1, 1) : this.taipeiMidnightUtc(year, month + 1, 1);
    } else if (range === '上月') {
      start = month === 1 ? this.taipeiMidnightUtc(year - 1, 12, 1) : this.taipeiMidnightUtc(year, month - 1, 1);
      end = this.taipeiMidnightUtc(year, month, 1);
    } else if (range === '本週') {
      start = weekStart;
      end = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    } else if (range === '上週') {
      start = new Date(weekStart.getTime() - 7 * 24 * 60 * 60 * 1000);
      end = weekStart;
    } else {
      return null;
    }

    return {
      label: range,
      displayStart: this.formatTaipeiDate(start),
      displayEnd: this.formatTaipeiDate(new Date(end.getTime() - 24 * 60 * 60 * 1000)),
      startDate: this.formatSqliteDate(start),
      endDate: this.formatSqliteDate(end),
    };
  }

  private formatTaipeiDate(date: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  }

  private parseCustomMonth(monthText: string) {
    const match = monthText.trim().match(/^(\d{4})-(\d{2})$/);
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    if (month < 1 || month > 12) return null;

    const start = this.taipeiMidnightUtc(year, month, 1);
    const end = month === 12 ? this.taipeiMidnightUtc(year + 1, 1, 1) : this.taipeiMidnightUtc(year, month + 1, 1);
    return {
      label: `${monthText.trim()} 月份`,
      displayStart: this.formatTaipeiDate(start),
      displayEnd: this.formatTaipeiDate(new Date(end.getTime() - 24 * 60 * 60 * 1000)),
      startDate: this.formatSqliteDate(start),
      endDate: this.formatSqliteDate(end),
    };
  }

  private parseCustomDateRange(rangeText: string) {
    const match = rangeText.trim().match(/^(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})$/);
    if (!match) return null;

    const [startYear, startMonth, startDay] = match[1].split('-').map(Number);
    const [endYear, endMonth, endDay] = match[2].split('-').map(Number);
    const start = this.taipeiMidnightUtc(startYear, startMonth, startDay);
    const inclusiveEnd = this.taipeiMidnightUtc(endYear, endMonth, endDay);
    const end = new Date(inclusiveEnd.getTime() + 24 * 60 * 60 * 1000);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) return null;

    return {
      label: '自訂區間',
      displayStart: this.formatTaipeiDate(start),
      displayEnd: this.formatTaipeiDate(inclusiveEnd),
      startDate: this.formatSqliteDate(start),
      endDate: this.formatSqliteDate(end),
    };
  }

  private transactionButtonLabel(transaction: Transaction): string {
    const createdAt = transaction.createdAt as Date | string;
    const date =
      typeof createdAt === 'string'
        ? createdAt.slice(5, 10).replace('-', '/')
        : this.formatTaipeiDate(createdAt).slice(5).replace('-', '/');
    const type = transaction.type === 'income' ? '進' : '支';
    return `#${transaction.transactionId} ${date} ${type} ${transaction.amount}`;
  }

  private parseTransactionId(text: string): number | null {
    const match = text.match(/^#(\d+)/);
    return match ? Number(match[1]) : null;
  }

  private async showMainMenu(chatId: number, userId: number, message: string): Promise<void> {
    const session: UserSession = { userId, step: 'select_type' };
    await cacheManager.setUserSession(userId, session);
    this.sendKeyboard(chatId, message, MAIN_MENU);
  }

  async handleStart(chatId: number, userId: number, username: string): Promise<void> {
    // Get or create user
    await userModule.getOrCreateUser(userId, username);

    // Create default ledgers if not exist
    await ledgerModule.createDefaultLedgers(userId);
    await settingsModule.initializeDefaults(userId);

    // Initialize user session
    const session: UserSession = { userId, step: 'select_type' };
    await cacheManager.setUserSession(userId, session);

    const message =
      '歡迎使用 Telegram 記帳系統！\n\n請選擇您要進行的操作：';

    this.sendKeyboard(chatId, message, MAIN_MENU);
  }

  async sendMainMenuToKnownUsers(): Promise<void> {
    const users = await userModule.getAllUsers();
    for (const user of users) {
      const session: UserSession = { userId: user.userId, step: 'select_type' };
      await cacheManager.setUserSession(user.userId, session);
      await ledgerModule.createDefaultLedgers(user.userId);
      await settingsModule.initializeDefaults(user.userId);
      this.sendKeyboard(
        user.userId,
        '系統已啟動。\n\n請選擇您要進行的操作：',
        MAIN_MENU
      );
    }
  }

  async handleRecording(chatId: number, userId: number, username: string): Promise<void> {
    const session = await cacheManager.getUserSession(userId);
    if (!session) {
      return this.handleStart(chatId, userId, username);
    }

    const message = '請選擇進出類型：';
    this.sendKeyboard(chatId, message, this.withNavigation([['支出', '進帳']]));
  }

  async handleHelp(chatId: number): Promise<void> {
    const expenseCategoryLines = Object.values(EXPENSE_CATEGORIES)
      .map((c) => `• ${c.name}（${c.description}）：${c.subcategories.join('、')}`)
      .join('\n');
    const incomeCategoryLines = Object.values(INCOME_CATEGORIES)
      .map((c) => `• ${c.name}（${c.description}）：${c.subcategories.join('、')}`)
      .join('\n');
    const message =
      '📖 使用說明\n\n' +
      '記帳流程：記帳 → 選擇進出 → 選擇帳本 → 選擇類別 → 選擇子類別 → 選擇支付方式 → 輸入金額\n\n' +
      '查詢：點選「查詢」後選擇帳本，可查看該帳本的收支統計與最近紀錄。\n\n' +
      '設定：點選「設定」→「修改帳本名稱」，可自訂帳本名稱。\n\n' +
      `支出類別：\n${expenseCategoryLines}\n\n` +
      `進帳類別：\n${incomeCategoryLines}\n\n` +
      `支付方式：${Object.values(PAYMENT_METHODS).join('、')}\n\n` +
      '隨時可輸入「回主畫面」回到主選單。';
    this.sendKeyboard(chatId, message, MAIN_MENU);
  }

  async handleSettings(chatId: number, userId: number): Promise<void> {
    const session: UserSession = { userId, step: 'settings' };
    await cacheManager.setUserSession(userId, session);
    this.sendKeyboard(chatId, '請選擇設定項目：', SETTINGS_MENU);
  }

  async handleLedgerSettings(chatId: number, userId: number): Promise<void> {
    const session: UserSession = { userId, step: 'ledger_settings' };
    await cacheManager.setUserSession(userId, session);
    this.sendKeyboard(chatId, '請選擇帳本設定：', LEDGER_SETTINGS_MENU);
  }

  async handleCreateLedgerCommand(chatId: number, userId: number, username: string): Promise<void> {
    await userModule.getOrCreateUser(userId, username);
    const session: UserSession = {
      userId,
      step: 'input_ledger_name',
      selectedLedgerAction: 'add',
    };
    await cacheManager.setUserSession(userId, session);
    this.sendKeyboard(chatId, '請輸入新帳本名稱：', [NAVIGATION_BUTTONS]);
  }

  async handleArchiveLedgerCommand(
    chatId: number,
    userId: number,
    username: string
  ): Promise<void> {
    await userModule.getOrCreateUser(userId, username);
    await ledgerModule.createDefaultLedgers(userId);

    const session: UserSession = {
      userId,
      step: 'select_archive_ledger',
      selectedLedgerAction: 'archive',
    };
    await cacheManager.setUserSession(userId, session);

    const ledgers = await ledgerModule.getUserLedgers(userId);
    this.sendKeyboard(chatId, '請選擇要封存的帳本：', this.ledgerButtons(ledgers));
  }

  async handleArchivedLedgers(chatId: number, userId: number): Promise<void> {
    const session: UserSession = { userId, step: 'ledger_settings' };
    await cacheManager.setUserSession(userId, session);
    const ledgers = await ledgerModule.getArchivedLedgers(userId);
    const message =
      ledgers.length > 0
        ? `封存帳本：\n${ledgers.map((ledger) => `- ${ledger.name}`).join('\n')}`
        : '目前沒有封存帳本。';
    this.sendKeyboard(chatId, `${message}\n\n請選擇帳本設定：`, LEDGER_SETTINGS_MENU);
  }

  async handleUnarchiveLedgerCommand(
    chatId: number,
    userId: number,
    username: string
  ): Promise<void> {
    await userModule.getOrCreateUser(userId, username);
    const ledgers = await ledgerModule.getArchivedLedgers(userId);
    if (!ledgers.length) {
      this.sendKeyboard(chatId, '目前沒有封存帳本。\n\n請選擇帳本設定：', LEDGER_SETTINGS_MENU);
      return;
    }

    const session: UserSession = {
      userId,
      step: 'select_unarchive_ledger',
      selectedLedgerAction: 'unarchive',
    };
    await cacheManager.setUserSession(userId, session);
    this.sendKeyboard(chatId, '請選擇要取消封存的帳本：', this.ledgerButtons(ledgers));
  }

  async handleBackupSettings(chatId: number, userId: number): Promise<void> {
    await settingsModule.backupSettings(userId);
    this.sendKeyboard(chatId, '已備份目前設定。\n\n請選擇設定項目：', SETTINGS_MENU);
  }

  async handleRestoreBackupSettings(chatId: number, userId: number): Promise<void> {
    try {
      await settingsModule.restoreBackup(userId);
      this.sendKeyboard(chatId, '已恢復備份設定。\n\n請選擇設定項目：', SETTINGS_MENU);
    } catch (err) {
      const message =
        err instanceof Error && err.message === 'SETTINGS_BACKUP_NOT_FOUND'
          ? '目前沒有備份設定。請先使用「備份目前設定」。'
          : '恢復備份設定失敗。';
      this.sendKeyboard(chatId, `${message}\n\n請選擇設定項目：`, SETTINGS_MENU);
    }
  }

  async handleRestoreDefaultSettings(chatId: number, userId: number): Promise<void> {
    await settingsModule.resetToDefaults(userId);
    this.sendKeyboard(
      chatId,
      '已恢復初始設定。\n\n恢復前的設定已自動備份，可用「恢復備份設定」還原。\n\n請選擇設定項目：',
      SETTINGS_MENU
    );
  }

  async handleSettingsTargetSelection(
    chatId: number,
    userId: number,
    targetText: string
  ): Promise<void> {
    const targetMap: Record<string, UserSession['selectedSettingTarget']> = {
      付款方式設定: 'payment',
      支出類別設定: 'expense_category',
      收入類別設定: 'income_category',
      支出子類別設定: 'expense_subcategory',
      收入子類別設定: 'income_subcategory',
    };
    const target = targetMap[targetText];
    if (!target) {
      return this.sendKeyboard(chatId, '請選擇設定項目：', SETTINGS_MENU);
    }

    const session: UserSession = {
      userId,
      step: target.endsWith('subcategory') ? 'settings_select_category' : 'settings_select_action',
      selectedSettingTarget: target,
    };
    await cacheManager.setUserSession(userId, session);

    if (session.step === 'settings_select_category') {
      const categories = await settingsModule.getCategories(userId, this.getSettingType(session));
      return this.sendKeyboard(
        chatId,
        '請選擇要管理子類別的類別：',
        this.itemButtons(categories.map((category) => category.name))
      );
    }

    this.sendKeyboard(chatId, '請選擇操作：', SETTING_ACTION_MENU);
  }

  async handleSettingsCategorySelection(
    chatId: number,
    userId: number,
    categoryName: string
  ): Promise<void> {
    const session = await cacheManager.getUserSession(userId);
    if (!session?.selectedSettingTarget) return;

    const categories = await settingsModule.getCategories(userId, this.getSettingType(session));
    if (!categories.some((category) => category.name === categoryName)) {
      return this.sendKeyboard(
        chatId,
        '找不到該類別，請重新選擇：',
        this.itemButtons(categories.map((category) => category.name))
      );
    }

    session.selectedSettingCategory = categoryName;
    session.step = 'settings_select_action';
    await cacheManager.setUserSession(userId, session);
    this.sendKeyboard(chatId, '請選擇操作：', SETTING_ACTION_MENU);
  }

  async handleSettingsActionSelection(
    chatId: number,
    userId: number,
    actionText: string
  ): Promise<void> {
    const session = await cacheManager.getUserSession(userId);
    if (!session?.selectedSettingTarget) return;

    const actionMap: Record<string, UserSession['selectedSettingAction']> = {
      新增: 'add',
      修改: 'rename',
      刪除: 'delete',
    };
    const action = actionMap[actionText];
    if (!action) {
      return this.sendKeyboard(chatId, '請選擇操作：', SETTING_ACTION_MENU);
    }

    session.selectedSettingAction = action;

    if (action === 'add') {
      session.step = 'settings_input_name';
      await cacheManager.setUserSession(userId, session);
      return this.sendKeyboard(chatId, '請輸入新名稱：', [NAVIGATION_BUTTONS]);
    }

    const items = await this.getSettingItems(userId, session);
    if (!items.length) {
      return this.sendKeyboard(chatId, '目前沒有可操作的項目。', SETTING_ACTION_MENU);
    }

    session.step = 'settings_select_item';
    await cacheManager.setUserSession(userId, session);
    this.sendKeyboard(chatId, '請選擇項目：', this.itemButtons(items));
  }

  async handleSettingsItemSelection(
    chatId: number,
    userId: number,
    itemName: string
  ): Promise<void> {
    const session = await cacheManager.getUserSession(userId);
    if (!session?.selectedSettingTarget || !session.selectedSettingAction) return;

    const items = await this.getSettingItems(userId, session);
    if (!items.includes(itemName)) {
      return this.sendKeyboard(chatId, '找不到該項目，請重新選擇：', this.itemButtons(items));
    }

    session.selectedSettingItem = itemName;

    if (session.selectedSettingAction === 'delete') {
      await this.applySettingDelete(userId, session);
      session.step = 'settings_select_action';
      session.selectedSettingAction = undefined;
      session.selectedSettingItem = undefined;
      await cacheManager.setUserSession(userId, session);
      return this.sendKeyboard(chatId, `已刪除「${itemName}」。\n\n請選擇操作：`, SETTING_ACTION_MENU);
    }

    session.step = 'settings_input_name';
    await cacheManager.setUserSession(userId, session);
    this.sendKeyboard(chatId, `請輸入「${itemName}」的新名稱：`, [NAVIGATION_BUTTONS]);
  }

  async handleSettingsNameInput(chatId: number, userId: number, name: string): Promise<void> {
    const session = await cacheManager.getUserSession(userId);
    if (!session?.selectedSettingTarget || !session.selectedSettingAction) return;

    try {
      if (session.selectedSettingAction === 'add') {
        await this.applySettingAdd(userId, session, name);
      } else {
        await this.applySettingRename(userId, session, name);
      }

      session.step = 'settings_select_action';
      session.selectedSettingAction = undefined;
      session.selectedSettingItem = undefined;
      await cacheManager.setUserSession(userId, session);
      this.sendKeyboard(chatId, `已儲存「${name.trim()}」。\n\n請選擇操作：`, SETTING_ACTION_MENU);
    } catch (err) {
      const message = this.getSettingErrorMessage(err);
      this.sendKeyboard(chatId, message, [NAVIGATION_BUTTONS]);
    }
  }

  private async getSettingItems(userId: number, session: UserSession): Promise<string[]> {
    switch (session.selectedSettingTarget) {
      case 'payment':
        return settingsModule.getPaymentMethods(userId);
      case 'expense_category':
        return (await settingsModule.getCategories(userId, 'expense')).map((category) => category.name);
      case 'income_category':
        return (await settingsModule.getCategories(userId, 'income')).map((category) => category.name);
      case 'expense_subcategory':
      case 'income_subcategory':
        return settingsModule.getSubcategories(
          userId,
          this.getSettingType(session),
          session.selectedSettingCategory || ''
        );
      default:
        return [];
    }
  }

  private async applySettingAdd(userId: number, session: UserSession, name: string): Promise<void> {
    switch (session.selectedSettingTarget) {
      case 'payment':
        return settingsModule.addPaymentMethod(userId, name);
      case 'expense_category':
        return settingsModule.addCategory(userId, 'expense', name);
      case 'income_category':
        return settingsModule.addCategory(userId, 'income', name);
      case 'expense_subcategory':
      case 'income_subcategory':
        return settingsModule.addSubcategory(
          userId,
          this.getSettingType(session),
          session.selectedSettingCategory || '',
          name
        );
    }
  }

  private async applySettingRename(userId: number, session: UserSession, name: string): Promise<void> {
    switch (session.selectedSettingTarget) {
      case 'payment':
        return settingsModule.renamePaymentMethod(userId, session.selectedSettingItem || '', name);
      case 'expense_category':
        return settingsModule.renameCategory(userId, 'expense', session.selectedSettingItem || '', name);
      case 'income_category':
        return settingsModule.renameCategory(userId, 'income', session.selectedSettingItem || '', name);
      case 'expense_subcategory':
      case 'income_subcategory':
        return settingsModule.renameSubcategory(
          userId,
          this.getSettingType(session),
          session.selectedSettingCategory || '',
          session.selectedSettingItem || '',
          name
        );
    }
  }

  private async applySettingDelete(userId: number, session: UserSession): Promise<void> {
    switch (session.selectedSettingTarget) {
      case 'payment':
        return settingsModule.deletePaymentMethod(userId, session.selectedSettingItem || '');
      case 'expense_category':
        return settingsModule.deleteCategory(userId, 'expense', session.selectedSettingItem || '');
      case 'income_category':
        return settingsModule.deleteCategory(userId, 'income', session.selectedSettingItem || '');
      case 'expense_subcategory':
      case 'income_subcategory':
        return settingsModule.deleteSubcategory(
          userId,
          this.getSettingType(session),
          session.selectedSettingCategory || '',
          session.selectedSettingItem || ''
        );
    }
  }

  private getSettingErrorMessage(err: unknown): string {
    const message = err instanceof Error ? err.message : '';
    if (message === 'SETTING_NAME_EMPTY') return '名稱不可空白，請重新輸入：';
    if (message === 'SETTING_NAME_TOO_LONG') return '名稱最多 40 個字，請重新輸入：';
    if (message === 'SETTING_NOT_FOUND') return '找不到該項目，請重新選擇。';
    if (message.includes('SQLITE_CONSTRAINT')) return '名稱已存在，請換一個名稱：';
    return '設定儲存失敗，請重新輸入：';
  }

  async handleQuery(chatId: number, userId: number, username: string): Promise<void> {
    let session = await cacheManager.getUserSession(userId);
    if (!session) {
      await this.handleStart(chatId, userId, username);
      session = await cacheManager.getUserSession(userId);
      if (!session) return;
    }

    session.step = 'select_query_ledger';
    await cacheManager.setUserSession(userId, session);

    const ledgers = await ledgerModule.getUserLedgers(userId);
    const buttons = this.ledgerButtons(ledgers);

    this.sendKeyboard(chatId, '請選擇要查詢的帳本：', buttons);
  }

  async handleRenameLedgerCommand(
    chatId: number,
    userId: number,
    username: string
  ): Promise<void> {
    await userModule.getOrCreateUser(userId, username);
    await ledgerModule.createDefaultLedgers(userId);

    const session: UserSession = {
      userId,
      step: 'select_rename_ledger',
      selectedLedgerAction: 'rename',
    };
    await cacheManager.setUserSession(userId, session);

    const ledgers = await ledgerModule.getUserLedgers(userId);
    const buttons = this.ledgerButtons(ledgers);

    this.sendKeyboard(chatId, '請選擇要改名的帳本：', buttons);
  }

  async handleRenameLedgerSelection(
    chatId: number,
    userId: number,
    ledgerName: string
  ): Promise<void> {
    const session = await cacheManager.getUserSession(userId);
    if (!session) return;

    const ledgers = await ledgerModule.getUserLedgers(userId);
    const selectedLedger = ledgers.find((l) => l.name === ledgerName);
    if (!selectedLedger) {
      this.sendKeyboard(chatId, '找不到該帳本，請重新選擇：', [
        ...this.ledgerButtons(ledgers),
      ]);
      return;
    }

    session.selectedRenameLedger = selectedLedger.ledgerId;
    session.selectedLedgerAction = 'rename';
    session.step = 'input_ledger_name';
    await cacheManager.setUserSession(userId, session);

    this.sendKeyboard(chatId, `請輸入「${selectedLedger.name}」的新名稱：`, [NAVIGATION_BUTTONS]);
  }

  async handleArchiveLedgerSelection(
    chatId: number,
    userId: number,
    ledgerName: string
  ): Promise<void> {
    const session = await cacheManager.getUserSession(userId);
    if (!session) return;

    const ledgers = await ledgerModule.getUserLedgers(userId);
    const selectedLedger = ledgers.find((l) => l.name === ledgerName);
    if (!selectedLedger) {
      this.sendKeyboard(chatId, '找不到該帳本，請重新選擇：', [
        ...this.ledgerButtons(ledgers),
      ]);
      return;
    }

    try {
      await ledgerModule.archiveLedger(userId, selectedLedger.ledgerId);
      const activeLedgers = await ledgerModule.getUserLedgers(userId);
      session.step = 'select_archive_ledger';
      session.selectedLedgerAction = 'archive';
      await cacheManager.setUserSession(userId, session);
      this.sendKeyboard(
        chatId,
        `已封存「${selectedLedger.name}」。\n\n請選擇要封存的帳本：`,
        this.ledgerButtons(activeLedgers)
      );
    } catch (err) {
      const message =
        err instanceof Error && err.message === 'LEDGER_ARCHIVE_LAST_ACTIVE'
          ? '至少需要保留一個未封存帳本。'
          : '封存帳本失敗，請重新選擇。';
      this.sendKeyboard(chatId, message, this.ledgerButtons(ledgers));
    }
  }

  async handleUnarchiveLedgerSelection(
    chatId: number,
    userId: number,
    ledgerName: string
  ): Promise<void> {
    const session = await cacheManager.getUserSession(userId);
    if (!session) return;

    const ledgers = await ledgerModule.getArchivedLedgers(userId);
    const selectedLedger = ledgers.find((l) => l.name === ledgerName);
    if (!selectedLedger) {
      this.sendKeyboard(chatId, '找不到該帳本，請重新選擇：', this.ledgerButtons(ledgers));
      return;
    }

    try {
      await ledgerModule.unarchiveLedger(userId, selectedLedger.ledgerId);
      const archivedLedgers = await ledgerModule.getArchivedLedgers(userId);
      session.step = archivedLedgers.length ? 'select_unarchive_ledger' : 'ledger_settings';
      await cacheManager.setUserSession(userId, session);
      this.sendKeyboard(
        chatId,
        `已取消封存「${selectedLedger.name}」。\n\n${
          archivedLedgers.length ? '請選擇要取消封存的帳本：' : '請選擇帳本設定：'
        }`,
        archivedLedgers.length ? this.ledgerButtons(archivedLedgers) : LEDGER_SETTINGS_MENU
      );
    } catch (err) {
      const message =
        err instanceof Error && err.message === 'LEDGER_NAME_DUPLICATE'
          ? '已有同名未封存帳本，請先修改其中一個帳本名稱。'
          : '取消封存失敗，請重新選擇。';
      this.sendKeyboard(chatId, message, this.ledgerButtons(ledgers));
    }
  }

  async handleLedgerNameInput(
    chatId: number,
    userId: number,
    newName: string
  ): Promise<void> {
    const session = await cacheManager.getUserSession(userId);
    if (!session) return;

    try {
      const ledger =
        session.selectedLedgerAction === 'add'
          ? await ledgerModule.createLedger(userId, newName)
          : await ledgerModule.renameLedger(userId, session.selectedRenameLedger!, newName);

      session.step = session.selectedLedgerAction === 'add' ? 'ledger_settings' : 'select_rename_ledger';
      session.selectedRenameLedger = undefined;
      await cacheManager.setUserSession(userId, session);
      if (session.selectedLedgerAction === 'add') {
        session.selectedLedgerAction = undefined;
        await cacheManager.setUserSession(userId, session);
        this.sendKeyboard(
          chatId,
          `已新增帳本「${ledger.name}」。\n\n請選擇帳本設定：`,
          LEDGER_SETTINGS_MENU
        );
        return;
      }

      const ledgers = await ledgerModule.getUserLedgers(userId);
      session.selectedLedgerAction = 'rename';
      await cacheManager.setUserSession(userId, session);
      this.sendKeyboard(
        chatId,
        `帳本名稱已更新為「${ledger.name}」。\n\n請選擇要改名的帳本：`,
        this.ledgerButtons(ledgers)
      );
    } catch (err) {
      const error = err instanceof Error ? err.message : '';
      const message =
        error === 'LEDGER_NAME_EMPTY'
          ? '帳本名稱不可空白，請重新輸入：'
          : error === 'LEDGER_NAME_TOO_LONG'
            ? '帳本名稱最多 30 個字，請重新輸入：'
            : error === 'LEDGER_NAME_DUPLICATE'
              ? '你已經有同名帳本，請換一個名稱：'
              : '無法更新帳本名稱，請重新選擇帳本。';

      if (error === 'LEDGER_NOT_FOUND') {
        this.resetSession(session);
        await cacheManager.setUserSession(userId, session);
        this.sendKeyboard(chatId, message, MAIN_MENU);
        return;
      }

      this.sendKeyboard(chatId, message, [NAVIGATION_BUTTONS]);
    }
  }

  async handleQueryLedgerSelection(
    chatId: number,
    userId: number,
    ledgerName: string
  ): Promise<void> {
    const session = await cacheManager.getUserSession(userId);
    if (!session) return;

    const ledgers = await ledgerModule.getUserLedgers(userId);
    const selectedLedger = ledgers.find((l) => l.name === ledgerName);
    if (!selectedLedger) {
      this.sendKeyboard(chatId, '找不到該帳本，請重新選擇：', [
        ...this.ledgerButtons(ledgers),
      ]);
      return;
    }

    session.selectedQueryLedger = selectedLedger.ledgerId;
    session.step = 'select_query_range';
    await cacheManager.setUserSession(userId, session);

    this.sendKeyboard(chatId, '請選擇查詢範圍：', QUERY_RANGE_MENU);
  }

  async handleQueryRangeSelection(
    chatId: number,
    userId: number,
    rangeText: string
  ): Promise<void> {
    const session = await cacheManager.getUserSession(userId);
    if (!session?.selectedQueryLedger) return;

    const range = this.getQueryDateRange(rangeText);
    if (rangeText === '自訂月份') {
      session.step = 'input_query_month';
      await cacheManager.setUserSession(userId, session);
      this.sendKeyboard(chatId, '請輸入月份，例如：2026-06', [NAVIGATION_BUTTONS]);
      return;
    }
    if (rangeText === '自訂區間') {
      session.step = 'input_query_date_range';
      await cacheManager.setUserSession(userId, session);
      this.sendKeyboard(chatId, '請輸入日期區間，例如：2026-06-01~2026-06-15', [NAVIGATION_BUTTONS]);
      return;
    }
    if (!range) {
      this.sendKeyboard(chatId, '請選擇查詢範圍：', QUERY_RANGE_MENU);
      return;
    }

    return this.showQueryResult(chatId, userId, session, range);
  }

  async handleQueryMonthInput(chatId: number, userId: number, monthText: string): Promise<void> {
    const session = await cacheManager.getUserSession(userId);
    if (!session?.selectedQueryLedger) return;

    const range = this.parseCustomMonth(monthText);
    if (!range) {
      this.sendKeyboard(chatId, '月份格式錯誤，請輸入例如：2026-06', [NAVIGATION_BUTTONS]);
      return;
    }

    return this.showQueryResult(chatId, userId, session, range);
  }

  async handleQueryDateRangeInput(chatId: number, userId: number, rangeText: string): Promise<void> {
    const session = await cacheManager.getUserSession(userId);
    if (!session?.selectedQueryLedger) return;

    const range = this.parseCustomDateRange(rangeText);
    if (!range) {
      this.sendKeyboard(chatId, '日期區間格式錯誤，請輸入例如：2026-06-01~2026-06-15', [NAVIGATION_BUTTONS]);
      return;
    }

    return this.showQueryResult(chatId, userId, session, range);
  }

  private async showQueryResult(
    chatId: number,
    userId: number,
    session: UserSession,
    range: {
      label: string;
      displayStart: string;
      displayEnd: string;
      startDate: string;
      endDate: string;
    }
  ): Promise<void> {
    const selectedLedger = await ledgerModule.getLedgerById(session.selectedQueryLedger!, userId);
    if (!selectedLedger) {
      this.resetSession(session);
      await cacheManager.setUserSession(userId, session);
      this.sendKeyboard(chatId, '找不到該帳本，已回到主畫面。', MAIN_MENU);
      return;
    }

    const stats = await transactionModule.getLedgerStatsByDateRange(
      selectedLedger.ledgerId,
      range.startDate,
      range.endDate
    );
    const recent = await transactionModule.getTransactionsByLedgerAndDateRange(
      selectedLedger.ledgerId,
      range.startDate,
      range.endDate,
      5
    );
    const categorySummary = await transactionModule.getCategorySummaryByDateRange(
      selectedLedger.ledgerId,
      range.startDate,
      range.endDate
    );

    const income = stats.totalIncome || 0;
    const expense = stats.totalExpense || 0;
    const balance = income - expense;

    let message =
      `📊 ${selectedLedger.name}｜${range.label}統計\n\n` +
      `期間：${range.displayStart} ~ ${range.displayEnd}\n\n` +
      `總進帳：${income}\n` +
      `總支出：${expense}\n` +
      `結餘：${balance}\n` +
      `筆數：${stats.transactionCount || 0}`;

    if (categorySummary.length > 0) {
      const incomeLines = categorySummary
        .filter((item) => item.type === 'income')
        .map((item) => `${item.category}：${item.total}`)
        .join('\n');
      const expenseLines = categorySummary
        .filter((item) => item.type === 'expense')
        .map((item) => `${item.category}：${item.total}`)
        .join('\n');

      if (incomeLines) message += `\n\n進帳分類：\n${incomeLines}`;
      if (expenseLines) message += `\n\n支出分類：\n${expenseLines}`;
    }

    if (recent.length > 0) {
      const lines = recent
        .map(
          (t) =>
            `${t.type === 'income' ? '＋' : '－'}${t.amount} ${t.category}/${t.subcategory}`
        )
        .join('\n');
      message += `\n\n最近紀錄：\n${lines}`;
    } else {
      message += '\n\n（尚無紀錄）';
    }

    // Reset to main menu state.
    session.step = 'select_type';
    session.selectedQueryLedger = undefined;
    await cacheManager.setUserSession(userId, session);

    this.sendKeyboard(chatId, message, MAIN_MENU);
  }

  async handleTransactionManagement(
    chatId: number,
    userId: number,
    username: string
  ): Promise<void> {
    await userModule.getOrCreateUser(userId, username);
    await ledgerModule.createDefaultLedgers(userId);

    const session: UserSession = { userId, step: 'select_manage_transaction_ledger' };
    await cacheManager.setUserSession(userId, session);

    const ledgers = await ledgerModule.getUserLedgers(userId);
    this.sendKeyboard(chatId, '請選擇要管理交易的帳本：', this.ledgerButtons(ledgers));
  }

  async handleManageTransactionLedgerSelection(
    chatId: number,
    userId: number,
    ledgerName: string
  ): Promise<void> {
    const session = await cacheManager.getUserSession(userId);
    if (!session) return;

    const ledgers = await ledgerModule.getUserLedgers(userId);
    const selectedLedger = ledgers.find((ledger) => ledger.name === ledgerName);
    if (!selectedLedger) {
      this.sendKeyboard(chatId, '找不到該帳本，請重新選擇：', this.ledgerButtons(ledgers));
      return;
    }

    const transactions = await transactionModule.getTransactionsByLedger(selectedLedger.ledgerId, 10);
    if (!transactions.length) {
      this.sendKeyboard(chatId, '這個帳本目前沒有交易紀錄。', MAIN_MENU);
      this.resetSession(session);
      await cacheManager.setUserSession(userId, session);
      return;
    }

    session.selectedLedger = selectedLedger.ledgerId;
    session.step = 'select_manage_transaction';
    await cacheManager.setUserSession(userId, session);

    this.sendKeyboard(
      chatId,
      '請選擇要管理的交易：',
      this.itemButtons(transactions.map((transaction) => this.transactionButtonLabel(transaction)))
    );
  }

  async handleManageTransactionSelection(
    chatId: number,
    userId: number,
    transactionText: string
  ): Promise<void> {
    const session = await cacheManager.getUserSession(userId);
    if (!session?.selectedLedger) return;

    const transactionId = this.parseTransactionId(transactionText);
    if (!transactionId) {
      const transactions = await transactionModule.getTransactionsByLedger(session.selectedLedger, 10);
      this.sendKeyboard(
        chatId,
        '請選擇要管理的交易：',
        this.itemButtons(transactions.map((transaction) => this.transactionButtonLabel(transaction)))
      );
      return;
    }

    const transaction = await transactionModule.getTransactionByIdForLedger(
      transactionId,
      session.selectedLedger
    );
    if (!transaction) {
      this.sendKeyboard(chatId, '找不到該交易，請重新選擇。', [NAVIGATION_BUTTONS]);
      return;
    }

    session.selectedTransaction = transaction.transactionId;
    session.step = 'select_transaction_action';
    await cacheManager.setUserSession(userId, session);

    const message =
      `交易 #${transaction.transactionId}\n` +
      `類型：${transaction.type === 'income' ? '進帳' : '支出'}\n` +
      `金額：${transaction.amount}\n` +
      `類別：${transaction.category}/${transaction.subcategory}\n` +
      `付款方式：${transaction.paymentMethod}\n` +
      `備註：${transaction.description || '無'}\n\n` +
      '請選擇操作：';
    this.sendKeyboard(chatId, message, TRANSACTION_ACTION_MENU);
  }

  async handleTransactionActionSelection(
    chatId: number,
    userId: number,
    actionText: string
  ): Promise<void> {
    const session = await cacheManager.getUserSession(userId);
    if (!session?.selectedLedger || !session.selectedTransaction) return;

    if (actionText === '修改金額') {
      session.selectedTransactionAction = 'edit_amount';
      session.step = 'input_transaction_amount';
      await cacheManager.setUserSession(userId, session);
      this.sendKeyboard(chatId, '請輸入新的金額：', [NAVIGATION_BUTTONS]);
      return;
    }

    if (actionText === '修改備註') {
      session.selectedTransactionAction = 'edit_note';
      session.step = 'input_transaction_note';
      await cacheManager.setUserSession(userId, session);
      this.sendKeyboard(chatId, '請輸入新的備註，或按「略過」清空備註：', [['略過'], NAVIGATION_BUTTONS]);
      return;
    }

    if (actionText === '刪除交易') {
      await transactionModule.deleteTransaction(session.selectedTransaction, session.selectedLedger);
      this.resetSession(session);
      await cacheManager.setUserSession(userId, session);
      this.sendKeyboard(chatId, '已刪除交易。', MAIN_MENU);
      return;
    }

    this.sendKeyboard(chatId, '請選擇操作：', TRANSACTION_ACTION_MENU);
  }

  async handleTransactionAmountInput(
    chatId: number,
    userId: number,
    amountText: string
  ): Promise<void> {
    const session = await cacheManager.getUserSession(userId);
    if (!session?.selectedLedger || !session.selectedTransaction) return;

    const amount = parseFloat(amountText);
    if (isNaN(amount) || amount <= 0) {
      this.sendKeyboard(chatId, '無效的金額，請重新輸入：', [NAVIGATION_BUTTONS]);
      return;
    }

    const transaction = await transactionModule.updateTransactionAmount(
      session.selectedTransaction,
      session.selectedLedger,
      amount
    );
    this.resetSession(session);
    await cacheManager.setUserSession(userId, session);
    this.sendKeyboard(chatId, `已更新交易 #${transaction.transactionId} 金額為 ${transaction.amount}。`, MAIN_MENU);
  }

  async handleTransactionNoteInput(chatId: number, userId: number, note: string): Promise<void> {
    const session = await cacheManager.getUserSession(userId);
    if (!session?.selectedLedger || !session.selectedTransaction) return;

    const description = note === '略過' ? '' : note.trim();
    const transaction = await transactionModule.updateTransactionDescription(
      session.selectedTransaction,
      session.selectedLedger,
      description
    );
    this.resetSession(session);
    await cacheManager.setUserSession(userId, session);
    this.sendKeyboard(
      chatId,
      `已更新交易 #${transaction.transactionId} 備註為「${description || '無'}」。`,
      MAIN_MENU
    );
  }

  async handleTypeSelection(
    chatId: number,
    userId: number,
    type: string
  ): Promise<void> {
    const session = await cacheManager.getUserSession(userId);
    if (!session) return;

    session.selectedType = type === '支出' ? 'expense' : 'income';
    session.step = 'select_ledger';
    await cacheManager.setUserSession(userId, session);

    const ledgers = await ledgerModule.getUserLedgers(userId);
    const buttons = this.ledgerButtons(ledgers);

    this.sendKeyboard(chatId, '請選擇帳本：', buttons);
  }

  async handleLedgerSelection(
    chatId: number,
    userId: number,
    ledgerName: string
  ): Promise<void> {
    const session = await cacheManager.getUserSession(userId);
    if (!session) return;

    const ledgers = await ledgerModule.getUserLedgers(userId);
    const selectedLedger = ledgers.find((l) => l.name === ledgerName);
    if (!selectedLedger) {
      this.sendKeyboard(chatId, '找不到該帳本，請重新選擇：', [
        ...this.ledgerButtons(ledgers),
      ]);
      return;
    }

    session.selectedLedger = selectedLedger.ledgerId;
    session.step = 'select_category';
    await cacheManager.setUserSession(userId, session);

    const categories = await settingsModule.getCategories(userId, session.selectedType!);
    const buttons = this.itemButtons(categories.map((category) => category.name));

    this.sendKeyboard(chatId, '請選擇類別：', buttons);
  }

  async handleCategorySelection(
    chatId: number,
    userId: number,
    category: string
  ): Promise<void> {
    const session = await cacheManager.getUserSession(userId);
    if (!session) return;

    const categories = await settingsModule.getCategories(userId, session.selectedType!);
    const categoryData = categories.find((item) => item.name === category);
    if (!categoryData) {
      const buttons = this.itemButtons(categories.map((item) => item.name));
      this.sendKeyboard(chatId, '無效的類別，請重新選擇：', buttons);
      return;
    }

    session.selectedCategory = category;
    session.step = 'select_subcategory';
    await cacheManager.setUserSession(userId, session);

    const buttons = this.itemButtons(categoryData.subcategories);

    this.sendKeyboard(chatId, '請選擇子類別：', buttons);
  }

  async handleSubcategorySelection(
    chatId: number,
    userId: number,
    subcategory: string
  ): Promise<void> {
    const session = await cacheManager.getUserSession(userId);
    if (!session) return;

    // Validate the subcategory belongs to the chosen category.
    const subcategories = session.selectedCategory
      ? await settingsModule.getSubcategories(userId, session.selectedType!, session.selectedCategory)
      : [];
    if (!subcategories.includes(subcategory)) {
      const buttons = this.itemButtons(subcategories);
      this.sendKeyboard(chatId, '無效的子類別，請重新選擇：', buttons);
      return;
    }

    session.selectedSubcategory = subcategory;
    session.step = 'select_payment';
    await cacheManager.setUserSession(userId, session);

    const paymentMethods = await settingsModule.getPaymentMethods(userId);
    const buttons = this.itemButtons(paymentMethods);

    this.sendKeyboard(chatId, '請選擇支付方式：', buttons);
  }

  async handlePaymentMethodSelection(
    chatId: number,
    userId: number,
    paymentMethod: string
  ): Promise<void> {
    const session = await cacheManager.getUserSession(userId);
    if (!session) return;

    const paymentMethods = await settingsModule.getPaymentMethods(userId);
    if (!paymentMethods.includes(paymentMethod)) {
      const buttons = this.itemButtons(paymentMethods);
      this.sendKeyboard(chatId, '無效的支付方式，請重新選擇：', buttons);
      return;
    }

    session.selectedPayment = paymentMethod;
    session.step = 'input_amount';
    await cacheManager.setUserSession(userId, session);

    this.sendKeyboard(chatId, '請輸入金額：', [NAVIGATION_BUTTONS]);
  }

  async handleAmountInput(
    chatId: number,
    userId: number,
    amountText: string
  ): Promise<void> {
    const session = await cacheManager.getUserSession(userId);
    if (!session) return;

    const amount = parseFloat(amountText);
    if (isNaN(amount) || amount <= 0) {
      this.sendKeyboard(chatId, '無效的金額，請重新輸入：', [NAVIGATION_BUTTONS]);
      return;
    }

    session.selectedAmount = amount;
    session.step = 'input_note';
    await cacheManager.setUserSession(userId, session);

    this.sendKeyboard(chatId, '請輸入備註，或按「略過」不填備註：', [['略過'], NAVIGATION_BUTTONS]);
  }

  async handleNoteInput(
    chatId: number,
    userId: number,
    note: string
  ): Promise<void> {
    const session = await cacheManager.getUserSession(userId);
    if (!session) return;

    if (note === '略過') {
      return this.createTransactionFromSession(chatId, userId, session, '');
    }

    return this.createTransactionFromSession(chatId, userId, session, note.trim());
  }

  private async createTransactionFromSession(
    chatId: number,
    userId: number,
    session: UserSession,
    description: string
  ): Promise<void> {
    const transaction = await transactionModule.createTransaction(
      session.selectedLedger!,
      session.selectedType!,
      session.selectedAmount!,
      session.selectedCategory!,
      session.selectedSubcategory!,
      session.selectedPayment!,
      description
    );

    // Try to append to Google Sheets (non-blocking)
    googleSheetsIntegration.appendTransaction(transaction).catch((err) => {
      console.error('Failed to append to Google Sheets:', err);
    });

    const paymentName = session.selectedPayment;
    const ledger = await ledgerModule.getLedgerById(session.selectedLedger!, userId);
    const ledgerName = ledger?.name || '未知帳本';
    const message = `✓ 記帳成功！\n\n類型：${
      session.selectedType === 'income' ? '進帳' : '支出'
    }\n帳本：${ledgerName}\n類別：${
      session.selectedCategory
    }\n子類別：${session.selectedSubcategory}\n金額：${
      session.selectedAmount
    }\n支付方式：${paymentName}\n備註：${description || '無'}`;

    this.sendKeyboard(chatId, message, MAIN_MENU);

    // Reset session
    this.resetSession(session);
    await cacheManager.setUserSession(userId, session);
  }

  private resetSession(session: UserSession): void {
    session.step = 'select_type';
    session.selectedLedger = undefined;
    session.selectedQueryLedger = undefined;
    session.selectedRenameLedger = undefined;
    session.selectedLedgerAction = undefined;
    session.selectedType = undefined;
    session.selectedCategory = undefined;
    session.selectedSubcategory = undefined;
    session.selectedPayment = undefined;
    session.selectedAmount = undefined;
    session.selectedTransaction = undefined;
    session.selectedTransactionAction = undefined;
    session.selectedSettingTarget = undefined;
    session.selectedSettingAction = undefined;
    session.selectedSettingCategory = undefined;
    session.selectedSettingItem = undefined;
  }

  async handleCancel(chatId: number, userId: number): Promise<void> {
    const session = await cacheManager.getUserSession(userId);
    if (session) {
      this.resetSession(session);
      await cacheManager.setUserSession(userId, session);
    }

    this.sendKeyboard(chatId, '已回到主畫面，請選擇：', MAIN_MENU);
  }

  async handleBack(chatId: number, userId: number): Promise<void> {
    const session = await cacheManager.getUserSession(userId);
    if (!session) {
      return this.showMainMenu(chatId, userId, '請選擇您要進行的操作：');
    }

    switch (session.step) {
      case 'settings':
      case 'select_query_ledger':
      case 'select_type':
        return this.showMainMenu(chatId, userId, '請選擇您要進行的操作：');

      case 'select_query_range': {
        session.step = 'select_query_ledger';
        session.selectedQueryLedger = undefined;
        await cacheManager.setUserSession(userId, session);
        const ledgers = await ledgerModule.getUserLedgers(userId);
        return this.sendKeyboard(
          chatId,
          '請選擇要查詢的帳本：',
          this.ledgerButtons(ledgers)
        );
      }

      case 'input_query_month':
      case 'input_query_date_range':
        session.step = 'select_query_range';
        await cacheManager.setUserSession(userId, session);
        return this.sendKeyboard(chatId, '請選擇查詢範圍：', QUERY_RANGE_MENU);

      case 'settings_select_target':
        return this.handleSettings(chatId, userId);

      case 'settings_select_category':
      case 'settings_select_action':
        session.step = 'settings';
        session.selectedSettingTarget = undefined;
        session.selectedSettingAction = undefined;
        session.selectedSettingCategory = undefined;
        session.selectedSettingItem = undefined;
        await cacheManager.setUserSession(userId, session);
        return this.sendKeyboard(chatId, '請選擇設定項目：', SETTINGS_MENU);

      case 'settings_select_item':
      case 'settings_input_name':
        session.step = this.isSubcategoryTarget(session)
          ? 'settings_select_category'
          : 'settings_select_action';
        session.selectedSettingAction = undefined;
        session.selectedSettingItem = undefined;
        await cacheManager.setUserSession(userId, session);
        if (session.step === 'settings_select_category') {
          const categories = await settingsModule.getCategories(userId, this.getSettingType(session));
          return this.sendKeyboard(
            chatId,
            '請選擇要管理子類別的類別：',
            this.itemButtons(categories.map((category) => category.name))
          );
        }
        return this.sendKeyboard(chatId, '請選擇操作：', SETTING_ACTION_MENU);

      case 'ledger_settings':
        return this.handleSettings(chatId, userId);

      case 'select_rename_ledger':
      case 'select_archive_ledger':
      case 'select_unarchive_ledger':
        return this.handleLedgerSettings(chatId, userId);

      case 'select_manage_transaction_ledger':
        return this.showMainMenu(chatId, userId, '請選擇您要進行的操作：');

      case 'select_manage_transaction': {
        session.step = 'select_manage_transaction_ledger';
        session.selectedLedger = undefined;
        await cacheManager.setUserSession(userId, session);
        const ledgers = await ledgerModule.getUserLedgers(userId);
        return this.sendKeyboard(
          chatId,
          '請選擇要管理交易的帳本：',
          this.ledgerButtons(ledgers)
        );
      }

      case 'select_transaction_action':
      case 'input_transaction_amount':
      case 'input_transaction_note': {
        session.step = 'select_manage_transaction';
        session.selectedTransaction = undefined;
        session.selectedTransactionAction = undefined;
        await cacheManager.setUserSession(userId, session);
        const transactions = await transactionModule.getTransactionsByLedger(session.selectedLedger!, 10);
        return this.sendKeyboard(
          chatId,
          '請選擇要管理的交易：',
          this.itemButtons(transactions.map((transaction) => this.transactionButtonLabel(transaction)))
        );
      }

      case 'input_ledger_name': {
        if (session.selectedLedgerAction === 'add') {
          return this.handleLedgerSettings(chatId, userId);
        }

        session.step = 'select_rename_ledger';
        session.selectedRenameLedger = undefined;
        await cacheManager.setUserSession(userId, session);
        const ledgers = await ledgerModule.getUserLedgers(userId);
        return this.sendKeyboard(
          chatId,
          '請選擇要改名的帳本：',
          this.ledgerButtons(ledgers)
        );
      }

      case 'select_ledger':
        session.step = 'select_type';
        session.selectedType = undefined;
        await cacheManager.setUserSession(userId, session);
        return this.sendKeyboard(
          chatId,
          '請選擇進出類型：',
          this.withNavigation([['支出', '進帳']])
        );

      case 'select_category': {
        session.step = 'select_ledger';
        session.selectedLedger = undefined;
        await cacheManager.setUserSession(userId, session);
        const ledgers = await ledgerModule.getUserLedgers(userId);
        return this.sendKeyboard(
          chatId,
          '請選擇帳本：',
          this.ledgerButtons(ledgers)
        );
      }

      case 'select_subcategory': {
        session.step = 'select_category';
        session.selectedCategory = undefined;
        await cacheManager.setUserSession(userId, session);
        const categories = await settingsModule.getCategories(userId, session.selectedType!);
        return this.sendKeyboard(
          chatId,
          '請選擇類別：',
          this.itemButtons(categories.map((category) => category.name))
        );
      }

      case 'select_payment': {
        session.step = 'select_subcategory';
        session.selectedSubcategory = undefined;
        await cacheManager.setUserSession(userId, session);
        const subcategories = session.selectedCategory
          ? await settingsModule.getSubcategories(userId, session.selectedType!, session.selectedCategory)
          : [];
        return this.sendKeyboard(
          chatId,
          '請選擇子類別：',
          this.itemButtons(subcategories)
        );
      }

      case 'input_amount':
        session.step = 'select_payment';
        session.selectedPayment = undefined;
        await cacheManager.setUserSession(userId, session);
        return this.sendKeyboard(
          chatId,
          '請選擇支付方式：',
          this.itemButtons(await settingsModule.getPaymentMethods(userId))
        );

      case 'input_note':
        session.step = 'input_amount';
        session.selectedAmount = undefined;
        await cacheManager.setUserSession(userId, session);
        return this.sendKeyboard(chatId, '請輸入金額：', [NAVIGATION_BUTTONS]);

      default:
        return this.showMainMenu(chatId, userId, '請選擇您要進行的操作：');
    }
  }

  registerHandlers(): void {
    this.bot.on('update', async (update) => {
      try {
        const message = update.message;
        if (!message) return;

        const chatId = message.chat.id;
        const userId = message.from.id;
        const username = message.from.username || `user_${userId}`;
        const text = message.text || '';

        if (text === '/start') {
          return this.handleStart(chatId, userId, username);
        }

        if (text === '/rename_ledger' || text === '/rename') {
          return this.handleRenameLedgerCommand(chatId, userId, username);
        }

        if (text === '記帳') {
          return this.handleRecording(chatId, userId, username);
        }

        if (text === '查詢') {
          return this.handleQuery(chatId, userId, username);
        }

        if (text === '交易管理') {
          return this.handleTransactionManagement(chatId, userId, username);
        }

        if (text === '設定') {
          return this.handleSettings(chatId, userId);
        }

        if (text === '帳本設定') {
          return this.handleLedgerSettings(chatId, userId);
        }

        if (text === '新增帳本') {
          return this.handleCreateLedgerCommand(chatId, userId, username);
        }

        if (text === '修改帳本名稱') {
          return this.handleRenameLedgerCommand(chatId, userId, username);
        }

        if (text === '封存帳本') {
          return this.handleArchiveLedgerCommand(chatId, userId, username);
        }

        if (text === '查看封存帳本') {
          return this.handleArchivedLedgers(chatId, userId);
        }

        if (text === '取消封存帳本') {
          return this.handleUnarchiveLedgerCommand(chatId, userId, username);
        }

        if (text === '備份目前設定') {
          return this.handleBackupSettings(chatId, userId);
        }

        if (text === '恢復備份設定') {
          return this.handleRestoreBackupSettings(chatId, userId);
        }

        if (text === '恢復初始設定') {
          return this.handleRestoreDefaultSettings(chatId, userId);
        }

        if (
          text === '付款方式設定' ||
          text === '支出類別設定' ||
          text === '收入類別設定' ||
          text === '支出子類別設定' ||
          text === '收入子類別設定'
        ) {
          return this.handleSettingsTargetSelection(chatId, userId, text);
        }

        if (text === '說明') {
          return this.handleHelp(chatId);
        }

        if (text === '支出' || text === '進帳') {
          return this.handleTypeSelection(chatId, userId, text);
        }

        if (text === '回主畫面' || text === '取消' || text === '退出') {
          return this.handleCancel(chatId, userId);
        }

        const session = await cacheManager.getUserSession(userId);
        if (!session) {
          return this.handleStart(chatId, userId, username);
        }

        if (text === '上一步') {
          return this.handleBack(chatId, userId);
        }

        switch (session.step) {
          case 'ledger_settings':
            if (text === '新增帳本') {
              return this.handleCreateLedgerCommand(chatId, userId, username);
            }
            if (text === '修改帳本名稱') {
              return this.handleRenameLedgerCommand(chatId, userId, username);
            }
            if (text === '封存帳本') {
              return this.handleArchiveLedgerCommand(chatId, userId, username);
            }
            if (text === '查看封存帳本') {
              return this.handleArchivedLedgers(chatId, userId);
            }
            if (text === '取消封存帳本') {
              return this.handleUnarchiveLedgerCommand(chatId, userId, username);
            }
            return this.handleLedgerSettings(chatId, userId);
          case 'settings':
            return this.handleSettingsTargetSelection(chatId, userId, text);
          case 'settings_select_category':
            return this.handleSettingsCategorySelection(chatId, userId, text);
          case 'settings_select_action':
            return this.handleSettingsActionSelection(chatId, userId, text);
          case 'settings_select_item':
            return this.handleSettingsItemSelection(chatId, userId, text);
          case 'settings_input_name':
            return this.handleSettingsNameInput(chatId, userId, text);
          case 'select_query_ledger':
            return this.handleQueryLedgerSelection(chatId, userId, text);
          case 'select_query_range':
            return this.handleQueryRangeSelection(chatId, userId, text);
          case 'input_query_month':
            return this.handleQueryMonthInput(chatId, userId, text);
          case 'input_query_date_range':
            return this.handleQueryDateRangeInput(chatId, userId, text);
          case 'select_rename_ledger':
            return this.handleRenameLedgerSelection(chatId, userId, text);
          case 'select_archive_ledger':
            return this.handleArchiveLedgerSelection(chatId, userId, text);
          case 'select_unarchive_ledger':
            return this.handleUnarchiveLedgerSelection(chatId, userId, text);
          case 'input_ledger_name':
            return this.handleLedgerNameInput(chatId, userId, text);
          case 'select_manage_transaction_ledger':
            return this.handleManageTransactionLedgerSelection(chatId, userId, text);
          case 'select_manage_transaction':
            return this.handleManageTransactionSelection(chatId, userId, text);
          case 'select_transaction_action':
            return this.handleTransactionActionSelection(chatId, userId, text);
          case 'input_transaction_amount':
            return this.handleTransactionAmountInput(chatId, userId, text);
          case 'input_transaction_note':
            return this.handleTransactionNoteInput(chatId, userId, text);
          case 'select_ledger':
            return this.handleLedgerSelection(chatId, userId, text);
          case 'select_category':
            return this.handleCategorySelection(chatId, userId, text);
          case 'select_subcategory':
            return this.handleSubcategorySelection(chatId, userId, text);
          case 'select_payment':
            return this.handlePaymentMethodSelection(chatId, userId, text);
          case 'input_amount':
            return this.handleAmountInput(chatId, userId, text);
          case 'input_note':
            return this.handleNoteInput(chatId, userId, text);
          default:
            return this.handleStart(chatId, userId, username);
        }
      } catch (err) {
        console.error('Error handling update:', err);
      }
    });
  }

  async start(): Promise<void> {
    this.registerHandlers();
    await this.bot.start();
    console.log('Telegram Bot is polling...');
  }

  async stop(): Promise<void> {
    await this.bot.stop();
  }
}
