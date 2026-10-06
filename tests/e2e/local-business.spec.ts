import { test, expect } from "@playwright/test";
test("free local workflow: manual email, multiple sites, actual, fixed price, billing, backup restore and reopening", async ({
  page,
  context,
}) => {
  const external: string[] = [];
  page.on("request", (r) => {
    if (/supabase|api.openai/.test(r.url())) external.push(r.url());
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "ローカル業務を開く", exact: true })
    .click();
  await page.getByRole("button", { name: "顧客検索" }).click();
  await page.getByRole("button", { name: "顧客を追加", exact: true }).click();
  await page.getByLabel("顧客名 *", { exact: true }).fill("ローカル検証運輸");
  await page.getByLabel("会社名", { exact: true }).fill("検証株式会社");
  await page.getByLabel("会社住所", { exact: true }).fill("藤沢市本町");
  await page.getByRole("button", { name: "顧客を保存", exact: true }).click();
  for (const name of ["第一車庫", "第二車庫"]) {
    await page.getByRole("button", { name: "場所を追加" }).click();
    await page.getByLabel("給液場所名 *", { exact: true }).fill(name);
    await page
      .getByLabel("給液場所住所", { exact: true })
      .fill("藤沢市 " + name);
    await page
      .getByRole("button", { name: "給液場所を保存", exact: true })
      .click();
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  }
  await page.getByLabel("単価（円） *").fill("100");
  await page.getByLabel("適用開始日 *").fill("2020-01-01");
  await page
    .getByRole("button", { name: "単価履歴を追加", exact: true })
    .click();
  await page
    .locator("button:visible")
    .filter({ hasText: /^ホーム$/ })
    .first()
    .click();
  await page.getByRole("button", { name: "電話受注" }).click();
  await page.getByLabel("受注経路", { exact: true }).selectOption("email");
  await page
    .getByLabel("顧客 *", { exact: true })
    .selectOption({ label: "ローカル検証運輸" });
  await page
    .getByLabel("登録済み給液場所")
    .selectOption({ label: "第二車庫 / 藤沢市 第二車庫" });
  await expect(page.getByLabel("給液場所", { exact: true })).toHaveValue(
    "第二車庫",
  );
  await page.getByLabel("依頼数量", { exact: true }).fill("200");
  await page.getByLabel("希望給液日", { exact: true }).fill("2026-10-06");
  await page.getByRole("button", { name: "受注を登録", exact: true }).click();
  await page.getByLabel("給液予定日", { exact: true }).fill("2026-10-06");
  await page.getByRole("button", { name: "日程・メモを保存" }).click();
  await page
    .getByRole("button", { name: "給液終了を記録（納品書待ち）" })
    .click();
  await page.getByRole("button", { name: "撮影・追加", exact: true }).click();
  const image = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 100;
    c.height = 100;
    return c.toDataURL("image/png").split(",")[1];
  });
  await page.getByLabel("画像を選択", { exact: true }).setInputFiles({
    name: "actual.png",
    mimeType: "image/png",
    buffer: Buffer.from(image, "base64"),
  });
  await expect(page.getByRole("status")).toContainText("納品書を保存");
  // Open the same case from the document screen.
  await page
    .locator("button:visible")
    .filter({ hasText: /^ホーム$/ })
    .first()
    .click();
  await page.getByRole("button", { name: /納品書確認待ち/ }).click();
  await page
    .locator("button:visible")
    .filter({ hasText: /第二車庫/ })
    .first()
    .click();
  await page.getByLabel("実際の給液日 *", { exact: true }).fill("2026-10-06");
  await page.getByLabel("実際の給液量（L） *", { exact: true }).fill("175");
  await page
    .getByLabel("納品書・実給液日・実給液量・適用単価を確認しました")
    .check();
  await page.getByRole("button", { name: "給液実績と売上を登録" }).click();
  await expect(page.getByText("17,500 円", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "売上・請求管理", exact: true })
    .click();
  await page.getByLabel("実給液月", { exact: true }).selectOption("2026-10");
  await page.getByRole("checkbox", { name: /売上選択/ }).check();
  await page.getByLabel("請求状態変更のメモ *").fill("ローカル業務検証");
  await page.getByLabel("対象売上と請求状態の変更を確認しました").check();
  await page.getByRole("button", { name: "選択分を請求済みにする" }).click();
  await expect(page.locator("tbody")).toContainText("請求済み");
  await page
    .locator("button:visible")
    .filter({ hasText: /^ホーム$/ })
    .first()
    .click();
  await page.getByRole("button", { name: "顧客検索" }).click();
  await page
    .locator("button.customer-item")
    .filter({ hasText: "ローカル検証運輸" })
    .click();
  await page.getByLabel("単価（円） *").fill("120");
  await page.getByLabel("適用開始日 *").fill("2020-01-01");
  await page
    .getByRole("button", { name: "単価履歴を追加", exact: true })
    .click();
  const fixed = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("fujisawa-adblue-demo-v1")!),
  );
  expect(fixed.actuals[0].unit_price_excl_tax).toBe("100");
  expect(fixed.sales[0].net_amount).toBe("17500");
  await page
    .getByRole("button", { name: "バックアップ・復元", exact: true })
    .click();
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "JSONバックアップを保存", exact: true })
    .click();
  const file = await downloadPromise;
  const backupPath = await file.path();
  const backup = JSON.parse(
    await (await import("node:fs/promises")).readFile(backupPath!, "utf8"),
  );
  expect(backup.data.sales[0].net_amount).toBe("17500");
  expect(backup.data.orders[0].requested_quantity).toBe(200);
  expect(backup.data.orders[0].channel).toBe("email");
  expect(backup.data.sites).toHaveLength(2);
  await page.getByLabel("バックアップJSONを選択").setInputFiles(backupPath!);
  await page
    .getByLabel("内容を確認し、現在のデータをバックアップの内容に置き換えます")
    .check();
  await page.getByRole("button", { name: "確認して復元", exact: true }).click();
  await expect(page.getByText(/バックアップを復元しました/)).toBeVisible();
  const state = await context.storageState();
  await page.close();
  const reopened = await context.browser()!.newContext({ storageState: state });
  const p = await reopened.newPage();
  await p.goto("http://127.0.0.1:3000/");
  await p.getByLabel("デモ利用者").selectOption("佐藤");
  await p
    .getByRole("button", { name: "ローカル業務を開く", exact: true })
    .click();
  await p.getByRole("button", { name: "売上・請求管理", exact: true }).click();
  await p.getByLabel("実給液月", { exact: true }).selectOption("2026-10");
  await expect(p.locator("tbody")).toContainText("17,500");
  await expect(p.locator("tbody")).toContainText("請求済み");
  expect(external).toEqual([]);
  await reopened.close();
});
