"use client";
import { useState, useEffect, type FormEvent } from "react";
import { Plus, Download, Upload, Check } from "lucide-react";
import { type Data, type Order, currentPrice, japanDate } from "@/lib/domain";
import {
  type DeliverySite,
  confirmActual,
  markBilling,
  multiplyNet,
  sumDecimal,
  formatDecimal,
  backupText,
  parseBackup,
} from "@/lib/local-flow";
export type LocalCommit = (
  next: Data,
  entity: string,
  id: string,
  action: string,
  detail: string,
) => Promise<void>;
function Entry({
  label,
  children,
}: {
  label: string;
  children: React.ReactElement<{ id?: string }>;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
// Labels below wrap one input; select labels have explicit htmlFor to avoid option text in names.
function Problem({ message }: { message: string }) {
  return message ? (
    <div className="alert error" role="alert">
      {message}
    </div>
  ) : null;
}
export function SiteManager({
  data,
  customerId,
  commit,
}: {
  data: Data;
  customerId: string;
  commit: LocalCommit;
}) {
  const [editing, setEditing] = useState<DeliverySite | null>(null),
    [show, setShow] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    setShow(false);
    setEditing(null);
    setError("");
  }, [customerId]);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const name = String(f.get("site_name")).trim();
      if (!name) throw new Error("給液場所名を入力してください");
      const site: DeliverySite = {
        id: editing?.id ?? crypto.randomUUID(),
        customer_id: customerId,
        name,
        address: String(f.get("site_address")).trim(),
        contact: String(f.get("site_contact")).trim(),
        notes: String(f.get("site_notes")).trim(),
        active: f.get("site_active") === "on",
      };
      const next = {
        ...data,
        sites: editing
          ? (data.sites || []).map((s) => (s.id === site.id ? site : s))
          : [...(data.sites || []), site],
      };
      await commit(
        next,
        "delivery_sites",
        site.id,
        editing ? "UPDATE" : "INSERT",
        JSON.stringify({ before: editing, after: site }),
      );
      setShow(false);
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="subform">
      <div className="section-title">
        <h3>給液場所（複数登録可）</h3>
        <button
          className="text-button"
          onClick={() => {
            setEditing(null);
            setShow(true);
          }}
        >
          <Plus size={16} />
          場所を追加
        </button>
      </div>
      <Problem message={error} />
      {(data.sites || [])
        .filter((s) => s.customer_id === customerId)
        .map((s) => (
          <div className="site-row" key={s.id}>
            <div>
              <strong>{s.name}</strong>
              <small>{s.address || "住所未登録"}</small>
              <small>
                {s.contact} · {s.active ? "利用中" : "利用停止"}
              </small>
              {s.notes && <small>{s.notes}</small>}
            </div>
            <button
              className="text-button"
              onClick={() => {
                setEditing(s);
                setShow(true);
              }}
            >
              場所を編集
            </button>
          </div>
        ))}
      {!(data.sites || []).some((s) => s.customer_id === customerId) && (
        <p className="hint">
          給液場所はまだありません。会社住所とは別に登録できます。
        </p>
      )}
      {show && (
        <form onSubmit={save} key={editing?.id || "new"}>
          <Entry label="給液場所名 *">
            <input name="site_name" required defaultValue={editing?.name} />
          </Entry>
          <Entry label="給液場所住所">
            <input name="site_address" defaultValue={editing?.address} />
          </Entry>
          <Entry label="場所の連絡先">
            <input name="site_contact" defaultValue={editing?.contact} />
          </Entry>
          <Entry label="場所の備考">
            <textarea name="site_notes" defaultValue={editing?.notes} />
          </Entry>
          <label className="checkbox-row">
            <input
              name="site_active"
              type="checkbox"
              defaultChecked={editing?.active ?? true}
            />
            新規受注で利用する
          </label>
          <button className="secondary" disabled={busy}>
            給液場所を保存
          </button>
          <button
            type="button"
            className="text-button spaced"
            onClick={() => setShow(false)}
          >
            閉じる
          </button>
        </form>
      )}
    </div>
  );
}
export function ActualPanel({
  data,
  order,
  actor,
  commit,
  openDocument,
  openUpload,
  openSales,
}: {
  data: Data;
  order: Order;
  actor: string;
  commit: LocalCommit;
  openDocument: (id: string) => void;
  openUpload: () => void;
  openSales: () => void;
}) {
  const actual = (data.actuals || []).find((a) => a.order_id === order.id),
    documents = data.documents.filter((d) => d.order_id === order.id);
  const [day, setDay] = useState(japanDate()),
    [quantity, setQuantity] = useState(""),
    [performer, setPerformer] = useState(actor),
    [documentId, setDocumentId] = useState(
      documents.length === 1 ? documents[0].id : "",
    ),
    [notes, setNotes] = useState(""),
    [approved, setApproved] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const price = currentPrice(data.prices, order.customer_id, day);
  let amount: string | null = null;
  try {
    if (price && quantity) amount = multiplyNet(quantity, String(price.amount));
  } catch {
    /* validation shown on submit; never round */
  }
  const mutate = (f: () => void) => {
    f();
    setApproved(false);
  };
  async function confirm(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (!approved) throw new Error("納品書と実績内容を確認してください");
      const next = confirmActual(
        data,
        order.id,
        {
          delivered_on: day,
          quantity_l: quantity,
          performed_by: performer,
          document_id: documentId,
          notes,
        },
        actor,
      );
      const created = next.actuals!.find((a) => a.order_id === order.id)!;
      await commit(
        next,
        "delivery_actuals",
        created.id,
        "INSERT",
        JSON.stringify({
          actual: created,
          sale: next.sales!.find((s) => s.actual_id === created.id),
          order_id: order.id,
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "登録に失敗しました");
    } finally {
      setBusy(false);
    }
  }
  async function given() {
    setBusy(true);
    setError("");
    try {
      await commit(
        {
          ...data,
          orders: data.orders.map((o) =>
            o.id === order.id
              ? { ...o, status: "awaiting_document", given_on: japanDate() }
              : o,
          ),
        },
        "orders",
        order.id,
        "UPDATE",
        JSON.stringify({
          before: order.status,
          after: "awaiting_document",
          given_on: japanDate(),
          note: "給液終了の連絡。数量・単価・売上は未確定",
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>給液実績・売上</h2>
      <Problem message={error} />
      {actual ? (
        <>
          <span className="tag completed">実績・売上登録済</span>
          <dl className="details">
            <dt>実給液日</dt>
            <dd>{actual.delivered_on}</dd>
            <dt>実給液量</dt>
            <dd>{formatDecimal(actual.quantity_l)} L</dd>
            <dt>固定単価</dt>
            <dd>{formatDecimal(actual.unit_price_excl_tax)} 円/L（税抜）</dd>
            <dt>税抜売上</dt>
            <dd>
              <strong>{formatDecimal(actual.net_amount)} 円</strong>
            </dd>
            <dt>給液担当者</dt>
            <dd>{actual.performed_by}</dd>
            <dt>確認者</dt>
            <dd>
              {actual.confirmed_by} ·{" "}
              {new Date(actual.confirmed_at).toLocaleString("ja-JP", {
                timeZone: "Asia/Tokyo",
              })}
            </dd>
            <dt>取込元</dt>
            <dd>
              {actual.import_meta
                ? actual.import_meta.filename +
                  " / " +
                  actual.import_meta.row +
                  "行 / 伝票 " +
                  (actual.import_meta.slip || "なし")
                : "通常登録"}
            </dd>
            {actual.import_meta && (
              <>
                <dt>金額の根拠</dt>
                <dd>
                  {actual.import_meta.amount_basis === "source"
                    ? "原資料の記載金額を確認して採用"
                    : "数量 × 記載単価"}
                  （数量×単価：{actual.import_meta.calculated_amount} 円）
                </dd>
              </>
            )}
            <dt>備考</dt>
            <dd>{actual.notes || "—"}</dd>
          </dl>
          <button
            className="secondary"
            disabled={!actual.document_id}
            onClick={() => openDocument(actual.document_id)}
          >
            確定時の納品書を見る
          </button>
          <button className="text-button spaced" onClick={openSales}>
            売上・請求管理へ
          </button>
          <p className="hint">
            確定済みの数量・単価・金額は上書きしません。実績訂正は今回未対応です。
          </p>
        </>
      ) : (
        <>
          <p className="hint">
            依頼数量とは別に、納品書の実給液量を入力します。登録すると給液日の単価を固定し、税抜売上を同時に作成します。
          </p>
          {!["awaiting_document", "document_pending", "cancelled"].includes(
            order.status,
          ) && (
            <button className="secondary" disabled={busy} onClick={given}>
              給液終了を記録（納品書待ち）
            </button>
          )}
          {order.given_on && (
            <p className="hint">
              給液終了の連絡日：{order.given_on}
              。下で実際の給液日を確認してください。
            </p>
          )}
          {documents.length === 0 && (
            <div className="callout">
              <p>実績登録の前に、この案件の納品書画像を保存してください。</p>
              <button className="secondary" onClick={openUpload}>
                納品書を撮影・追加
              </button>
            </div>
          )}
          <form onSubmit={confirm}>
            <div className="form-grid">
              <Entry label="実際の給液日 *">
                <input
                  type="date"
                  value={day}
                  required
                  onChange={(e) => mutate(() => setDay(e.target.value))}
                />
              </Entry>
              <Entry label="実際の給液量（L） *">
                <input
                  type="number"
                  min="0.0001"
                  step="0.0001"
                  value={quantity}
                  required
                  onChange={(e) => mutate(() => setQuantity(e.target.value))}
                />
              </Entry>
              <Entry label="給液担当者 *">
                <input
                  value={performer}
                  required
                  onChange={(e) => mutate(() => setPerformer(e.target.value))}
                />
              </Entry>
              <div className="field">
                <label htmlFor="actual-document">確認した納品書 *</label>
                <select
                  id="actual-document"
                  required
                  value={documentId}
                  onChange={(e) => mutate(() => setDocumentId(e.target.value))}
                >
                  <option value="">選択してください</option>
                  {documents.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.filename}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {documentId && (
              <button
                className="text-button"
                type="button"
                onClick={() => openDocument(documentId)}
              >
                選択した納品書を確認
              </button>
            )}
            <Entry label="給液実績の備考">
              <textarea
                value={notes}
                onChange={(e) => mutate(() => setNotes(e.target.value))}
              />
            </Entry>
            <div className="amount-preview">
              <span>
                給液日時点の税抜単価：
                {price ? `${price.amount} 円/L` : "未登録"}
              </span>
              <strong>
                税抜売上：
                {amount !== null ? `${formatDecimal(amount)} 円` : "—"}
              </strong>
            </div>
            <label className="checkbox-row confirmation">
              <input
                type="checkbox"
                checked={approved}
                onChange={(e) => setApproved(e.target.checked)}
              />
              納品書・実給液日・実給液量・適用単価を確認しました
            </label>
            <button
              className="primary"
              disabled={
                busy ||
                !approved ||
                !documents.length ||
                order.status === "cancelled"
              }
            >
              <Check size={17} />
              給液実績と売上を登録
            </button>
          </form>
        </>
      )}
    </section>
  );
}
export function LocalSales({
  data,
  actor,
  commit,
  openOrder,
}: {
  data: Data;
  actor: string;
  commit: LocalCommit;
  openOrder: (id: string) => void;
}) {
  const [customerId, setCustomerId] = useState(""),
    [month, setMonth] = useState(japanDate().slice(0, 7)),
    [status, setStatus] = useState("all"),
    [selected, setSelected] = useState<string[]>([]),
    [memo, setMemo] = useState(""),
    [approved, setApproved] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    setSelected([]);
    setApproved(false);
  }, [customerId, month, status]);
  const all = data.sales || [],
    rows = all
      .filter(
        (s) =>
          (!customerId || s.customer_id === customerId) &&
          (!month || s.delivered_on.slice(0, 7) === month) &&
          (status === "all" || s.billing_status === status),
      )
      .sort((a, b) => a.delivered_on.localeCompare(b.delivered_on));
  const months = Array.from(
    new Set([
      japanDate().slice(0, 7),
      ...all.map((s) => s.delivered_on.slice(0, 7)),
    ]),
  )
    .sort()
    .reverse();
  const groups = Array.from(
    new Set(rows.map((s) => `${s.customer_id}|${s.delivered_on.slice(0, 7)}`)),
  ).map((key) => {
    const [id, m] = key.split("|");
    const list = rows.filter(
      (s) => s.customer_id === id && s.delivered_on.startsWith(m),
    );
    return {
      key,
      id,
      month: m,
      quantity: sumDecimal(list.map((s) => s.quantity_l)),
      amount: sumDecimal(list.map((s) => s.net_amount)),
    };
  });
  async function billing(next: "billed" | "unbilled") {
    setBusy(true);
    setError("");
    try {
      if (!approved) throw new Error("対象と請求状態の変更を確認してください");
      const changed = markBilling(data, selected, next, actor, memo);
      await commit(
        changed,
        "billing",
        crypto.randomUUID(),
        "UPDATE",
        JSON.stringify({
          sale_ids: selected,
          before: all
            .filter((s) => selected.includes(s.id))
            .map((s) => ({ id: s.id, status: s.billing_status })),
          after: next,
          note: memo,
        }),
      );
      setSelected([]);
      setApproved(false);
      setMemo("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setBusy(false);
    }
  }
  function csv() {
    const cells = [
      [
        "案件ID",
        "顧客名",
        "会社名",
        "給液場所",
        "給液日",
        "実給液量(L)",
        "確定税抜単価(円/L)",
        "税抜金額(円)",
        "請求状態",
      ],
      ...rows.map((s) => {
        const c = data.customers.find((c) => c.id === s.customer_id),
          o = data.orders.find((o) => o.id === s.order_id);
        return [
          o?.case_no || s.order_id,
          c?.name || "",
          c?.company_name || c?.name || "",
          o?.location || "",
          s.delivered_on,
          s.quantity_l,
          s.unit_price_excl_tax,
          s.net_amount,
          s.billing_status === "billed" ? "請求済み" : "請求前",
        ];
      }),
    ];
    const body = cells
      .map((row) =>
        row
          .map(
            (c) =>
              `"${(/^[=+@-]/.test(c) ? "'" + c : c).replaceAll('"', '""')}"`,
          )
          .join(","),
      )
      .join("\r\n");
    download(
      "\uFEFF" + body,
      `藤沢AdBlue-売上一覧-${month || "全月"}.csv`,
      "text/csv;charset=utf-8",
    );
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">LOCAL SALES & BILLING</p>
          <h1>売上・請求管理</h1>
          <p className="muted">
            実給液月で集計。税抜金額と請求状態を確認します。
          </p>
        </div>
        <button className="secondary" onClick={csv} disabled={!rows.length}>
          <Download size={16} />
          一覧CSV
        </button>
      </div>
      <Problem message={error} />
      <section className="panel">
        <div className="form-grid">
          <div className="field">
            <label htmlFor="sales-customer">集計する顧客</label>
            <select
              id="sales-customer"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
            >
              <option value="">すべての顧客</option>
              {data.customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="sales-month">実給液月</label>
            <select
              id="sales-month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            >
              <option value="">すべての月</option>
              {months.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="tabs">
          {[
            ["all", "すべて"],
            ["unbilled", "請求前"],
            ["billed", "請求済み"],
          ].map(([key, label]) => (
            <button
              key={key}
              className={status === key ? "selected" : ""}
              onClick={() => setStatus(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="totals">
          <div>
            <small>合計数量</small>
            <strong>
              {formatDecimal(sumDecimal(rows.map((s) => s.quantity_l)))} L
            </strong>
          </div>
          <div>
            <small>合計税抜金額</small>
            <strong>
              {formatDecimal(sumDecimal(rows.map((s) => s.net_amount)))} 円
            </strong>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>選択</th>
                <th>顧客／給液場所</th>
                <th>給液日</th>
                <th>実給液量</th>
                <th>固定単価（税抜）</th>
                <th>税抜金額</th>
                <th>請求状態</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const o = data.orders.find((o) => o.id === s.order_id);
                return (
                  <tr key={s.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`売上選択 ${o?.case_no || s.id}`}
                        checked={selected.includes(s.id)}
                        onChange={(e) => {
                          setSelected((old) =>
                            e.target.checked
                              ? [...old, s.id]
                              : old.filter((id) => id !== s.id),
                          );
                          setApproved(false);
                        }}
                      />
                    </td>
                    <td>
                      <button
                        className="text-button"
                        onClick={() => openOrder(s.order_id)}
                      >
                        {
                          data.customers.find((c) => c.id === s.customer_id)
                            ?.name
                        }
                        <br />
                        {o?.location}
                      </button>
                      <small>{o?.case_no}</small>
                    </td>
                    <td>{s.delivered_on}</td>
                    <td>{formatDecimal(s.quantity_l)} L</td>
                    <td>{formatDecimal(s.unit_price_excl_tax)} 円/L</td>
                    <td>{formatDecimal(s.net_amount)} 円</td>
                    <td>
                      <span className={`tag ${s.billing_status}`}>
                        {s.billing_status === "billed" ? "請求済み" : "請求前"}
                      </span>
                      {s.billed_at && (
                        <small>
                          {new Date(s.billed_at).toLocaleDateString("ja-JP", {
                            timeZone: "Asia/Tokyo",
                          })}
                        </small>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!rows.length && (
          <p className="empty">
            この条件の売上はありません。給液実績を登録すると表示します。
          </p>
        )}
        <h3>顧客別・月別の合計</h3>
        {groups.map((g) => (
          <div className="summary-row" key={g.key}>
            <span>
              {data.customers.find((c) => c.id === g.id)?.name} · {g.month}
            </span>
            <strong>
              {formatDecimal(g.quantity)} L / {formatDecimal(g.amount)}{" "}
              円（税抜）
            </strong>
          </div>
        ))}
        <p className="hint">
          消費税・端数処理・締日・正式請求書は未確定です。表示額を正式な請求金額として確定しません。
        </p>
      </section>
      <section className="panel">
        <h2>選択した売上の請求状態</h2>
        <p className="hint">
          請求書の発行や送信は行いません。業務検証用の状態記録です。
          {selected.length}件選択中。
        </p>
        <Entry label="請求状態変更のメモ *">
          <input
            value={memo}
            onChange={(e) => {
              setMemo(e.target.value);
              setApproved(false);
            }}
            placeholder="例：業務検証で請求済み扱いにする"
          />
        </Entry>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={approved}
            onChange={(e) => setApproved(e.target.checked)}
          />
          対象売上と請求状態の変更を確認しました
        </label>
        <button
          className="primary"
          disabled={busy || !selected.length || !approved}
          onClick={() => billing("billed")}
        >
          選択分を請求済みにする
        </button>
        <button
          className="secondary spaced"
          disabled={busy || !selected.length || !approved}
          onClick={() => billing("unbilled")}
        >
          選択分を請求前に戻す
        </button>
      </section>
    </>
  );
}
export function download(
  text: string,
  name: string,
  type = "application/json",
) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function LocalBackup({
  data,
  restore,
}: {
  data: Data;
  restore: (next: Data) => Promise<void>;
}) {
  const [candidate, setCandidate] = useState<Data | null>(null),
    [filename, setFilename] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function read(file: File | undefined) {
    if (!file) return;
    setError("");
    setMessage("");
    setCandidate(null);
    setConfirmed(false);
    try {
      if (file.size > 25 * 1024 * 1024)
        throw new Error("バックアップは25MB以下のJSONを選択してください");
      setCandidate(parseBackup(await file.text()));
      setFilename(file.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "バックアップを読み込めません");
    }
  }
  async function apply() {
    if (!candidate || !confirmed) return;
    setBusy(true);
    setError("");
    try {
      download(backupText(data), `藤沢AdBlue-復元前-${japanDate()}.json`);
      await restore(candidate);
      setCandidate(null);
      setConfirmed(false);
      setMessage(
        "バックアップを復元しました。復元前のデータもファイルとして保存しました。",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "復元に失敗しました");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">LOCAL BACKUP</p>
          <h1>バックアップ・復元</h1>
          <p className="muted">
            このPCのデータを、画像・単価履歴・実績・変更履歴ごと保存。
          </p>
        </div>
      </div>
      <Problem message={error} />
      {message && (
        <div className="alert success" role="status">
          {message}
        </div>
      )}
      <section className="panel">
        <h2>JSONバックアップを保存</h2>
        <p>
          ブラウザを閉じてもデータは残ります。ブラウザのデータ削除・PC故障に備え、作業後にファイルを保存してください。
        </p>
        <p className="hint">
          同じPC・同じブラウザ・同じアドレスで続けてください。ログアウトでデータは消えません。ファイルには顧客情報と納品書が含まれます。
        </p>
        <button
          className="primary"
          onClick={() =>
            download(
              backupText(data),
              `藤沢AdBlue-バックアップ-${japanDate()}.json`,
            )
          }
        >
          <Download size={17} />
          JSONバックアップを保存
        </button>
        <p className="hint">
          顧客 {data.customers.length}件 / 受注 {data.orders.length}件 /
          給液実績 {(data.actuals || []).length}件 / 売上{" "}
          {(data.sales || []).length}件
        </p>
      </section>
      <section className="panel">
        <h2>JSONバックアップから復元</h2>
        <p>復元は現在のデータを置き換えます。合算・自動マージは行いません。</p>
        <label className="secondary upload-button">
          <Upload size={17} />
          バックアップJSONを選択
          <input
            aria-label="バックアップJSONを選択"
            type="file"
            accept="application/json,.json"
            disabled={busy}
            onChange={(e) => {
              read(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
        {candidate && (
          <div className="callout">
            <strong>{filename}</strong>
            <p>
              復元するデータ：顧客 {candidate.customers.length}件 / 受注{" "}
              {candidate.orders.length}件 / 実績{" "}
              {(candidate.actuals || []).length}件 / 売上{" "}
              {(candidate.sales || []).length}件
            </p>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              内容を確認し、現在のデータをバックアップの内容に置き換えます
            </label>
            <button
              className="primary"
              disabled={busy || !confirmed}
              onClick={apply}
            >
              確認して復元
            </button>
            <p className="hint">
              復元直前のデータも自動ダウンロードします。ブラウザが確認を出した場合は保存を許可してください。
            </p>
          </div>
        )}
      </section>
    </>
  );
}
