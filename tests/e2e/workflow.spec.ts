import { test, expect } from "@playwright/test";
test("customer, prices, LINE order, schedule, reply, image and persistence", async ({
  page,
  context,
}, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: "デモを開く" }).click();
  await expect(
    page.getByRole("heading", { name: "おはようございます、土屋さん" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "顧客検索" }).click();
  await page.getByRole("button", { name: "顧客を追加" }).click();
  await page.getByLabel("顧客名 *", { exact: true }).fill("テスト運輸");
  await page.getByLabel("会社住所").fill("藤沢車庫");
  await page.getByRole("button", { name: "顧客を保存", exact: true }).click();
  await page.getByLabel("単価（円） *").fill("110");
  await page.getByLabel("適用開始日 *").fill("2020-01-01");
  await page.getByRole("button", { name: "単価履歴を追加" }).click();
  await expect(page.getByText("110 円 / L")).toBeVisible();
  await page.getByLabel("単価（円） *").fill("120");
  await page.getByLabel("適用開始日 *").fill("2020-01-01");
  await page.getByRole("button", { name: "単価履歴を追加" }).click();
  await expect(page.getByText("120 円 / L")).toBeVisible();
  await expect(page.getByText("110 円 / L")).toBeVisible();
  await page
    .locator("button:visible")
    .filter({ hasText: /^ホーム$/ })
    .first()
    .click();
  await page.getByRole("button", { name: "LINE受注取込" }).click();
  await page
    .getByLabel("LINE本文", { exact: true })
    .fill("AdBlue 250Lお願いします");
  await page.getByRole("button", { name: "数量候補を取り込む" }).click();
  await expect(page.getByLabel("依頼数量", { exact: true })).toHaveValue("250");
  await page
    .getByLabel("顧客 *", { exact: true })
    .selectOption({ label: "テスト運輸" });
  await page.getByRole("button", { name: "受注を登録", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "テスト運輸", exact: true }),
  ).toBeVisible();
  await page.getByLabel("給液予定日", { exact: true }).fill("2026-10-08");
  await page.getByRole("button", { name: "日程・メモを保存" }).click();
  await expect(page.getByLabel("LINE回答文")).toContainText("2026/10/08");
  await expect(page.getByText("120 円/L（税抜）")).toBeVisible();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "回答文をコピー" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "2026/10/08",
  );
  await page.getByRole("button", { name: "撮影・追加", exact: true }).click();
  await page.getByLabel("画像を選択", { exact: true }).setInputFiles({
    name: "delivery.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      await page.evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.width = 600;
        canvas.height = 800;
        const c = canvas.getContext("2d")!;
        c.fillStyle = "white";
        c.fillRect(0, 0, 600, 800);
        c.fillStyle = "black";
        c.font = "24px sans-serif";
        c.fillText("納品書 / AdBlue 250L", 40, 80);
        return canvas.toDataURL("image/png").split(",")[1];
      }),
      "base64",
    ),
  });
  await expect(page.getByRole("status")).toContainText("納品書を保存");
  await page.getByRole("button").filter({ hasText: "delivery.png" }).click();
  await expect(
    page.getByRole("img", { name: "納品書", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "閉じる", exact: true }).click();
  await page.reload();
  await page.getByLabel("デモ利用者").selectOption("佐藤");
  await page.getByRole("button", { name: "デモを開く" }).click();
  await expect(
    page.getByRole("heading", { name: "おはようございます、佐藤さん" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "顧客検索" }).click();
  await page.getByLabel("顧客検索", { exact: true }).fill("テスト運輸");
  await expect(
    page.getByRole("button").filter({ hasText: "テスト運輸" }),
  ).toBeVisible();
  if (testInfo.project.name === "mobile")
    await page.getByRole("button", { name: "メニューを開く" }).click();
  await page.getByRole("button", { name: "変更履歴", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "変更履歴", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("土屋 · 追加", { exact: true }).first(),
  ).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
});
test("phone order permits unknown quantity and date", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "デモを開く" }).click();
  await page
    .getByRole("button", { name: "電話受注", exact: false })
    .first()
    .click();
  await page
    .getByLabel("顧客 *", { exact: true })
    .selectOption({ label: "湘南運送（サンプル）" });
  await page.getByRole("button", { name: "受注を登録", exact: true }).click();
  await expect(page.getByText("未定", { exact: true })).toBeVisible();
  await expect(
    page.getByText("給液予定日を設定すると回答文を作成します。"),
  ).toBeVisible();
});
