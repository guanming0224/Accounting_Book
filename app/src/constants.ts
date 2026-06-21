// Category definitions for Taiwan accounting system
export interface CategoryDefinition {
  name: string;
  description: string;
  subcategories: string[];
}

export type CategoryMap = Record<string, CategoryDefinition>;

export const EXPENSE_CATEGORIES: CategoryMap = {
  食: {
    name: '食',
    description: '維持生命活動機能的能量提取',
    subcategories: ['早餐', '午餐', '晚餐', '消夜', '飲料', '餐飲', '食材'],
  },
  衣: {
    name: '衣',
    description: '身體的遮蔽、保護與社交禮儀',
    subcategories: ['上衣', '褲子', '襪子', '帽子', '外套', '鞋子', '護具', '飾品'],
  },
  住: {
    name: '住',
    description: '安全、隱私與休息的空間',
    subcategories: ['房租', '家具', '水費', '電費', '瓦斯'],
  },
  行: {
    name: '行',
    description: '人或物體的位移與運輸',
    subcategories: ['共車費', '大眾交通', '私車費'],
  },
  育: {
    name: '育',
    description: '擴充認知與技能的學習',
    subcategories: ['學費', '書籍費', '考試費'],
  },
  樂: {
    name: '樂',
    description: '緩解壓力的休閒與體驗',
    subcategories: ['旅遊', '健身'],
  },
};

export const INCOME_CATEGORIES: CategoryMap = {
  '薪資收入 (Earned)': {
    name: '薪資收入 (Earned)',
    description: '受僱或投入勞務取得的收入',
    subcategories: ['月薪', '年終獎金', '加班費', '兼職外快'],
  },
  '營利與業務收入 (Business)': {
    name: '營利與業務收入 (Business)',
    description: '經營事業或提供服務取得的收入',
    subcategories: ['開店做生意', '網拍', '自行創業', '接案抽成'],
  },
  '理財與投資收入 (Portfolio)': {
    name: '理財與投資收入 (Portfolio)',
    description: '金融商品或投資交易產生的收入',
    subcategories: ['股票股利', '基金配息', '買賣價差（資本利得）'],
  },
  '資產與衍生收入 (Passive)': {
    name: '資產與衍生收入 (Passive)',
    description: '資產授權、出租或權利金產生的收入',
    subcategories: ['房子出租的租金', '專利權益金', '著作權版稅'],
  },
};

export const CATEGORIES = EXPENSE_CATEGORIES;

export const PAYMENT_METHODS = {
  cash: '現金',
  line_pay: 'Line Pay',
  alipay: '支付寶',
  cathay_credit_card: '中華信託信用卡',
  okx_credit_card: 'OKX 信用卡',
};

export const LEDGER_NAMES = {
  1: '日常支出',
  2: '儲蓄帳本',
};
