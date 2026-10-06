import { parseCsv } from "./history-import";
import { unzipSync, strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";
export type HistorySheet = {
  name: string;
  table: string[][];
  rowNumbers?: number[];
  formulaCells?: string[];
  warnings?: string[];
};
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  parseTagValue: false,
  trimValues: false,
});
const list = (v: unknown): any[] =>
  v == null ? [] : Array.isArray(v) ? v : [v];
function text(v: any): string {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  return String(v["#text"] || "");
}
function rich(v: any) {
  return v?.t != null
    ? text(v.t)
    : list(v?.r)
        .map((r) => text(r.t))
        .join("");
}
export async function readHistoryFile(
  file: File,
  encoding = "utf-8",
): Promise<HistorySheet[]> {
  if (file.size > 10 * 1024 * 1024)
    throw new Error("10MB以下のファイルを選択してください");
  const bytes = new Uint8Array(await file.arrayBuffer());
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
  const files = unzipSync(bytes, {
    filter: (entry) =>
      /^(xl\/(workbook.xml|_rels\/workbook.xml.rels|sharedStrings.xml|styles.xml|worksheets\/sheet\d+.xml))$/.test(
        entry.name,
      ) && entry.originalSize <= 100 * 1024 * 1024,
  });
  const xml = (path: string) => {
    if (!files[path])
      throw new Error(
        "xlsx内部ファイルがありません／展開サイズ上限超過：" + path,
      );
    return strFromU8(files[path]);
  };
  const workbook = parser.parse(xml("xl/workbook.xml")).workbook,
    sheets = list(workbook.sheets?.sheet);
  if (sheets.length > 30) throw new Error("シートは30枚までです");
  const rels = list(
      parser.parse(xml("xl/_rels/workbook.xml.rels")).Relationships
        .Relationship,
    ),
    shared = files["xl/sharedStrings.xml"]
      ? list(parser.parse(xml("xl/sharedStrings.xml")).sst.si).map(rich)
      : [],
    styles = files["xl/styles.xml"]
      ? parser.parse(xml("xl/styles.xml")).styleSheet
      : {},
    formats = new Map(
      list(styles.numFmts?.numFmt).map((f) => [
        String(f["@numFmtId"]),
        String(f["@formatCode"]),
      ]),
    ),
    xfs = list(styles.cellXfs?.xf),
    date1904 = ["1", "true"].includes(
      String(workbook.workbookPr?.["@date1904"]),
    );
  return sheets.map((sheet) => {
    const rel = rels.find((r) => r["@Id"] === sheet["@r:id"]);
    if (!rel) throw new Error("シートの参照が不正です");
    const target = String(rel["@Target"]),
      path = target.startsWith("/")
        ? target.slice(1)
        : "xl/" + target.replace(/^\.\//, "");
    // Discard formatting-only rows before parsing. No formulas, links, or macros are evaluated.
    const cleaned = xml(path)
      .replace(/<row\b[^>]*\/>/g, "")
      .replace(/<row\b[^>]*>[\s\S]*?<\/row>/g, (row) =>
        /<(?:v|is|f)(?:\s|>)/.test(row) ? row : "",
      );
    const root = parser.parse(cleaned).worksheet,
      table: string[][] = [],
      rowNumbers: number[] = [],
      formulaCells: string[] = [],
      warnings: string[] = [];
    for (const row of list(root.sheetData?.row)) {
      const cells: string[] = [];
      for (const cell of list(row.c)) {
        const ref = String(cell["@r"] || ""),
          letters = ref.replace(/\d/g, "");
        let column = 0;
        for (const letter of letters)
          column = column * 26 + letter.charCodeAt(0) - 64;
        if (column < 1 || column > 100)
          throw new Error("100列を超えるデータがあります");
        const type = cell["@t"],
          raw = text(cell.v);
        let value =
          type === "s"
            ? shared[Number(raw)] || ""
            : type === "inlineStr"
              ? rich(cell.is)
              : raw;
        if (cell.f !== undefined) {
          formulaCells.push(ref);
          if (!raw)
            warnings.push(
              ref + "：数式の保存済み計算結果がありません（要確認）",
            );
        }
        if (type === "e") {
          value = "";
          warnings.push(ref + "：Excelエラーセル（要確認）");
        }
        const numFormat = String(
            xfs[Number(cell["@s"] || 0)]?.["@numFmtId"] || "0",
          ),
          custom = formats.get(numFormat) || "";
        if (
          raw &&
          type !== "s" &&
          type !== "inlineStr" &&
          ([
            14, 15, 16, 17, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 50, 51,
            52, 53, 54, 55, 56, 57, 58,
          ].includes(Number(numFormat)) ||
            /[ymd]/i.test(custom.replace(/"[^"]*"|\[[^\]]*\]/g, "")))
        ) {
          const serial = Number(raw);
          if (Number.isFinite(serial)) {
            const date = new Date(
              Date.UTC(
                date1904 ? 1904 : 1899,
                date1904 ? 0 : 11,
                date1904 ? 1 : 30,
              ) +
                Math.floor(serial) * 86400000,
            );
            value = date.toISOString().slice(0, 10);
          }
        }
        cells[column - 1] = value;
      }
      if (cells.some((v) => v?.trim())) {
        table.push(
          Array.from({ length: cells.length }, (_, i) => cells[i] || ""),
        );
        rowNumbers.push(Number(row["@r"]));
      }
      if (table.length > 2001)
        throw new Error("実データ行は1シート2001行までです");
    }
    return {
      name: String(sheet["@name"]),
      table,
      rowNumbers,
      formulaCells,
      warnings,
    };
  });
}
