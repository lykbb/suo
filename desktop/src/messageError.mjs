const HIDDEN = '[已隐藏]';
const SECRET_FIELD = /^(?:api[ _-]?key|x-api-key|authorization|access[ _-]?token|refresh[ _-]?token|token|password|passwd|secret|client[ _-]?secret|key)$/iu;

// Historical errors predate backend redaction, so the reader also removes credentials.
export function redactErrorDetails(value) {
  let text;
  try { text = typeof value === 'string' ? value : JSON.stringify(value) ?? ''; } catch { text = '无法读取错误详情。'; }
  text = text.replace(/\bBearer\s+[^\s,"'<>}\]]+/giu, `Bearer ${HIDDEN}`)
    .replace(/((?:proxy-)?authorization\s*[:=]\s*)(?:Basic|Bearer)\s+[^\s,"'<>}\]]+/giu, `$1${HIDDEN}`)
    .replace(/\bsk-[a-z\d_-]{6,}/giu, HIDDEN)
    .replace(/(["'](?:api[ _-]?key|x-api-key|authorization|access[ _-]?token|refresh[ _-]?token|token|password|passwd|secret|client[ _-]?secret|key)["']\s*:\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/giu, `$1"${HIDDEN}"`)
    .replace(/((?:api[ _-]?key|x-api-key|authorization|access[ _-]?token|refresh[ _-]?token|token|password|passwd|secret|client[ _-]?secret)(?:\s+(?:provided|used))?\s*[:=]\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}\]]+)/giu, `$1${HIDDEN}`)
    .replace(/https?:\/\/[^\s"'<>]+/giu, raw => {
      try {
        const url = new URL(raw);
        if (url.username || url.password) { url.username = 'hidden'; url.password = 'hidden'; }
        for (const key of [...url.searchParams.keys()]) if (SECRET_FIELD.test(key)) url.searchParams.set(key, HIDDEN);
        return url.href;
      } catch { return raw; }
    })
    .replace(/([?&](?:api[_-]?key|key|token|access[_-]?token|password|secret|authorization)=)[^&#\s"'<>]*/giu, `$1${HIDDEN}`)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '');
  return text.length > 4000 ? `${text.slice(0, 4000)}\n（详情过长，已省略后续内容）` : text;
}

function statusOf(raw) {
  let parsed;
  try { parsed = JSON.parse(raw); } catch {}
  const status = parsed?.status ?? parsed?.statusCode ?? parsed?.httpStatus ?? parsed?.error?.status;
  if (Number.isInteger(Number(status)) && Number(status) >= 400 && Number(status) < 600) return Number(status);
  const match = /\bHTTP\s*[:=]?\s*([45]\d\d)\b|^(?:Error:\s*)?([45]\d\d)\b|["'](?:status|statusCode|httpStatus)["']\s*:\s*([45]\d\d)\b/iu.exec(raw.trim());
  return match ? Number(match[1] ?? match[2] ?? match[3]) : undefined;
}

export function presentMessageError(value) {
  const details = redactErrorDetails(value);
  const status = statusOf(details);
  let kind = 'unknown', title = '这次回复没有完成', reason = '可以重新试一次，或检查模型连接。';
  if (/还没有配置模型|No configured model/iu.test(details)) {
    kind = 'unconfigured'; title = '还没有可用的模型'; reason = '在模型设置中添加连接，就可以继续聊。';
  } else if (/图片能力|支持图片|图片分析/iu.test(details)) {
    kind = 'image'; title = '当前模型无法读取图片'; reason = '请选择支持图片的模型，并在连接设置中开启图片分析。';
  } else if (/XLSX|旧版 \.xls|表格.*(?:读取|范围)/iu.test(details)) {
    kind = 'material'; title = '这份表格暂时无法读取'; reason = /\.xls 暂不支持/iu.test(details) ? '请另存为 .xlsx 后导入。' : /20 MB|64 MB|16 MB|安全读取范围/iu.test(details) ? '请拆分表格后重试。' : '请检查文件是否损坏或加密，并另存为 .xlsx 后重试。';
  } else if (status === 401 || status === 403 || /认证失败|API Key 无效|unauthori[sz]ed|invalid[_ -]*(?:api[_ -]*)?key|authentication/iu.test(details)) {
    kind = 'authentication'; title = '模型连接验证失败'; reason = '连接密钥可能无效或没有权限，请在模型设置中检查。';
  } else if (status === 429 || /额度不足|quota|insufficient|rate.?limit|请求太频繁/iu.test(details)) {
    kind = /quota|insufficient/iu.test(details) ? 'quota' : /rate.?limit/iu.test(details) ? 'rate-limit' : /额度不足/iu.test(details) ? 'quota' : 'rate-limit'; title = kind === 'quota' ? '模型暂时没有可用额度' : '模型请求有点频繁'; reason = kind === 'quota' ? '可以更换模型，或检查当前连接的额度。' : '稍等一会儿再试，或换一个模型继续。';
  } else if (status === 404 || /所选模型不在|重新选择模型|没有这个模型|Unknown model|not.?found|does not exist|no such model|model.*not.*(?:exist|support)/iu.test(details)) {
    kind = 'model'; title = '当前模型暂时不可用'; reason = '模型名称或接口地址可能已变化，请更换模型或检查连接。';
  } else if (/回复太长|回复内容过长|Response limit/iu.test(details)) {
    kind = 'response-limit'; title = '回复太长，已停止接收'; reason = '可以让 Suo 分段回答，或缩小这次要整理的范围。';
  } else if (/上下文长度|Context limit|context[_ ](?:length|window)|maximum context|消息太长|请求内容过大/iu.test(details) || status === 413) {
    kind = 'context'; title = '这次发送的内容太多'; reason = '请减少引用资料，或把问题拆成几次发送。';
  } else if (/任务运行超时/iu.test(details)) {
    kind = 'task-timeout'; title = '这次任务花的时间有点长'; reason = '任务已停止。可以把任务拆小后再试。';
  } else if (/超时|timed?.?out|timeout|ETIMEDOUT/iu.test(details) || status === 408 || status === 504) {
    kind = 'timeout'; title = '模型响应超时了'; reason = '可以重新试一次，或更换模型继续。';
  } else if (/没有返回文字|empty response/iu.test(details)) {
    kind = 'empty'; title = '模型没有给出回复'; reason = '可以补充一下问题，再试一次。';
  } else if (status && status >= 500 || /服务不可用|overloaded|unavailable|upstream/iu.test(details)) {
    kind = 'unavailable'; title = '模型服务暂时不可用'; reason = '稍后再试，或换一个模型继续。';
  } else if (/连接中断|连接失败|连不上|ENOTFOUND|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|fetch failed|network/iu.test(details)) {
    kind = 'network'; title = '暂时连不上模型'; reason = '请检查网络和模型连接，再试一次。';
  }
  return { kind, title, reason, details };
}

// Earlier versions put an operation record after each reply in the history, and some models copied
// it into their answers. It is internal, so it never shows, gets copied or is sent back as history.
export function hideSystemRecord(text = '') {
  const at = text.search(/〔系统记录[^〕\n]*〕/u);
  return at < 0 ? text : text.slice(0, at).trimEnd();
}

// The same visible content is used when the user copies a message or places it on the board.
export function messageDisplayText(message = {}) {
  const text = hideSystemRecord(message.text ?? '');
  if (!message.error) return text;
  const { title, reason } = presentMessageError(message.error);
  return [text.trimEnd(), title, reason].filter(Boolean).join('\n\n');
}
