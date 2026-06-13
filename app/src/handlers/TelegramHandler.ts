import TelegramBot from 'telegram-bot-api';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, PAYMENT_METHODS } from '../constants';
import { UserSession } from '../types';
import { cacheManager } from '../db/cache';
import { userModule } from '../modules/user/user';
import { ledgerModule } from '../modules/ledger/ledger';
import { transactionModule } from '../modules/transaction/transaction';
import { googleSheetsIntegration } from '../integrations/GoogleSheets';

const MAIN_MENU: string[][] = [['記帳', '查詢'], ['設定', '說明']];
const SETTINGS_MENU: string[][] = [['修改帳本名稱'], ['取消']];

export class BotHandlers {
  private bot: TelegramBot;

  constructor(token: string) {
    this.bot = new TelegramBot({ token });
    this.bot.setMessageProvider(new TelegramBot.GetUpdateMessageProvider());
  }

  private sendKeyboard(chatId: number, text: string, buttons: string[][]): void {
    this.bot
      .sendMessage({
        chat_id: chatId,
        text,
        reply_markup: {
          keyboard: buttons,
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      })
      .catch((err) => console.error('Failed to send message:', err));
  }

  private getCategoriesForSession(session: UserSession) {
    return session.selectedType === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  }

  async handleStart(chatId: number, userId: number, username: string): Promise<void> {
    // Get or create user
    await userModule.getOrCreateUser(userId, username);

    // Create default ledgers if not exist
    await ledgerModule.createDefaultLedgers(userId);

    // Initialize user session
    const session: UserSession = { userId, step: 'select_type' };
    await cacheManager.setUserSession(userId, session);

    const message =
      '歡迎使用 Telegram 記帳系統！\n\n請選擇您要進行的操作：';

    this.sendKeyboard(chatId, message, MAIN_MENU);
  }

  async handleRecording(chatId: number, userId: number, username: string): Promise<void> {
    const session = await cacheManager.getUserSession(userId);
    if (!session) {
      return this.handleStart(chatId, userId, username);
    }

    const message = '請選擇進出類型：';
    this.sendKeyboard(chatId, message, [['支出', '進帳'], ['取消']]);
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
      '隨時可輸入「取消」回到主選單。';
    this.sendKeyboard(chatId, message, MAIN_MENU);
  }

  async handleSettings(chatId: number): Promise<void> {
    this.sendKeyboard(chatId, '請選擇設定項目：', SETTINGS_MENU);
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
    const buttons = ledgers.map((l) => [l.name]);
    buttons.push(['取消']);

    this.sendKeyboard(chatId, '請選擇要查詢的帳本：', buttons);
  }

  async handleRenameLedgerCommand(
    chatId: number,
    userId: number,
    username: string
  ): Promise<void> {
    await userModule.getOrCreateUser(userId, username);
    await ledgerModule.createDefaultLedgers(userId);

    const session: UserSession = { userId, step: 'select_rename_ledger' };
    await cacheManager.setUserSession(userId, session);

    const ledgers = await ledgerModule.getUserLedgers(userId);
    const buttons = ledgers.map((l) => [l.name]);
    buttons.push(['取消']);

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
        ...ledgers.map((l) => [l.name]),
        ['取消'],
      ]);
      return;
    }

    session.selectedRenameLedger = selectedLedger.ledgerId;
    session.step = 'input_ledger_name';
    await cacheManager.setUserSession(userId, session);

    this.sendKeyboard(chatId, `請輸入「${selectedLedger.name}」的新名稱：`, [['取消']]);
  }

  async handleLedgerNameInput(
    chatId: number,
    userId: number,
    newName: string
  ): Promise<void> {
    const session = await cacheManager.getUserSession(userId);
    if (!session?.selectedRenameLedger) return;

    try {
      const ledger = await ledgerModule.renameLedger(
        userId,
        session.selectedRenameLedger,
        newName
      );

      session.step = 'select_rename_ledger';
      session.selectedRenameLedger = undefined;
      await cacheManager.setUserSession(userId, session);
      const ledgers = await ledgerModule.getUserLedgers(userId);
      const buttons = ledgers.map((l) => [l.name]);
      buttons.push(['取消']);
      this.sendKeyboard(
        chatId,
        `帳本名稱已更新為「${ledger.name}」。\n\n請選擇要改名的帳本：`,
        buttons
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

      this.sendKeyboard(chatId, message, [['取消']]);
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
        ...ledgers.map((l) => [l.name]),
        ['取消'],
      ]);
      return;
    }

    const stats = await transactionModule.getLedgerStats(selectedLedger.ledgerId);
    const recent = await transactionModule.getTransactionsByLedger(selectedLedger.ledgerId, 5);

    const income = stats.totalIncome || 0;
    const expense = stats.totalExpense || 0;
    const balance = income - expense;

    let message =
      `📊 ${selectedLedger.name} 統計\n\n` +
      `總進帳：${income}\n` +
      `總支出：${expense}\n` +
      `結餘：${balance}\n` +
      `筆數：${stats.transactionCount || 0}`;

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
    await cacheManager.setUserSession(userId, session);

    this.sendKeyboard(chatId, message, MAIN_MENU);
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
    const buttons = ledgers.map((l) => [l.name]);
    buttons.push(['取消']);

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
        ...ledgers.map((l) => [l.name]),
        ['取消'],
      ]);
      return;
    }

    session.selectedLedger = selectedLedger.ledgerId;
    session.step = 'select_category';
    await cacheManager.setUserSession(userId, session);

    const categories = Object.keys(this.getCategoriesForSession(session));
    const buttons = categories.map((c) => [c]);
    buttons.push(['取消']);

    this.sendKeyboard(chatId, '請選擇類別：', buttons);
  }

  async handleCategorySelection(
    chatId: number,
    userId: number,
    category: string
  ): Promise<void> {
    const session = await cacheManager.getUserSession(userId);
    if (!session) return;

    const categories = this.getCategoriesForSession(session);
    const categoryData = categories[category as keyof typeof categories];
    if (!categoryData) {
      const buttons = Object.keys(categories).map((c) => [c]);
      buttons.push(['取消']);
      this.sendKeyboard(chatId, '無效的類別，請重新選擇：', buttons);
      return;
    }

    session.selectedCategory = category;
    session.step = 'select_subcategory';
    await cacheManager.setUserSession(userId, session);

    const buttons = categoryData.subcategories.map((s) => [s]);
    buttons.push(['取消']);

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
    const categories = this.getCategoriesForSession(session);
    const categoryData = session.selectedCategory
      ? categories[session.selectedCategory as keyof typeof categories]
      : undefined;
    if (!categoryData || !categoryData.subcategories.includes(subcategory)) {
      const buttons = (categoryData?.subcategories ?? []).map((s) => [s]);
      buttons.push(['取消']);
      this.sendKeyboard(chatId, '無效的子類別，請重新選擇：', buttons);
      return;
    }

    session.selectedSubcategory = subcategory;
    session.step = 'select_payment';
    await cacheManager.setUserSession(userId, session);

    const buttons = Object.values(PAYMENT_METHODS).map((name) => [name]);
    buttons.push(['取消']);

    this.sendKeyboard(chatId, '請選擇支付方式：', buttons);
  }

  async handlePaymentMethodSelection(
    chatId: number,
    userId: number,
    paymentMethod: string
  ): Promise<void> {
    const session = await cacheManager.getUserSession(userId);
    if (!session) return;

    const methodKey = Object.entries(PAYMENT_METHODS).find(
      ([_, name]) => name === paymentMethod
    )?.[0];
    if (!methodKey) {
      const buttons = Object.values(PAYMENT_METHODS).map((name) => [name]);
      buttons.push(['取消']);
      this.sendKeyboard(chatId, '無效的支付方式，請重新選擇：', buttons);
      return;
    }

    session.selectedPayment = methodKey as any;
    session.step = 'input_amount';
    await cacheManager.setUserSession(userId, session);

    this.sendKeyboard(chatId, '請輸入金額：', [['取消']]);
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
      this.sendKeyboard(chatId, '無效的金額，請重新輸入：', [['取消']]);
      return;
    }

    session.selectedAmount = amount;
    session.step = 'ask_note';
    await cacheManager.setUserSession(userId, session);

    this.sendKeyboard(chatId, '是否要寫備註？', [['寫備註', '不用備註'], ['取消']]);
  }

  async handleNoteDecision(
    chatId: number,
    userId: number,
    decision: string
  ): Promise<void> {
    const session = await cacheManager.getUserSession(userId);
    if (!session) return;

    if (decision === '不用備註') {
      return this.createTransactionFromSession(chatId, userId, session, '');
    }

    if (decision === '寫備註') {
      session.step = 'input_note';
      await cacheManager.setUserSession(userId, session);
      this.sendKeyboard(chatId, '請輸入備註：', [['取消']]);
      return;
    }

    this.sendKeyboard(chatId, '請選擇是否要寫備註：', [['寫備註', '不用備註'], ['取消']]);
  }

  async handleNoteInput(
    chatId: number,
    userId: number,
    note: string
  ): Promise<void> {
    const session = await cacheManager.getUserSession(userId);
    if (!session) return;

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

    const paymentName = PAYMENT_METHODS[session.selectedPayment as keyof typeof PAYMENT_METHODS];
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
    session.selectedRenameLedger = undefined;
    session.selectedType = undefined;
    session.selectedCategory = undefined;
    session.selectedSubcategory = undefined;
    session.selectedPayment = undefined;
    session.selectedAmount = undefined;
  }

  async handleCancel(chatId: number, userId: number): Promise<void> {
    const session = await cacheManager.getUserSession(userId);
    if (session) {
      this.resetSession(session);
      await cacheManager.setUserSession(userId, session);
    }

    this.sendKeyboard(chatId, '已取消操作，請選擇：', MAIN_MENU);
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

        if (text === '設定') {
          return this.handleSettings(chatId);
        }

        if (text === '修改帳本名稱') {
          return this.handleRenameLedgerCommand(chatId, userId, username);
        }

        if (text === '說明') {
          return this.handleHelp(chatId);
        }

        if (text === '支出' || text === '進帳') {
          return this.handleTypeSelection(chatId, userId, text);
        }

        if (text === '取消' || text === '退出') {
          return this.handleCancel(chatId, userId);
        }

        const session = await cacheManager.getUserSession(userId);
        if (!session) {
          return this.handleStart(chatId, userId, username);
        }

        switch (session.step) {
          case 'select_query_ledger':
            return this.handleQueryLedgerSelection(chatId, userId, text);
          case 'select_rename_ledger':
            return this.handleRenameLedgerSelection(chatId, userId, text);
          case 'input_ledger_name':
            return this.handleLedgerNameInput(chatId, userId, text);
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
          case 'ask_note':
            return this.handleNoteDecision(chatId, userId, text);
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
