export class JsonLines {
  constructor(onRecord) { this.pending = ''; this.onRecord = onRecord; }
  push(chunk) {
    this.pending += chunk;
    if (this.pending.length > 16 * 1024 * 1024) throw new Error('RPC record too large');
    let end;
    while ((end = this.pending.indexOf('\n')) >= 0) {
      const line = this.pending.slice(0, end).replace(/\r$/, '');
      this.pending = this.pending.slice(end + 1);
      if (line.trim()) this.onRecord(JSON.parse(line));
    }
  }
}
