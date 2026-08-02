export class MemoryPolicy {
  private readonly sensitivePatterns = [
    /(?:密码|口令|验证码|密钥|token|api\s*key)/i,
    /\b\d{15,18}[0-9Xx]\b/,
    /\b(?:\d[ -]?){16,19}\b/,
    /(?:身份证|银行卡|信用卡|精确住址|家庭住址)/,
  ];

  validate(content: string): { ok: boolean; message: string } {
    const normalized = content.trim().replaceAll(/\s+/g, ' ');
    if (!normalized) {
      return { ok: false, message: '记忆内容不能为空' };
    }
    if (normalized.length > 200) {
      return { ok: false, message: '单条记忆不能超过 200 个字符' };
    }
    if (this.sensitivePatterns.some((pattern) => pattern.test(normalized))) {
      return {
        ok: false,
        message: '为了保护隐私，这类敏感信息不会被保存',
      };
    }
    return { ok: true, message: normalized };
  }
}
