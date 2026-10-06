import { createClient } from "@supabase/supabase-js";
import { boundedJson, extractOrder, validateImageData } from "@/lib/ocr-server";
export const runtime = "nodejs";
export const maxDuration = 60;
const localLimits = new Map<string, { count: number; minute: number }>();
function response(message: string, status: number) {
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
export async function GET() {
  return Response.json(
    {
      enabled:
        process.env.ADBLUE_ENABLE_PAID_OCR === "true" &&
        !!process.env.ADBLUE_OPENAI_API_KEY &&
        !!process.env.OPENAI_OCR_MODEL,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(request: Request) {
  const url = new URL(request.url),
    origin = request.headers.get("origin");
  if (!origin || origin !== url.origin)
    return response("同じサイトの画面から読み取りを実行してください。", 403);
  if (process.env.ADBLUE_ENABLE_PAID_OCR !== "true")
    return response(
      "ローカル版ではAI読み取りを停止しています。画像を見ながら手入力できます。",
      503,
    );
  const apiKey = process.env.ADBLUE_OPENAI_API_KEY;
  const model = process.env.OPENAI_OCR_MODEL;
  if (!apiKey || !model)
    return response(
      "AI読み取りは未設定です。サーバー専用APIキーとOPENAI_OCR_MODELを設定するか、手入力で確認してください。",
      503,
    );
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  try {
    if (supabaseUrl && anonKey) {
      const token = request.headers
        .get("authorization")
        ?.match(/^Bearer (.+)$/)?.[1];
      if (!token) return response("管理者ログインが必要です。", 401);
      const client = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await client.auth.getUser(token);
      if (error || !data.user)
        return response("ログインを確認してください。", 401);
      const { data: member, error: me } = await client
        .from("memberships")
        .select("user_id")
        .eq("user_id", data.user.id)
        .maybeSingle();
      if (me || !member) return response("管理者権限が必要です。", 403);
      const { error: quotaError } = await client.rpc("consume_order_ocr_quota");
      if (quotaError)
        return response(
          "読み取り回数の上限、または画像取込用のDB設定を確認してください。1分後に再実行してください。",
          429,
        );
    } else {
      if (
        process.env.NODE_ENV !== "development" ||
        process.env.ADBLUE_ALLOW_LOCAL_OCR !== "true" ||
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      )
        return response(
          "本番AI読み取りにはSupabase管理者認証が必要です。ローカル実験の設定方法はREADMEを参照してください。",
          401,
        );
      const minute = Math.floor(Date.now() / 60000),
        limit = localLimits.get("local");
      const count = limit?.minute === minute ? limit.count : 0;
      if (count >= 3)
        return response(
          "読み取りは1分間に3回までです。少し待ってください。",
          429,
        );
      localLimits.set("local", { count: count + 1, minute });
    }
    const input = await boundedJson(request);
    const image = validateImageData(input.image);
    const result = await extractOrder(image, apiKey, model);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof SyntaxError)
      return response(
        "読み取りデータを処理できません。手入力で確認してください。",
        422,
      );
    if (e instanceof Error && /画像|JSON形式|ファイル/.test(e.message))
      return response(e.message, 400);
    return response(
      "AI読み取りに失敗しました。APIキー・モデルの対応状況・利用枠・接続設定を確認し、手入力で続けてください。",
      502,
    );
  }
}
