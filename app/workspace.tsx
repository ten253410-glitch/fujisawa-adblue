"use client";
import {
  useEffect,
  useState,
  useId,
  cloneElement,
  isValidElement,
  type ReactElement,
  type FormEvent,
} from "react";
import {
  LayoutDashboard,
  CalendarDays,
  Users,
  MessageSquare,
  Phone,
  Camera,
  Search,
  LogOut,
  Droplets,
  ArrowRight,
  Plus,
  Check,
  Copy,
  FileText,
  Menu,
  History,
  X,
  RefreshCw,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { loadRemote, writeRemote } from "@/lib/repository";
import {
  type Data,
  type Customer,
  type Order,
  type Price,
  type Document,
  emptyData,
  demoSeed,
  japanDate,
  addDays,
  weekEnd,
  suggestFromLine,
  validateQuantity,
  currentPrice,
  lineReply,
  statusNames,
} from "@/lib/domain";

type View =
  | "home"
  | "customers"
  | "order"
  | "schedule"
  | "documents"
  | "detail"
  | "billing"
  | "audit";
const demoKey = "fujisawa-adblue-demo-v1";
const fmt = (day: string) => (day ? day.replaceAll("-", "/") : "未定");
const timestamp = (value: string) =>
  new Date(value).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>
        <span>{label}</span>
      </label>
      {isValidElement(children)
        ? cloneElement(children as ReactElement<{ id: string }>, { id })
        : children}
    </div>
  );
}

export default function Workspace() {
  const [mode, setMode] = useState<"demo" | "live" | null>(null);
  const [actor, setActor] = useState("");
  const [data, setData] = useState<Data>(emptyData());
  const [view, setView] = useState<View>("home");
  const [channel, setChannel] = useState<"line" | "phone">("line");
  const [selected, setSelected] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!!supabase);
  const [customerForm, setCustomerForm] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [raw, setRaw] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("L");
  const [loginName, setLoginName] = useState("土屋");
  const [uploadOrder, setUploadOrder] = useState("");
  const today = japanDate();
  const customer = (id: string) => data.customers.find((c) => c.id === id);
  const activeOrders = data.orders.filter(
    (o) => o.status !== "cancelled" && o.status !== "completed",
  );
  const currentOrder = data.orders.find((o) => o.id === selected);
  const currentCustomer = customer(customerId);
  const nav = (v: View) => {
    setView(v);
    setMenuOpen(false);
    setError("");
    setNotice("");
    setSearch("");
    setFilter("all");
    setCustomerForm(false);
  };
  const openOrder = (o: Order) => {
    setSelected(o.id);
    nav("detail");
  };
  const beginOrder = (c: "line" | "phone") => {
    setChannel(c);
    setCustomerId("");
    setRaw("");
    setQty("");
    setUnit("L");
    nav("order");
  };
  async function enterLive() {
    if (!supabase) return;
    const { data: sessionData, error: se } = await supabase.auth.getSession();
    if (se) throw se;
    if (!sessionData.session) {
      setMode(null);
      return;
    }
    const { data: member, error: me } = await supabase
      .from("memberships")
      .select("display_name")
      .eq("user_id", sessionData.session.user.id)
      .maybeSingle();
    if (me) throw me;
    if (!member) {
      await supabase.auth.signOut();
      throw new Error(
        "管理者として登録されていません。Supabaseで管理者メンバーを設定してください。",
      );
    }
    const remote = await loadRemote();
    setData(remote);
    setActor(member.display_name);
    setMode("live");
  }
  useEffect(() => {
    let alive = true;
    if (!supabase) return;
    enterLive()
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    const { data: subscription } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        setMode(null);
        setData(emptyData());
      }
    });
    return () => {
      alive = false;
      subscription.subscription.unsubscribe();
    };
  }, []); // eslint-disable-line
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "処理に失敗しました。接続と入力内容を確認してください。",
      );
    } finally {
      setBusy(false);
    }
  }
  function saveDemo(
    next: Data,
    entity: string,
    id: string,
    action: string,
    detail: string,
  ) {
    const result = {
      ...next,
      audit: [
        {
          id: crypto.randomUUID(),
          actor_name: actor,
          action,
          entity,
          entity_id: id,
          created_at: new Date().toISOString(),
          detail,
        },
        ...next.audit,
      ],
    };
    localStorage.setItem(demoKey, JSON.stringify(result));
    setData(result);
  }
  async function persist(
    kind: "customers" | "orders" | "prices" | "documents",
    record: Customer | Order | Price | Document,
    update = false,
  ) {
    if (mode === "live") {
      const table = {
        customers: "customers",
        orders: "orders",
        prices: "customer_prices",
        documents: "delivery_documents",
      }[kind];
      await writeRemote(table, record, update ? record.id : undefined);
      setData(await loadRemote());
    } else {
      const next = {
        ...data,
        [kind]: update
          ? data[kind].map((r) => (r.id === record.id ? record : r))
          : [...data[kind], record],
      };
      const before = update ? data[kind].find((r) => r.id === record.id) : null;
      saveDemo(
        next,
        kind,
        record.id,
        update ? "UPDATE" : "INSERT",
        JSON.stringify({ before, after: record }),
      );
    }
  }
  async function login(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const values = new FormData(e.currentTarget);
    await run(async () => {
      if (!supabase)
        throw new Error(
          "Supabaseが未設定です。デモモードを利用するか環境変数を設定してください。",
        );
      const { error: err } = await supabase.auth.signInWithPassword({
        email: String(values.get("email")),
        password: String(values.get("password")),
      });
      if (err) throw err;
      await enterLive();
    });
  }
  function demoLogin() {
    try {
      const saved = localStorage.getItem(demoKey);
      setData(saved ? JSON.parse(saved) : demoSeed());
      setMode("demo");
      setActor(loginName);
      setError("");
      setView("home");
    } catch {
      setError(
        "デモ保存データを読み込めません。ブラウザのサイトデータを確認してください。",
      );
    }
  }
  async function logout() {
    await run(async () => {
      if (mode === "live") {
        const { error } = await supabase!.auth.signOut();
        if (error) throw error;
      }
      setMode(null);
      setData(emptyData());
      setActor("");
    });
  }
  async function saveCustomer(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await run(async () => {
      const name = String(f.get("name")).trim();
      if (!name) throw new Error("顧客名を入力してください");
      const record: Customer = {
        id: editing?.id ?? crypto.randomUUID(),
        name,
        contact: String(f.get("contact")).trim(),
        phone: String(f.get("phone")).trim(),
        address: String(f.get("address")).trim(),
        notes: String(f.get("notes")).trim(),
        active: editing?.active ?? true,
        ...(editing?.version !== undefined ? { version: editing.version } : {}),
      };
      await persist("customers", record, !!editing);
      setCustomerId(record.id);
      setEditing(null);
      setCustomerForm(false);
      setNotice("顧客を保存しました");
    });
  }
  async function savePrice(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const form = e.currentTarget;
    await run(async () => {
      const amount = Number(f.get("amount"));
      const priceUnit = "L";
      const date = String(f.get("effective_from"));
      if (!Number.isFinite(amount) || amount < 0 || !priceUnit || !date)
        throw new Error("金額・単価単位・適用開始日を確認してください");
      const p: Price = {
        id: crypto.randomUUID(),
        customer_id: customerId,
        amount,
        unit: priceUnit,
        tax_basis: "exclusive",
        effective_from: date,
        note: String(f.get("note")),
        created_at: new Date().toISOString(),
        ...(mode === "demo"
          ? {
              revision:
                Math.max(0, ...data.prices.map((p) => p.revision ?? 0)) + 1,
            }
          : {}),
      };
      await persist("prices", p);
      form.reset();
      setNotice(
        "単価履歴を追加しました。過去の売上金額は変更しません。同じ開始日は最新の登録を採用します。",
      );
    });
  }
  async function saveOrder(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await run(async () => {
      if (!customer(customerId)?.active)
        throw new Error("顧客を選択してください");
      const quantity = validateQuantity(qty);
      if (quantity !== null && !unit.trim())
        throw new Error("数量の単位を入力してください");
      const id = crypto.randomUUID();
      const scheduled = String(f.get("scheduled_on")) || null;
      const received = String(f.get("received_at"));
      const o: Order = {
        id,
        case_no: `FA-${received.replaceAll("-", "")}-${id.slice(0, 8).toUpperCase()}`,
        customer_id: customerId,
        channel,
        received_at: received,
        requested_quantity: quantity,
        quantity_unit: "L",
        source_text: channel === "line" ? raw : "",
        location: String(f.get("location")).trim(),
        notes: String(f.get("notes")).trim(),
        scheduled_on: scheduled,
        status: scheduled ? "scheduled" : "new",
        created_at: new Date().toISOString(),
      };
      await persist("orders", o);
      setSelected(id);
      setView("detail");
      setNotice("受注を登録しました");
    });
  }
  async function updateSchedule(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await run(async () => {
      if (!currentOrder) return;
      const scheduled = String(f.get("scheduled_on")) || null;
      const o: Order = {
        ...currentOrder,
        scheduled_on: scheduled,
        location: String(f.get("location")).trim(),
        notes: String(f.get("notes")).trim(),
        status:
          currentOrder.status === "document_pending"
            ? "document_pending"
            : scheduled
              ? "scheduled"
              : "new",
      };
      await persist("orders", o, true);
      setNotice("日程を保存しました");
    });
  }
  async function copy(text: string) {
    await run(async () => {
      try {
        await navigator.clipboard.writeText(text);
        setNotice("LINE回答文をコピーしました");
      } catch {
        throw new Error(
          "コピーできませんでした。回答文を選択してコピーしてください。",
        );
      }
    });
  }
  async function upload(file: File | undefined) {
    if (!file) return;
    await run(async () => {
      if (!uploadOrder) throw new Error("案件を選択してください");
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
        throw new Error(
          "JPEG・PNG・WebPの画像を選択してください。HEICの場合はJPEGに変換してください。",
        );
      if (file.size > 10 * 1024 * 1024)
        throw new Error("画像は10MB以下にしてください");
      const id = crypto.randomUUID();
      let path: string;
      if (mode === "live") {
        const extension = {
          "image/jpeg": "jpg",
          "image/png": "png",
          "image/webp": "webp",
        }[file.type];
        path = `${uploadOrder}/${id}.${extension}`;
        const { error } = await supabase!.storage
          .from("delivery-documents")
          .upload(path, file, { contentType: file.type, upsert: false });
        if (error) throw error;
        try {
          const { error: re } = await supabase!.rpc("register_document", {
            p_id: id,
            p_order_id: uploadOrder,
            p_path: path,
            p_filename: file.name,
          });
          if (re) throw re;
        } catch (e) {
          await supabase!.storage.from("delivery-documents").remove([path]);
          throw e;
        }
        setData(await loadRemote());
      } else {
        path = await compressImage(file);
        const doc: Document = {
          id,
          order_id: uploadOrder,
          path,
          filename: file.name,
          review_status: "pending",
          created_at: new Date().toISOString(),
        };
        const next = {
          ...data,
          documents: [...data.documents, doc],
          orders: data.orders.map((o) =>
            o.id === uploadOrder
              ? { ...o, status: "document_pending" as const }
              : o,
          ),
        };
        saveDemo(
          next,
          "documents",
          id,
          "INSERT",
          `納品書追加・案件 ${uploadOrder} を確認待ちに変更`,
        );
      }
      setNotice("納品書を保存しました。数量・金額は未確定です。");
    });
  }
  async function openImage(doc: Document) {
    await run(async () => {
      let url = doc.path;
      if (mode === "live") {
        const { data: signed, error } = await supabase!.storage
          .from("delivery-documents")
          .createSignedUrl(doc.path, 60);
        if (error) throw error;
        url = signed.signedUrl;
      }
      setImage(url);
    });
  }
  const [image, setImage] = useState("");
  const orderCards = (orders: Order[]) =>
    orders.length ? (
      <div className="order-list">
        {orders.map((o) => (
          <button
            key={o.id}
            className="order-card"
            onClick={() => openOrder(o)}
          >
            <div className="order-icon">
              <Droplets size={20} />
            </div>
            <div className="order-main">
              <strong>{customer(o.customer_id)?.name ?? "顧客不明"}</strong>
              <span>
                {o.location || "給液場所未入力"} ·{" "}
                {o.requested_quantity === null
                  ? "数量未定"
                  : `${o.requested_quantity} ${o.quantity_unit}`}
              </span>
              <small>{o.case_no}</small>
            </div>
            <div className="order-meta">
              <span className={`tag ${o.status}`}>{statusNames[o.status]}</span>
              <small>{fmt(o.scheduled_on || "")}</small>
            </div>
            <ArrowRight size={17} />
          </button>
        ))}
      </div>
    ) : (
      <div className="empty">
        <Droplets size={30} />
        <p>該当する案件はありません</p>
      </div>
    );
  if (loading)
    return (
      <div className="login-wrap">
        <p>ログイン状態を確認しています…</p>
      </div>
    );
  if (!mode)
    return (
      <div className="login-wrap">
        <div className="login-card">
          <div className="brand-mark">
            <Droplets size={30} />
          </div>
          <p className="eyebrow">FUJISAWA OFFICE</p>
          <h1>AdBlue 業務管理</h1>
          <p className="muted">受注から給液まで、ひとつの案件で。</p>
          {error && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}
          <form onSubmit={login}>
            <Field label="メールアドレス">
              <input
                name="email"
                type="email"
                autoComplete="username"
                required
                placeholder="登録済みのメールアドレス"
              />
            </Field>
            <Field label="パスワード">
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                minLength={6}
              />
            </Field>
            <button className="primary wide" disabled={busy || !supabase}>
              ログイン <ArrowRight size={17} />
            </button>
          </form>
          <div className="demo-login">
            <strong>操作確認用デモ</strong>
            <p>
              サンプルデータをこのブラウザに保存します。共有・本番データへの接続はありません。
            </p>
            <div className="inline">
              <select
                aria-label="デモ利用者"
                value={loginName}
                onChange={(e) => setLoginName(e.target.value)}
              >
                <option>土屋</option>
                <option>佐藤</option>
              </select>
              <button className="secondary" onClick={demoLogin}>
                デモを開く
              </button>
            </div>
          </div>
          <small className="muted">
            {supabase
              ? "Supabase Auth接続設定あり · 管理者のみ利用可能"
              : "Supabase未設定 · 本番ログインには環境変数が必要です"}
          </small>
        </div>
      </div>
    );
  const displayOrders = activeOrders
    .filter((o) => {
      if (filter === "new") return o.status === "new";
      if (filter === "undated") return !o.scheduled_on;
      if (filter === "documents") return o.status === "document_pending";
      if (filter === "today") return o.scheduled_on === today;
      if (filter === "tomorrow") return o.scheduled_on === addDays(today, 1);
      if (filter === "week")
        return (
          !!o.scheduled_on &&
          o.scheduled_on >= today &&
          o.scheduled_on <= weekEnd(today)
        );
      return true;
    })
    .sort((a, b) =>
      (a.scheduled_on || "9999").localeCompare(b.scheduled_on || "9999"),
    );
  return (
    <div className="shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            nav("home");
          }}
        >
          <span className="brand-mark">
            <Droplets size={23} />
          </span>
          <span>
            AdBlue<small>藤沢営業所</small>
          </span>
        </a>
        <p className="nav-label">WORKSPACE</p>
        <nav>
          {(
            [
              { v: "home", name: "ホーム", Icon: LayoutDashboard },
              { v: "schedule", name: "給液スケジュール", Icon: CalendarDays },
              { v: "customers", name: "顧客マスター", Icon: Users },
              { v: "documents", name: "納品書", Icon: Camera },
              { v: "audit", name: "変更履歴", Icon: History },
            ] as const
          ).map(({ v, name, Icon }) => (
            <button
              key={v}
              className={view === v ? "nav-item active" : "nav-item"}
              onClick={() => nav(v)}
            >
              <Icon size={19} />
              <span>{name}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="phase">PHASE 1</span>
          <p>
            受注・給液の業務を
            <br />
            シンプルに、確実に。
          </p>
          <div className="profile">
            <span className="avatar">{actor.slice(0, 1)}</span>
            <span>
              <strong>{actor}</strong>
              <small>管理者</small>
            </span>
            <button
              aria-label="ログアウト"
              title="ログアウト"
              onClick={logout}
              disabled={busy}
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span className="topbar-office">
            <button
              className="mobile-menu-button"
              aria-label={menuOpen ? "メニューを閉じる" : "メニューを開く"}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <Menu size={18} />
            </button>{" "}
            藤沢営業所 <span className="divider">/</span> AdBlue管理
          </span>
          <div>
            <span className={mode === "demo" ? "mode demo" : "mode"}>
              {mode === "demo" ? "デモモード" : "Supabase接続"}
            </span>
            <span className="top-user">{actor} さん</span>
            {mode === "live" && (
              <button
                className="refresh-button"
                aria-label="最新データを取得"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    setData(await loadRemote());
                    setNotice("最新データを取得しました");
                  })
                }
              >
                <RefreshCw size={17} />
              </button>
            )}
            <button
              className="mobile-logout"
              onClick={logout}
              aria-label="ログアウト"
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>
        {menuOpen && (
          <nav className="mobile-menu" aria-label="業務メニュー">
            <button onClick={() => nav("home")}>ホーム</button>
            <button onClick={() => nav("schedule")}>給液スケジュール</button>
            <button onClick={() => nav("customers")}>顧客マスター</button>
            <button onClick={() => nav("documents")}>納品書</button>
            <button onClick={() => nav("audit")}>変更履歴</button>
          </nav>
        )}
        <div className="content">
          {mode === "demo" && (
            <div className="demo-banner">
              デモ：データはこのブラウザ内だけに保存されます。実際の顧客情報・納品書は登録しないでください。
            </div>
          )}
          {error && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div className="alert success" role="status">
              <Check size={18} />
              {notice}
            </div>
          )}
          {view === "home" && (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">DAILY OVERVIEW</p>
                  <h1>おはようございます、{actor}さん</h1>
                  <p className="muted">
                    今日の受注と給液予定を確認しましょう。
                  </p>
                </div>
                <span className="date-pill">
                  <CalendarDays size={17} />
                  {fmt(today)} <small>日本時間</small>
                </span>
              </div>
              <section>
                <div className="section-title">
                  <h2>未処理</h2>
                  <span>次に取りかかる業務</span>
                </div>
                <div className="stats">
                  {[
                    {
                      name: "新規受注",
                      count: activeOrders.filter((o) => o.status === "new")
                        .length,
                      key: "new",
                      icon: MessageSquare,
                      color: "blue",
                    },
                    {
                      name: "日程未定",
                      count: activeOrders.filter((o) => !o.scheduled_on).length,
                      key: "undated",
                      icon: CalendarDays,
                      color: "amber",
                    },
                    {
                      name: "納品書確認待ち",
                      count: activeOrders.filter(
                        (o) => o.status === "document_pending",
                      ).length,
                      key: "documents",
                      icon: FileText,
                      color: "purple",
                    },
                  ].map((s) => (
                    <button
                      key={s.key}
                      className={`stat ${s.color}`}
                      onClick={() => {
                        nav("schedule");
                        setFilter(s.key);
                      }}
                    >
                      <div>
                        <span>{s.name}</span>
                        <s.icon size={19} />
                      </div>
                      <strong>
                        {s.count}
                        <small>件</small>
                      </strong>
                      <span className="stat-link">
                        案件を確認 <ArrowRight size={15} />
                      </span>
                    </button>
                  ))}
                  <button
                    className="stat neutral"
                    onClick={() => nav("billing")}
                  >
                    <div>
                      <span>未請求</span>
                      <FileText size={19} />
                    </div>
                    <strong>—</strong>
                    <span className="stat-link">
                      Phase 3で対応 <ArrowRight size={15} />
                    </span>
                  </button>
                </div>
              </section>
              <section>
                <div className="section-title">
                  <h2>クイック操作</h2>
                </div>
                <div className="quick-grid">
                  {[
                    {
                      name: "LINE受注取込",
                      sub: "本文を貼り付けて登録",
                      Icon: MessageSquare,
                      click: () => beginOrder("line"),
                      green: true,
                    },
                    {
                      name: "電話受注",
                      sub: "少ない入力で登録",
                      Icon: Phone,
                      click: () => beginOrder("phone"),
                    },
                    {
                      name: "納品書撮影",
                      sub: "撮影・画像アップロード",
                      Icon: Camera,
                      click: () => nav("documents"),
                    },
                    {
                      name: "顧客検索",
                      sub: "顧客情報と単価履歴",
                      Icon: Search,
                      click: () => nav("customers"),
                    },
                    {
                      name: "請求書作成",
                      sub: "Phase 3で対応",
                      Icon: FileText,
                      click: () => nav("billing"),
                    },
                  ].map((q) => (
                    <button
                      className={`quick ${q.green ? "line-green" : ""}`}
                      key={q.name}
                      onClick={q.click}
                    >
                      <q.Icon size={23} />
                      <strong>{q.name}</strong>
                      <small>{q.sub}</small>
                    </button>
                  ))}
                </div>
              </section>
              <section className="schedule-panel">
                <div className="section-title">
                  <h2>
                    <CalendarDays size={20} />
                    給液予定
                  </h2>
                  <button
                    className="text-button"
                    onClick={() => nav("schedule")}
                  >
                    すべて見る <ArrowRight size={16} />
                  </button>
                </div>
                <div className="tabs">
                  {[
                    ["today", "今日"],
                    ["tomorrow", "明日"],
                    ["week", "今週"],
                  ].map(([f, label]) => (
                    <button
                      key={f}
                      className={
                        filter === f || (filter === "all" && f === "today")
                          ? "selected"
                          : ""
                      }
                      onClick={() => setFilter(f)}
                    >
                      {label}
                      <span>
                        {
                          activeOrders.filter((o) =>
                            f === "today"
                              ? o.scheduled_on === today
                              : f === "tomorrow"
                                ? o.scheduled_on === addDays(today, 1)
                                : !!o.scheduled_on &&
                                  o.scheduled_on >= today &&
                                  o.scheduled_on <= weekEnd(today),
                          ).length
                        }
                      </span>
                    </button>
                  ))}
                </div>
                {orderCards(
                  filter === "all"
                    ? activeOrders.filter((o) => o.scheduled_on === today)
                    : displayOrders,
                )}
              </section>
              <p className="footer-note">
                受注 → 給液予定 → 納品書 → 給液実績 → 売上 →
                請求。同じ案件IDでつながります。
              </p>
            </>
          )}
          {view === "customers" && (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">CUSTOMERS</p>
                  <h1>顧客マスター</h1>
                  <p className="muted">顧客情報と、変更しても残る単価履歴。</p>
                </div>
                <button
                  className="primary"
                  onClick={() => {
                    setEditing(null);
                    setCustomerForm(true);
                  }}
                >
                  <Plus size={18} />
                  顧客を追加
                </button>
              </div>
              {customerForm && (
                <section className="panel">
                  <div className="section-title">
                    <h2>{editing ? "顧客を編集" : "顧客を追加"}</h2>
                    <button
                      aria-label="閉じる"
                      onClick={() => setCustomerForm(false)}
                    >
                      <X size={20} />
                    </button>
                  </div>
                  <form onSubmit={saveCustomer} key={editing?.id || "new"}>
                    <div className="form-grid">
                      <Field label="顧客名 *">
                        <input
                          name="name"
                          required
                          defaultValue={editing?.name}
                        />
                      </Field>
                      <Field label="担当者">
                        <input name="contact" defaultValue={editing?.contact} />
                      </Field>
                      <Field label="電話番号">
                        <input
                          name="phone"
                          type="tel"
                          defaultValue={editing?.phone}
                        />
                      </Field>
                      <Field label="主な給液場所">
                        <input name="address" defaultValue={editing?.address} />
                      </Field>
                    </div>
                    <Field label="メモ">
                      <textarea name="notes" defaultValue={editing?.notes} />
                    </Field>
                    <button className="primary" disabled={busy}>
                      顧客を保存
                    </button>
                  </form>
                </section>
              )}
              <div className="search-box">
                <Search size={20} />
                <input
                  aria-label="顧客検索"
                  placeholder="顧客名・電話番号・場所で検索"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="two-columns">
                <section className="panel customer-list">
                  {data.customers
                    .filter((c) =>
                      `${c.name} ${c.phone} ${c.address}`.includes(search),
                    )
                    .map((c) => (
                      <button
                        key={c.id}
                        className={
                          customerId === c.id
                            ? "customer-item selected"
                            : "customer-item"
                        }
                        onClick={() => setCustomerId(c.id)}
                      >
                        <span className="avatar">
                          <Users size={19} />
                        </span>
                        <span>
                          <strong>{c.name}</strong>
                          <small>
                            {c.phone || "電話未登録"} ·{" "}
                            {c.active ? "利用中" : "停止中"}
                          </small>
                        </span>
                        <ArrowRight size={17} />
                      </button>
                    ))}
                  {!data.customers.length && (
                    <p className="muted">顧客を追加してください。</p>
                  )}
                </section>
                <section className="panel">
                  {currentCustomer ? (
                    <>
                      <div className="section-title">
                        <h2>{currentCustomer.name}</h2>
                        <button
                          className="text-button"
                          onClick={() => {
                            setEditing(currentCustomer);
                            setCustomerForm(true);
                          }}
                        >
                          編集
                        </button>
                      </div>
                      <dl className="details">
                        <dt>担当者</dt>
                        <dd>{currentCustomer.contact || "—"}</dd>
                        <dt>電話</dt>
                        <dd>{currentCustomer.phone || "—"}</dd>
                        <dt>場所</dt>
                        <dd>{currentCustomer.address || "—"}</dd>
                        <dt>メモ</dt>
                        <dd>{currentCustomer.notes || "—"}</dd>
                      </dl>
                      <h3>単価履歴</h3>
                      <p className="hint">
                        税抜・円/Lで管理します。実際の給液日に有効な単価を適用し、実績確定時に固定します。
                      </p>
                      {data.prices
                        .filter((p) => p.customer_id === customerId)
                        .sort(
                          (a, b) =>
                            b.effective_from.localeCompare(a.effective_from) ||
                            (b.revision ?? 0) - (a.revision ?? 0),
                        )
                        .map((p) => (
                          <div className="price-row" key={p.id}>
                            <div>
                              <strong>
                                {p.amount.toLocaleString("ja-JP")} 円 / {p.unit}
                              </strong>
                              <small>
                                {fmt(p.effective_from)} から ·{" "}
                                {
                                  {
                                    unknown: "税区分未確認",
                                    exclusive: "税抜",
                                    inclusive: "税込",
                                  }[p.tax_basis]
                                }
                              </small>
                              {p.note && <small>{p.note}</small>}
                            </div>
                            <History size={18} />
                          </div>
                        ))}
                      {!data.prices.some(
                        (p) => p.customer_id === customerId,
                      ) && <p className="muted">単価未登録</p>}
                      <form onSubmit={savePrice} className="subform">
                        <h3>新しい単価を追加</h3>
                        <div className="form-grid">
                          <Field label="単価（円） *">
                            <input
                              name="amount"
                              type="number"
                              step="0.0001"
                              min="0"
                              required
                            />
                          </Field>
                          <Field label="単位">
                            <input value="円 / L（税抜）" readOnly />
                          </Field>
                          <Field label="適用開始日 *">
                            <input
                              name="effective_from"
                              type="date"
                              defaultValue={today}
                              required
                            />
                          </Field>
                          <Field label="消費税率">
                            <input
                              value="10%（端数処理はINOUT確認待ち）"
                              readOnly
                            />
                          </Field>
                        </div>
                        <Field label="変更理由・メモ">
                          <input name="note" />
                        </Field>
                        <button className="secondary" disabled={busy}>
                          単価履歴を追加
                        </button>
                      </form>
                    </>
                  ) : (
                    <div className="empty">
                      <Users size={32} />
                      <p>顧客を選択すると情報を表示します</p>
                    </div>
                  )}
                </section>
              </div>
            </>
          )}
          {view === "order" && (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">NEW ORDER</p>
                  <h1>{channel === "line" ? "LINE受注取込" : "電話受注"}</h1>
                  <p className="muted">
                    依頼内容を残し、日程は後から設定できます。
                  </p>
                </div>
              </div>
              <section className="panel form-panel">
                <form onSubmit={saveOrder}>
                  {channel === "line" && (
                    <div className="line-input">
                      <Field label="LINE本文">
                        <textarea
                          rows={5}
                          placeholder="受信したLINE本文をそのまま貼り付けてください"
                          value={raw}
                          onChange={(e) => setRaw(e.target.value)}
                        />
                      </Field>
                      <button
                        className="secondary"
                        type="button"
                        onClick={() => {
                          const s = suggestFromLine(raw);
                          setQty(
                            s.quantity === null || s.unit !== "L"
                              ? ""
                              : String(s.quantity),
                          );
                          setUnit("L");
                          setNotice(
                            s.quantity === null || s.unit !== "L"
                              ? "L単位の数量候補が見つかりませんでした。手入力してください。"
                              : "数量候補を入力しました。L単位か確認してから登録してください。",
                          );
                        }}
                      >
                        数量候補を取り込む
                      </button>
                      <p className="hint">
                        Phase 1は文字からの候補抽出です。AI/OCRはPhase
                        2で対応します。
                      </p>
                    </div>
                  )}
                  <div className="form-grid">
                    <Field label="顧客 *">
                      <select
                        required
                        value={customerId}
                        onChange={(e) => setCustomerId(e.target.value)}
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
                    </Field>
                    <Field label="受注日 *">
                      <input
                        name="received_at"
                        type="date"
                        defaultValue={today}
                        required
                      />
                    </Field>
                    <Field label="依頼数量（未定なら空欄）">
                      <input
                        aria-label="依頼数量"
                        type="number"
                        min="0.0001"
                        step="any"
                        value={qty}
                        onChange={(e) => setQty(e.target.value)}
                      />
                    </Field>
                    <Field label="数量の単位">
                      <input value="L（リットル）" readOnly />
                    </Field>
                    <Field label="給液場所">
                      <input
                        name="location"
                        key={customerId}
                        defaultValue={customer(customerId)?.address || ""}
                      />
                    </Field>
                    <Field label="給液予定日（未定なら空欄）">
                      <input name="scheduled_on" type="date" />
                    </Field>
                  </div>
                  <Field label="連絡事項・メモ">
                    <textarea
                      name="notes"
                      placeholder="時間帯の希望、入場方法など"
                    />
                  </Field>
                  <p className="hint">
                    依頼数量は給液実績ではありません。金額は確定しません。
                  </p>
                  <button
                    className="primary"
                    disabled={busy || !data.customers.length}
                  >
                    <Check size={18} />
                    受注を登録
                  </button>
                  {!data.customers.length && (
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => nav("customers")}
                    >
                      まず顧客を追加してください
                    </button>
                  )}
                </form>
              </section>
            </>
          )}
          {view === "schedule" && (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">DELIVERY SCHEDULE</p>
                  <h1>給液スケジュール</h1>
                  <p className="muted">案件を選んで日程調整・LINE回答へ。</p>
                </div>
                <button className="primary" onClick={() => beginOrder("phone")}>
                  <Plus size={18} />
                  受注登録
                </button>
              </div>
              <section className="panel">
                <div className="tabs wrap">
                  {[
                    ["all", "すべて"],
                    ["today", "今日"],
                    ["tomorrow", "明日"],
                    ["week", "今週"],
                    ["undated", "日程未定"],
                    ["new", "新規"],
                    ["documents", "納品書確認待ち"],
                  ].map(([f, label]) => (
                    <button
                      key={f}
                      className={filter === f ? "selected" : ""}
                      onClick={() => setFilter(f)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {orderCards(displayOrders)}
                <p className="hint">
                  今週は日本時間で今日から日曜日まで。給液完了・取消の案件は一覧に含みません。
                </p>
              </section>
            </>
          )}
          {view === "detail" && currentOrder && (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">{currentOrder.case_no}</p>
                  <h1>{customer(currentOrder.customer_id)?.name}</h1>
                  <p className="muted">案件ID：{currentOrder.id}</p>
                </div>
                <span className={`tag ${currentOrder.status}`}>
                  {statusNames[currentOrder.status]}
                </span>
              </div>
              <div className="pipeline">
                {["受注", "給液予定", "納品書", "給液実績", "売上", "請求"].map(
                  (s, i) => (
                    <span className={i < 3 ? "enabled" : ""} key={s}>
                      {s}
                      {i < 5 && <ArrowRight size={14} />}
                    </span>
                  ),
                )}
              </div>
              <div className="two-columns">
                <section className="panel">
                  <h2>受注内容</h2>
                  <dl className="details">
                    <dt>受注日</dt>
                    <dd>{fmt(currentOrder.received_at)}</dd>
                    <dt>受付</dt>
                    <dd>{currentOrder.channel === "line" ? "LINE" : "電話"}</dd>
                    <dt>依頼数量</dt>
                    <dd>
                      {currentOrder.requested_quantity === null
                        ? "未定"
                        : `${currentOrder.requested_quantity} ${currentOrder.quantity_unit}`}
                    </dd>
                    <dt>参考単価</dt>
                    <dd>
                      {currentOrder.scheduled_on &&
                      currentPrice(
                        data.prices,
                        currentOrder.customer_id,
                        currentOrder.scheduled_on,
                      )
                        ? `${currentPrice(data.prices, currentOrder.customer_id, currentOrder.scheduled_on)!.amount} 円/L（税抜）`
                        : "有効な単価・予定日が未登録"}
                      <small className="muted">
                        {" "}
                        · 実際の給液日で確定します
                      </small>
                    </dd>
                  </dl>
                  {currentOrder.source_text && (
                    <>
                      <h3>LINE原文</h3>
                      <pre className="source-text">
                        {currentOrder.source_text}
                      </pre>
                    </>
                  )}
                  <form
                    onSubmit={updateSchedule}
                    key={`${currentOrder.id}-${currentOrder.scheduled_on}-${currentOrder.notes}`}
                  >
                    <Field label="給液予定日">
                      <input
                        name="scheduled_on"
                        type="date"
                        defaultValue={currentOrder.scheduled_on || ""}
                      />
                    </Field>
                    <Field label="給液場所">
                      <input
                        name="location"
                        defaultValue={currentOrder.location}
                      />
                    </Field>
                    <Field label="メモ">
                      <textarea
                        name="notes"
                        defaultValue={currentOrder.notes}
                      />
                    </Field>
                    <button
                      className="primary"
                      disabled={
                        busy ||
                        ["cancelled", "completed"].includes(currentOrder.status)
                      }
                    >
                      日程・メモを保存
                    </button>
                  </form>
                </section>
                <div>
                  <section className="panel">
                    <h2>
                      <MessageSquare size={20} />
                      LINE回答文
                    </h2>
                    {currentOrder.scheduled_on ? (
                      <>
                        <textarea
                          className="reply"
                          aria-label="LINE回答文"
                          readOnly
                          rows={7}
                          value={lineReply(
                            customer(currentOrder.customer_id)?.name || "",
                            currentOrder.scheduled_on,
                            currentOrder.location,
                          )}
                        />
                        <button
                          className="secondary"
                          onClick={() =>
                            copy(
                              lineReply(
                                customer(currentOrder.customer_id)?.name || "",
                                currentOrder.scheduled_on!,
                                currentOrder.location,
                              ),
                            )
                          }
                          disabled={busy}
                        >
                          <Copy size={17} />
                          回答文をコピー
                        </button>
                        <p className="hint">
                          LINEの送信は行いません。内容を確認してLINEに貼り付けてください。
                        </p>
                      </>
                    ) : (
                      <p className="muted">
                        給液予定日を設定すると回答文を作成します。
                      </p>
                    )}
                  </section>
                  <section className="panel">
                    <div className="section-title">
                      <h2>納品書</h2>
                      <button
                        className="text-button"
                        onClick={() => {
                          setUploadOrder(currentOrder.id);
                          nav("documents");
                        }}
                      >
                        撮影・追加 <Camera size={17} />
                      </button>
                    </div>
                    {data.documents
                      .filter((d) => d.order_id === currentOrder.id)
                      .map((d) => (
                        <button
                          className="document-row"
                          key={d.id}
                          onClick={() => openImage(d)}
                        >
                          <FileText size={20} />
                          <span>
                            {d.filename}
                            <small>{timestamp(d.created_at)} · 確認待ち</small>
                          </span>
                        </button>
                      ))}
                    {!data.documents.some(
                      (d) => d.order_id === currentOrder.id,
                    ) && <p className="muted">納品書はまだありません。</p>}
                    <p className="hint">
                      納品書の確認・給液実績確定は後続フェーズで対応します。
                    </p>
                  </section>
                </div>
              </div>
            </>
          )}
          {view === "documents" && (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">DELIVERY DOCUMENTS</p>
                  <h1>納品書撮影・アップロード</h1>
                  <p className="muted">納品書を案件にひも付けて保存します。</p>
                </div>
              </div>
              <section className="panel form-panel">
                <Field label="対象案件 *">
                  <select
                    value={uploadOrder}
                    onChange={(e) => setUploadOrder(e.target.value)}
                  >
                    <option value="">案件を選択してください</option>
                    {data.orders
                      .filter(
                        (o) => !["cancelled", "completed"].includes(o.status),
                      )
                      .map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.case_no} · {customer(o.customer_id)?.name}
                        </option>
                      ))}
                  </select>
                </Field>
                <div className="upload-zone">
                  <Camera size={38} />
                  <h3>納品書の文字が読めるように撮影</h3>
                  <p>JPEG / PNG / WebP · 最大10MB</p>
                  <div className="inline">
                    <label
                      className={`primary upload-button ${busy || !uploadOrder ? "disabled" : ""}`}
                    >
                      <Camera size={18} />
                      カメラで撮影
                      <input
                        aria-label="カメラで撮影"
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        capture="environment"
                        disabled={busy || !uploadOrder}
                        onChange={(e) => {
                          upload(e.target.files?.[0]);
                          e.target.value = "";
                        }}
                      />
                    </label>
                    <label
                      className={`secondary upload-button ${busy || !uploadOrder ? "disabled" : ""}`}
                    >
                      画像を選択
                      <input
                        aria-label="画像を選択"
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        disabled={busy || !uploadOrder}
                        onChange={(e) => {
                          upload(e.target.files?.[0]);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  </div>
                </div>
                <p className="hint">
                  画像は確認待ちとして保存。AI/OCR・数量の自動確定・売上計上は行いません。
                </p>
              </section>
              <section className="panel">
                <h2>保存済み納品書</h2>
                {data.documents
                  .filter((d) => !uploadOrder || d.order_id === uploadOrder)
                  .map((d) => (
                    <button
                      className="document-row"
                      key={d.id}
                      onClick={() => openImage(d)}
                    >
                      <FileText size={23} />
                      <span>
                        <strong>
                          {
                            customer(
                              data.orders.find((o) => o.id === d.order_id)
                                ?.customer_id || "",
                            )?.name
                          }
                        </strong>
                        {d.filename}
                        <small>
                          {
                            data.orders.find((o) => o.id === d.order_id)
                              ?.case_no
                          }{" "}
                          · {timestamp(d.created_at)}
                        </small>
                      </span>
                      <span className="tag document_pending">確認待ち</span>
                    </button>
                  ))}
                {!data.documents.length && (
                  <p className="muted">保存済みの納品書はありません。</p>
                )}
              </section>
            </>
          )}
          {view === "billing" && (
            <section className="panel">
              <p className="eyebrow">PHASE 3</p>
              <h1>請求書作成</h1>
              <p>
                売上確定・月次請求・INOUT形式のPDF／印刷はPhase 3で実装します。
              </p>
              <p className="muted">
                現段階では請求金額を計算しません。税抜単価 ×
                納品書の実給液量（L）を基礎とし、税率は10%。税計算の単位・端数処理・締日・INOUTの見本は確認後に対応します。
              </p>
              <button className="secondary" onClick={() => nav("home")}>
                ホームへ戻る
              </button>
            </section>
          )}
          {view === "audit" && (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">AUDIT TRAIL</p>
                  <h1>変更履歴</h1>
                  <p className="muted">
                    誰が・いつ・何を変更したかを記録します。
                  </p>
                </div>
              </div>
              <section className="panel">
                {data.audit
                  .slice()
                  .sort((a, b) => b.created_at.localeCompare(a.created_at))
                  .map((a) => (
                    <details className="audit-row" key={a.id}>
                      <summary>
                        <span className="avatar">
                          {a.actor_name?.slice(0, 1) || "?"}
                        </span>
                        <span>
                          <strong>
                            {a.actor_name} ·{" "}
                            {a.action === "INSERT"
                              ? "追加"
                              : a.action === "UPDATE"
                                ? "変更"
                                : a.action}
                          </strong>
                          <small>
                            {a.entity} · {timestamp(a.created_at)}
                          </small>
                        </span>
                      </summary>
                      <p className="hint">ID：{a.entity_id}</p>
                      <pre>{a.detail}</pre>
                    </details>
                  ))}
                {!data.audit.length && (
                  <p className="muted">変更履歴はまだありません。</p>
                )}
              </section>
            </>
          )}
        </div>
        <nav className="mobile-nav">
          <button onClick={() => nav("home")}>
            <LayoutDashboard size={20} />
            ホーム
          </button>
          <button onClick={() => nav("schedule")}>
            <CalendarDays size={20} />
            予定
          </button>
          <button onClick={() => beginOrder("phone")}>
            <Plus size={20} />
            受注
          </button>
          <button onClick={() => nav("customers")}>
            <Users size={20} />
            顧客
          </button>
          <button onClick={() => nav("documents")}>
            <Camera size={20} />
            納品書
          </button>
        </nav>
      </main>
      {image && (
        <div
          className="modal"
          role="dialog"
          aria-modal="true"
          aria-label="納品書画像"
        >
          <button className="secondary" onClick={() => setImage("")}>
            <X size={20} />
            閉じる
          </button>
          {/* Uploaded images are private documents, not public optimized assets. */}
          <img src={image} alt="納品書" />
        </div>
      )}
    </div>
  );
}
async function compressImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("画像処理を利用できません");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.8);
}
