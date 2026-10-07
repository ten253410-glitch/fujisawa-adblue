"use client";
import { useState } from "react";
import type { Data } from "@/lib/domain";
import type { LocalCommit } from "./local-business";
import {
  unpaidLines,
  pendingInfo,
  pastLabel,
  createSelectedInvoices,
  confirmSelectedInvoice,
  updatePending,
  consolidateDestinations,
} from "@/lib/billing-plan";
import {
  ledger,
  lineParty,
  monthRule,
  cancelBillingDraft,
} from "@/lib/billing";
import { billingPeriod, releaseInvoice } from "@/lib/billing-accounts";
import { sumDecimal, formatDecimal } from "@/lib/local-flow";
export default function BillingPlanWorkspace({
  data,
  actor,
  commit,
  month,
}: {
  data: Data;
  actor: string;
  commit: LocalCommit;
  month: string;
}) {
  const [payer, setPayer] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [mode, setMode] = useState<"unified" | "destination">("unified"),
    [approved, setApproved] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [printId, setPrintId] = useState("");
  const party = data.billingParties?.find((p) => p.id === payer),
    period = party ? billingPeriod(month, party) : null,
    lines = unpaidLines(data, payer).filter(
      (l) => !period || l.actual_day <= period.end,
    ),
    picked = lines.filter((l) => selected.includes(l.source_id)),
    past = lines.filter((l) => period && l.actual_day < period.start);
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
        JSON.stringify({ month, payer, selected, mode, records }),
      );
      setNotice("保存しました");
      setSelected([]);
      setApproved(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存できません");
    } finally {
      setBusy(false);
    }
  }
  const invoices = (data.billingInvoices || []).filter(
    (i) =>
      i.selection_mode &&
      i.month === month &&
      (!payer || i.billing_party_id === payer),
  );
  return (
    <>
      <section className="panel no-print">
        <h2>未請求・統合請求</h2>
        <p>
          給液日は変更せず、選択した明細だけを請求対象月 {month}{" "}
          に追加します。既発行原本は保持します。
        </p>
        {error && (
          <p role="alert" className="alert error">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        <label className="field">
          請求先
          <select
            aria-label="統合請求の請求先"
            value={payer}
            onChange={(e) => {
              setPayer(e.target.value);
              setSelected([]);
              setApproved(false);
            }}
          >
            <option value="">選択してください</option>
            {data.billingParties
              ?.filter((p) => p.active)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.internal_name} / {p.formal_name}
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          請求のまとめ方
          <select
            aria-label="請求のまとめ方"
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
        {!monthRule(data, month) && (
          <div className="alert">
            対象月の税設定が未確認です。「税・請求書設定」で対象月の設定を確認・保存してください。
          </div>
        )}
        {payer && past.length > 0 && (
          <div className="alert">
            <strong>過去の未請求実績があります</strong>
            <p>
              過去月 {past.length}{" "}
              件。今回請求する明細にチェックしてください。自動追加はしません。
            </p>
          </div>
        )}
        {payer && (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {[
                    "追加",
                    "実給液日／区分",
                    "給液先・場所",
                    "数量L",
                    "固定単価",
                    "税抜金額",
                    "登録日",
                    "未請求理由／発見日／請求予定月",
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
                        <br />
                        {period && l.actual_day < period.start
                          ? pastLabel(l)
                          : "今回月の通常実績"}
                      </td>
                      <td>
                        {
                          data.customers.find((c) => c.id === l.customer_id)
                            ?.name
                        }
                        <br />
                        {l.destination}
                      </td>
                      <td>{l.liters}</td>
                      <td>{l.price}</td>
                      <td>{formatDecimal(l.amount || "0")}円</td>
                      <td>{info.registered_at || "旧データに記録なし"}</td>
                      <td>
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            const f = new FormData(e.currentTarget);
                            void save(
                              () =>
                                updatePending(data, l.source_id, {
                                  reason: String(f.get("reason")),
                                  discovered_on:
                                    String(f.get("discovery")) || null,
                                  planned_month:
                                    String(f.get("planned")) || null,
                                  invoice_id: null,
                                }),
                              "UPDATE_PENDING",
                              l.source_id,
                            );
                          }}
                        >
                          <input
                            aria-label={"未請求理由 " + l.destination}
                            name="reason"
                            defaultValue={info.reason}
                            required
                          />
                          <input
                            aria-label={"発見日 " + l.destination}
                            name="discovery"
                            type="date"
                            defaultValue={info.discovered_on || ""}
                          />
                          <input
                            aria-label={"請求予定月 " + l.destination}
                            name="planned"
                            type="month"
                            defaultValue={info.planned_month || ""}
                          />
                          <button disabled={busy}>記録保存</button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <h3>確定前の選択内容</h3>
        <p>
          今回月{" "}
          {picked.filter((l) => period && l.actual_day >= period.start).length}
          件 ／ 過去未請求{" "}
          {picked.filter((l) => period && l.actual_day < period.start).length}件
        </p>
        {[...new Set(picked.map((l) => l.destination))].map((dest) => (
          <p key={dest}>
            {dest}：
            {sumDecimal(
              picked.filter((l) => l.destination === dest).map((l) => l.liters),
            )}{" "}
            L ／ 税抜{" "}
            {formatDecimal(
              sumDecimal(
                picked
                  .filter((l) => l.destination === dest)
                  .map((l) => l.amount || "0"),
              ),
            )}
            円
          </p>
        ))}
        <strong>
          請求先全体：{sumDecimal(picked.map((l) => l.liters))} L ／ 税抜{" "}
          {formatDecimal(sumDecimal(picked.map((l) => l.amount || "0")))}円
        </strong>
        <p>
          消費税は選んだまとめ方に従い、請求書ごとに計算します。下書きで税額・税込額を確認してください。
        </p>
        <label>
          <input
            type="checkbox"
            checked={approved}
            onChange={(e) => setApproved(e.target.checked)}
          />
          選択明細と請求先・対象月・まとめ方を確認しました
        </label>
        <button
          disabled={
            busy ||
            !payer ||
            !selected.length ||
            !approved ||
            !monthRule(data, month)
          }
          onClick={() =>
            void save(
              () =>
                createSelectedInvoices(
                  data,
                  month,
                  payer,
                  selected,
                  mode,
                  actor,
                ),
              "CREATE_SELECTED_INVOICES",
            )
          }
        >
          選択明細から下書き作成
        </button>
      </section>
      <section className="panel no-print">
        <h3>複数給液先を同じ請求先に紐付け</h3>
        <p>
          先に「請求先・紐付け」で TWS
          などの請求先を作成し、上で選択してください。給液先は何か所でも選べます。請求済み実績・原本・既存ID・単価は保持し、今後の設定と未請求実績だけを変更します。
        </p>
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
                  f.getAll("customer").map(String),
                  String(f.get("reason")),
                ),
              "CONSOLIDATE_DESTINATIONS",
            );
          }}
        >
          {data.customers.map((c) => (
            <label key={c.id} style={{ display: "block" }}>
              <input type="checkbox" name="customer" value={c.id} />
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
          <button disabled={busy || !payer}>
            選択給液先を統合請求先へ紐付け
          </button>
        </form>
      </section>
      {invoices.map((i) => (
        <div
          key={i.id}
          className={printId && printId !== i.id ? "no-print" : ""}
        >
          <article className="panel invoice-page">
            <h2>
              請求書{" "}
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
                    "実給液日",
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
                    <td>{l.actual_day}</td>
                    <td>{l.destination}</td>
                    <td>
                      {l.quantity}
                      {l.unit}
                    </td>
                    <td>{l.price}</td>
                    <td>{formatDecimal(l.amount || "0")}</td>
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
                        () => confirmSelectedInvoice(data, i.id, actor),
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
            {i.status === "issued" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  if (f.get("checked") === "on")
                    void save(
                      () =>
                        releaseInvoice(
                          data,
                          i.id,
                          actor,
                          String(f.get("reason")),
                        ),
                      "RELEASE_INVOICE",
                      i.id,
                    );
                }}
              >
                <input aria-label="解除理由" name="reason" required />
                <label>
                  <input name="checked" type="checkbox" required />
                  旧版を残して未請求に戻すことを確認しました
                </label>
                <button disabled={busy}>請求確定解除</button>
              </form>
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
      <section className="panel no-print">
        <h3>請求済み実績の追跡</h3>
        {ledger(data)
          .filter(
            (l) =>
              lineParty(data, l) === payer && pendingInfo(data, l).invoice_id,
          )
          .map((l) => (
            <p key={l.source_id}>
              {l.actual_day} ／ {l.destination} ／ {l.amount}円 ／ 請求書{" "}
              {pendingInfo(data, l).invoice_id}
            </p>
          ))}
      </section>
    </>
  );
}
