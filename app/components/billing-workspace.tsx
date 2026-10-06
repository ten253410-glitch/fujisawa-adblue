"use client";
import { useState, type FormEvent } from "react";
import type { Data } from "@/lib/domain";
import {
  billingCheck,
  cancelBillingDraft,
  reviewBillingLine,
  ledger,
  lineParty,
  issuedCoverage,
  makeBillingInvoice,
  confirmBillingInvoice,
  markAdditional,
  taxAmounts,
  defaultIssuer,
  type BillingParty,
  type BillingItem,
  type BillingLine,
  type TransactionCategory,
  type TaxRule,
} from "@/lib/billing";
import { importVerifiedAugust, augustFixture } from "@/lib/august-data";
import { formatDecimal, multiplyNet, sumDecimal } from "@/lib/local-flow";
import { type LocalCommit } from "./local-business";
export default function BillingWorkspace({
  data,
  actor,
  commit,
}: {
  data: Data;
  actor: string;
  commit: LocalCommit;
}) {
  const [invoiceApprovals, setInvoiceApprovals] = useState<
    Record<string, boolean>
  >({});
  const [tab, setTab] = useState<
      "check" | "masters" | "august" | "items" | "settings"
    >("check"),
    [month, setMonth] = useState("2026-08"),
    [party, setParty] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [approved, setApproved] = useState(false),
    [kind, setKind] = useState<"regular" | "additional">("regular"),
    [selected, setSelected] = useState<string[]>([]),
    [issueDay, setIssueDay] = useState("2026-09-01"),
    [dueDay, setDueDay] = useState("2026-09-30"),
    [subject, setSubject] = useState("2026年8月分"),
    [printId, setPrintId] = useState("");
  async function save(
    next: Data,
    entity: string,
    id: string,
    action: string,
    detail: unknown,
  ) {
    await commit(next, entity, id, action, JSON.stringify(detail));
    setNotice("保存しました");
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存できません");
    } finally {
      setBusy(false);
    }
  }
  const check = billingCheck(data, month, party || undefined),
    parties = data.billingParties || [],
    invoices = (data.billingInvoices || []).filter(
      (i) =>
        i.month === month &&
        i.status !== "cancelled" &&
        (!party || i.billing_party_id === party),
    ),
    unassigned = ledger(data, month).filter((l) => !lineParty(data, l));
  async function create() {
    await run(async () => {
      if (!approved || !selected.length)
        throw new Error("請求先と対象明細を確認してください");
      let next = data;
      for (const id of selected)
        next = makeBillingInvoice(next, month, id, kind, actor, {
          issued_on: issueDay,
          due_on: dueDay,
          subject: subject + (kind === "additional" ? " 追加請求" : ""),
        });
      await save(next, "billing_invoice", month, "INSERT", {
        kind,
        invoices: next.billingInvoices!.slice(
          (data.billingInvoices || []).length,
        ),
      });
      setSelected([]);
      setApproved(false);
    });
  }
  async function payer(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      form = e.currentTarget;
    await run(async () => {
      const internal = String(f.get("internal")).trim(),
        formal = String(f.get("formal")).trim();
      if (!internal || !formal)
        throw new Error("社内名称・正式請求先を入力してください");
      const p: BillingParty = {
        id: crypto.randomUUID(),
        internal_name: internal,
        formal_name: formal,
        address: String(f.get("address")).trim(),
        active: true,
      };
      await save(
        { ...data, billingParties: [...parties, p] },
        "billing_party",
        p.id,
        "INSERT",
        p,
      );
      form.reset();
    });
  }
  async function link(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      customer = String(f.get("customer")),
      site = String(f.get("site")),
      pid = String(f.get("party"));
    await run(async () => {
      if (!parties.some((p) => p.id === pid))
        throw new Error("請求先を選択してください");
      if (site) {
        if (!(data.sites || []).some((s) => s.id === site))
          throw new Error("給液場所を選択してください");
        await save(
          {
            ...data,
            sites: (data.sites || []).map((s) =>
              s.id === site ? { ...s, billing_party_id: pid } : s,
            ),
          },
          "delivery_sites",
          site,
          "UPDATE",
          { billing_party_id: pid },
        );
      } else {
        if (!data.customers.some((c) => c.id === customer))
          throw new Error("給液先を選択してください");
        await save(
          {
            ...data,
            customers: data.customers.map((c) =>
              c.id === customer ? { ...c, billing_party_id: pid } : c,
            ),
          },
          "customers",
          customer,
          "UPDATE",
          { billing_party_id: pid },
        );
      }
    });
  }
  async function item(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      form = e.currentTarget;
    await run(async () => {
      const category = String(f.get("category")) as TransactionCategory,
        kind = String(f.get("kind")) as BillingItem["kind"],
        quantity = String(f.get("quantity")).trim(),
        price = String(f.get("price")).trim(),
        pid = String(f.get("party")),
        day = String(f.get("day")),
        product = String(f.get("product")).trim(),
        destination = String(f.get("destination")).trim();
      if (!product || !destination || !day)
        throw new Error("商品・納入先・日付を入力してください");
      if (category === "normal" && !parties.some((p) => p.id === pid))
        throw new Error("請求先を選択してください");
      const amount = multiplyNet(quantity, kind === "loan" ? "0" : price),
        liters =
          kind === "adblue"
            ? multiplyNet(quantity, String(f.get("factor") || "0"))
            : "0";
      const i: BillingItem = {
        id: crypto.randomUUID(),
        billing_party_id: pid || null,
        customer_id: null,
        day,
        kind,
        product,
        destination,
        quantity,
        unit: String(f.get("unit")).trim() || "個",
        price: kind === "loan" ? "0" : price,
        liters,
        ...(kind === "adblue"
          ? { liters_per_unit: String(f.get("factor")) }
          : {}),
        amount,
        category,
        status: "unbilled",
        notes: String(f.get("notes")),
        created_by: actor,
        created_at: new Date().toISOString(),
      };
      await save(
        { ...data, billingItems: [...(data.billingItems || []), i] },
        "billing_item",
        i.id,
        "INSERT",
        i,
      );
      form.reset();
    });
  }
  async function setting(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await run(async () => {
      const rule: TaxRule = {
        month,
        rate: String(f.get("rate")).trim(),
        rounding: String(f.get("rounding")) as TaxRule["rounding"],
        basis: "invoice",
        confirmed_by: actor,
        confirmed_at: new Date().toISOString(),
      };
      taxAmounts("1", rule);
      await save(
        {
          ...data,
          taxRules: [
            ...(data.taxRules || []).filter((r) => r.month !== month),
            rule,
          ],
          invoiceIssuer: {
            bank: String(f.get("bank")),
            registration: String(f.get("registration")),
          },
        },
        "invoice_settings",
        month,
        "UPDATE",
        rule,
      );
    });
  }
  return (
    <>
      <div className="no-print">
        <h1>請求前チェック・請求書</h1>
        <p>
          給液先・場所と請求先を分離し、明細単位で金額まで確認します。ローカルの確定記録で、請求書の送信は行いません。
        </p>
        {error && (
          <div role="alert" className="alert error">
            {error}
          </div>
        )}
        {notice && (
          <div role="status" className="alert success">
            {notice}
          </div>
        )}
        <div className="tabs wrap">
          {[
            ["check", "請求前チェック"],
            ["masters", "請求先・紐付け"],
            ["august", "実資料8月検証"],
            ["items", "商品・貸与・対象外"],
            ["settings", "税・請求書設定"],
          ].map(([v, n]) => (
            <button
              key={v}
              onClick={() => {
                setTab(v as typeof tab);
                setError("");
                setNotice("");
              }}
            >
              {n}
            </button>
          ))}
        </div>
        <label className="field">
          対象月
          <input
            aria-label="請求チェック対象月"
            type="month"
            value={month}
            onChange={(e) => {
              setMonth(e.target.value);
              setSelected([]);
              setApproved(false);
              setIssueDay("");
              setDueDay("");
              setSubject(e.target.value + "分");
            }}
          />
        </label>
      </div>
      {tab === "masters" && (
        <section className="panel no-print">
          <h2>請求先マスター</h2>
          <form onSubmit={payer}>
            <div className="form-grid">
              <label className="field">
                社内管理名称
                <input name="internal" required />
              </label>
              <label className="field">
                正式請求先名称
                <input name="formal" required />
              </label>
              <label className="field">
                請求先住所
                <input name="address" />
              </label>
            </div>
            <button className="primary" disabled={busy}>
              請求先を追加
            </button>
          </form>
          {parties.map((p) => (
            <details key={p.id}>
              <summary>
                {p.internal_name} → {p.formal_name}
              </summary>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void run(async () => {
                    const next = {
                      ...p,
                      internal_name: String(f.get("internal")).trim(),
                      formal_name: String(f.get("formal")).trim(),
                      address: String(f.get("address")).trim(),
                      active: f.get("active") === "on",
                    };
                    if (!next.internal_name || !next.formal_name)
                      throw new Error("名称が必要です");
                    await save(
                      {
                        ...data,
                        billingParties: parties.map((x) =>
                          x.id === p.id ? next : x,
                        ),
                      },
                      "billing_party",
                      p.id,
                      "UPDATE",
                      { before: p, after: next },
                    );
                  });
                }}
              >
                <label>
                  社内名称
                  <input
                    name="internal"
                    defaultValue={p.internal_name}
                    required
                  />
                </label>
                <label>
                  正式名称
                  <input name="formal" defaultValue={p.formal_name} required />
                </label>
                <label>
                  住所
                  <input name="address" defaultValue={p.address} />
                </label>
                <label>
                  <input
                    type="checkbox"
                    name="active"
                    defaultChecked={p.active}
                  />
                  利用中
                </label>
                <button disabled={busy}>請求先を保存</button>
              </form>
            </details>
          ))}
          <h3>今後の実績に適用する紐付け</h3>
          <p>
            給液場所の指定を優先します。マスター変更で過去の売上・請求書を変更しません。既存の未設定売上は請求前チェックで明細ごとに指定します。
          </p>
          <form onSubmit={link}>
            <label className="field">
              給液先企業
              <select name="customer">
                <option value="">選択</option>
                {data.customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} →{" "}
                    {parties.find((p) => p.id === c.billing_party_id)
                      ?.internal_name || "請求先未設定"}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              給液場所（空なら企業全体）
              <select name="site">
                <option value="">企業全体</option>
                {(data.sites || []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {data.customers.find((c) => c.id === s.customer_id)?.name} /{" "}
                    {s.name} →{" "}
                    {parties.find((p) => p.id === s.billing_party_id)
                      ?.internal_name || "企業設定を使用"}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              紐付ける請求先
              <select name="party" required>
                <option value="">選択</option>
                {parties
                  .filter((p) => p.active)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.internal_name} / {p.formal_name}
                    </option>
                  ))}
              </select>
            </label>
            <button disabled={busy} className="primary">
              請求先の紐付けを保存
            </button>
          </form>
        </section>
      )}
      {tab === "august" && (
        <section className="panel no-print">
          <h2>受領した8月実資料の照合結果</h2>
          <p>
            Excel69件・40,500L。既発行税抜2,823,058円、正しい税抜2,884,158円。Schatzの61,100円漏れを検出。付属PDFの17貸与明細・1有償商品・4仕入記録も保存します。
          </p>
          <p>
            4件の日付差異は自動補正せず、実給液日と請求書記載日を保存します。バッチ番号は伝票番号として使いません。担当者は資料未記載です。
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {[
                    "Excel行",
                    "給液日",
                    "給液先／場所",
                    "請求先",
                    "L",
                    "単価",
                    "売上",
                    "PDF日付",
                    "PDF金額",
                  ].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {augustFixture.rows.map((r) => (
                  <tr key={r.row}>
                    <td>{r.row}</td>
                    <td>{r.day}</td>
                    <td>{r.destination}</td>
                    <td>{r.bill}</td>
                    <td>{r.quantity}</td>
                    <td>{r.price}</td>
                    <td>{r.cached_amount}</td>
                    <td>{r.pdf.day}</td>
                    <td>
                      {r.pdf.amount === null ? (
                        <strong>空欄・請求漏れ</strong>
                      ) : (
                        r.pdf.amount
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details>
            <summary>有償商品・無償貸与・仕入の確認</summary>
            {augustFixture.extras.map((e, i) => (
              <p key={i}>
                {e.day} / {e.bill} / {e.product} / {e.quantity}個 /{" "}
                {e.kind === "loan" ? "無償貸与" : e.amount + "円"}
              </p>
            ))}
            {augustFixture.internal.map((e) => (
              <p key={e.day}>{e.day} / 仕入 / 0円 / 通常請求対象外</p>
            ))}
          </details>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={approved}
              onChange={(e) => setApproved(e.target.checked)}
            />
            実資料・紐付け・記載金額・既発行記録を確認して取り込みます
          </label>
          <button
            className="primary"
            disabled={busy || !approved}
            onClick={() =>
              void run(async () => {
                const next = importVerifiedAugust(data, actor);
                await save(next, "august_reconciliation", "2026-08", "INSERT", {
                  source: augustFixture.source,
                  deliveries: 69,
                  extras: 18,
                  purchases: 4,
                  confirmed_by: actor,
                });
                setApproved(false);
                setTab("check");
                setMonth("2026-08");
              })
            }
          >
            照合した8月実データを登録
          </button>
          <p className="hint">
            現在のデータを置き換えません。同じ実績がある場合は二重登録を拒否します。先にJSONバックアップを保存してください。
          </p>
        </section>
      )}
      {tab === "items" && (
        <section className="panel no-print">
          <h2>商品・無償貸与・BIB・対象外の記録</h2>
          <form onSubmit={item}>
            <div className="form-grid">
              <label className="field">
                日付
                <input name="day" type="date" required />
              </label>
              <label className="field">
                明細区分
                <select name="kind">
                  <option value="goods">有償商品</option>
                  <option value="loan">無償貸与品</option>
                  <option value="adblue">AdBlue（BIB等）</option>
                </select>
              </label>
              <label className="field">
                取引区分
                <select name="category">
                  <option value="normal">通常売上</option>
                  <option value="internal">内部取引</option>
                  <option value="purchase">仕入</option>
                  <option value="excluded">請求対象外</option>
                </select>
              </label>
              <label className="field">
                商品名
                <input name="product" required />
              </label>
              <label className="field">
                給液先／納入先
                <input name="destination" required />
              </label>
              <label className="field">
                請求先
                <select name="party">
                  <option value="">未設定</option>
                  {parties
                    .filter((p) => p.active)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.internal_name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="field">
                請求数量
                <input
                  name="quantity"
                  type="number"
                  min="0"
                  step="0.0001"
                  required
                />
              </label>
              <label className="field">
                請求単位
                <input name="unit" defaultValue="個" required />
              </label>
              <label className="field">
                単価（円／請求単位）
                <input
                  name="price"
                  type="number"
                  min="0"
                  step="0.0001"
                  defaultValue="0"
                  required
                />
              </label>
              <label className="field">
                AdBlue換算係数（L／単位）
                <input
                  name="factor"
                  type="number"
                  min="0"
                  step="0.0001"
                  defaultValue="0"
                />
              </label>
            </div>
            <label className="field">
              備考
              <textarea name="notes" />
            </label>
            <p>
              無償貸与は名前にかかわらず金額0。AdBlue以外はL集計に含めません。仕入・内部取引・対象外は通常請求から除外します。
            </p>
            <button className="primary" disabled={busy}>
              確認して商品明細を登録
            </button>
          </form>
          {(data.billingItems || [])
            .filter((i) => i.day.startsWith(month))
            .map((i) => (
              <p key={i.id}>
                {i.day} / {i.product} /{" "}
                {i.kind === "loan" ? "無償貸与" : i.category} / {i.quantity}
                {i.unit} / {i.liters}L / {formatDecimal(i.amount)}円
              </p>
            ))}
        </section>
      )}
      {tab === "items" && (
        <section className="panel no-print">
          <h2>内部取引・仕入・対象外の区分確認</h2>
          <p>
            除外理由を記録します。誤って除外した明細は、確認して通常売上に戻せます。
          </p>
          {ledger(
            {
              ...data,
              sales: (data.sales || []).map((s) => ({
                ...s,
                transaction_category: "normal",
              })),
              billingItems: (data.billingItems || []).map((i) => ({
                ...i,
                category: "normal",
              })),
            },
            month,
          )
            .filter((l) =>
              l.source_kind === "sale"
                ? !!data.sales?.find(
                    (s) =>
                      s.id === l.source_id &&
                      s.transaction_category &&
                      s.transaction_category !== "normal",
                  )
                : !!data.billingItems?.find(
                    (i) => i.id === l.source_id && i.category !== "normal",
                  ),
            )
            .map((l) => (
              <LineReview
                key={l.source_id}
                line={l}
                data={data}
                busy={busy}
                commit={(next, detail) =>
                  run(() =>
                    save(next, "billing_review", l.source_id, "UPDATE", detail),
                  )
                }
              />
            ))}
        </section>
      )}
      {tab === "settings" && (
        <section className="panel no-print">
          <h2>{month}の税・請求書設定</h2>
          <p>
            税計算単位は請求書1枚の税抜小計。既発行請求書の計算設定は固定して保持します。8月は実資料で確認した10%・切り捨てです。
          </p>
          <form onSubmit={setting} key={month}>
            <label className="field">
              税率（%）
              <input
                name="rate"
                required
                type="number"
                min="0"
                max="100"
                step="0.0001"
                defaultValue={
                  (data.taxRules || []).find((r) => r.month === month)?.rate ||
                  ""
                }
              />
            </label>
            <label className="field">
              1円未満の処理
              <select
                name="rounding"
                defaultValue={
                  (data.taxRules || []).find((r) => r.month === month)
                    ?.rounding || "floor"
                }
              >
                <option value="floor">切り捨て</option>
                <option value="nearest">四捨五入</option>
                <option value="ceil">切り上げ</option>
              </select>
            </label>
            <label className="field">
              振込先
              <input
                name="bank"
                defaultValue={(data.invoiceIssuer || defaultIssuer).bank}
              />
            </label>
            <label className="field">
              登録番号
              <input
                name="registration"
                defaultValue={
                  (data.invoiceIssuer || defaultIssuer).registration
                }
              />
            </label>
            <button className="primary" disabled={busy}>
              確認した設定を保存
            </button>
          </form>
        </section>
      )}
      {tab === "check" && (
        <>
          <section className="panel no-print">
            <label className="field">
              チェックする請求先
              <select
                aria-label="チェックする請求先"
                value={party}
                onChange={(e) => {
                  setParty(e.target.value);
                  setPrintId("");
                  setApproved(false);
                }}
              >
                <option value="">月全体</option>
                {parties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.internal_name} / {p.formal_name}
                  </option>
                ))}
              </select>
            </label>
            <div className="totals">
              <div>
                <small>実績AdBlue総量</small>
                <strong>{formatDecimal(check.quantity)} L</strong>
              </div>
              <div>
                <small>請求書掲載AdBlue量（重複除外）</small>
                <strong>{formatDecimal(check.billedQty)} L</strong>
              </div>
              <div>
                <small>数量差異</small>
                <strong>{check.quantityDifference} L</strong>
              </div>
              <div>
                <small>実績売上（税抜）</small>
                <strong>{formatDecimal(check.net)} 円</strong>
              </div>
              <div>
                <small>請求算入額（税抜）</small>
                <strong>{formatDecimal(check.billedNet)} 円</strong>
              </div>
              <div>
                <small>金額差異</small>
                <strong>
                  {check.amountDifference.toLocaleString("ja-JP")} 円
                </strong>
              </div>
            </div>
            <p>
              AdBlue売上 {formatDecimal(check.adblue)}円 ／ 有償商品{" "}
              {formatDecimal(check.goods)}円 ／ 無償貸与 {check.loans.length}件
              ／ 税{" "}
              {check.tax === null ? "未確認" : formatDecimal(check.tax) + "円"}{" "}
              ／ 税込{" "}
              {check.gross === null
                ? "未確認"
                : formatDecimal(check.gross) + "円"}
            </p>
            {!!unassigned.length && (
              <div className="alert error">
                請求先未設定：{unassigned.length}
                件。月全体の明細を確認してください。
              </div>
            )}
            {check.issues.map((issue, i) => (
              <div className={issue.blocking ? "alert error" : "alert"} key={i}>
                {issue.blocking ? "要確認：" : "確認記録あり："}
                {issue.message}{" "}
                {
                  check.lines.find((l) => l.source_id === issue.source_id)
                    ?.destination
                }
              </div>
            ))}
            {!!check.issues.filter((i) => i.code === "omission").length && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const ids = [
                      ...new Set(
                        check.issues
                          .filter((i) => i.code === "omission")
                          .map((i) => i.source_id!),
                      ),
                    ];
                    await save(
                      markAdditional(data, ids, actor),
                      "sales",
                      month,
                      "UPDATE",
                      { additional: ids, confirmed_by: actor },
                    );
                    setKind("additional");
                  })
                }
              >
                請求漏れ候補を追加請求対象にする
              </button>
            )}
            <h3>請求先別の集約</h3>
            {parties
              .filter((p) => !party || p.id === party)
              .map((p) => {
                const c = billingCheck(data, month, p.id);
                return c.lines.length ? (
                  <p key={p.id}>
                    <strong>
                      {p.internal_name} → {p.formal_name}
                    </strong>{" "}
                    ／ 給液
                    {c.lines.filter((l) => l.source_kind === "sale").length}件
                    ／ {c.quantity}L ／ AdBlue{c.adblue}円 ／ 商品{c.goods}円 ／
                    貸与{c.loans.length}件 ／ 税抜{c.net}円 ／ 税
                    {c.tax ?? "未確認"} ／ 税込{c.gross ?? "未確認"}
                  </p>
                ) : null;
              })}
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    {[
                      "実給液日",
                      "請求記載日",
                      "給液先／商品",
                      "請求先",
                      "数量／単位",
                      "AdBlue L",
                      "固定単価",
                      "税抜金額",
                      "請求状態",
                    ].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {check.lines.map((l) => (
                    <tr key={l.source_id}>
                      <td>{l.actual_day}</td>
                      <td>{l.day}</td>
                      <td>
                        {l.destination}
                        <small>{l.product}</small>
                      </td>
                      <td>
                        {parties.find((p) => p.id === lineParty(data, l))
                          ?.internal_name || "未設定"}
                      </td>
                      <td>
                        {l.quantity}
                        {l.unit}
                      </td>
                      <td>{l.liters}</td>
                      <td>{l.price}</td>
                      <td>{l.amount}</td>
                      <td>
                        {issuedCoverage(data, l.source_id).length
                          ? "請求済み"
                          : (data.sales || []).find((s) => s.id === l.source_id)
                                ?.billing_status === "additional"
                            ? "追加請求対象"
                            : "未請求"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <details>
              <summary>請求先・取引区分・記載日・単位を確認する</summary>
              {check.lines.map((l) => (
                <LineReview
                  key={l.source_id}
                  line={l}
                  data={data}
                  busy={busy}
                  commit={(next, detail) =>
                    run(() =>
                      save(
                        next,
                        "billing_review",
                        l.source_id,
                        "UPDATE",
                        detail,
                      ),
                    )
                  }
                />
              ))}
            </details>
          </section>
          <section className="panel no-print">
            <h2>請求書を作成</h2>
            <p>
              既発行分は変更しません。追加請求では算入されていない明細だけを含めます。
            </p>
            <label className="field">
              請求区分
              <select
                aria-label="請求区分"
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as typeof kind);
                  setApproved(false);
                }}
              >
                <option value="regular">通常請求</option>
                <option value="additional">追加請求</option>
              </select>
            </label>
            {parties
              .filter((p) => p.active && (!party || p.id === party))
              .map((p) => (
                <label className="checkbox-row" key={p.id}>
                  <input
                    type="checkbox"
                    aria-label={"請求作成先 " + p.internal_name}
                    checked={selected.includes(p.id)}
                    onChange={(e) => {
                      setSelected((old) =>
                        e.target.checked
                          ? [...old, p.id]
                          : old.filter((id) => id !== p.id),
                      );
                      setApproved(false);
                    }}
                  />
                  {p.internal_name}
                </label>
              ))}
            <div className="form-grid">
              <label className="field">
                請求日
                <input
                  type="date"
                  value={issueDay}
                  onChange={(e) => {
                    setIssueDay(e.target.value);
                    setApproved(false);
                  }}
                />
              </label>
              <label className="field">
                支払期限
                <input
                  type="date"
                  value={dueDay}
                  onChange={(e) => {
                    setDueDay(e.target.value);
                    setApproved(false);
                  }}
                />
              </label>
              <label className="field">
                件名
                <input
                  value={subject}
                  onChange={(e) => {
                    setSubject(e.target.value);
                    setApproved(false);
                  }}
                />
              </label>
            </div>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={approved}
                onChange={(e) => setApproved(e.target.checked)}
              />
              対象月・請求先・明細・日付を確認しました
            </label>
            <button
              className="primary"
              disabled={busy || !approved || !selected.length}
              onClick={() => void create()}
            >
              確認して請求書を作成
            </button>
            <button
              className="secondary spaced"
              disabled={!invoices.length}
              onClick={() => {
                setPrintId("");
                setTimeout(() => window.print(), 100);
              }}
            >
              表示中の請求書をまとめて印刷・PDF保存
            </button>
          </section>
          {invoices.map((i) => (
            <div
              key={i.id}
              className={printId && printId !== i.id ? "no-print" : ""}
            >
              <article className="panel invoice-page">
                <h2>
                  {i.kind === "reference"
                    ? "既発行請求書の照合記録"
                    : i.kind === "additional"
                      ? "追加請求書"
                      : "請求書"}{" "}
                  {i.status === "draft" ? "（未確定）" : ""}
                </h2>
                <p>{i.party_address}</p>
                <h3>{i.party_name} 御中</h3>
                <p>
                  {i.subject} ／ {i.month}
                </p>
                <p>
                  請求日 {i.issued_on} ／ 支払期限 {i.due_on}
                </p>
                <p>
                  振込先 {i.bank} ／ 登録番号 {i.registration}
                </p>
                <h3>ご請求額 {formatDecimal(i.gross)} 円</h3>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        {[
                          "日付",
                          "商品／納入先",
                          "数量",
                          "単価",
                          "金額（税抜）",
                          "備考",
                        ].map((h) => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {i.lines.map((l) => (
                        <tr key={l.source_id}>
                          <td>{l.day}</td>
                          <td>
                            {l.product}
                            <small>{l.destination}</small>
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
                </div>
                <p>
                  AdBlue換算 {formatDecimal(i.quantity)}L ／ 税抜小計{" "}
                  {formatDecimal(i.net)}円 ／ 消費税 {formatDecimal(i.tax)}円 ／
                  税込合計 {formatDecimal(i.gross)}円
                </p>
                <p className="hint">
                  税設定：請求書小計×{i.tax_rule.rate}%・{i.tax_rule.rounding}
                  。明細IDを保持。
                  {i.source && i.source + " " + i.source_page + "ページ"}
                </p>
              </article>
              <div className="panel no-print">
                {i.status === "draft" && (
                  <>
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        aria-label={"請求確定確認 " + i.id}
                        checked={invoiceApprovals[i.id] || false}
                        onChange={(e) =>
                          setInvoiceApprovals((old) => ({
                            ...old,
                            [i.id]: e.target.checked,
                          }))
                        }
                      />
                      請求前チェックとこの請求書の全明細を確認しました
                    </label>
                    <button
                      className="primary"
                      disabled={busy || !invoiceApprovals[i.id]}
                      onClick={() =>
                        void run(async () => {
                          await save(
                            confirmBillingInvoice(data, i.id, actor),
                            "billing_invoice",
                            i.id,
                            "CONFIRM",
                            { before: i, confirmed_by: actor },
                          );
                          setInvoiceApprovals((old) => ({
                            ...old,
                            [i.id]: false,
                          }));
                        })
                      }
                    >
                      内容を確認して請求確定
                    </button>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await save(
                            cancelBillingDraft(data, i.id),
                            "billing_invoice",
                            i.id,
                            "CANCEL_DRAFT",
                            { before: i },
                          );
                        })
                      }
                    >
                      未確定請求書を取消（記録は保持）
                    </button>
                  </>
                )}
                <button
                  className="secondary"
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
      )}
    </>
  );
}
function LineReview({
  line,
  data,
  busy,
  commit,
}: {
  line: BillingLine;
  data: Data;
  busy: boolean;
  commit: (next: Data, detail: unknown) => Promise<void>;
}) {
  const [error, setError] = useState("");
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      setError("");
      const fields = {
        payer: String(f.get("payer")),
        category: String(f.get("category")) as TransactionCategory,
        invoice_on: String(f.get("day")),
        note: String(f.get("note")),
        quantity: String(f.get("q")),
        unit: String(f.get("unit")),
        price: String(f.get("price")),
        factor: String(f.get("factor")),
      };
      await commit(reviewBillingLine(data, line.source_id, fields), {
        before: line,
        reviewed: fields,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "確認内容を保存できません");
    }
  }
  const s = data.sales?.find((s) => s.id === line.source_id),
    i = data.billingItems?.find((i) => i.id === line.source_id),
    locked = !!issuedCoverage(data, line.source_id).length;
  return (
    <details className="import-row">
      <summary>
        {line.actual_day} / {line.destination} / {line.quantity}
        {line.unit} / {line.amount}円
      </summary>
      {error && (
        <div role="alert" className="alert error">
          {error}
        </div>
      )}
      <form onSubmit={save} key={JSON.stringify(s || i)}>
        <label className="field">
          請求先
          <select
            name="payer"
            defaultValue={lineParty(data, line) || ""}
            disabled={busy}
          >
            {[""].map((v) => (
              <option key={v} value={v}>
                未設定
              </option>
            ))}
            {(data.billingParties || []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.internal_name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          取引区分
          <select
            name="category"
            defaultValue={s?.transaction_category || i?.category || "normal"}
          >
            <option value="normal">通常売上</option>
            <option value="internal">内部取引</option>
            <option value="purchase">仕入</option>
            <option value="excluded">請求対象外</option>
          </select>
        </label>
        <label className="field">
          請求書記載日
          <input name="day" type="date" defaultValue={line.day} required />
        </label>
        <p>実給液日：{line.actual_day}（変更しません）</p>
        <div className="form-grid">
          <label className="field">
            請求数量
            <input
              name="q"
              defaultValue={line.quantity}
              readOnly={locked || !s}
            />
          </label>
          <label className="field">
            単位
            <input
              name="unit"
              defaultValue={line.unit}
              readOnly={locked || !s}
            />
          </label>
          <label className="field">
            請求単位の固定単価
            <input
              name="price"
              defaultValue={line.price}
              readOnly={locked || !s}
            />
          </label>
          <label className="field">
            L換算係数
            <input
              name="factor"
              defaultValue={s?.liters_per_unit || "1"}
              readOnly={locked || !s}
            />
          </label>
        </div>
        <label className="field">
          確認事項・日付差異等の確認記録
          <textarea
            name="note"
            defaultValue={s?.billing_review_note || i?.review_note || ""}
          />
        </label>
        <p className="hint">
          {locked
            ? "請求済みの明細は確認記録だけを追加できます。請求書は上書きしません。"
            : "価格・金額そのものを変更せず、単位と請求先・取引区分を明示的に確認します。"}
        </p>
        <button className="secondary" disabled={busy}>
          確認内容を保存
        </button>
      </form>
    </details>
  );
}
