import { test, expect } from "@playwright/test";
test("explicit Schatz October carry preserves August original and survives reload", async ({
  page,
}) => {
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
  await page
    .getByLabel("実資料・紐付け・記載金額・既発行記録を確認して取り込みます")
    .check();
  await page.getByRole("button", { name: "照合した8月実データを登録" }).click();
  await page.getByLabel("請求チェック対象月").fill("2026-10");
  await page
    .getByRole("button", { name: "税・請求書設定", exact: true })
    .click();
  await page.getByLabel("税率（%）").fill("10");
  await page.getByRole("button", { name: "確認した設定を保存" }).click();
  await page
    .getByRole("button", { name: "未請求・統合請求", exact: true })
    .click();
  await page
    .getByLabel("統合請求の請求先")
    .selectOption({ label: "Schatz / 株式会社 Schatz" });
  await expect(
    page.getByText("過去の未請求実績があります", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "選択明細から下書き作成" }),
  ).toBeDisabled();
  const boxes = page.getByRole("checkbox", { name: /今回請求 / });
  await expect(boxes).toHaveCount(2);
  await expect(boxes.first()).not.toBeChecked();
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await expect(page.getByText(/請求先全体：/)).toContainText("61,100");
  await page
    .getByLabel("選択明細と請求先・対象月・まとめ方を確認しました")
    .check();
  await page.getByRole("button", { name: "選択明細から下書き作成" }).click();
  await expect(page.getByText(/税込請求額/)).toContainText("67,210");
  await page
    .getByLabel("この請求書の明細・数量・金額・税額を確認しました")
    .check();
  await page
    .getByRole("button", { name: "この請求書を確定", exact: true })
    .click();
  await expect(page.getByRole("checkbox", { name: /今回請求 / })).toHaveCount(
    0,
  );
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("fujisawa-adblue-demo-v1")!),
  );
  const ref = saved.billingInvoices.find(
    (i: any) => i.kind === "reference" && i.internal_name === "Schatz",
  );
  expect(ref.net).toBe("570290");
  expect(ref.quantity).toBe("9630");
  const invoice = saved.billingInvoices.find((i: any) => i.selection_mode);
  expect(invoice.month).toBe("2026-10");
  expect(invoice.lines.every((l: any) => l.actual_day === "2026-08-04")).toBe(
    true,
  );
  expect(
    saved.sales.filter(
      (s: any) => s.pending_billing?.invoice_id === invoice.id,
    ),
  ).toHaveLength(2);
  await page.reload();
  await page
    .getByRole("button", { name: "ローカル業務を開く", exact: true })
    .click();
  await page
    .getByRole("button", { name: "請求前チェック・請求書", exact: true })
    .click();
  await page.getByLabel("請求チェック対象月").fill("2026-10");
  await page
    .getByRole("button", { name: "未請求・統合請求", exact: true })
    .click();
  await page
    .getByLabel("統合請求の請求先")
    .selectOption({ label: "Schatz / 株式会社 Schatz" });
  await expect(
    page.getByRole("button", {
      name: "この請求書を印刷・PDF保存",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /今回請求 / })).toHaveCount(
    0,
  );
});

test("TWS parent mapping and unified invoice retain both delivery destinations", async ({
  page,
}) => {
  const { emptyData } = await import("../../lib/domain");
  const { localData } = await import("../../lib/local-flow");
  const { importVerifiedAugust } = await import("../../lib/august-data");
  let d = importVerifiedAugust(localData(emptyData()), "土屋");
  d.taxRules!.push({ ...d.taxRules![0], month: "2026-09" });
  d.billingParties!.push({
    id: "tws-parent",
    internal_name: "TWS",
    formal_name: "TWS",
    address: "",
    active: true,
  });
  const cs = d.customers.filter((c) => c.name.includes("TWS"));
  const { registerHistory } = await import("../../lib/history-import");
  for (const [n, c] of cs.entries()) {
    const site = d.sites!.find((s) => s.customer_id === c.id)!;
    d = registerHistory(
      d,
      [
        {
          row: n + 1,
          day: "2026-09-10",
          customer: c.name,
          site: site.name,
          address: "",
          quantity: String(100 * (n + 1)),
          price: "90",
          amount: "",
          operator: "土屋",
          slip: "TWS-" + n,
          notes: "9月検証",
          customerId: c.id,
          siteId: site.id,
          newCustomer: false,
          newSite: false,
          include: true,
          useSourceAmount: false,
          duplicateApproved: false,
          approved: true,
        },
      ],
      "TWS9月.csv",
      "CSV",
      "土屋",
    );
  }
  await page.goto("/");
  await page.evaluate(
    (d) => localStorage.setItem("fujisawa-adblue-demo-v1", JSON.stringify(d)),
    d,
  );
  await page.reload();
  await page
    .getByRole("button", { name: "ローカル業務を開く", exact: true })
    .click();
  await page
    .getByRole("button", { name: "請求前チェック・請求書", exact: true })
    .click();
  await page.getByLabel("請求チェック対象月").fill("2026-09");
  await page
    .getByRole("button", { name: "未請求・統合請求", exact: true })
    .click();
  await page.getByLabel("統合請求の請求先").selectOption("tws-parent");
  for (const c of cs)
    await page
      .getByRole("checkbox", { name: new RegExp("^" + c.name) })
      .check();
  await page
    .getByLabel("変更理由", { exact: true })
    .fill("TWS本牧・平塚を統合");
  await page
    .getByLabel("選択給液先の未請求実績と今後の請求先設定の変更を確認しました")
    .check();
  await page
    .getByRole("button", { name: "選択給液先を統合請求先へ紐付け" })
    .click();
  const boxes = page.getByRole("checkbox", { name: /今回請求 / });
  await expect(boxes).toHaveCount(2);
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await page
    .getByLabel("選択明細と請求先・対象月・まとめ方を確認しました")
    .check();
  await page.getByRole("button", { name: "選択明細から下書き作成" }).click();
  await expect(page.locator(".invoice-page")).toHaveCount(1);
  await expect(page.locator(".invoice-page")).toContainText("27,000");
  await page
    .getByLabel("この請求書の明細・数量・金額・税額を確認しました")
    .check();
  await page
    .getByRole("button", { name: "この請求書を確定", exact: true })
    .click();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("fujisawa-adblue-demo-v1")!),
  );
  expect(
    saved.billingInvoices.filter((i: any) => i.kind === "reference"),
  ).toEqual(d.billingInvoices);
  expect(saved.billingInvoices.at(-1).lines).toHaveLength(2);
  expect(
    new Set(saved.billingInvoices.at(-1).lines.map((l: any) => l.customer_id))
      .size,
  ).toBe(2);
});
