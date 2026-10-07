"use client";
import { useState } from "react";
import type { Data } from "@/lib/domain";
import type { BillingInvoice } from "@/lib/billing";
import { cancelBillingDraft, confirmBillingInvoice } from "@/lib/billing";

import { formatDecimal } from "@/lib/local-flow";
export default function SelectedInvoiceView({
  data,
  actor,
  invoices,
  busy,
  save,
  onManage,
}: {
  data: Data;
  actor: string;
  invoices: BillingInvoice[];
  busy: boolean;
  save: (fn: () => Data, action: string, id: string) => Promise<unknown>;
  onManage?: () => void;
}) {
  const [printId, setPrintId] = useState("");
  return (
    <>
      {invoices.map((i) => (
        <div
          key={i.id}
          className={printId && printId !== i.id ? "no-print" : ""}
        >
          <article className="panel invoice-page">
            <h2>
              {i.kind === "reference" ? "既発行請求書の照合記録" : "請求書"}{" "}
              {i.status === "draft"
                ? "（未確定）"
                : i.status === "cancelled"
                  ? "（取消・旧版）"
                  : ""}
            </h2>
            <p>{i.party_address}</p>
            <h3>{i.party_name} 御中</h3>
            <p>
              請求対象月 {i.month} ／ {i.subject}
            </p>
            <p>
              請求日 {i.issued_on} ／ 支払期限 {i.due_on}
            </p>
            <p>
              振込先 {i.bank} ／ 登録番号 {i.registration}
            </p>
            <table>
              <thead>
                <tr>
                  {[
                    i.kind === "reference" ? "原本記載日" : "実給液日",
                    "給液先／場所",
                    "数量",
                    "単価",
                    "税抜金額",
                    "備考",
                  ].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {i.lines.map((l) => (
                  <tr key={l.source_id}>
                    <td>{i.kind === "reference" ? l.day : l.actual_day}</td>
                    <td>
                      {data.customers.find((c) => c.id === l.customer_id)?.name}
                      <br />
                      {l.destination}
                      <small>
                        {l.product}
                        {l.kind === "loan" ? "（無償貸与）" : ""}
                      </small>
                    </td>
                    <td>
                      {l.quantity}
                      {l.unit}
                    </td>
                    <td>{l.kind === "loan" ? "無償" : l.price}</td>
                    <td>
                      {l.amount === null
                        ? "空欄（原本通り）"
                        : formatDecimal(l.amount)}
                    </td>
                    <td>{l.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              税抜合計 {formatDecimal(i.net)}円 ／ 消費税 {formatDecimal(i.tax)}
              円 ／ 税込請求額 {formatDecimal(i.gross)}円
            </p>
            <p>
              合計数量 {i.quantity} L ／ 請求書ID {i.id}
            </p>
          </article>
          <div className="no-print">
            {i.status === "draft" && (
              <>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (new FormData(e.currentTarget).get("checked") === "on")
                      void save(
                        () => confirmBillingInvoice(data, i.id, actor),
                        "CONFIRM_SELECTED_INVOICE",
                        i.id,
                      );
                  }}
                >
                  <label>
                    <input type="checkbox" name="checked" required />
                    この請求書の明細・数量・金額・税額を確認しました
                  </label>
                  <button disabled={busy}>この請求書を確定</button>
                </form>
                <button
                  disabled={busy}
                  onClick={() =>
                    void save(
                      () => cancelBillingDraft(data, i.id),
                      "CANCEL_DRAFT",
                      i.id,
                    )
                  }
                >
                  下書き取消（選択し直す）
                </button>
              </>
            )}
            {i.status === "issued" && i.kind !== "reference" && (
              <p>
                請求書確定済み。確定後の変更は管理画面で行います。
                {onManage && (
                  <button className="secondary" onClick={onManage}>
                    確定後の変更は管理画面で行う
                  </button>
                )}
              </p>
            )}
            <button
              onClick={() => {
                setPrintId(i.id);
                setTimeout(() => window.print(), 100);
              }}
            >
              この請求書を印刷・PDF保存
            </button>
          </div>
        </div>
      ))}
    </>
  );
}
