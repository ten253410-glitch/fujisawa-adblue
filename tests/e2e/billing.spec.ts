import { test, expect } from "@playwright/test";
test("original August totals, independent calculation difference, hierarchy, preserved originals and PDF", async ({
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
    .getByRole("button", { name: "④ 月次集計・照合", exact: true })
    .click();
  await page
    .getByRole("button", { name: "実資料8月検証", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "照合した8月実データを登録" }),
  ).toBeDisabled();
  await page
    .getByLabel("実資料・紐付け・記載金額・既発行記録を確認して取り込みます")
    .check();
  await page.getByRole("button", { name: "照合した8月実データを登録" }).click();
  const summary = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "実請求の正解値（原本を保持）" }),
    })
    .last();
  await expect(summary).toContainText("2,823,058");
  await expect(summary).toContainText("282,305");
  await expect(summary).toContainText("3,105,363");
  await expect(page.getByText("61,100 円", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/請求内容再計算が必要：原本に通常請求/),
  ).toHaveCount(2);
  expect(
    await page
      .getByRole("button", { name: "請求漏れ候補を追加請求対象にする" })
      .count(),
  ).toBe(0);
  const before = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("fujisawa-adblue-demo-v1")!),
  );
  expect(before.sales).toHaveLength(69);
  expect(before.billingInvoices).toHaveLength(11);
  await page
    .getByLabel("チェックする請求先")
    .selectOption({ label: "Schatz / 株式会社 Schatz" });
  await expect(summary).toContainText("570,290");
  await page
    .getByRole("button", { name: "既存請求の管理", exact: true })
    .click();
  await page
    .getByText("旧方式の一括作成・追加請求（既存運用用）", { exact: true })
    .click();
  await page.getByLabel("請求区分").selectOption("additional");
  await page.getByLabel("請求日", { exact: true }).fill("2026-10-07");
  await page.getByLabel("支払期限", { exact: true }).fill("2026-10-31");
  await page.getByLabel("請求作成先 Schatz", { exact: true }).check();
  await page.getByLabel("対象月・請求先・明細・日付を確認しました").check();
  await page
    .getByRole("button", { name: "確認して請求書を作成", exact: true })
    .click();
  await expect(page.getByRole("alert").first()).toContainText(
    "未請求の売上がありません",
  );
  const after = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("fujisawa-adblue-demo-v1")!),
  );
  expect(after.billingInvoices).toEqual(before.billingInvoices);
  expect(after.sales).toEqual(before.sales);
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".sidebar")).toBeHidden();
  await expect(page.locator(".invoice-page")).toHaveCount(1);
  const pdf = await page.pdf({ format: "A4" });
  expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  await page.emulateMedia({ media: "screen" });
  if (
    await page
      .getByRole("button", { name: "メニューを開く", exact: true })
      .isVisible()
  )
    await page
      .getByRole("button", { name: "メニューを開く", exact: true })
      .click();
  await page
    .getByRole("button", { name: "顧客マスター", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "請求先一覧 → 配下の給液先" }),
  ).toBeVisible();
  await page.getByLabel("請求先・給液先から検索").fill("Schatz");
  await page
    .getByText("Schatz → 株式会社 Schatz（給液先17件）", { exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /給液先を開く：EG八王子/ }),
  ).toBeVisible();
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
  ).toBe(11);
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
test("existing schema 4 browser data migrates once and supports reviewed relinking and backups", async ({
  page,
}) => {
  const { emptyData } = await import("../../lib/domain");
  const { localData } = await import("../../lib/local-flow");
  const { importVerifiedAugust } = await import("../../lib/august-data");
  const old = importVerifiedAugust(localData(emptyData()), "土屋");
  old.schema_version = 4;
  const payer = old.billingParties!.find((p) => p.internal_name === "Schatz")!;
  const sale = old.sales!.find(
    (s) => s.billing_party_id === payer.id && s.net_amount === "48100",
  )!;
  sale.billing_status = "additional";
  sale.billing_party_id = null;
  const customer = old.customers.find((c) => c.id === sale.customer_id)!;
  customer.billing_party_id = null;
  const site = old.sites!.find(
    (s) => s.id === old.orders.find((o) => o.id === sale.order_id)!.site_id,
  )!;
  site.billing_party_id = null;
  await page.goto("/");
  await page.evaluate(
    (value) =>
      localStorage.setItem("fujisawa-adblue-demo-v1", JSON.stringify(value)),
    old,
  );
  await page
    .getByRole("button", { name: "ローカル業務を開く", exact: true })
    .click();
  const migrated = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("fujisawa-adblue-demo-v1")!),
  );
  expect(migrated.schema_version).toBe(5);
  expect(migrated.sales.find((s: any) => s.id === sale.id).billing_status).toBe(
    "recalculate",
  );
  expect(migrated.billingInvoices).toEqual(old.billingInvoices);
  expect(
    await page.evaluate(
      () =>
        JSON.parse(
          localStorage.getItem("fujisawa-adblue-demo-v1-before-schema-5")!,
        ).schema_version,
    ),
  ).toBe(4);
  await page
    .getByRole("button", { name: "請求前チェック・請求書", exact: true })
    .click();
  await page.getByRole("button", { name: "⑤ 請求先設定", exact: true }).click();
  await page
    .getByRole("button", { name: "請求先・紐付け", exact: true })
    .click();
  const form = page.locator("form").filter({
    has: page.getByRole("button", { name: "請求先の紐付けを保存" }),
  });
  await form.locator("[name=customer]").selectOption(customer.id);
  await form.locator("[name=site]").selectOption(site.id);
  await form.locator("[name=party]").selectOption(payer.id);
  await form.getByLabel("変更理由").fill("8月原本でSchatz配下と確認");
  await form
    .getByLabel("対象月の既存・未確定売上も確認して再紐付けする")
    .check();
  await form.getByRole("button", { name: "請求先の紐付けを保存" }).click();
  await expect(page.getByRole("status")).toContainText("再集約");
  const linked = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("fujisawa-adblue-demo-v1")!),
  );
  expect(linked.sales.find((s: any) => s.id === sale.id)).toMatchObject({
    billing_party_id: payer.id,
    quantity_l: "740",
    unit_price_excl_tax: "65",
    net_amount: "48100",
    billing_status: "unbilled",
  });
  expect(linked.billingInvoices).toEqual(old.billingInvoices);
  expect(linked.billingAliases).toHaveLength(1);
  await page
    .getByRole("button", { name: "バックアップ・復元", exact: true })
    .click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "JSONバックアップを保存", exact: true })
    .click();
  const file = await download;
  expect(await file.path()).toBeTruthy();
  const exported = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("fujisawa-adblue-demo-v1")!),
  );
  expect(exported.audit.some((a: any) => a.action === "EXPORT")).toBeTruthy();
});
test("previous August history attaches to original reference without increasing actual counts", async ({
  page,
}) => {
  const { emptyData } = await import("../../lib/domain");
  const { localData } = await import("../../lib/local-flow");
  const { importVerifiedAugust } = await import("../../lib/august-data");
  const existing = importVerifiedAugust(localData(emptyData()), "土屋");
  existing.billingInvoices = [];
  existing.billingItems = [];
  existing.sales = existing.sales!.map((s) => ({
    ...s,
    billing_party_id: null,
    billing_status: "unbilled",
  }));
  await page.goto("/");
  await page.evaluate(
    (d) => localStorage.setItem("fujisawa-adblue-demo-v1", JSON.stringify(d)),
    existing,
  );
  await page
    .getByRole("button", { name: "ローカル業務を開く", exact: true })
    .click();
  await page
    .getByRole("button", { name: "請求前チェック・請求書", exact: true })
    .click();
  await page
    .getByRole("button", { name: "④ 月次集計・照合", exact: true })
    .click();
  await page
    .getByRole("button", { name: "実資料8月検証", exact: true })
    .click();
  await page
    .getByText("既に一般取込した8月実績と原本を照合する（削除・再取込なし）", {
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "確認して既存実績へ8月原本を紐付ける" }),
  ).toBeDisabled();
  await page
    .getByLabel("実資料・紐付け・記載金額・既発行記録を確認して取り込みます")
    .check();
  await page
    .getByRole("button", { name: "確認して既存実績へ8月原本を紐付ける" })
    .click();
  await expect(page.getByText("61,100 円", { exact: true })).toBeVisible();
  const current = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("fujisawa-adblue-demo-v1")!),
  );
  expect(current.actuals).toEqual(existing.actuals);
  expect(current.orders).toEqual(existing.orders);
  expect(current.sales.map((s: any) => s.id)).toEqual(
    existing.sales!.map((s) => s.id),
  );
  expect(current.billingInvoices).toHaveLength(11);
});
test("ordinary monthly invoice defaults, recalculation, confirmation and explicit release preserve every version", async ({
  page,
}) => {
  const { emptyData } = await import("../../lib/domain");
  const { localData } = await import("../../lib/local-flow");
  const { importVerifiedAugust } = await import("../../lib/august-data");
  const data = importVerifiedAugust(localData(emptyData()), "土屋"),
    p = data.billingParties!.find((p) => p.internal_name === "G.TRES")!;
  data.billingInvoices = data.billingInvoices!.filter(
    (i) => i.billing_party_id !== p.id,
  );
  await page.goto("/");
  await page.evaluate(
    (d) => localStorage.setItem("fujisawa-adblue-demo-v1", JSON.stringify(d)),
    data,
  );
  await page
    .getByRole("button", { name: "ローカル業務を開く", exact: true })
    .click();
  await page
    .getByRole("button", { name: "請求前チェック・請求書", exact: true })
    .click();
  await page
    .getByRole("button", { name: "④ 月次集計・照合", exact: true })
    .click();
  await page.getByLabel("チェックする請求先").selectOption(p.id);
  await page
    .getByRole("button", { name: "既存請求の管理", exact: true })
    .click();
  await page
    .getByText("旧方式の一括作成・追加請求（既存運用用）", { exact: true })
    .click();
  await page.getByLabel("請求作成先 G.TRES", { exact: true }).check();
  await page.getByLabel("対象月・請求先・明細・日付を確認しました").check();
  await page
    .getByRole("button", { name: "確認して請求書を作成", exact: true })
    .click();
  await expect(page.locator(".invoice-page")).toContainText("1,180,539");
  let saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("fujisawa-adblue-demo-v1")!),
  );
  const first = saved.billingInvoices.at(-1);
  expect(first).toMatchObject({
    status: "draft",
    issued_on: "2026-09-01",
    due_on: "2026-09-30",
  });
  await page
    .getByRole("button", { name: "未確定請求書を再計算（旧版を保持）" })
    .click();
  saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("fujisawa-adblue-demo-v1")!),
  );
  expect(saved.billingInvoices.find((i: any) => i.id === first.id).status).toBe(
    "cancelled",
  );
  const replacement = saved.billingInvoices.at(-1);
  expect(replacement.lines).toEqual(first.lines);
  await expect(
    page.getByRole("button", { name: "内容を確認して請求確定", exact: true }),
  ).toBeDisabled();
  await page.getByLabel(/請求確定確認 /).check();
  await page
    .getByRole("button", { name: "内容を確認して請求確定", exact: true })
    .click();
  await expect(page.getByLabel("確定解除理由")).toBeVisible();
  await page.getByLabel("確定解除理由").fill("発行前の宛名確認のため");
  await page.getByLabel("確定解除の影響を確認しました").check();
  await page
    .getByRole("button", { name: "請求確定を解除（旧版を保持）" })
    .click();
  saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("fujisawa-adblue-demo-v1")!),
  );
  expect(saved.billingInvoices.at(-1)).toMatchObject({
    status: "cancelled",
    released_by: "土屋",
  });
  expect(saved.billingInvoices.at(-1).lines).toEqual(first.lines);
  expect(
    saved.sales
      .filter((s: any) => s.billing_party_id === p.id)
      .every((s: any) => s.billing_status === "unbilled"),
  ).toBeTruthy();
  expect(saved.audit.map((a: any) => a.action)).toEqual(
    expect.arrayContaining(["RECALCULATE", "CONFIRM", "RELEASE"]),
  );
});
