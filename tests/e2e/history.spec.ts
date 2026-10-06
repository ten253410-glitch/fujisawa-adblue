import { test, expect } from "@playwright/test";
import { Workbook } from "exceljs";
test("August CSV review, monthly invoice, matching, print and restore; duplicate remains blocked", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page
    .getByRole("button", { name: "ローカル業務を開く", exact: true })
    .click();
  await page.getByRole("button", { name: "過去実績取込", exact: true }).click();
  const content =
    "給液日,顧客,給液場所,住所,給液量,単価,金額,担当者,伝票番号,備考\r\n2026-08-01,八月運輸,第一車庫,藤沢市,100,100,10000,土屋,0001,\r\n2026-08-02,八月運輸,第一車庫,藤沢市,75,100,7500,佐藤,0002,\r\n2026-08-03,別会社,第二車庫,横浜市,20,120,2400,土屋,B001,";
  const file = {
    name: "august.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(content),
  };
  await page.getByLabel("給液履歴ファイル").setInputFiles(file);
  await page.getByRole("button", { name: "確認用プレビューを表示" }).click();
  expect(
    await page.evaluate(() => localStorage.getItem("fujisawa-adblue-demo-v1")),
  ).toBeNull();
  await expect(
    page.getByText("顧客候補：未一致", { exact: true }).first(),
  ).toBeVisible();
  for (const row of [2, 3, 4]) {
    await page
      .getByLabel(row + "行 登録先顧客", { exact: true })
      .selectOption("new");
    await page
      .getByLabel(row + "行 登録先給液場所", { exact: true })
      .selectOption("new");
    await page
      .getByLabel(row + "行 内容と紐付けを確認", { exact: true })
      .check();
  }
  await page
    .getByLabel("資料の単価・金額が税抜であることを確認しました")
    .check();
  await page.getByLabel("選択した全行を確認して一括登録します").check();
  await page.getByRole("button", { name: "確認した過去実績を登録" }).click();
  await expect(page.getByRole("status")).toContainText("3件");
  await page
    .getByRole("button", { name: "売上・請求管理", exact: true })
    .click();
  await page.getByLabel("実給液月", { exact: true }).selectOption("2026-08");
  await expect(page.locator("tbody")).toContainText("7,500");
  await expect(page.getByText("19,900 円", { exact: true })).toBeVisible();
  await page.getByText("開発・検証用画面", { exact: true }).click();
  await page
    .getByRole("button", { name: "月次検証請求書", exact: true })
    .click();
  await page.getByLabel("請求先 八月運輸", { exact: true }).check();
  await page.getByLabel("請求先 別会社", { exact: true }).check();
  await page.getByLabel("対象月と請求先を確認しました").check();
  await page
    .getByRole("button", { name: "選択顧客の検証請求書を一括作成" })
    .click();
  await expect(page.locator(".invoice-page")).toHaveCount(2);
  await expect(page.locator(".invoice-page").first()).toContainText("17,500");
  await expect(page.locator(".invoice-page").first()).toContainText("未確定");
  const comparison = page.locator("section").filter({
    has: page.getByRole("heading", {
      name: "発行済み請求書との照合：八月運輸",
    }),
  });
  await comparison.getByLabel("発行済み 合計数量", { exact: true }).fill("175");
  await comparison
    .getByLabel("発行済み 税抜合計", { exact: true })
    .fill("17500");
  await comparison.getByLabel("発行済み 消費税", { exact: true }).fill("1750");
  await comparison
    .getByLabel("発行済み 税込請求額", { exact: true })
    .fill("19250");
  await comparison.getByRole("button", { name: "照合値を保存" }).click();
  await expect(comparison).toContainText("数量：一致 ／ 税抜合計：一致");
  await expect(comparison).toContainText("判定保留");
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".sidebar")).toBeHidden();
  await expect(
    page.getByRole("heading", { name: "月次検証請求書・照合" }),
  ).toBeHidden();
  await expect(page.locator(".invoice-page").first()).toBeVisible();
  await page.emulateMedia({ media: "screen" });
  const pdf = await page.pdf({ format: "A4", printBackground: true });
  expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  await page
    .getByRole("button", { name: "バックアップ・復元", exact: true })
    .click();
  const promise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "JSONバックアップを保存", exact: true })
    .click();
  const downloaded = await promise,
    path = await downloaded.path();
  await page.getByLabel("バックアップJSONを選択").setInputFiles(path!);
  await page
    .getByLabel("内容を確認し、現在のデータをバックアップの内容に置き換えます")
    .check();
  await page.getByRole("button", { name: "確認して復元", exact: true }).click();
  await expect(page.getByText(/バックアップを復元しました/)).toBeVisible();

  await page.reload();
  await page
    .getByRole("button", { name: "ローカル業務を開く", exact: true })
    .click();
  await page.getByRole("button", { name: "過去実績取込", exact: true }).click();
  await page.getByLabel("給液履歴ファイル").setInputFiles(file);
  await page.getByRole("button", { name: "確認用プレビューを表示" }).click();
  await page
    .getByLabel("2行 登録先顧客", { exact: true })
    .selectOption({ label: "八月運輸" });
  await page
    .getByLabel("2行 登録先給液場所", { exact: true })
    .selectOption({ label: "第一車庫 / 藤沢市" });
  await expect(page.getByText(/重複の可能性/).first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "確認した過去実績を登録" }),
  ).toBeDisabled();
  const data = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("fujisawa-adblue-demo-v1")!),
  );
  expect(data.actuals).toHaveLength(3);
  expect(data.invoiceDrafts).toHaveLength(2);
  expect(data.invoiceDrafts[0].tax).toBeNull();
  expect(errors).toEqual([]);
});
test("xlsx is parsed locally with preview and never registers before confirmation", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "ローカル業務を開く", exact: true })
    .click();
  await page.getByRole("button", { name: "過去実績取込", exact: true }).click();
  const book = new Workbook();
  book.addWorksheet("別月").addRow(["メモ"]);
  const s = book.addWorksheet("8月履歴");
  s.addRow(["給液日", "顧客", "給液場所", "給液量", "単価", "担当者"]);
  s.addRow([
    new Date("2026-08-01T00:00:00Z"),
    "Excel運輸",
    "車庫",
    12.5,
    100,
    "土屋",
  ]);
  const bytes = await book.xlsx.writeBuffer();
  await page.getByLabel("給液履歴ファイル").setInputFiles({
    name: "履歴.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(bytes),
  });
  await page.getByLabel("取込シート").selectOption({ label: "8月履歴" });
  await page.getByRole("button", { name: "確認用プレビューを表示" }).click();
  await expect(page.getByLabel("2行 給液日", { exact: true })).toHaveValue(
    "2026-08-01",
  );
  await expect(page.getByLabel("2行 給液量", { exact: true })).toHaveValue(
    "12.5",
  );
  expect(
    await page.evaluate(() => localStorage.getItem("fujisawa-adblue-demo-v1")),
  ).toBeNull();
});
