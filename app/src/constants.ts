// Category definitions for Taiwan accounting system
export const CATEGORIES = {
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

export const PAYMENT_METHODS = {
  cash: '現金',
  line_pay: 'Line Pay',
  alipay: '支付寶',
  cathay_credit_card: '中華信託信用卡',
  okx_credit_card: 'OKX 信用卡',
};

export const LEDGER_NAMES = {
  1: '帳本一',
  2: '帳本二',
  3: '帳本三',
  4: '帳本四',
  5: '帳本五',
};
