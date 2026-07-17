// 应用入口配置
export const APP_CONFIG = {
  appName: '账号管理器',
  version: '1.0.0',
  storagePrefix: 'acctmgr_',
  defaultExchangeRate: 7.25,
  reminderDays: 7,
};

// 订阅类型选项
export const SUBSCRIPTION_TYPES = {
  gpt: [
    { value: 'free', label: 'Free' },
    { value: 'plus', label: 'Plus' },
    { value: 'pro', label: 'Pro 5x' },
    { value: 'business', label: 'Business' },
  ],
  claude: [
    { value: 'free', label: 'Free' },
    { value: 'pro', label: 'Pro' },
    { value: 'max', label: 'Max 5x' },
  ],
  gemini: [
    { value: 'free', label: 'Free' },
    { value: 'pro', label: 'Pro' },
  ],
};

// 账号状态选项
export const STATUS_OPTIONS = [
  { value: 'active', label: '正常' },
  { value: 'banned', label: '封禁' },
];

// 付费订阅生命周期状态（与账号是否封禁相互独立）
export const SUBSCRIPTION_STATUS = {
  ACTIVE: 'active',
  CANCEL_AT_PERIOD_END: 'cancel_at_period_end',
  ENDED: 'ended',
};

// 退款状态选项（仅 Claude）
export const REFUND_STATUS_OPTIONS = [
  { value: 'none', label: '未申请' },
  { value: 'applied', label: '已申请' },
  { value: 'received', label: '已到账' },
  { value: 'rejected', label: '被拒绝' },
];

// 成员缴纳状态
export const PAYMENT_STATUS = [
  { value: false, label: '未缴' },
  { value: true, label: '已缴' },
];

// 成员状态
export const MEMBER_STATUS_OPTIONS = [
  { value: 'active', label: '活跃' },
  { value: 'exited', label: '已退出' },
];

// 卡片品牌
export const CARD_BRANDS = [
  { value: 'bybit', label: 'Bybit', color: '#F7A600' },
  { value: 'bitget', label: 'Bitget', color: '#00B897' },
  { value: 'roogoo', label: 'Roogoo', color: '#6366F1' },
  { value: 'ur', label: 'UR', color: '#3B82F6' },
  { value: 'savo', label: 'Savo', color: '#8B5CF6' },
  { value: 'krak', label: 'Krak', color: '#5B21B6' },
  { value: 'other', label: '其他', color: '#6B7280' },
];

// 充值方式
export const TOP_UP_METHODS = [
  { value: 'binance', label: '币安提币' },
  { value: 'okx', label: '欧易提币' },
  { value: 'bybit_transfer', label: 'Bybit转账' },
  { value: 'other', label: '其他' },
];

// 账单支付来源
export const BILLING_PAYMENT_SOURCES = [
  { value: 'card', label: '卡片余额' },
  { value: 'gift_card', label: '礼品卡' },
  { value: 'third_party', label: '他人代付' },
  { value: 'unknown', label: '未指定来源' },
];

// 账号类型配置
export const ACCOUNT_TYPES = [
  { value: 'gpt', label: 'GPT', icon: '🤖' },
  { value: 'claude', label: 'Claude', icon: '🧠' },
  { value: 'gemini', label: 'Gemini', icon: '✨' },
];

// 判断订阅是否为付费类型
export function isPaidSubscription(type) {
  return type && type !== 'free';
}

// 判断是否支持团队管理（仅 GPT Business）
export function hasTeamManagement(accountType, subscriptionType) {
  return accountType === 'gpt' && subscriptionType === 'business';
}

// 判断是否支持直接售出收入（仅 GPT Plus）
export function hasDirectSaleIncome(accountType, subscriptionType) {
  return accountType === 'gpt' && subscriptionType === 'plus';
}

// 判断是否使用开通时间自动计算月度续费
export function hasMonthlyRenewal(accountType) {
  return accountType === 'gpt' || accountType === 'claude' || accountType === 'gemini';
}

// 判断是否有退款字段（仅 Claude）
export function hasRefundFields(accountType) {
  return accountType === 'claude';
}

// 判断是否有注册时间字段（Claude 和 Gemini）
export function hasRegistrationDate(accountType) {
  return accountType === 'claude' || accountType === 'gemini';
}

// 判断是否有登录设备字段（仅 GPT）
export function hasLoginDevice(accountType) {
  return accountType === 'gpt';
}
