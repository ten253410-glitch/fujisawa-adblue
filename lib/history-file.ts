import { parseCsv } from "./history-import";
export async function readHistoryFile(
  file: File,
  encoding = "utf-8",
): Promise<{ name: string; table: string[][] }[]> {
  if (file.size > 10 * 1024 * 1024)
    throw new Error("10MB以下のファイルを選択してください");
  const bytes = await file.arrayBuffer();
  if (/\.csv$/i.test(file.name))
    return [
      {
        name: "CSV",
        table: parseCsv(
          new TextDecoder(encoding).decode(bytes).replace(/^\uFEFF/, ""),
        ),
      },
    ];
  if (!/\.xlsx$/i.test(file.name))
    throw new Error(
      "CSVまたはxlsxを選択してください（xls・マクロ・PDFは未対応）",
    );
  const excel = await import("exceljs");
  const Workbook = excel.Workbook || excel.default.Workbook;
  const book = new Workbook();
  await book.xlsx.load(bytes);
  if (book.worksheets.length > 30) throw new Error("シート数は30までです");
  return book.worksheets.map((sheet) => {
    if (sheet.rowCount > 2001 || sheet.columnCount > 100)
      throw new Error("各シートは見出しを含め2001行・100列までです");
    const table: string[][] = [];
    sheet.eachRow({ includeEmpty: true }, (row) => {
      const cells: string[] = [];
      for (let c = 1; c <= sheet.columnCount; c++) {
        const cell = row.getCell(c),
          v = cell.value;
        if (v instanceof Date) cells.push(v.toISOString().slice(0, 10));
        else if (
          v &&
          typeof v === "object" &&
          ("formula" in v || "sharedFormula" in v)
        )
          throw new Error(
            `${sheet.name} ${cell.address}: 数式セルがあります。計算結果を値として貼り付けてから取り込んでください。`,
          );
        else if (v && typeof v === "object" && "error" in v)
          throw new Error(`${cell.address}: エラーセルを修正してください`);
        else cells.push(cell.text || "");
      }
      table.push(cells);
    });
    return { name: sheet.name, table };
  });
}
