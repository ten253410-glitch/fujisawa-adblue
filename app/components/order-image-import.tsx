"use client";
import { useEffect, useId, useState, type FormEvent } from "react";
import { Camera, FileImage, Check, ScanLine, ArrowLeft } from "lucide-react";
import {
  type Customer,
  type Data,
  type Order,
  currentPrice,
  japanDate,
} from "@/lib/domain";
import {
  blankRead,
  customerCandidates,
  sanitizeRead,
  validateReviewed,
  type ReadFields,
  type ReadResult,
} from "@/lib/order-import";
import { supabase } from "@/lib/supabase";
export type ImportConfirmation = {
  file: File;
  preview: string;
  result: ReadResult;
  reviewed: ReadFields;
  customerId: string;
  newCustomer: Customer | null;
  channel: Order["channel"];
  scheduledOn: string | null;
};
function InputField({
  label,
  value,
  onChange,
  type = "text",
  required = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        step={type === "number" ? "any" : undefined}
        min={type === "number" ? "0.0001" : undefined}
      />
    </div>
  );
}
export default function OrderImageImport({
  data,
  mode,
  onConfirm,
}: {
  data: Data;
  mode: "demo" | "live";
  onConfirm: (input: ImportConfirmation) => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState(""),
    [readingImage, setReadingImage] = useState("");
  const [result, setResult] = useState<ReadResult | null>(null),
    [fields, setFields] = useState<ReadFields>(blankRead),
    [customerId, setCustomerId] = useState(""),
    [newCustomer, setNewCustomer] = useState(false),
    [newPhone, setNewPhone] = useState("");
  const [channel, setChannel] = useState<Order["channel"]>("fax"),
    [scheduled, setScheduled] = useState(""),
    [approved, setApproved] = useState(false),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(
    () => () => {
      if (preview.startsWith("blob:")) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  function change<K extends keyof ReadFields>(key: K, value: ReadFields[K]) {
    setFields((old) => ({ ...old, [key]: value }));
    setApproved(false);
  }
  async function selectFile(selected: File | undefined) {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      if (!["image/jpeg", "image/png", "image/webp"].includes(selected.type))
        throw new Error(
          "JPEG・PNG・WebPを選択してください。PDF・HEICは画像へ変換してください。",
        );
      if (selected.size > 10 * 1024 * 1024)
        throw new Error("画像は10MB以下にしてください");
      const converted = await readingData(selected);
      setFile(selected);
      setPreview(URL.createObjectURL(selected));
      setReadingImage(converted);
      setResult(null);
      setFields(blankRead());
      setCustomerId("");
      setNewCustomer(false);
      setNewPhone("");
      setScheduled("");
      setApproved(false);
      setConsent(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "画像を開けません");
    } finally {
      setBusy(false);
    }
  }
  function useResult(next: ReadResult) {
    setResult(next);
    setFields({ ...next.fields });
    setApproved(false);
    setCustomerId("");
    setNewCustomer(false);
    setError("");
  }
  async function read() {
    setBusy(true);
    setError("");
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (mode === "live") {
        const { data: s } = await supabase!.auth.getSession();
        if (!s.session) throw new Error("再ログインしてください");
        headers.Authorization = `Bearer ${s.session.access_token}`;
      }
      const response = await fetch("/api/order-ocr", {
        method: "POST",
        headers,
        body: JSON.stringify({ image: readingImage }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "読み取りに失敗しました");
      const clean = sanitizeRead({ ...body.fields, warnings: body.warnings });
      useResult({
        ...clean,
        method: "openai",
        model: typeof body.model === "string" ? body.model : null,
      });
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "読み取りに失敗しました。手入力で続けられます。",
      );
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (!approved || !file || !result)
        throw new Error("原画像と入力内容を確認してください");
      validateReviewed(fields);
      let created: Customer | null = null;
      let selected = customerId;
      if (newCustomer) {
        selected = crypto.randomUUID();
        created = {
          id: selected,
          name: fields.customer_name!.trim(),
          contact: fields.contact || "",
          phone: newPhone.trim(),
          address: fields.address || fields.location || "",
          notes: "受注画像の確認画面から登録",
          active: true,
        };
      } else if (!data.customers.some((c) => c.id === selected && c.active))
        throw new Error("登録先の顧客を選択してください");
      await onConfirm({
        file,
        preview: readingImage,
        result,
        reviewed: { ...fields },
        customerId: selected,
        newCustomer: created,
        channel,
        scheduledOn: scheduled || null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "登録に失敗しました");
    } finally {
      setBusy(false);
    }
  }
  const candidates = customerCandidates(data.customers, fields),
    selected = data.customers.find((c) => c.id === customerId),
    priceDay = scheduled || fields.requested_on || "",
    price =
      selected && priceDay
        ? currentPrice(data.prices, selected.id, priceDay)
        : undefined;
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ORDER IMAGE IMPORT</p>
          <h1>受注画像取込</h1>
          <p className="muted">
            FAX・紙・LINEの画像から候補を読み取り、確認して登録。
          </p>
        </div>
      </div>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      <section className="panel">
        <div className="image-steps">
          <span>1. 画像を選択</span>
          <span className={result ? "enabled" : ""}>2. 読み取り・修正</span>
          <span>3. 確認して登録</span>
        </div>
        <div className="inline">
          <label className="primary upload-button">
            <Camera size={18} />
            受注書を撮影
            <input
              aria-label="受注書を撮影"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              disabled={busy}
              onChange={(e) => {
                selectFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          <label className="secondary upload-button">
            <FileImage size={18} />
            受注画像を選択
            <input
              aria-label="受注画像を選択"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy}
              onChange={(e) => {
                selectFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        <p className="hint">
          JPEG / PNG /
          WebP・10MB以内。1枚の受注書を対象にします。PDF・複数案件の一括処理は未対応です。
        </p>
        {file && (
          <p className="hint">
            選択中：{file.name}（変更すると読み取り・修正内容を破棄します）
          </p>
        )}
      </section>
      {file && (
        <div className="image-review-grid">
          <section className="panel original-panel">
            <h2>原画像</h2>
            <a href={preview} target="_blank" rel="noreferrer">
              <img
                className="order-original"
                src={preview}
                alt="取り込んだ受注原画像"
              />
            </a>
            <p className="hint">
              画像をクリックすると拡大表示します。原画像と照らし合わせて確認してください。
            </p>
          </section>
          <section className="panel">
            {!result ? (
              <>
                <h2>読み取り方法</h2>
                <p>
                  読めない文字・日付・数量は推測せず、確認画面で入力します。
                </p>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                  />
                  この受注画像をOpenAIへ送信して読み取る（利用料金が発生します）
                </label>
                <button
                  className="primary"
                  disabled={busy || !consent}
                  onClick={read}
                >
                  <ScanLine size={18} />
                  {busy ? "処理中…" : "AIで画像を読み取る"}
                </button>
                <button
                  className="secondary spaced"
                  disabled={busy}
                  onClick={() =>
                    useResult({
                      fields: blankRead(),
                      warnings: [
                        "AI読み取りを使用していません。原画像から入力してください。",
                      ],
                      method: "manual",
                      model: null,
                    })
                  }
                >
                  手入力で確認へ
                </button>
                {mode === "demo" && (
                  <div className="subform">
                    <h3>確認画面の操作サンプル</h3>
                    <p className="hint">
                      下のボタンは実画像の読み取りではありません。架空の候補を表示します。
                    </p>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        useResult({
                          fields: {
                            customer_name: "湘南運送",
                            location: "藤沢車庫",
                            address: "藤沢市（サンプル住所）",
                            quantity_l: 200,
                            requested_on: null,
                            received_on: japanDate(),
                            contact: "0466-00-0001",
                            notes:
                              "操作確認用サンプル。実画像の内容ではありません。",
                          },
                          warnings: [
                            "サンプル候補です。実画像は解析していません。",
                          ],
                          model: null,
                          method: "sample",
                        })
                      }
                    >
                      サンプル候補で確認画面を試す
                    </button>
                  </div>
                )}
              </>
            ) : (
              <form onSubmit={submit}>
                <h2>受注内容の確認・修正</h2>
                <p className="method-badge">
                  {result.method === "openai"
                    ? `AI読取候補（${result.model}）`
                    : result.method === "manual"
                      ? "手入力"
                      : "サンプル候補：実画像の読取ではありません"}
                </p>
                {result.warnings.length > 0 && (
                  <ul className="read-warnings">
                    {result.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                )}
                <div className="field">
                  <label htmlFor="image-channel">受注経路</label>
                  <select
                    id="image-channel"
                    value={channel}
                    onChange={(e) => {
                      setChannel(e.target.value as Order["channel"]);
                      setApproved(false);
                    }}
                  >
                    <option value="fax">FAX</option>
                    <option value="paper">紙の受注書</option>
                    <option value="line">LINE画像</option>
                    <option value="image">その他画像</option>
                  </select>
                </div>
                <InputField
                  label="読み取り顧客名 *"
                  value={fields.customer_name || ""}
                  required
                  onChange={(v) => change("customer_name", v || null)}
                />
                <div className="candidate-panel">
                  <h3>既存顧客の候補（自動選択しません）</h3>
                  {candidates.length ? (
                    candidates.map((c) => (
                      <button
                        type="button"
                        className={`candidate ${customerId === c.customer.id ? "selected" : ""}`}
                        key={c.customer.id}
                        onClick={() => {
                          setCustomerId(c.customer.id);
                          setNewCustomer(false);
                          setApproved(false);
                        }}
                      >
                        <strong>{c.customer.name}</strong>
                        <small>{c.reasons.join(" / ")}</small>
                      </button>
                    ))
                  ) : (
                    <p className="hint">
                      一致する候補がありません。全顧客から選ぶか、新規顧客として登録してください。
                    </p>
                  )}
                  <div className="field">
                    <label htmlFor="matched-customer">登録先の顧客</label>
                    <select
                      id="matched-customer"
                      disabled={newCustomer}
                      value={customerId}
                      onChange={(e) => {
                        setCustomerId(e.target.value);
                        setApproved(false);
                      }}
                    >
                      <option value="">選択してください</option>
                      {data.customers
                        .filter((c) => c.active)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                  </div>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={newCustomer}
                      onChange={(e) => {
                        setNewCustomer(e.target.checked);
                        setCustomerId("");
                        setApproved(false);
                      }}
                    />
                    新規顧客として追加する（単価は登録しません）
                  </label>
                  {newCustomer && (
                    <InputField
                      label="新規顧客の電話番号（確認して入力）"
                      value={newPhone}
                      onChange={(v) => {
                        setNewPhone(v);
                        setApproved(false);
                      }}
                    />
                  )}
                  {selected && !newCustomer && (
                    <div className="master-comparison">
                      <strong>照合先：{selected.name}</strong>
                      <dl className="details">
                        <dt>登録場所・住所</dt>
                        <dd>{selected.address || "未登録"}</dd>
                        <dt>登録連絡先</dt>
                        <dd>
                          {selected.contact} {selected.phone || "未登録"}
                        </dd>
                        <dt>参考単価</dt>
                        <dd>
                          {price
                            ? `${price.amount} 円/L（税抜）`
                            : "対象日に有効な単価なし／日付未入力"}
                          <small className="muted">
                            {priceDay && ` · ${priceDay}時点`} ·
                            給液実績の単価は実給液日に確定
                          </small>
                        </dd>
                      </dl>
                      <p className="hint">
                        画像の内容で顧客マスターや単価を自動上書きしません。
                      </p>
                    </div>
                  )}
                </div>
                <div className="form-grid">
                  <InputField
                    label="給液場所／現場名"
                    value={fields.location || ""}
                    onChange={(v) => change("location", v || null)}
                  />
                  <InputField
                    label="住所"
                    value={fields.address || ""}
                    onChange={(v) => change("address", v || null)}
                  />
                  <InputField
                    label="依頼数量（L・未定なら空欄）"
                    type="number"
                    value={
                      fields.quantity_l === null
                        ? ""
                        : String(fields.quantity_l)
                    }
                    onChange={(v) =>
                      change("quantity_l", v === "" ? null : Number(v))
                    }
                  />
                  <InputField
                    label="希望給液日"
                    type="date"
                    value={fields.requested_on || ""}
                    onChange={(v) => change("requested_on", v || null)}
                  />
                  <InputField
                    label="受注日 *"
                    type="date"
                    value={fields.received_on || ""}
                    required
                    onChange={(v) => change("received_on", v || null)}
                  />
                  <InputField
                    label="電話番号等の連絡先"
                    value={fields.contact || ""}
                    onChange={(v) => change("contact", v || null)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="image-notes">備考</label>
                  <textarea
                    id="image-notes"
                    value={fields.notes || ""}
                    onChange={(e) => change("notes", e.target.value || null)}
                  />
                </div>
                <InputField
                  label="確定した給液予定日（任意・希望日とは別）"
                  type="date"
                  value={scheduled}
                  onChange={(v) => {
                    setScheduled(v);
                    setApproved(false);
                  }}
                />
                <p className="hint">
                  希望給液日は予定を確定しません。数量は依頼数量であり、納品書の実給液量ではありません。
                </p>
                <label className="checkbox-row confirmation">
                  <input
                    type="checkbox"
                    required
                    checked={approved}
                    onChange={(e) => setApproved(e.target.checked)}
                  />
                  原画像・登録先顧客・数量・日付を確認し、修正後の内容で登録します
                </label>
                <div className="inline">
                  <button
                    className="secondary"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setResult(null);
                      setApproved(false);
                    }}
                  >
                    <ArrowLeft size={16} />
                    読み取り方法へ
                  </button>
                  <button className="primary" disabled={busy || !approved}>
                    <Check size={18} />
                    {busy ? "登録中…" : "確認した内容で受注登録"}
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      )}
    </>
  );
}
async function readingData(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const c = canvas.getContext("2d");
  if (!c) throw new Error("画像処理を利用できません");
  c.fillStyle = "white";
  c.fillRect(0, 0, canvas.width, canvas.height);
  c.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const data = canvas.toDataURL("image/jpeg", 0.9);
  if (data.length > 3_800_000)
    throw new Error(
      "読み取り用画像が大きすぎます。解像度を下げて選び直してください",
    );
  return data;
}
