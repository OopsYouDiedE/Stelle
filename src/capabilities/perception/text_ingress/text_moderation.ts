export interface TextModerationResult {
  allowed: boolean;
  action: "allow" | "drop" | "hide";
  reason: string;
  category?: "political" | "spam" | "empty" | "abuse" | "privacy" | "prompt_injection" | "sexual" | "minor_safety";
  visibleToControlRoom?: boolean;
}

const POLITICAL_PATTERNS = [
  /政治/,
  /时政/,
  /选举/,
  /总统/,
  /主席/,
  /总理/,
  /政府/,
  /政党/,
  /国会/,
  /外交/,
  /台海/,
  /台湾/,
  /香港/,
  /新疆/,
  /西藏/,
  /乌克兰/,
  /俄罗斯/,
  /巴以/,
  /以色列/,
  /哈马斯/,
  /特朗普|川普|拜登|习近平|普京|泽连斯基/,
  /\b(CCP|CPC|DPP|KMT|NATO|UN)\b/i,
];

const SPAM_PATTERNS = [
  /(.)\1{8,}/u,
  /^(哈哈|hhh|www|111|666|。。|？？){4,}$/iu,
  /(加群|私信|代刷|刷粉|免费领取|点击链接)/u,
];
const ABUSE_PATTERNS = [/傻逼|垃圾|废物|去死|滚|脑残|弱智/u, /\b(kys|idiot|stupid)\b/i];
const PRIVACY_PATTERNS = [/身份证|手机号|电话号码|住址|家庭住址|真实姓名|开盒|人肉|隐私|私人信息/u, /\b\d{11}\b/];
const PROMPT_INJECTION_PATTERNS = [
  /忽略(以上|之前|所有).*(规则|指令|设定)/u,
  /system prompt|developer message|越权|调用工具|执行命令|泄露提示词/i,
];
const SEXUAL_PATTERNS = [/色情|裸照|约炮|性爱|黄片|成人内容/u];
const MINOR_SAFETY_PATTERNS = [/未成年.*(裸|性|约|隐私)|小学生.*(裸|性|约)/u];

export function moderateText(text: string): TextModerationResult {
  const check = (
    patterns: RegExp[],
    category: TextModerationResult["category"],
    action: TextModerationResult["action"],
    reason: string,
  ): TextModerationResult | null => {
    if (patterns.some((pattern) => pattern.test(text))) {
      return { allowed: false, action, reason, category, visibleToControlRoom: true };
    }
    return null;
  };

  return (
    check(MINOR_SAFETY_PATTERNS, "minor_safety", "drop", "minor safety risk") ??
    check(PRIVACY_PATTERNS, "privacy", "drop", "privacy or doxxing risk") ??
    check(PROMPT_INJECTION_PATTERNS, "prompt_injection", "drop", "prompt injection attempt") ??
    check(ABUSE_PATTERNS, "abuse", "hide", "abusive text") ??
    check(SEXUAL_PATTERNS, "sexual", "drop", "sexual content") ??
    check(SPAM_PATTERNS, "spam", "drop", "spam text") ??
    (POLITICAL_PATTERNS.some((pattern) => pattern.test(text))
      ? {
          allowed: false,
          action: "drop",
          reason: "political content",
          category: "political",
          visibleToControlRoom: true,
        }
      : { allowed: true, action: "allow", reason: "allowed", visibleToControlRoom: false })
  );
}
