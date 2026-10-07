"use client";
import SelectedInvoiceView from "./selected-invoice-view";
import { useEffect, useState } from "react";
import type { Data } from "@/lib/domain";
import type { LocalCommit } from "./local-business";
import {
  unpaidLines,
  pendingInfo,
  pastLabel,
  sourceBillingMonth,
  createSelectedInvoices,
  updatePending,
  consolidateDestinations,
} from "@/lib/billing-plan";
import { ledger, lineParty, monthRule } from "@/lib/billing";
import { billingPeriod } from "@/lib/billing-accounts";
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
    [mode, setMode] = useState<"unified" | "destination">("unified"),
    [approved, setApproved] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [previewIds, setPreviewIds] = useState<string[]>([]),
    [search, setSearch] = useState("");
  useEffect(() => {
    setApproved(false);
    setPreviewIds([]);
    setError("");
    setNotice("");
  }, [month]);
  const party = data.billingParties?.find((p) => p.id === payer),
    period = party ? billingPeriod(month, party) : null,
    lines = unpaidLines(data, payer),
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
      if (action === "CREATE_SELECTED_INVOICES")
        setPreviewIds(
          (next.billingInvoices || [])
            .filter(
              (i) =>
                !(data.billingInvoices || []).some((old) => old.id === i.id),
            )
            .map((i) => i.id),
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
          setApproved(false);
          setPreviewIds([]);
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
          給液日は変更せず、選択した明細だけを請求対象月 {month}{" "}
          に追加します。既発行原本は保持します。
        </p>
        {error && (
          <p role="alert" className="alert error">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        {payerField}
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
        {
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {[
                    "追加",
                    "実給液日／区分",
                    "給液先・場所",
                    "請求先／本来の対象月",
                    "数量／AdBlue L",
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
                  const info = pendingInfo(data, l),
                    linePayer = data.billingParties?.find(
                      (p) => p.id === lineParty(data, l),
                    ),
                    rowPeriod = linePayer
                      ? billingPeriod(month, linePayer)
                      : null;
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
                            if (e.target.checked && !payer)
                              setPayer(lineParty(data, l) || "");
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
                        {rowPeriod && l.actual_day < rowPeriod.start
                          ? pastLabel(l)
                          : rowPeriod && l.actual_day > rowPeriod.end
                            ? "今回の請求月より後の実績"
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
                      <td>
                        {data.billingParties?.find(
                          (p) => p.id === lineParty(data, l),
                        )?.internal_name || "未設定"}
                        <br />
                        {sourceBillingMonth(data, l)}
                      </td>
                      <td>
                        {l.quantity}
                        {l.unit}
                        <small>AdBlue換算 {l.liters} L</small>
                      </td>
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
        }
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
      <SelectedInvoiceView
        data={data}
        actor={actor}
        invoices={invoices.filter((i) => previewIds.includes(i.id))}
        busy={busy}
        save={save}
      />
      <details className="panel no-print">
        <summary>この月の保存済み請求書・旧版を確認する</summary>
        {invoices.map((i) => (
          <button key={i.id} onClick={() => setPreviewIds([i.id])}>
            {i.party_name} ／ {i.net}円 ／{" "}
            {i.status === "draft"
              ? "未確定"
              : i.status === "issued"
                ? "確定済み"
                : "取消・旧版"}{" "}
            ／ {i.id}
          </button>
        ))}
      </details>
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
