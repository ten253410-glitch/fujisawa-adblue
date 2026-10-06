import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyData } from "../lib/domain";
import {
  parseCsv,
  mappedRows,
  registerHistory,
  rowProblems,
  duplicateReasons,
  createDrafts,
} from "../lib/history-import";
import { backupText, parseBackup, localData } from "../lib/local-flow";
import { readHistoryFile } from "../lib/history-file";
import { Workbook } from "exceljs";
const table = [
  [
    "給液日",
    "顧客",
    "給液場所",
    "住所",
    "給液量",
    "単価",
    "金額",
    "担当者",
    "伝票番号",
    "備考",
  ],
  [
    "2026/8/1",
    "検証会社",
    "車庫",
    "藤沢",
    "100",
    "100",
    "10000",
    "土屋",
    "0001",
    "",
  ],
  [
    "2026/8/2",
    "検証会社",
    "車庫",
    "藤沢",
    "0.1",
    "100.12",
    "10.01",
    "佐藤",
    "0002",
    "丸め未確定",
  ],
];
const mapping = {
  day: 0,
  customer: 1,
  site: 2,
  address: 3,
  quantity: 4,
  price: 5,
  amount: 6,
  operator: 7,
  slip: 8,
  notes: 9,
};
function reviewed() {
  return mappedRows(table, 0, mapping).map((r) => ({
    ...r,
    newCustomer: true,
    newSite: true,
    approved: true,
  }));
}
test("CSV quote, multiline and incomplete dates are not inferred", () => {
  assert.deepEqual(parseCsv('a,b\r\n"車庫,現場","1\n2"\r\n'), [
    ["a", "b"],
    ["車庫,現場", "1\n2"],
  ]);
  assert.throws(() => parseCsv('"oops'), /引用符/);
  assert.equal(reviewed()[0].day, "2026-08-01");
  const r = reviewed()[0];
  r.day = "8/1";
  assert.ok(rowProblems(emptyData(), r, [r]).some((p) => p.includes("給液日")));
});
test("history requires review, keeps recorded price and rounded amount, atomic registration and duplicate warning", () => {
  const rows = reviewed();
  assert.throws(
    () => registerHistory(emptyData(), rows, "history.csv", "CSV", "土屋"),
    /金額/,
  );
  rows[1].useSourceAmount = true;
  const data = registerHistory(
    localData(emptyData()),
    rows,
    "history.csv",
    "CSV",
    "土屋",
  );
  assert.equal(data.customers.length, 1);
  assert.equal(data.sites!.length, 1);
  assert.equal(data.actuals![1].net_amount, "10.01");
  assert.equal(data.actuals![1].import_meta!.calculated_amount, "10.012");
  assert.equal(data.orders[0].requested_quantity, null);
  assert.equal(data.prices.length, 0);
  assert.equal(data.documents.length, 0);
  assert.deepEqual(parseBackup(backupText(data)), data);
  const again = {
    ...rows[0],
    customerId: data.customers[0].id,
    siteId: data.sites![0].id,
    newCustomer: false,
    newSite: false,
  };
  assert.ok(duplicateReasons(data, again, [again]).length);
  assert.throws(
    () => registerHistory(data, [again], "again.csv", "CSV", "佐藤"),
    /重複/,
  );
  const duplicate = { ...rows[0], row: 9 };
  assert.ok(
    duplicateReasons(emptyData(), rows[0], [rows[0], duplicate]).length,
  );
});
test("monthly drafts group all deliveries, freeze lines, leave tax null and survive backup", () => {
  const rows = reviewed();
  rows[1].useSourceAmount = true;
  const third = { ...rows[0], row: 4, customer: "別会社", slip: "B001" };
  let data = registerHistory(
    localData(emptyData()),
    [...rows, third],
    "a.csv",
    "CSV",
    "土屋",
  );
  data = createDrafts(
    data,
    "2026-08",
    data.customers.map((c) => c.id),
    "佐藤",
  );
  assert.equal(data.invoiceDrafts!.length, 2);
  assert.equal(data.invoiceDrafts![0].net, "10010.01");
  assert.equal(data.invoiceDrafts![0].quantity, "100.1");
  assert.equal(data.invoiceDrafts![0].tax, null);
  assert.equal(data.invoiceDrafts![0].gross, null);
  assert.deepEqual(parseBackup(backupText(data)), data);
  assert.throws(
    () => createDrafts(data, "2026-08", [data.customers[0].id], "土屋"),
    /作成済み/,
  );
  assert.throws(() => createDrafts(data, "2026-13", [], "土屋"), /対象月/);
  const rebuilt = createDrafts(
    data,
    "2026-08",
    [data.customers[0].id],
    "土屋",
    true,
  );
  assert.equal(rebuilt.invoiceDrafts!.length, 3);
  assert.ok(rebuilt.invoiceDrafts![0].superseded_at);
  assert.deepEqual(parseBackup(backupText(rebuilt)), rebuilt);
  data.invoiceDrafts![0].net = "1";
  assert.throws(() => parseBackup(backupText(data)), /金額/);
});
test("xlsx selects sheets, reads dates and cached formulas without evaluating them", async () => {
  const book = new Workbook(),
    sheet = book.addWorksheet("八月");
  sheet.addRow(table[0]);
  sheet.addRow([
    new Date("2026-08-01T00:00:00Z"),
    "会社",
    "車庫",
    "住所",
    100,
    100,
    10000,
    "土屋",
    "0001",
    "",
  ]);
  const bytes = await book.xlsx.writeBuffer();
  const file = new File([new Uint8Array(bytes)], "august.xlsx");
  const result = await readHistoryFile(file);
  assert.equal(result[0].name, "八月");
  assert.equal(result[0].table[1][0], "2026-08-01");
  assert.equal(result[0].table[1][8], "0001");
  sheet.getCell("G2").value = { formula: "E2*F2", result: 10000 };
  const formula = await book.xlsx.writeBuffer();
  const cached = await readHistoryFile(
    new File([new Uint8Array(formula)], "formula.xlsx"),
  );
  assert.equal(cached[0].table[1][6], "10000");
  assert.deepEqual(cached[0].formulaCells, ["G2"]);
});
test("xlsx ignores long formatting-only tails while preserving physical source row numbers", async () => {
  const { zipSync, strToU8 } = await import("fflate");
  const book = new Workbook();
  const sheet = book.addWorksheet("8月");
  sheet.addRow(["給液日"]);
  sheet.getCell("A5").value = "2026-08-01";
  const { unzipSync, strFromU8 } = await import("fflate");
  const entries = unzipSync(new Uint8Array(await book.xlsx.writeBuffer()));
  const path = "xl/worksheets/sheet1.xml";
  entries[path] = strToU8(
    strFromU8(entries[path]).replace(
      "</sheetData>",
      Array.from(
        { length: 10000 },
        (_, i) => `<row r="${i + 100}" customHeight="1"/>`,
      ).join("") + "</sheetData>",
    ),
  );
  const result = await readHistoryFile(
    new File([new Uint8Array(zipSync(entries))], "formatted.xlsx"),
  );
  assert.deepEqual(result[0].rowNumbers, [1, 5]);
  assert.equal(result[0].table[1][0], "2026-08-01");
});
