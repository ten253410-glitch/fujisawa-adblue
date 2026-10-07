"use client";
import { useState } from "react";
import type { Data } from "@/lib/domain";
import type { LocalCommit } from "./local-business";
import {
  unpaidLines,
  pendingInfo,
  sourceBillingMonth,
  unassignedLines,
  assignUnpaidToMonth,
  cancelMonthAssignment,
  draftForLine,
  monthLabel,
  nextBillingMonth,
  updatePending,
  consolidateDestinations,
} from "@/lib/billing-plan";
import { ledger, lineParty } from "@/lib/billing";
import { sumDecimal, formatDecimal } from "@/lib/local-flow";
export default function BillingPlanWorkspace({
  data,
  actor,
  commit,
  month,
  view,
}: {
  data: Data;
  actor: string;
  commit: LocalCommit;
  month: string;
  view: "unpaid" | "integration";
}) {
  const [payer, setPayer] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [search, setSearch] = useState(""),
    [targetMonth, setTargetMonth] = useState(() =>
      nextBillingMonth(
        unassignedLines(data)
          .map((l) => sourceBillingMonth(data, l))
          .sort()[0] || month,
      ),
    ),
    [batchReason, setBatchReason] = useState("");
  const lines = unassignedLines(data, payer),
    picked = lines.filter((l) => selected.includes(l.source_id)),
    processing = unpaidLines(data, payer).filter(
      (l) =>
        pendingInfo(data, l).assigned_month || draftForLine(data, l.source_id),
    );
  const startMonth = nextBillingMonth(
      unassignedLines(data)
        .map((l) => sourceBillingMonth(data, l))
        .sort()[0] || month,
    ),
    months = [startMonth];
  for (let i = 1; i < 36; i++) months.push(nextBillingMonth(months[i - 1]));
  if (!months.includes(targetMonth)) months.push(targetMonth);
  months.sort();
  async function save(fn: () => Data, action: string, id = payer) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = fn();
      const changes = [
        "customers",
        "sites",
        "sales",
        "billingItems",
        "billingInvoices",
      ] as const;
      const records = changes.flatMap((key) =>
        (next[key] || [])
          .filter(
            (row) =>
              JSON.stringify(row) !==
              JSON.stringify(
                (data[key] || []).find((old) => old.id === row.id),
              ),
          )
          .map((row) => ({
            entity: key,
            id: row.id,
            before: (data[key] || []).find((old) => old.id === row.id) || null,
            after: row,
          })),
      );
      await commit(
        next,
        "billing_plan",
        id,
        action,
        JSON.stringify({ month, targetMonth, payer, selected, records }),
      );
      setNotice(
        action === "ASSIGN_BILLING_MONTH"
          ? `${selected.length}件を${monthLabel(targetMonth)}請求へ追加しました。①で明細を確認して請求書を作成してください。`
          : "保存しました",
      );
      setSelected([]);
      setBatchReason("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存できません");
    } finally {
      setBusy(false);
    }
  }
  const payerField = (
    <label className="field">
      {view === "integration" ? "統合・変更後の請求先" : "請求先で絞り込み"}
      <select
        aria-label={
          view === "integration" ? "統合設定の請求先" : "未請求の請求先"
        }
        value={payer}
        onChange={(e) => {
          setPayer(e.target.value);
          setSelected([]);
        }}
      >
        <option value="">
          {view === "integration" ? "選択してください" : "すべての請求先"}
        </option>
        {data.billingParties
          ?.filter((p) => p.active)
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.internal_name} / {p.formal_name}
            </option>
          ))}
      </select>
    </label>
  );
  if (view === "integration")
    return (
      <section className="panel no-print">
        <h2>統合請求設定</h2>
        <p>
          複数給液先の請求先をまとめます。保存した設定は翌月以降も継続します。解除する場合は、個別請求先を選んで該当給液先だけを紐付け直してください。請求済み実績・原本・ID・単価履歴は保持します。
        </p>
        {error && (
          <p role="alert" className="alert error">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        {payerField}
        <label className="field">
          給液先を検索
          <input value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            if (f.get("checked") !== "on") return;
            void save(
              () =>
                consolidateDestinations(
                  data,
                  payer,
                  selected,
                  String(f.get("reason")),
                ),
              "CONSOLIDATE_DESTINATIONS",
            );
          }}
        >
          {data.customers
            .filter((c) => c.name.includes(search))
            .map((c) => (
              <label className="checkbox-row" key={c.id}>
                <input
                  type="checkbox"
                  name="customer"
                  value={c.id}
                  checked={selected.includes(c.id)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...selected, c.id]
                        : selected.filter((id) => id !== c.id),
                    )
                  }
                />
                {c.name}（現在：
                {data.billingParties?.find((p) => p.id === c.billing_party_id)
                  ?.internal_name || "未設定"}
                ）
              </label>
            ))}
          <label className="field">
            変更理由
            <input name="reason" required />
          </label>
          <label>
            <input name="checked" type="checkbox" required />
            選択給液先の未請求実績と今後の請求先設定の変更を確認しました
          </label>
          <p>選択した給液先：{selected.length}件</p>
          <button disabled={busy || !payer || !selected.length}>
            選択給液先を統合請求先へ紐付け
          </button>
        </form>
      </section>
    );
  return (
    <>
      <section className="panel no-print">
        <h2>未請求を処理</h2>
        <p>
          請求漏れの明細を、次に請求する月へ送ります。元の給液日・固定単価・本来の対象月は変更しません。請求書の作成・確定は①で行います。
        </p>
        {error && (
          <p role="alert" className="alert error">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="alert success">
            {notice}
          </p>
        )}
        {payerField}
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {[
                  "選択",
                  "実給液日",
                  "給液先／場所・商品",
                  "請求先／本来の対象月",
                  "数量／AdBlue L",
                  "固定単価",
                  "税抜金額",
                  "状態・個別編集",
                ].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const info = pendingInfo(data, l);
                return (
                  <tr key={l.source_id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={
                          "今回請求 " + l.destination + " " + l.actual_day
                        }
                        disabled={!lineParty(data, l)}
                        checked={selected.includes(l.source_id)}
                        onChange={(e) => {
                          setSelected(
                            e.target.checked
                              ? [...selected, l.source_id]
                              : selected.filter((id) => id !== l.source_id),
                          );
                          if (
                            e.target.checked &&
                            targetMonth <= sourceBillingMonth(data, l)
                          )
                            setTargetMonth(
                              nextBillingMonth(sourceBillingMonth(data, l)),
                            );
                        }}
                      />
                    </td>
                    <td>{l.actual_day}</td>
                    <td>
                      {data.customers.find((c) => c.id === l.customer_id)?.name}
                      <br />
                      {l.destination}
                      <small>{l.product}</small>
                    </td>
                    <td>
                      {data.billingParties?.find(
                        (p) => p.id === lineParty(data, l),
                      )?.internal_name || "未設定"}
                      <br />
                      {monthLabel(sourceBillingMonth(data, l))}
                    </td>
                    <td>
                      {l.quantity}
                      {l.unit}
                      <small>AdBlue換算 {l.liters} L</small>
                    </td>
                    <td>{l.price}</td>
                    <td>{formatDecimal(l.amount || "0")}円</td>
                    <td>
                      未請求
                      <details>
                        <summary>個別編集</summary>
                        <p>
                          登録日：{info.registered_at || "旧データに記録なし"}
                        </p>
                        <form
                          key={JSON.stringify(info)}
                          onSubmit={(e) => {
                            e.preventDefault();
                            const f = new FormData(e.currentTarget);
                            void save(
                              () =>
                                updatePending(data, l.source_id, {
                                  ...info,
                                  reason: String(f.get("reason")),
                                  discovered_on:
                                    String(f.get("discovery")) || null,
                                  invoice_id: null,
                                }),
                              "UPDATE_PENDING",
                              l.source_id,
                            );
                          }}
                        >
                          <label className="field">
                            未請求理由
                            <input
                              name="reason"
                              defaultValue={info.reason}
                              required
                            />
                          </label>
                          <label className="field">
                            発見日
                            <input
                              name="discovery"
                              type="date"
                              defaultValue={info.discovered_on || ""}
                            />
                          </label>
                          <button disabled={busy}>個別記録を保存</button>
                        </form>
                      </details>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {lines.length === 0 && <p>請求月が未指定の未請求明細はありません。</p>}
        <div className="billing-summary" aria-label="未請求の処理内容">
          <span>未請求明細：{lines.length}件</span>
          <span>今回選択：{picked.length}件</span>
          <strong>選択数量：{sumDecimal(picked.map((l) => l.liters))} L</strong>
          <strong>
            選択税抜金額：
            {formatDecimal(sumDecimal(picked.map((l) => l.amount || "0")))}円
          </strong>
          <span>追加先：{monthLabel(targetMonth)}請求</span>
        </div>
        <label className="field">
          請求する月
          <select
            aria-label="請求する月"
            value={targetMonth}
            onChange={(e) => setTargetMonth(e.target.value)}
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
        </label>
        <details>
          <summary>一覧にない請求月を指定する</summary>
          <label className="field">
            請求する月を直接指定
            <input
              aria-label="請求する月を直接指定"
              type="month"
              value={targetMonth}
              onChange={(e) => setTargetMonth(e.target.value)}
            />
          </label>
        </details>
        <label className="field">
          未請求理由（一括・任意）
          <input
            value={batchReason}
            onChange={(e) => setBatchReason(e.target.value)}
            placeholder="例：8月請求漏れ"
          />
        </label>
        <p>
          未記録の発見日は処理日で自動記録します。既に記録された発見日・理由は、一括理由を入力しない限り保持します。
        </p>
        <button
          disabled={busy || !picked.length || !targetMonth}
          onClick={() =>
            void save(
              () =>
                assignUnpaidToMonth(
                  data,
                  selected,
                  targetMonth,
                  actor,
                  batchReason,
                ),
              "ASSIGN_BILLING_MONTH",
            )
          }
        >
          選択した{picked.length}件を{monthLabel(targetMonth)}請求へ追加
        </button>
      </section>
      <section className="panel no-print">
        <h3>請求月へ追加済み・請求書作成中</h3>
        {processing.length === 0 && <p>追加済みの明細はありません。</p>}
        {processing.map((l) => {
          const info = pendingInfo(data, l),
            draft = draftForLine(data, l.source_id),
            to = info.assigned_month || draft?.month;
          return (
            <details key={l.source_id}>
              <summary>
                {l.actual_day} ／ {l.destination} ／{" "}
                {formatDecimal(l.amount || "0")}円 ／ {to ? monthLabel(to) : ""}
                請求へ追加済み{draft ? "（請求書作成中）" : ""}
              </summary>
              <p>
                本来の対象月：{monthLabel(sourceBillingMonth(data, l))} ／
                理由：{info.reason} ／ 発見日：{info.discovered_on || "未記録"}{" "}
                ／ 追加者：{info.assigned_by || "旧下書き"}
              </p>
              {draft ? (
                <p>
                  請求書ID：{draft.id}
                  。①で下書きを取り消してから追加を取り消してください。
                </p>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void save(
                      () =>
                        cancelMonthAssignment(
                          data,
                          l.source_id,
                          actor,
                          String(f.get("reason")),
                        ),
                      "CANCEL_BILLING_MONTH",
                      l.source_id,
                    );
                  }}
                >
                  <label className="field">
                    追加取消理由
                    <input name="reason" required />
                  </label>
                  <button disabled={busy}>請求月への追加を取り消す</button>
                </form>
              )}
            </details>
          );
        })}
      </section>
      <details className="panel no-print">
        <summary>請求書確定済み・履歴を確認する</summary>
        {ledger(data)
          .filter(
            (l) =>
              (!payer || lineParty(data, l) === payer) &&
              pendingInfo(data, l).invoice_id,
          )
          .map((l) => (
            <p key={l.source_id}>
              {l.actual_day} ／ {l.destination} ／ {l.amount}円 ／
              請求書確定済み ／ 請求書ID：{pendingInfo(data, l).invoice_id}
            </p>
          ))}
        <p>
          請求書確定後の変更は「④
          月次集計・照合」→「既存請求の管理」で、理由と確認を付けて行います。
        </p>
      </details>
    </>
  );
}
