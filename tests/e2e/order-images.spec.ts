import { test, expect, type Page } from "@playwright/test";
async function image(page: Page) {
  return Buffer.from(
    await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 650;
      c.height = 900;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, 650, 900);
      ctx.fillStyle = "black";
      ctx.font = "24px sans-serif";
      ctx.fillText("FAX 受注書 / 湘南運送 200L", 30, 60);
      return c.toDataURL("image/png").split(",")[1];
    }),
    "base64",
  );
}
test("image candidates require customer choice and human confirmation, keep hope date separate", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "デモを開く" }).click();
  await page
    .getByRole("button", { name: "受注画像取込", exact: false })
    .first()
    .click();
  await page.getByLabel("受注画像を選択", { exact: true }).setInputFiles({
    name: "fax.png",
    mimeType: "image/png",
    buffer: await image(page),
  });
  await expect(
    page.getByRole("button", { name: "AIで画像を読み取る" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "サンプル候補で確認画面を試す" })
    .click();
  await expect(
    page.getByText("サンプル候補：実画像の読取ではありません"),
  ).toBeVisible();
  await expect(page.getByLabel("登録先の顧客", { exact: true })).toHaveValue(
    "",
  );
  await expect(
    page.getByRole("button", { name: "確認した内容で受注登録" }),
  ).toBeDisabled();
  await page
    .getByRole("button")
    .filter({ hasText: "湘南運送（サンプル）" })
    .click();
  await expect(page.getByText("照合先：湘南運送（サンプル）")).toBeVisible();
  await page.getByLabel("依頼数量（L・未定なら空欄）").fill("250");
  await page.getByLabel("希望給液日", { exact: true }).fill("2026-10-08");
  await page
    .getByLabel(
      "原画像・登録先顧客・数量・日付を確認し、修正後の内容で登録します",
    )
    .check();
  await page.getByLabel("住所", { exact: true }).fill("藤沢市確認済み住所");
  await expect(
    page.getByRole("button", { name: "確認した内容で受注登録" }),
  ).toBeDisabled();
  await page
    .getByLabel(
      "原画像・登録先顧客・数量・日付を確認し、修正後の内容で登録します",
    )
    .check();
  await page.getByRole("button", { name: "確認した内容で受注登録" }).click();
  await expect(
    page.getByRole("heading", { name: "湘南運送（サンプル）" }),
  ).toBeVisible();
  await expect(page.getByText("250 L", { exact: true })).toBeVisible();
  await expect(page.getByText("2026/10/08（予定は別途調整）")).toBeVisible();
  await expect(page.getByLabel("給液予定日", { exact: true })).toHaveValue("");
  await expect(
    page.getByText("藤沢市確認済み住所", { exact: true }),
  ).toBeVisible();
  await page.getByText("受注原画像と確認記録：fax.png").click();
  await expect(page.getByText("読取候補（登録前）")).toBeVisible();
  await page.getByRole("button", { name: "受注原画像を表示" }).click();
  await expect(
    page.getByRole("img", { name: "受注原画像", exact: true }),
  ).toBeVisible();
});
test("API error keeps image and enables manual entry; new customer registered only on confirmation", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "デモを開く" }).click();
  await page
    .getByRole("button", { name: "受注画像取込", exact: false })
    .first()
    .click();
  await page.getByLabel("受注画像を選択", { exact: true }).setInputFiles({
    name: "paper.png",
    mimeType: "image/png",
    buffer: await image(page),
  });
  await page.route("**/api/order-ocr", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "AI読み取りは未設定です。" }),
    }),
  );
  await page
    .getByLabel(
      "この受注画像をOpenAIへ送信して読み取る（利用料金が発生します）",
    )
    .check();
  await page.getByRole("button", { name: "AIで画像を読み取る" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "AI読み取りは未設定" }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "取り込んだ受注原画像" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "手入力で確認へ" }).click();
  await page.getByLabel("読み取り顧客名 *").fill("新規画像顧客");
  await page.getByLabel("新規顧客として追加する（単価は登録しません）").check();
  await page.getByLabel("受注日 *", { exact: true }).fill("2026-10-06");
  await page
    .getByLabel(
      "原画像・登録先顧客・数量・日付を確認し、修正後の内容で登録します",
    )
    .check();
  await page.getByRole("button", { name: "確認した内容で受注登録" }).click();
  await expect(
    page.getByRole("heading", { name: "新規画像顧客" }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "デモを開く" }).click();
  await page
    .getByRole("button", { name: "顧客検索", exact: false })
    .first()
    .click();
  await expect(
    page.getByRole("button").filter({ hasText: "新規画像顧客" }),
  ).toBeVisible();
});
test("AI response populates all read fields but never registers or selects a customer", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "デモを開く" }).click();
  await page
    .getByRole("button", { name: "受注画像取込", exact: false })
    .first()
    .click();
  await page
    .getByLabel("受注画像を選択", { exact: true })
    .setInputFiles({
      name: "line.png",
      mimeType: "image/png",
      buffer: await image(page),
    });
  await page.route("**/api/order-ocr", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        fields: {
          customer_name: "湘南運送",
          location: "第一現場",
          address: "藤沢市テスト住所",
          quantity_l: 123.5,
          requested_on: "2026-10-08",
          received_on: "2026-10-06",
          contact: "0466-00-0001",
          notes: "入口で連絡",
        },
        warnings: ["原画像で確認"],
        model: "mock-model",
        method: "openai",
      }),
    }),
  );
  await page
    .getByLabel(
      "この受注画像をOpenAIへ送信して読み取る（利用料金が発生します）",
    )
    .check();
  await page.getByRole("button", { name: "AIで画像を読み取る" }).click();
  await expect(page.getByLabel("読み取り顧客名 *")).toHaveValue("湘南運送");
  await expect(page.getByLabel("給液場所／現場名")).toHaveValue("第一現場");
  await expect(page.getByLabel("住所", { exact: true })).toHaveValue(
    "藤沢市テスト住所",
  );
  await expect(page.getByLabel("依頼数量（L・未定なら空欄）")).toHaveValue(
    "123.5",
  );
  await expect(page.getByLabel("希望給液日", { exact: true })).toHaveValue(
    "2026-10-08",
  );
  await expect(page.getByLabel("受注日 *", { exact: true })).toHaveValue(
    "2026-10-06",
  );
  await expect(page.getByLabel("電話番号等の連絡先")).toHaveValue(
    "0466-00-0001",
  );
  await expect(page.getByLabel("備考", { exact: true })).toHaveValue(
    "入口で連絡",
  );
  await expect(page.getByLabel("登録先の顧客", { exact: true })).toHaveValue(
    "",
  );
  await expect(
    page.getByRole("button", { name: "確認した内容で受注登録" }),
  ).toBeDisabled();
  expect(
    await page.evaluate(() => localStorage.getItem("fujisawa-adblue-demo-v1")),
  ).toBeNull();
});
