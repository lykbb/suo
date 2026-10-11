import { deflateRawSync } from 'node:zlib';
import { zipCrc32 } from '../../bridge/spreadsheet.mjs';

export function zipEntries(entries, { stored = false } = {}) {
  const local = [], central = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name), bytes = Buffer.from(entry.text), data = stored ? bytes : deflateRawSync(bytes), crc = zipCrc32(bytes), size = entry.declaredSize ?? bytes.length;
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(stored ? 0 : 8, 8); header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(size, 22); header.writeUInt16LE(name.length, 26);
    const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(stored ? 0 : 8, 10); directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(data.length, 20); directory.writeUInt32LE(size, 24); directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(offset, 42);
    local.push(header, name, data); central.push(directory, name); offset += header.length + name.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
export function xlsxEntries({ firstSheet, sharedStrings, relations, workbook } = {}) {
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const questions = Array.from({ length: 25 }, (_, index) => `<row r="${index + 1}"><c r="A${index + 1}" t="inlineStr"><is><t>问题 ${index + 1}：最近一次使用 AI 产品时，你遇到了什么困难？请具体描述当时的场景、期望结果、尝试过的方法和最终的体验。</t></is></c><c r="B${index + 1}" t="inlineStr"><is><t>${String(index + 1).padStart(3, '0')}</t></is></c></row>`).join('');
  return [
    { name: '[Content_Types].xml', text: '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>' },
    { name: '_rels/.rels', text: `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="root" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', text: workbook ?? `<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets><sheet name="问卷原文" sheetId="1" r:id="sheet1"/><sheet name="文字与公式" sheetId="2" r:id="sheet2"/></sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', text: relations ?? `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="sheet1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="sheet2" Type="${rel}/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="shared" Type="${rel}/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="styles" Type="${rel}/styles" Target="styles.xml"/><Relationship Id="external" Type="${rel}/externalLink" Target="https://must-not-fetch.invalid/" TargetMode="External"/></Relationships>` },
    { name: 'xl/sharedStrings.xml', text: sharedStrings ?? `<sst xmlns="${ns}" count="2" uniqueCount="2"><si><r><t xml:space="preserve"> 文字 </t></r><r><t>&amp; &lt;原文&gt;&#10;第二行</t></r></si><si><t>00123</t></si></sst>` },
    { name: 'xl/styles.xml', text: `<styleSheet xmlns="${ns}"><numFmts count="1"><numFmt numFmtId="164" formatCode="000000"/></numFmts><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>` },
    { name: 'xl/worksheets/sheet1.xml', text: firstSheet ?? `<worksheet xmlns="${ns}"><dimension ref="A1:B25"/><sheetData>${questions}</sheetData></worksheet>` },
    { name: 'xl/worksheets/sheet2.xml', text: `<worksheet xmlns="${ns}"><dimension ref="A1:H3"/><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" s="1"><v>123</v></c><c r="D1"><v>12345678901234567890</v></c><c r="E1"><f>SUM(1,2)</f><v>3</v></c><c r="F1" t="str"><f>CONCAT(&quot;甲&quot;,&quot;乙&quot;)</f><v>甲乙</v></c><c r="G1"><f>WEBSERVICE(&quot;https://must-not-fetch.invalid&quot;)</f></c><c r="H1" t="inlineStr"><is><t>&lt;script&gt;alert(1)&lt;/script&gt;</t></is></c></row><row r="3"><c r="B3" t="inlineStr"><is><t>保留空行与空列</t></is></c></row></sheetData></worksheet>` },
  ];
}
export const syntheticXlsx = options => zipEntries(xlsxEntries(options));
