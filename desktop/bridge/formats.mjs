export const MAX_FILE_BYTES = 200 * 1024 * 1024;
export const MAX_TEXT_CHARS = 1000000;
export const MAX_HTML_CHARS = 4000000;
export const MAX_TEXT_BYTES = MAX_TEXT_CHARS * 4 + 4;
export const MAX_HTML_BYTES = MAX_HTML_CHARS * 4 + 4;
export const FILE_LIMIT_MESSAGE = '单个文件上限 200 MB。';
const types = {
  '.txt': ['text/plain', 'text'], '.md': ['text/markdown', 'text'], '.markdown': ['text/markdown', 'text'],
  '.json': ['application/json', 'text'], '.csv': ['text/csv', 'text'], '.log': ['text/plain', 'text'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'spreadsheet'],
  '.xls': ['application/vnd.ms-excel', 'spreadsheet'],
  '.html': ['text/html', 'html'], '.htm': ['text/html', 'html'],
  '.png': ['image/png', 'image'], '.jpg': ['image/jpeg', 'image'], '.jpeg': ['image/jpeg', 'image'],
  '.webp': ['image/webp', 'image'], '.gif': ['image/gif', 'image'], '.avif': ['image/avif', 'image'],
  '.pdf': ['application/pdf', 'pdf'], '.doc': ['application/msword', 'word'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'word'], '.rtf': ['application/rtf', 'word'],
  '.mp4': ['video/mp4', 'video'], '.m4v': ['video/mp4', 'video'], '.mov': ['video/quicktime', 'video'],
  '.webm': ['video/webm', 'video'], '.ogv': ['video/ogg', 'video'],
  '.mp3': ['audio/mpeg', 'audio'], '.m4a': ['audio/mp4', 'audio'], '.wav': ['audio/wav', 'audio'],
  '.aac': ['audio/aac', 'audio'], '.flac': ['audio/flac', 'audio'], '.ogg': ['audio/ogg', 'audio'],
};
export function fileKind(name) {
  const extension = name.slice(name.lastIndexOf('.')).toLowerCase();
  const [mime, kind] = types[extension] ?? ['application/octet-stream', 'binary'];
  return { mime, kind };
}
