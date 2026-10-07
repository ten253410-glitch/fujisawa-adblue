"use client";
import { useState } from "react";
import type { Data } from "@/lib/domain";
import type { LocalCommit } from "./local-business";
import {
  unassignedLines,
  createMonthlyInvoices,
  monthlyInvoiceLines,
  pendingInfo,
  sourceBillingMonth,
  monthLabel,
  normalIssued,
  deliveryKey,
} from "@/lib/billing-plan";
import { lineParty, monthRule, taxAmounts } from "@/lib/billing";
import { billingPeriod, billingDates } from "@/lib/billing-accounts";
import { sumDecimal, formatDecimal } from "@/lib/local-flow";
import SelectedInvoiceView from "./selected-invoice-view";
export default function InvoiceWizard({
  data,
  actor,
  commit,
  month,
  onUnpaid,
  onSettings,
  onManage,
}: {
  data: Data;
  actor: string;
  commit: LocalCommit;
  month: string;
  onUnpaid: () => void;
  onSettings: () => void;
  onManage: (payer: string) => void;
}) {
  const [step, setStep] = useState<"payer" | "details" | "preview">("payer"),
    [payer, setPayer] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [mode, setMode] = useState<"unified" | "destination">("unified"),
    [approved, setApproved] = useState(false),
    [previewIds, setPreviewIds] = useState<string[]>([]),
    [search, setSearch] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const party = data.billingParties?.find((p) => p.id === payer),
    period = party ? billingPeriod(month, party) : null,
    rule = monthRule(data, month);
  const current = (id: string) => monthlyInvoiceLines(data, month, id);
  const lines = party ? current(payer) : [],
    picked = lines.filter((l) => selected.includes(l.source_id)),
    old = unassignedLines(data, payer).filter(
      (l) =>
        sourceBillingMonth(data, l) <= month &&
        !lines.some((candidate) => candidate.source_id === l.source_id),
    );
  const net = sumDecimal(picked.map((l) => l.amount || "0"));
  const totals = rule
    ? mode === "unified"
      ? taxAmounts(net, rule)
      : {
          tax: sumDecimal(
            [...new Set(picked.map((l) => deliveryKey(data, l)))].map(
              (key) =>
                taxAmounts(
                  sumDecimal(
                    picked
                      .filter((l) => deliveryKey(data, l) === key)
                      .map((l) => l.amount || "0"),
                  ),
                  rule,
                ).tax,
            ),
          ),
          gross: "",
        }
    : null;
  const invoices = (data.billingInvoices || []).filter(
    (i) => i.month === month && i.billing_party_id === payer,
  );
  async function save(fn: () => Data, action: string, id: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = fn();
      await commit(
        next,
        "billing_invoice",
        id,
        action,
        JSON.stringify({
          month,
          payer,
          selected,
          mode,
          before: data.billingInvoices?.find((i) => i.id === id) || null,
          after: next.billingInvoices?.find((i) => i.id === id) || null,
          invoices: next.billingInvoices?.filter(
            (i) => !data.billingInvoices?.some((old) => old.id === i.id),
          ),
          sales: next.sales?.filter(
            (s) =>
              JSON.stringify(s) !==
              JSON.stringify(data.sales?.find((old) => old.id === s.id)),
          ),
          items: next.billingItems?.filter(
            (s) =>
              JSON.stringify(s) !==
              JSON.stringify(data.billingItems?.find((old) => old.id === s.id)),
          ),
        }),
      );
      setNotice("保存しました");
      if (action === "CREATE_SELECTED_INVOICES") {
        setPreviewIds(
          (next.billingInvoices || [])
            .filter(
              (i) => !data.billingInvoices?.some((old) => old.id === i.id),
            )
            .map((i) => i.id),
        );
        setStep("preview");
        setApproved(false);
      }
      return next;
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存できません");
    } finally {
      setBusy(false);
    }
  }
  function choose(id: string) {
    setPayer(id);
    setSelected(current(id).map((l) => l.source_id));
    setApproved(false);
    setError("");
    setNotice("");
    setStep("details");
  }
  return (
    <>
      <div className="no-print">
        <h2>請求書を作る</h2>
        <ol className="billing-steps" aria-label="請求書作成の手順">
          <li>対象月：{month}</li>
          <li aria-current={step === "payer" ? "step" : undefined}>
            1. 請求先を選択
          </li>
          <li aria-current={step === "details" ? "step" : undefined}>
            2. 明細・金額確認
          </li>
          <li aria-current={step === "preview" ? "step" : undefined}>
            3. プレビュー・確定・印刷
          </li>
        </ol>
        {error && (
          <p role="alert" className="alert error">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
      </div>
      {step === "payer" && (
        <section className="panel no-print">
          <h3>{month}の請求先を選んでください</h3>
          <label className="field">
            請求先を検索
            <input value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>請求先</th>
                  <th>未請求の給液量</th>
                  <th>税抜請求予定額</th>
                  <th>明細件数</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {data.billingParties
                  ?.filter(
                    (p) =>
                      p.active &&
                      (p.internal_name + p.formal_name).includes(search),
                  )
                  .map((p) => {
                    const ls = current(p.id);
                    return (
                      <tr key={p.id}>
                        <td>
                          {p.internal_name}
                          <small>{p.formal_name}</small>
                        </td>
                        <td>{sumDecimal(ls.map((l) => l.liters))} L</td>
                        <td>
                          {formatDecimal(
                            sumDecimal(ls.map((l) => l.amount || "0")),
                          )}
                          円
                        </td>
                        <td>
                          {ls.length}件
                          {normalIssued(data, month, p.id).length > 0 && (
                            <small>
                              {monthLabel(month)}の通常請求は発行済み
                            </small>
                          )}
                        </td>
                        <td>
                          <button
                            aria-label={"請求先を選択 " + p.internal_name}
                            onClick={() => choose(p.id)}
                          >
                            選択
                          </button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <p className="hint">
            この請求月の通常明細と、②でこの月へ追加済みの明細の予定額です。未処理の請求漏れは混在させません。
          </p>
        </section>
      )}
      {step === "details" && party && (
        <section className="panel no-print">
          <div className="billing-actions">
            <button className="secondary" onClick={() => setStep("payer")}>
              請求先を選び直す
            </button>
          </div>
          <h3>
            {party.internal_name} ／ {party.formal_name}
          </h3>
          <p>
            対象期間 {period?.start} ～ {period?.end} ／ 請求日{" "}
            {billingDates(month, party).issued_on} ／ 支払期限{" "}
            {billingDates(month, party).due_on}
          </p>
          {normalIssued(data, month, payer).length > 0 && (
            <p className="alert">
              {monthLabel(month)}
              の通常請求は発行済みです。既発行の内容は変更しません。
            </p>
          )}
          {old.length > 0 && (
            <div className="alert">
              <strong>未処理の請求漏れがあります</strong>
              <p>{old.length}件。②で請求する月へ送ってください。</p>
              <button onClick={onUnpaid}>未請求を処理へ</button>
            </div>
          )}
          {lines.length === 0 ? (
            <p>
              この対象月に未請求の通常明細はありません。保存済み請求書は下から確認できます。
            </p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    {[
                      "算入",
                      "給液日",
                      "給液先／場所・商品",
                      "数量",
                      "固定単価",
                      "税抜金額",
                    ].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.source_id}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={
                            "通常請求明細 " + l.destination + " " + l.actual_day
                          }
                          checked={selected.includes(l.source_id)}
                          onChange={(e) => {
                            setSelected(
                              e.target.checked
                                ? [...selected, l.source_id]
                                : selected.filter((id) => id !== l.source_id),
                            );
                            setApproved(false);
                          }}
                        />
                      </td>
                      <td>
                        {l.actual_day}
                        {pendingInfo(data, l).assigned_month === month && (
                          <small>
                            {monthLabel(sourceBillingMonth(data, l))}未請求分
                          </small>
                        )}
                      </td>
                      <td>
                        {
                          data.customers.find((c) => c.id === l.customer_id)
                            ?.name
                        }
                        <br />
                        {l.destination}
                        <small>{l.product}</small>
                      </td>
                      <td>
                        {l.quantity}
                        {l.unit}（{l.liters} L）
                      </td>
                      <td>{l.kind === "loan" ? "無償" : l.price}</td>
                      <td>{formatDecimal(l.amount || "0")}円</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <label className="field">
            請求のまとめ方
            <select
              aria-label="通常請求のまとめ方"
              value={mode}
              onChange={(e) => {
                setMode(e.target.value as typeof mode);
                setApproved(false);
              }}
            >
              <option value="unified">請求先単位で統合</option>
              <option value="destination">給液先別に請求</option>
            </select>
          </label>
          <div className="billing-summary">
            <strong>数量 {sumDecimal(picked.map((l) => l.liters))} L</strong>
            <strong>税抜 {formatDecimal(net)}円</strong>
            <strong>
              消費税 {totals ? formatDecimal(totals.tax) + "円" : "未設定"}
            </strong>
            <strong>
              税込{" "}
              {totals
                ? formatDecimal(sumDecimal([net, totals.tax])) + "円"
                : "未設定"}
            </strong>
          </div>
          {mode === "destination" && (
            <p>消費税は給液先別の請求書ごとに計算しています。</p>
          )}
          {!rule && (
            <div className="alert">
              この月の税・端数設定を確認して保存してください。
              <button onClick={onSettings}>税・請求書設定へ</button>
            </div>
          )}
          <label>
            <input
              type="checkbox"
              checked={approved}
              onChange={(e) => setApproved(e.target.checked)}
            />
            通常請求の明細・金額・日付を確認しました
          </label>
          <div className="billing-actions">
            <button
              disabled={busy || !approved || !selected.length || !rule}
              onClick={() =>
                void save(
                  () =>
                    createMonthlyInvoices(
                      data,
                      month,
                      payer,
                      selected,
                      mode,
                      actor,
                    ),
                  "CREATE_SELECTED_INVOICES",
                  payer,
                )
              }
            >
              請求書プレビューへ
            </button>
          </div>
          {invoices.length > 0 && (
            <details>
              <summary>
                この請求先の保存済み請求書を確認する（{invoices.length}枚）
              </summary>
              {invoices.map((i) => (
                <button
                  key={i.id}
                  onClick={() => {
                    setPreviewIds([i.id]);
                    setStep("preview");
                  }}
                >
                  {i.subject} ／ {i.net}円 ／{" "}
                  {i.status === "draft"
                    ? "未確定"
                    : i.status === "issued"
                      ? "確定済み"
                      : "取消・旧版"}
                </button>
              ))}
            </details>
          )}
        </section>
      )}
      {step === "preview" && (
        <>
          <div className="billing-actions no-print">
            <button
              className="secondary"
              onClick={() => {
                setStep("details");
                setApproved(false);
              }}
            >
              明細確認へ戻る
            </button>
            <button
              className="secondary"
              onClick={() => {
                setStep("payer");
                setSelected([]);
              }}
            >
              別の請求先を選択
            </button>
          </div>
          <SelectedInvoiceView
            data={data}
            actor={actor}
            invoices={invoices.filter((i) => previewIds.includes(i.id))}
            busy={busy}
            save={save}
            onManage={() => onManage(payer)}
          />
        </>
      )}
    </>
  );
}
