"use client";
import { useState, type FormEvent } from "react";
import type { Data } from "@/lib/domain";
import {
  columns,
  mappedRows,
  customerMatches,
  duplicateReasons,
  rowProblems,
  registerHistory,
  createDrafts,
  normalize,
  type ReviewRow,
  type DraftInvoice,
} from "@/lib/history-import";
import { readHistoryFile } from "@/lib/history-file";
import { formatDecimal, sumDecimal, multiplyNet } from "@/lib/local-flow";
import { download, type LocalCommit } from "./local-business";
type Key = keyof typeof columns;
const aliases: Record<Key, string[]> = {
  day: ["給液日", "実給液日", "日付"],
  customer: ["顧客", "顧客名", "取引先", "会社名"],
  site: ["給液場所", "現場名", "場所"],
  address: ["住所", "給液場所住所"],
  quantity: [
    "給液量",
    "給液量(L)",
    "給液量（L）",
    "数量",
    "数量(L)",
    "実給液量",
  ],
  price: ["単価", "税抜単価", "単価（円/L）"],
  amount: ["金額", "税抜金額", "明細金額"],
  operator: ["担当者", "給液担当者"],
  slip: ["伝票番号", "納品書番号", "伝票番号等"],
  notes: ["備考", "メモ"],
};
export function HistoryImport({
  data,
  actor,
  commit,
}: {
  data: Data;
  actor: string;
  commit: LocalCommit;
}) {
  const [sheets, setSheets] = useState<{ name: string; table: string[][] }[]>(
      [],
    ),
    [sheet, setSheet] = useState(0),
    [header, setHeader] = useState(0),
    [fileName, setFileName] = useState(""),
    [encoding, setEncoding] = useState("utf-8"),
    [mapping, setMapping] = useState<Record<Key, number>>(
      {} as Record<Key, number>,
    ),
    [rows, setRows] = useState<ReviewRow[]>([]),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [taxBasis, setTaxBasis] = useState(false),
    [applyRelated, setApplyRelated] = useState(false);
  function configure(table: string[][], h: number) {
    setMapping(
      Object.fromEntries(
        Object.keys(columns).map((k) => [
          k,
          (table[h] || []).findIndex((v) =>
            aliases[k as Key].includes(v.trim()),
          ),
        ]),
      ) as Record<Key, number>,
    );
    setRows([]);
    setConfirmed(false);
  }
  async function load(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError("");
    setMessage("");
    setRows([]);
    setSheets([]);
    setConfirmed(false);
    setTaxBasis(false);
    try {
      const result = await readHistoryFile(file, encoding);
      if (!result.length) throw new Error("シートがありません");
      setSheets(result);
      setSheet(0);
      setHeader(0);
      setFileName(file.name);
      configure(result[0].table, 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "ファイルを読めません");
    } finally {
      setBusy(false);
    }
  }
  function edit(i: number, patch: Partial<ReviewRow>) {
    setRows((old) =>
      old.map((r, n) =>
        n === i
          ? {
              ...r,
              ...patch,
              approved: patch.approved ?? false,
              duplicateApproved: patch.duplicateApproved ?? false,
            }
          : r,
      ),
    );
    setConfirmed(false);
    setMessage("");
  }
  function editLinks(
    i: number,
    patch: Partial<ReviewRow>,
    kind: "customer" | "site",
  ) {
    if (!applyRelated) {
      edit(i, patch);
      return;
    }
    const current = rows[i];
    setRows((old) =>
      old.map((r) =>
        normalize(r.customer) === normalize(current.customer) &&
        (kind === "customer" ||
          (normalize(r.site) === normalize(current.site) &&
            normalize(r.address) === normalize(current.address)))
          ? { ...r, ...patch, approved: false, duplicateApproved: false }
          : r,
      ),
    );
    setConfirmed(false);
    setMessage("");
  }
  function preview() {
    try {
      for (const key of [
        "day",
        "customer",
        "site",
        "quantity",
        "price",
      ] as Key[])
        if (mapping[key] === undefined || mapping[key] < 0)
          throw new Error(`${columns[key]}の列を選んでください`);
      setRows(mappedRows(sheets[sheet].table, header, mapping));
      setError("");
      setConfirmed(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "列を確認してください");
    }
  }
  async function save() {
    if (!confirmed || !taxBasis) return;
    setBusy(true);
    setError("");
    try {
      const next = registerHistory(
        data,
        rows,
        fileName,
        sheets[sheet].name,
        actor,
      );
      const count = rows.filter((r) => r.include).length;
      await commit(
        next,
        "historical_import",
        crypto.randomUUID(),
        "INSERT",
        JSON.stringify({
          filename: fileName,
          sheet: sheets[sheet].name,
          count,
          actor,
          rows: rows.filter((r) => r.include),
        }),
      );
      setRows([]);
      setSheets([]);
      setConfirmed(false);
      setMessage(`${count}件の過去給液実績と売上を登録しました`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setBusy(false);
    }
  }
  const problems = rows
    .filter((r) => r.include)
    .flatMap((r) => rowProblems(data, r, rows).map((e) => `${r.row}行：${e}`));
  return (
    <>
      <h1>過去給液実績の一括取込</h1>
      <p>
        受注・予定を経ずに登録します。ファイル選択やプレビューだけでは保存しません。単価・金額が税抜か資料で確認してください。
      </p>
      {error && (
        <div role="alert" className="alert error">
          {error}
        </div>
      )}
      {message && (
        <div role="status" className="alert success">
          {message}
        </div>
      )}
      <section className="panel">
        <label className="field">
          CSV文字コード
          <select
            aria-label="CSV文字コード"
            value={encoding}
            onChange={(e) => setEncoding(e.target.value)}
          >
            <option value="utf-8">UTF-8</option>
            <option value="shift_jis">Shift-JIS（Windows CSV）</option>
          </select>
        </label>
        <label className="field">
          給液履歴ファイル
          <input
            aria-label="給液履歴ファイル"
            type="file"
            accept=".csv,.xlsx"
            disabled={busy}
            onChange={(e) => {
              void load(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
        <p className="hint">
          CSV／xlsx、10MB、2000明細まで。xlsxの数式は実行せず、値に変換した資料を使用します。マクロ・xlsは未対応です。
        </p>
        <button
          className="secondary"
          onClick={() =>
            download(
              "給液日,顧客,給液場所,住所,給液量,単価,金額,担当者,伝票番号,備考\r\n2026-08-01,検証用会社,第一車庫,藤沢市,100,100,10000,確認担当,TEST-001,サンプル（実資料ではありません）\r\n",
              "過去給液履歴-テンプレート.csv",
              "text/csv;charset=utf-8",
            )
          }
        >
          CSVテンプレートを保存
        </button>
        {!!sheets.length && (
          <>
            <p>{fileName}</p>
            <label>
              取込シート
              <select
                aria-label="取込シート"
                value={sheet}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  setSheet(n);
                  setHeader(0);
                  configure(sheets[n].table, 0);
                }}
              >
                {sheets.map((s, i) => (
                  <option key={i} value={i}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              見出し行
              <input
                aria-label="見出し行"
                type="number"
                min="1"
                max={sheets[sheet].table.length}
                value={header + 1}
                onChange={(e) => {
                  const h = Math.max(0, Number(e.target.value) - 1);
                  setHeader(h);
                  configure(sheets[sheet].table, h);
                }}
              />
            </label>
            <div className="form-grid">
              {Object.entries(columns).map(([k, label]) => (
                <label className="field" key={k}>
                  {label}の列
                  <select
                    aria-label={label + "の列"}
                    value={mapping[k as Key] ?? -1}
                    onChange={(e) => {
                      setMapping({ ...mapping, [k]: Number(e.target.value) });
                      setRows([]);
                      setConfirmed(false);
                    }}
                  >
                    <option value="-1">なし／手入力</option>
                    {(sheets[sheet].table[header] || []).map((h, i) => (
                      <option key={i} value={i}>
                        {i + 1}: {h || "空見出し"}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <button className="primary" onClick={preview} disabled={busy}>
              確認用プレビューを表示
            </button>
          </>
        )}
      </section>
      {!!rows.length && (
        <>
          <section className="panel">
            <h2>取込前確認（{rows.filter((r) => r.include).length}件選択）</h2>
            <p>
              候補は自動確定しません。各行で顧客・場所の選択と確認を行ってください。金額不一致は原資料の確認が必要です。
            </p>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={applyRelated}
                onChange={(e) => setApplyRelated(e.target.checked)}
              />
              顧客・場所の選択を同じ名称の行にも適用する（顧客は同名、場所は同名・同住所のみ）
            </label>
            {rows.map((r, i) => {
              const candidates = customerMatches(data, r.customer),
                sites = (data.sites || []).filter(
                  (s) => s.customer_id === r.customerId && s.active,
                ),
                duplicates = duplicateReasons(data, r, rows);
              let product = "未計算";
              try {
                product = multiplyNet(r.quantity, r.price);
              } catch {}
              return (
                <details className="import-row" open key={r.row}>
                  <summary>
                    {r.row}行 · {r.day} · {r.customer} · {r.site} · {r.quantity}{" "}
                    L · {r.amount || product} 円{" "}
                    {r.approved ? "確認済み" : "未確認"}
                  </summary>
                  <label>
                    <input
                      type="checkbox"
                      checked={r.include}
                      onChange={(e) => edit(i, { include: e.target.checked })}
                    />
                    この行を取り込む
                  </label>
                  <div className="form-grid">
                    {Object.entries(columns).map(([k, label]) => (
                      <label className="field" key={k}>
                        {label}
                        <input
                          aria-label={`${r.row}行 ${label}`}
                          type={k === "day" ? "date" : "text"}
                          value={r[k as Key]}
                          onChange={(e) => edit(i, { [k]: e.target.value })}
                        />
                      </label>
                    ))}
                  </div>
                  <p>
                    顧客候補：
                    {candidates.length
                      ? candidates.map((c) => c.name).join(" / ")
                      : "未一致"}
                  </p>
                  <label>
                    登録先顧客
                    <select
                      aria-label={`${r.row}行 登録先顧客`}
                      value={r.newCustomer ? "new" : r.customerId}
                      onChange={(e) =>
                        editLinks(
                          i,
                          {
                            customerId:
                              e.target.value === "new" ? "" : e.target.value,
                            newCustomer: e.target.value === "new",
                            siteId: "",
                            newSite: false,
                          },
                          "customer",
                        )
                      }
                    >
                      <option value="">未一致／未選択</option>
                      <option value="new">新規顧客として追加</option>
                      {data.customers
                        .filter((c) => c.active)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <p>
                    場所候補：
                    {sites
                      .filter(
                        (s) =>
                          s.name.normalize("NFKC").trim() ===
                          r.site.normalize("NFKC").trim(),
                      )
                      .map((s) => s.name + " / " + s.address)
                      .join(" / ") || "未一致"}
                  </p>
                  <label>
                    登録先給液場所
                    <select
                      aria-label={`${r.row}行 登録先給液場所`}
                      value={r.newSite ? "new" : r.siteId}
                      onChange={(e) =>
                        editLinks(
                          i,
                          {
                            siteId:
                              e.target.value === "new" ? "" : e.target.value,
                            newSite: e.target.value === "new",
                          },
                          "site",
                        )
                      }
                    >
                      <option value="">未一致／未選択</option>
                      <option value="new">新規給液場所として追加</option>
                      {sites.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} / {s.address}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p>
                    数量×記載単価：{product} 円（税抜）。記載金額：
                    {r.amount || "なし"}
                    。履歴の単価はマスターへ自動登録せず、実績に固定します。
                  </p>
                  <label>
                    <input
                      type="checkbox"
                      checked={r.useSourceAmount}
                      onChange={(e) =>
                        edit(i, { useSourceAmount: e.target.checked })
                      }
                    />
                    原資料を確認し、記載金額を採用する（丸めルールの確定ではありません）
                  </label>
                  {!!duplicates.length && (
                    <div className="alert error">
                      重複の可能性：{duplicates.join(" / ")}
                      <label>
                        <input
                          type="checkbox"
                          checked={r.duplicateApproved}
                          onChange={(e) =>
                            edit(i, { duplicateApproved: e.target.checked })
                          }
                        />
                        別の実績であることを確認して取り込む
                      </label>
                    </div>
                  )}
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      aria-label={`${r.row}行 内容と紐付けを確認`}
                      checked={r.approved}
                      onChange={(e) =>
                        edit(i, {
                          approved: e.target.checked,
                          duplicateApproved: r.duplicateApproved,
                        })
                      }
                    />
                    この行の内容と顧客・場所の紐付けを確認しました
                  </label>
                </details>
              );
            })}
          </section>
          <section className="panel">
            <p>確認待ち：{problems.length}項目</p>
            {problems.slice(0, 12).map((p, i) => (
              <p className="hint" key={i}>
                {p}
              </p>
            ))}
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={taxBasis}
                onChange={(e) => {
                  setTaxBasis(e.target.checked);
                  setConfirmed(false);
                }}
              />
              資料の単価・金額が税抜であることを確認しました
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              選択した全行を確認して一括登録します
            </label>
            <button
              className="primary"
              disabled={busy || !confirmed || !taxBasis || !!problems.length}
              onClick={save}
            >
              確認した過去実績を登録
            </button>
          </section>
        </>
      )}
    </>
  );
}
function Comparison({
  draft,
  data,
  commit,
}: {
  draft: DraftInvoice;
  data: Data;
  commit: LocalCommit;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setError("");
    setBusy(true);
    try {
      const reference = {
        quantity: String(f.get("quantity")).trim(),
        net: String(f.get("net")).trim(),
        tax: String(f.get("tax")).trim(),
        gross: String(f.get("gross")).trim(),
        notes: String(f.get("notes")).trim(),
      };
      for (const k of ["quantity", "net", "tax", "gross"] as const)
        if (reference[k]) sumDecimal([reference[k]]);
      await commit(
        {
          ...data,
          invoiceDrafts: (data.invoiceDrafts || []).map((d) =>
            d.id === draft.id ? { ...d, reference } : d,
          ),
        },
        "invoice_comparison",
        draft.id,
        "UPDATE",
        JSON.stringify({ before: draft.reference, after: reference }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存できません");
    } finally {
      setBusy(false);
    }
  }
  const equal = (a: string, b: string) =>
    b ? (sumDecimal([a]) === sumDecimal([b]) ? "一致" : "不一致") : "未入力";
  return (
    <section className="panel no-print">
      <h3>発行済み請求書との照合：{draft.customer_name}</h3>
      {error && <div role="alert">{error}</div>}
      <form onSubmit={save} key={draft.id + JSON.stringify(draft.reference)}>
        <div className="form-grid">
          {[
            ["quantity", "合計数量"],
            ["net", "税抜合計"],
            ["tax", "消費税"],
            ["gross", "税込請求額"],
            ["notes", "照合メモ・請求書番号"],
          ].map(([k, label]) => (
            <label className="field" key={k}>
              発行済み {label}
              <input
                name={k}
                defaultValue={
                  draft.reference?.[
                    k as keyof NonNullable<DraftInvoice["reference"]>
                  ] || ""
                }
              />
            </label>
          ))}
        </div>
        <button disabled={busy} className="secondary">
          照合値を保存
        </button>
      </form>
      {draft.reference && (
        <>
          <p>
            数量：{equal(draft.quantity, draft.reference.quantity)} ／
            税抜合計：{equal(draft.net, draft.reference.net)}
          </p>
          <p>
            消費税・税込請求額：判定保留（税ルール未確定）。発行済みの金額は比較資料としてのみ保存します。
          </p>
        </>
      )}
    </section>
  );
}
export function InvoiceWorkspace({
  data,
  actor,
  commit,
}: {
  data: Data;
  actor: string;
  commit: LocalCommit;
}) {
  const [rebuild, setRebuild] = useState(false);
  const [month, setMonth] = useState("2026-08"),
    [selected, setSelected] = useState<string[]>([]),
    [approved, setApproved] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const customers = data.customers.filter((c) =>
      (data.sales || []).some(
        (s) => s.customer_id === c.id && s.delivered_on.startsWith(month),
      ),
    ),
    drafts = (data.invoiceDrafts || []).filter(
      (d) => d.month === month && !d.superseded_at,
    );
  async function create() {
    if (!approved) return;
    setBusy(true);
    setError("");
    try {
      const next = createDrafts(data, month, selected, actor, rebuild);
      await commit(
        next,
        "invoice_drafts",
        month,
        "INSERT",
        JSON.stringify({
          rebuild,
          drafts: next.invoiceDrafts!.slice((data.invoiceDrafts || []).length),
        }),
      );
      setSelected([]);
      setApproved(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "作成できません");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="no-print">
        <h1>月次検証請求書・照合</h1>
        <p>
          顧客ごとに対象月の全給液明細をまとめます。請求済みの実績も検証対象です。税・締め処理が未確定のため正式発行はしません。
        </p>
        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}
        <section className="panel">
          <label>
            請求対象月
            <input
              aria-label="請求対象月"
              type="month"
              value={month}
              onChange={(e) => {
                setMonth(e.target.value);
                setSelected([]);
                setApproved(false);
              }}
            />
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={rebuild}
              onChange={(e) => {
                setRebuild(e.target.checked);
                setSelected([]);
                setApproved(false);
              }}
            />
            作成済みも現売上で再作成する（旧版は保存し、新しい照合値を入力します）
          </label>
          <p>請求先を選択（複数選択できます）</p>
          {customers.map((c) => (
            <label className="checkbox-row" key={c.id}>
              <input
                type="checkbox"
                aria-label={"請求先 " + c.name}
                disabled={
                  !rebuild && drafts.some((d) => d.customer_id === c.id)
                }
                checked={selected.includes(c.id)}
                onChange={(e) => {
                  setSelected((old) =>
                    e.target.checked
                      ? [...old, c.id]
                      : old.filter((id) => id !== c.id),
                  );
                  setApproved(false);
                }}
              />
              {c.name}
              {drafts.some((d) => d.customer_id === c.id) && "（作成済み）"}
            </label>
          ))}
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={approved}
              onChange={(e) => setApproved(e.target.checked)}
            />
            対象月と請求先を確認しました
          </label>
          <button
            className="primary"
            disabled={busy || !selected.length || !approved}
            onClick={create}
          >
            選択顧客の検証請求書を一括作成
          </button>
          <button
            className="secondary spaced"
            disabled={!drafts.length}
            onClick={() => window.print()}
          >
            表示中の請求書を印刷・PDF保存
          </button>
          <p className="hint">
            作成後の明細は固定します。追加取込がある場合は下に差異を表示します。発行済み値はシステム計算へ流用しません。
          </p>
        </section>
      </div>
      {drafts.map((d) => {
        const sales = (data.sales || []).filter(
            (s) =>
              s.customer_id === d.customer_id &&
              s.delivered_on.startsWith(month),
          ),
          stale =
            sales.length !== d.lines.length ||
            sales.some(
              (s) =>
                !d.lines.some(
                  (l) => l.sale_id === s.id && l.amount === s.net_amount,
                ),
            );
        return (
          <div key={d.id}>
            <article className="panel invoice-page">
              <h2>請求書（検証用・未確定）</h2>
              <p>請求先：{d.customer_name} 御中</p>
              <p>{d.customer_address}</p>
              <p>
                対象年月：{d.month} ／ 管理ID：{d.id.slice(0, 8)}
              </p>
              {stale && (
                <p className="alert error">
                  作成後に対象売上が変わりました。この検証請求書には追加実績を含みません。照合前に資料を再確認してください。
                </p>
              )}
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      {[
                        "給液日",
                        "給液場所",
                        "伝票番号",
                        "給液量(L)",
                        "単価(円/L)",
                        "明細金額(税抜)",
                      ].map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {d.lines.map((l) => (
                      <tr key={l.sale_id}>
                        <td>{l.day}</td>
                        <td>{l.site}</td>
                        <td>{l.slip || "—"}</td>
                        <td>{formatDecimal(l.quantity)}</td>
                        <td>{formatDecimal(l.price)}</td>
                        <td>
                          {formatDecimal(l.amount)}
                          {sumDecimal([l.amount]) !==
                            sumDecimal([multiplyNet(l.quantity, l.price)]) && (
                            <small>
                              記載金額採用（計算値：
                              {multiplyNet(l.quantity, l.price)}）
                            </small>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <dl className="details">
                <dt>月間合計数量</dt>
                <dd>{formatDecimal(d.quantity)} L</dd>
                <dt>税抜合計</dt>
                <dd>{formatDecimal(d.net)} 円</dd>
                <dt>消費税</dt>
                <dd>未確定（実資料確認待ち）</dd>
                <dt>税込請求金額</dt>
                <dd>未確定（実資料確認待ち）</dd>
              </dl>
              <p className="hint">
                税率10%の前提。税計算単位・丸め・締日は未確定。正式な請求書として使用しないでください。
              </p>
            </article>
            <Comparison draft={d} data={data} commit={commit} />
          </div>
        );
      })}
      {!drafts.length && (
        <p className="no-print">この月の検証請求書はまだありません。</p>
      )}
    </>
  );
}
