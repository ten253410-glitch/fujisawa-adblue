"use client";
import { useState } from "react";
import type { Data } from "@/lib/domain";
import { currentPrice, japanDate } from "@/lib/domain";
import { accountTerms } from "@/lib/billing-accounts";
import type { BillingParty } from "@/lib/billing";
export function AccountFields({ party }: { party?: BillingParty }) {
  const t = party
    ? accountTerms(party)
    : {
        closing_day: 31,
        invoice_day: 1,
        payment_month_offset: 1,
        payment_day: 31,
      };
  return (
    <div className="form-grid">
      <label className="field">
        請求先担当者
        <input name="account_contact" defaultValue={party?.contact || ""} />
      </label>
      <label className="field">
        請求条件・メモ
        <input name="conditions" defaultValue={party?.conditions || ""} />
      </label>
      <label className="field">
        締日（31＝月末）
        <input
          name="closing_day"
          type="number"
          min="1"
          max="31"
          defaultValue={t.closing_day}
          required
        />
      </label>
      <label className="field">
        請求日（翌月の日）
        <input
          name="invoice_day"
          type="number"
          min="1"
          max="31"
          defaultValue={t.invoice_day}
          required
        />
      </label>
      <label className="field">
        支払期限（月数・翌月＝1）
        <input
          name="payment_month_offset"
          type="number"
          min="1"
          max="12"
          defaultValue={t.payment_month_offset}
          required
        />
      </label>
      <label className="field">
        支払期限日（31＝月末）
        <input
          name="payment_day"
          type="number"
          min="1"
          max="31"
          defaultValue={t.payment_day}
          required
        />
      </label>
    </div>
  );
}
export function readAccountFields(f: FormData) {
  return {
    contact: String(f.get("account_contact") || "").trim(),
    conditions: String(f.get("conditions") || "").trim(),
    terms: {
      closing_day: Number(f.get("closing_day")),
      invoice_day: Number(f.get("invoice_day")),
      payment_month_offset: Number(f.get("payment_month_offset")),
      payment_day: Number(f.get("payment_day")),
    },
  };
}
export default function AccountDirectory({
  data,
  open,
}: {
  data: Data;
  open: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const parties = data.billingParties || [];
  function members(p: string) {
    return data.customers.filter(
      (c) =>
        c.billing_party_id === p ||
        data.sites?.some(
          (s) => s.customer_id === c.id && s.billing_party_id === p,
        ),
    );
  }
  const unassigned = data.customers.filter(
    (c) =>
      !c.billing_party_id &&
      !data.sites?.some((s) => s.customer_id === c.id && s.billing_party_id),
  );
  return (
    <section className="panel">
      <h2>請求先一覧 → 配下の給液先</h2>
      <p>
        請求先と給液先は別のIDで管理します。既存の給液先・単価履歴・案件IDは維持しています。
      </p>
      <label className="field">
        請求先・給液先から検索
        <input
          aria-label="請求先・給液先から検索"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {parties
        .filter((p) =>
          `${p.internal_name} ${p.formal_name} ${members(p.id)
            .map((c) => c.name)
            .join(" ")}`.includes(query),
        )
        .map((p) => (
          <details key={p.id}>
            <summary>
              {p.internal_name} → {p.formal_name}（給液先{members(p.id).length}
              件）
            </summary>
            <p>
              {p.address || "住所未設定"} / 担当：{p.contact || "未設定"} /{" "}
              {p.conditions || "標準請求条件"}
            </p>
            {members(p.id)
              .filter(
                (c) =>
                  !query ||
                  `${c.name} ${p.internal_name} ${p.formal_name}`.includes(
                    query,
                  ),
              )
              .map((c) => (
                <div className="import-row" key={c.id}>
                  <button type="button" onClick={() => open(c.id)}>
                    給液先を開く：{c.name}
                  </button>
                  <p>
                    {c.address || "住所未設定"} / {c.phone || "電話未設定"} /
                    担当{c.contact || "未設定"} / 現在単価
                    {currentPrice(data.prices, c.id, japanDate())?.amount ??
                      "未設定"}
                    円/L
                  </p>
                  <p>
                    給液場所：
                    {(data.sites || [])
                      .filter(
                        (s) =>
                          s.customer_id === c.id &&
                          (s.billing_party_id || c.billing_party_id) === p.id,
                      )
                      .map((s) => s.name)
                      .join("、") || c.name}
                  </p>
                  {(data.billingItems || [])
                    .filter(
                      (i) =>
                        i.kind === "loan" &&
                        (i.customer_id === c.id || i.destination === c.name),
                    )
                    .map((i) => (
                      <small key={i.id}>
                        貸与：{i.day} {i.product} {i.quantity}
                        {i.unit}（金額0円）
                      </small>
                    ))}
                </div>
              ))}
          </details>
        ))}
      {!!unassigned.length && (
        <details>
          <summary>請求先未設定の給液先（{unassigned.length}件）</summary>
          {unassigned
            .filter((c) => c.name.includes(query))
            .map((c) => (
              <p key={c.id}>
                <button onClick={() => open(c.id)}>
                  給液先を開く：{c.name}
                </button>
              </p>
            ))}
        </details>
      )}
      <p className="hint">
        給液先検索・選択後の詳細画面で名称、連絡先、単価履歴、場所、メモを編集できます。請求先の変更と既存実績への適用は「請求前チェック・請求書」→「請求先・紐付け」で確認します。
      </p>
    </section>
  );
}
