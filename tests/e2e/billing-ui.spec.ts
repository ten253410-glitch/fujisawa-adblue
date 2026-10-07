import { test, expect, type Page } from "@playwright/test";
import { augustWithSeptember } from "../billing-test-fixture";
async function open(page: Page) {
  const fixture = augustWithSeptember();
  await page.goto("/");
  await page.evaluate(
    (d) => localStorage.setItem("fujisawa-adblue-demo-v1", JSON.stringify(d)),
    fixture.data,
  );
  await page
    .getByRole("button", { name: "ローカル業務を開く", exact: true })
    .click();
  await page
    .getByRole("button", { name: "請求前チェック・請求書", exact: true })
    .click();
  return fixture;
}
for (const destinationIndex of [0, 1])
  test(`normal wizard creates an independent invoice for TWS destination ${destinationIndex + 1}`, async ({
    page,
  }) => {
    const { data, destinations } = await open(page),
      c = destinations[destinationIndex],
      other = destinations[1 - destinationIndex],
      payer = data.billingParties!.find((p) => p.id === c.billing_party_id)!;
    await expect(
      page
        .getByRole("navigation", { name: "請求業務の入口" })
        .getByRole("button"),
    ).toHaveCount(5);
    await expect(
      page.getByRole("heading", { name: "請求先別の集約", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByLabel("正式請求先名称")).toHaveCount(0);
    await expect(page.locator(".invoice-page")).toHaveCount(0);
    await page.getByLabel("請求チェック対象月").fill("2026-09");
    await page
      .getByRole("button", {
        name: "請求先を選択 " + payer.internal_name,
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("checkbox", { name: /通常請求明細 / }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("checkbox", {
        name: new RegExp("通常請求明細 " + other.name),
      }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "請求書プレビューへ" }),
    ).toBeDisabled();
    await page.getByLabel("通常請求の明細・金額・日付を確認しました").check();
    await page
      .getByRole("button", { name: "請求書プレビューへ", exact: true })
      .click();
    await expect(
      page.getByRole("checkbox", { name: /通常請求明細 / }),
    ).toHaveCount(0);
    await expect(page.locator(".invoice-page")).toHaveCount(1);
    await expect(page.locator(".invoice-page")).toContainText(c.name);
    await page
      .getByLabel("この請求書の明細・数量・金額・税額を確認しました")
      .check();
    await page
      .getByRole("button", { name: "この請求書を確定", exact: true })
      .click();
    const saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("fujisawa-adblue-demo-v1")!),
    );
    expect(saved.billingInvoices.at(-1).net).toBe(
      String(9000 * (destinationIndex + 1)),
    );
    expect(saved.billingInvoices.at(-1).status).toBe("issued");
    expect(
      saved.billingInvoices.filter((i: any) => i.kind === "reference"),
    ).toEqual(data.billingInvoices);
    await page.emulateMedia({ media: "print" });
    await expect(
      page.getByRole("navigation", { name: "請求業務の入口" }),
    ).toBeHidden();
    const pdf = await page.pdf({ format: "A4" });
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });
test("unpaid starts with all accounts; September carry, October duplicate prevention and backup preserve persistent integration", async ({
  page,
}) => {
  const { data, destinations } = await open(page);
  await page
    .getByRole("button", { name: "② 未請求を処理", exact: true })
    .click();
  await expect(page.getByRole("checkbox", { name: /今回請求 / })).toHaveCount(
    4,
  );
  await expect(page.getByLabel("未請求の請求先")).toHaveValue("");
  await expect(
    page.getByRole("heading", { name: "統合請求設定", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "選択給液先を統合請求先へ紐付け" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("columnheader", { name: "請求先／本来の対象月" }),
  ).toBeVisible();
  await page.getByRole("checkbox", { name: /今回請求 EG八王子 / }).check();
  await page
    .getByRole("checkbox", { name: /今回請求 デイライン西東京営業所 / })
    .check();
  await page.getByLabel("請求する月", { exact: true }).selectOption("2026-09");
  await expect(page.getByLabel("未請求の処理内容")).toContainText("940 L");
  await expect(page.getByLabel("未請求の処理内容")).toContainText("61,100");
  await page.getByLabel("未請求理由（一括・任意）").fill("8月請求漏れ");
  await page
    .getByRole("button", {
      name: "選択した2件を2026年9月請求へ追加",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "① 請求書を作る", exact: true })
    .click();
  await page.getByLabel("請求チェック対象月").fill("2026-09");
  await page
    .getByRole("button", { name: "請求先を選択 Schatz", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: /通常請求明細 / }),
  ).toHaveCount(2);
  await expect(
    page.getByText("2026年8月未請求分", { exact: true }),
  ).toHaveCount(2);
  await page.getByLabel("通常請求の明細・金額・日付を確認しました").check();
  await page
    .getByRole("button", { name: "請求書プレビューへ", exact: true })
    .click();
  await page
    .getByLabel("この請求書の明細・数量・金額・税額を確認しました")
    .check();
  await page
    .getByRole("button", { name: "この請求書を確定", exact: true })
    .click();
  await page
    .getByRole("button", { name: "② 未請求を処理", exact: true })
    .click();
  await page
    .getByLabel("未請求の請求先")
    .selectOption({ label: "Schatz / 株式会社 Schatz" });
  await page.getByLabel("請求する月", { exact: true }).selectOption("2026-10");
  await expect(page.getByRole("checkbox", { name: /今回請求 / })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", {
      name: "選択した0件を2026年10月請求へ追加",
      exact: true,
    }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "③ 統合請求設定", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "未請求を処理", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("統合設定の請求先").selectOption("tws-parent");
  for (const c of destinations)
    await page.locator(`input[name="customer"][value="${c.id}"]`).check();
  await page.getByLabel("変更理由", { exact: true }).fill("統合設定の保存検証");
  await page
    .getByLabel("選択給液先の未請求実績と今後の請求先設定の変更を確認しました")
    .check();
  await page
    .getByRole("button", { name: "選択給液先を統合請求先へ紐付け" })
    .click();
  const before = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("fujisawa-adblue-demo-v1")!),
  );
  const schatz = before.billingInvoices.find(
    (i: any) => i.selection_mode && i.internal_name === "Schatz",
  );
  expect(schatz.month).toBe("2026-09");
  expect(schatz.net).toBe("61100");
  expect(schatz.lines.every((l: any) => l.actual_day === "2026-08-04")).toBe(
    true,
  );
  expect(
    before.billingInvoices.filter((i: any) => i.kind === "reference"),
  ).toEqual(data.billingInvoices);
  await page
    .getByRole("button", { name: "バックアップ・復元", exact: true })
    .click();
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "JSONバックアップを保存", exact: true })
    .click();
  const file = await downloadPromise;
  await page
    .getByLabel("バックアップJSONを選択")
    .setInputFiles((await file.path())!);
  await page
    .getByLabel("内容を確認し、現在のデータをバックアップの内容に置き換えます")
    .check();
  await page.getByRole("button", { name: "確認して復元", exact: true }).click();
  await expect(page.getByText(/バックアップを復元しました/)).toBeVisible();
  const restored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("fujisawa-adblue-demo-v1")!),
  );
  expect(restored.sales).toEqual(before.sales);
  expect(restored.customers).toEqual(before.customers);
  expect(restored.sites).toEqual(before.sites);
  expect(restored.billingInvoices).toEqual(before.billingInvoices);
  await page.reload();
  await page
    .getByRole("button", { name: "ローカル業務を開く", exact: true })
    .click();
  await page
    .getByRole("button", { name: "請求前チェック・請求書", exact: true })
    .click();
  await page.getByLabel("請求チェック対象月").fill("2026-10");
  await page
    .getByRole("button", { name: "② 未請求を処理", exact: true })
    .click();
  await page
    .getByLabel("未請求の請求先")
    .selectOption({ label: "Schatz / 株式会社 Schatz" });
  await expect(page.getByRole("checkbox", { name: /今回請求 / })).toHaveCount(
    0,
  );
  await page
    .getByText("請求書確定済み・履歴を確認する", { exact: true })
    .click();
  await expect(page.getByText(new RegExp(schatz.id)).first()).toBeVisible();
});

for (const sample of [
  { payer: "G.TRES", expected: ["遮光カバー", "4,598", "1,180,539"] },
  { payer: "関東総合設備", expected: ["AdBlue BIB", "10BIB", "38,500"] },
  { payer: "石田電設", expected: ["IBCタンク", "無償貸与", "99,000"] },
])
  test(`normal invoice preview preserves original product details for ${sample.payer}`, async ({
    page,
  }) => {
    const { data } = augustWithSeptember(),
      p = data.billingParties!.find((p) => p.internal_name === sample.payer)!;
    // An isolated pre-issue fixture; production original reference records are never removed.
    data.billingInvoices = data.billingInvoices!.filter(
      (i) => i.billing_party_id !== p.id,
    );
    data.sales = data.sales!.map((s) =>
      s.billing_party_id === p.id
        ? { ...s, billing_status: "unbilled", billed_at: null, billed_by: null }
        : s,
    );
    data.billingItems = data.billingItems!.map((i) =>
      i.billing_party_id === p.id ? { ...i, status: "unbilled" } : i,
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
      .getByRole("button", {
        name: "請求先を選択 " + sample.payer,
        exact: true,
      })
      .click();
    await page.getByLabel("通常請求の明細・金額・日付を確認しました").check();
    await page
      .getByRole("button", { name: "請求書プレビューへ", exact: true })
      .click();
    for (const expected of sample.expected)
      await expect(page.locator(".invoice-page")).toContainText(expected);
    await page
      .getByLabel("この請求書の明細・数量・金額・税額を確認しました")
      .check();
    await page
      .getByRole("button", { name: "この請求書を確定", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "この請求書を確定", exact: true }),
    ).toHaveCount(0);
  });
