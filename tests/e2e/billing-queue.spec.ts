import { test, expect, type Page } from "@playwright/test";
import { augustWithSeptember } from "../billing-test-fixture";
import { registerHistory } from "../../lib/history-import";
import { japanDate } from "../../lib/domain";
async function open(page: Page, normal = false) {
  let { data } = augustWithSeptember();
  if (normal) {
    const customer = data.customers.find((c) => c.name === "EG八王子")!,
      site = data.sites!.find((s) => s.customer_id === customer.id)!;
    data = registerHistory(
      data,
      [
        {
          row: 1,
          day: "2026-09-15",
          customer: customer.name,
          site: site.name,
          address: "",
          quantity: "100",
          price: "65",
          amount: "",
          operator: "土屋",
          slip: "SEPT-REGULAR",
          notes: "9月通常実績",
          customerId: customer.id,
          siteId: site.id,
          newCustomer: false,
          newSite: false,
          include: true,
          useSourceAmount: false,
          duplicateApproved: false,
          approved: true,
        },
      ],
      "9月通常.csv",
      "CSV",
      "土屋",
    );
  }
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
  return data;
}
async function selectOmissions(page: Page) {
  await page
    .getByRole("button", { name: "② 未請求を処理", exact: true })
    .click();
  await page
    .getByLabel("未請求の請求先")
    .selectOption({ label: "Schatz / 株式会社 Schatz" });
  await page
    .getByRole("checkbox", { name: /今回請求 EG八王子 2026-08-04/ })
    .check();
  await page
    .getByRole("checkbox", {
      name: /今回請求 デイライン西東京営業所 2026-08-04/,
    })
    .check();
}
test("August exclusions, batch September assignment, queue backup, combined normal invoice and no October duplicate", async ({
  page,
}) => {
  const original = await open(page, true);
  await page
    .getByRole("button", { name: "請求先を選択 Schatz", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: /通常請求明細 / }),
  ).toHaveCount(0);
  await expect(
    page.getByText(
      "2026年8月の通常請求は発行済みです。既発行の内容は変更しません。",
      { exact: true },
    ),
  ).toBeVisible();
  await selectOmissions(page);
  await expect(page.getByLabel("未請求の処理内容")).toContainText("940 L");
  await expect(page.getByLabel("未請求の処理内容")).toContainText("61,100");
  await page.getByLabel("請求する月", { exact: true }).selectOption("2026-09");
  await page.getByLabel("未請求理由（一括・任意）").fill("8月請求漏れ");
  await page
    .getByRole("button", {
      name: "選択した2件を2026年9月請求へ追加",
      exact: true,
    })
    .click();
  const queued = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("fujisawa-adblue-demo-v1")!),
  );
  expect(queued.billingInvoices).toEqual(original.billingInvoices);
  const rows = queued.sales.filter(
    (s: any) => s.pending_billing?.assigned_month === "2026-09",
  );
  expect(rows).toHaveLength(2);
  expect(
    rows.reduce((sum: number, s: any) => sum + Number(s.net_amount), 0),
  ).toBe(61100);
  expect(
    rows.every(
      (s: any) =>
        s.delivered_on === "2026-08-04" &&
        s.unit_price_excl_tax === "65" &&
        s.pending_billing.original_month === "2026-08" &&
        s.pending_billing.discovered_on === japanDate() &&
        s.pending_billing.reason === "8月請求漏れ",
    ),
  ).toBe(true);
  expect(rows.every((s: any) => s.pending_billing.invoice_id === null)).toBe(
    true,
  );
  await page.getByLabel("請求する月", { exact: true }).selectOption("2026-10");
  await expect(
    page.getByRole("checkbox", { name: /今回請求 .*2026-08-04/ }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "バックアップ・復元", exact: true })
    .click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "JSONバックアップを保存", exact: true })
    .click();
  const file = await download;
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
  expect(restored.sales).toEqual(queued.sales);
  expect(restored.billingInvoices).toEqual(original.billingInvoices);
  await page
    .getByRole("button", { name: "請求前チェック・請求書", exact: true })
    .click();
  await page
    .getByRole("button", { name: "請求先を選択 Schatz", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: /通常請求明細 / }),
  ).toHaveCount(0);
  await page.getByLabel("請求チェック対象月").fill("2026-09");
  await page
    .getByRole("button", { name: "請求先を選択 Schatz", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: /通常請求明細 / }),
  ).toHaveCount(3);
  await expect(
    page.getByText("2026年8月未請求分", { exact: true }),
  ).toHaveCount(2);
  await page.getByLabel("通常請求の明細・金額・日付を確認しました").check();
  await page
    .getByRole("button", { name: "請求書プレビューへ", exact: true })
    .click();
  await expect(page.locator(".invoice-page")).toContainText("67,600");
  await expect(page.locator(".invoice-page")).toContainText("2026-08-04");
  await page
    .getByLabel("この請求書の明細・数量・金額・税額を確認しました")
    .check();
  await page
    .getByRole("button", { name: "この請求書を確定", exact: true })
    .click();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("fujisawa-adblue-demo-v1")!),
  );
  const invoice = saved.billingInvoices.at(-1);
  expect(invoice.lines).toHaveLength(3);
  expect(new Set(invoice.lines.map((l: any) => l.source_id)).size).toBe(3);
  expect(invoice.status).toBe("issued");
  expect(
    saved.billingInvoices.filter((i: any) => i.kind === "reference"),
  ).toEqual(original.billingInvoices);
  expect(
    saved.sales
      .filter((s: any) => s.pending_billing?.assigned_month === "2026-09")
      .every((s: any) => s.pending_billing.invoice_id === invoice.id),
  ).toBe(true);
  await expect(page.getByLabel("解除理由", { exact: true })).toHaveCount(0);
  await page
    .getByRole("button", { name: "確定後の変更は管理画面で行う", exact: true })
    .click();
  await expect(page.getByLabel("確定解除理由", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "② 未請求を処理", exact: true })
    .click();
  await page
    .getByLabel("未請求の請求先")
    .selectOption({ label: "Schatz / 株式会社 Schatz" });
  await expect(page.getByRole("checkbox", { name: /今回請求 / })).toHaveCount(
    0,
  );
  await page.getByLabel("請求する月", { exact: true }).selectOption("2026-10");
  await expect(
    page.getByRole("button", {
      name: "選択した0件を2026年10月請求へ追加",
      exact: true,
    }),
  ).toBeDisabled();
  await page
    .getByText("請求書確定済み・履歴を確認する", { exact: true })
    .click();
  await expect(page.getByText(new RegExp(invoice.id)).first()).toBeVisible();
});
test("queued omissions can be cancelled individually and sent to a different later month with history", async ({
  page,
}) => {
  const original = await open(page);
  await selectOmissions(page);
  await page.getByLabel("請求する月", { exact: true }).selectOption("2026-09");
  await page
    .getByRole("button", {
      name: "選択した2件を2026年9月請求へ追加",
      exact: true,
    })
    .click();
  const queued = page
    .locator("details")
    .filter({ has: page.locator("summary").filter({ hasText: "EG八王子" }) })
    .first();
  await queued.locator("summary").click();
  await queued.getByLabel("追加取消理由").fill("10月請求へ変更");
  await queued
    .getByRole("button", { name: "請求月への追加を取り消す", exact: true })
    .click();
  await expect(page.getByRole("checkbox", { name: /今回請求 / })).toHaveCount(
    1,
  );
  await page.getByRole("checkbox", { name: /今回請求 EG八王子 / }).check();
  await page.getByLabel("請求する月", { exact: true }).selectOption("2026-10");
  await page
    .getByRole("button", {
      name: "選択した1件を2026年10月請求へ追加",
      exact: true,
    })
    .click();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("fujisawa-adblue-demo-v1")!),
  );
  const eg = saved.sales.find(
    (s: any) => s.pending_billing?.assigned_month === "2026-10",
  );
  expect(
    eg.pending_billing.assignment_history.map((h: any) => h.action),
  ).toEqual(["assign", "cancel", "assign"]);
  expect(eg.delivered_on).toBe("2026-08-04");
  expect(eg.net_amount).toBe("48100");
  expect(saved.billingInvoices).toEqual(original.billingInvoices);
});
