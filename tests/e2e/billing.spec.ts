import { test, expect } from "@playwright/test";
test("actual August reconciliation, guarded additional billing, immutable originals and printable PDF", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page
    .getByRole("button", { name: "ローカル業務を開く", exact: true })
    .click();
  await page
    .getByRole("button", { name: "請求前チェック・請求書", exact: true })
    .click();
  await page
    .getByRole("button", { name: "実資料8月検証", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "照合した8月実データを登録" }),
  ).toBeDisabled();
  expect(
    await page.evaluate(() => localStorage.getItem("fujisawa-adblue-demo-v1")),
  ).toBeNull();
  await page
    .getByLabel("実資料・紐付け・記載金額・既発行記録を確認して取り込みます")
    .check();
  await page.getByRole("button", { name: "照合した8月実データを登録" }).click();
  await expect(page.getByText("61,100 円", { exact: true })).toBeVisible();
  await expect(page.getByText(/請求漏れ候補：数量・単価は記載/)).toHaveCount(2);
  const before = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("fujisawa-adblue-demo-v1")!),
  );
  expect(before.sales).toHaveLength(69);
  expect(before.billingInvoices).toHaveLength(11);
  await page
    .getByRole("button", { name: "請求漏れ候補を追加請求対象にする" })
    .click();
  await page.getByLabel("請求作成先 Schatz", { exact: true }).check();
  await page.getByLabel("請求日", { exact: true }).fill("2026-10-07");
  await page.getByLabel("支払期限", { exact: true }).fill("2026-10-31");
  await page.getByLabel("対象月・請求先・明細・日付を確認しました").check();
  await page
    .getByRole("button", { name: "確認して請求書を作成", exact: true })
    .click();
  const invoice = page
    .locator(".invoice-page")
    .filter({ has: page.getByRole("heading", { name: /^追加請求書/ }) });
  await expect(invoice).toContainText("67,210");
  await expect(invoice.locator("tbody tr")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "内容を確認して請求確定", exact: true }),
  ).toBeDisabled();
  await page.getByLabel(/請求確定確認 /).check();
  await page
    .getByRole("button", { name: "内容を確認して請求確定", exact: true })
    .click();
  await expect(page.getByText("61,100 円", { exact: true })).toHaveCount(0);
  expect(await page.getByText(/請求漏れ候補：数量・単価は記載/).count()).toBe(
    0,
  );
  const after = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("fujisawa-adblue-demo-v1")!),
  );
  expect(after.billingInvoices.slice(0, 11)).toEqual(before.billingInvoices);
  expect(after.billingInvoices.at(-1)).toMatchObject({
    status: "issued",
    net: "61100",
    tax: "6110",
    gross: "67210",
  });
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".sidebar")).toBeHidden();
  await expect(invoice).toBeVisible();
  const pdf = await page.pdf({ format: "A4" });
  expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  await page.emulateMedia({ media: "screen" });
  await page.reload();
  await page
    .getByRole("button", { name: "ローカル業務を開く", exact: true })
    .click();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("fujisawa-adblue-demo-v1")!)
          .billingInvoices.length,
    ),
  ).toBe(12);
  expect(errors).toEqual([]);
});
test("original supplied workbook: August source rows and cached amounts preview without registration", async ({
  page,
}) => {
  test.skip(
    !process.env.AUGUST_WORKBOOK_PATH,
    "The original workbook stays outside the repository; set AUGUST_WORKBOOK_PATH to validate it.",
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "ローカル業務を開く", exact: true })
    .click();
  await page.getByRole("button", { name: "過去実績取込", exact: true }).click();
  await page
    .getByLabel("給液履歴ファイル")
    .setInputFiles(process.env.AUGUST_WORKBOOK_PATH!);
  await page.getByLabel("取込シート").selectOption({ label: "8月" });
  await page
    .getByRole("button", { name: "用田プラント形式で給液行をプレビュー" })
    .click();
  await expect(page.getByLabel(/行 給液日/)).toHaveCount(69);
  await expect(page.getByLabel("53行 給液日", { exact: true })).toHaveValue(
    "2026-08-18",
  );
  await expect(page.getByLabel("50行 給液量", { exact: true })).toHaveValue(
    "200",
  );
  expect(
    await page.evaluate(() => localStorage.getItem("fujisawa-adblue-demo-v1")),
  ).toBeNull();
});
