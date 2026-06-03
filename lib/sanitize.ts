import DOMPurify from 'dompurify';

// 正文 HTML 在写入 Quill 前必须消毒:LLM 是最不可信输入,
// dangerouslyPasteHTML 会在页面主世界(登录态后台 origin)执行任意脚本(R17)。
// 白名单只放 Quill 实际支持的格式标签。
const ALLOWED_TAGS = [
  'p', 'br', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'a',
  'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'img',
];
const ALLOWED_ATTR = ['href', 'target', 'rel', 'src', 'alt'];

/** 按白名单消毒正文 HTML。剥除 script/iframe/事件处理器/javascript: 等。 */
export function sanitizeBody(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    // 链接/图片只允许 http(s)、相对、锚点、mailto。
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  });
}
