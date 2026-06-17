declare module 'telegram-bot-api' {
  interface TelegramBotOptions {
    token: string;
  }

  interface Message {
    chat: { id: number };
    from: { id: number; username?: string };
    text?: string;
  }

  interface Update {
    update_id: number;
    message?: Message;
  }

  interface SendMessageOptions {
    chat_id: number;
    text: string;
    parse_mode?: string;
    reply_markup?: any;
  }

  interface GetUpdateMessageProviderOptions {
    limit?: number;
    timeout?: number;
    allowed_updates?: string[];
  }

  class GetUpdateMessageProvider {
    constructor(options?: GetUpdateMessageProviderOptions);
  }

  class WebhookMessageProvider {
    constructor(options?: any);
  }

  class TelegramBot {
    constructor(options: TelegramBotOptions);
    setMessageProvider(provider: GetUpdateMessageProvider | WebhookMessageProvider): void;
    on(event: 'update', handler: (update: Update) => void): void;
    on(event: string, handler: (...args: any[]) => void): void;
    sendMessage(options: SendMessageOptions): Promise<any>;
    getMe(): Promise<any>;
    start(): Promise<void>;
    stop(): Promise<void>;
    static GetUpdateMessageProvider: typeof GetUpdateMessageProvider;
    static WebhookMessageProvider: typeof WebhookMessageProvider;
  }

  export default TelegramBot;
}
