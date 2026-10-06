# Fujisawa AdBlue Management

藤沢営業所の受注→給液予定→給液→納品書→給液実績→税抜売上→請求状態を、このPCだけで検証するローカル版です。Next.js / TypeScript / localStorage。Supabase・OpenAIの将来用コードは保持し、初期状態では停止しています。

## 無料のローカル起動

Node.js 22以上で、プロジェクトフォルダー内から実行します。APIキーや .env.local の作成は不要です。

```sh
npm ci
npm run dev
```

土屋または佐藤を選び「ローカル業務を開く」で開始します。パスワード不要・同じ権限です。「デモを開く」は初回だけサンプルを用意します。以前の保存データは同じ保存キーで引き継ぎます。

[Windowsの更新・操作・バックアップ手順](docs/LOCAL_GUIDE.md)

- 顧客・会社情報、複数給液場所、税抜円/Lの単価履歴
- 電話・LINE・FAX・メール・紙・画像の受注、希望日と予定日の分離
- 日別スケジュール、日程未定、LINE回答文
- 画像の手入力取込と必須確認、納品書アップロード
- 実給液量と依頼数量の分離、給液日価格の固定、正確な税抜売上
- 顧客別・月別一覧／合計、請求前／済み記録、CSV
- 全データ・画像・変更履歴のJSONバックアップと確認後復元

実績訂正・分納、正式請求書、消費税／INOUT端数処理、PC間同期は未対応です。

## 将来用の外部接続（今回は利用しません）

外部接続は明示的な設定が必要です。Supabaseは NEXT_PUBLIC_ENABLE_CLOUD=true、有料OCRは ADBLUE_ENABLE_PAID_OCR=true と必要な認証・キー・モデル設定が揃った時だけ有効です。今回はどちらもfalseのまま利用してください。ローカル追加機能のクラウド同期はまだ実装していません。

## 本番Supabase設定

1. Supabaseプロジェクトを作成し、SQL Editorで `supabase/001_initial.sql` を**新規DBに一度だけ**実行。既存DBには状態を確認してから移行してください。
2. Authの公開サインアップを無効化。Auth管理画面で土屋・佐藤のユーザーを登録（メール＋パスワード、メール確認済み）。パスワードはユーザーへ安全な経路で渡してください。アプリから新規登録はできません。
3. 登録されたUUIDで、SQL Editorから管理者を割り当てます。メール名から権限を推測しません。

```sql
insert into public.memberships(user_id, display_name)
values ('土屋のAuth UUID', '土屋'), ('佐藤のAuth UUID', '佐藤');
```

4. `.env.example` を参考に `.env.local` を作成し、以下を設定して開発サーバーを再起動。

```text
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_OR_PUBLISHABLE_KEY
```

公開anon/publishableキーを利用します。service-roleキーは不要で、ブラウザ・Vercel公開環境変数に絶対に置かないでください。クラウドのネットワーク制限がある場合は実際のSupabaseプロジェクトのホスト名を許可してください。

5. 両名でログインし、顧客・受注の共有、別端末での画像閲覧を確認。別の管理者の変更は画面上部の「最新データを取得」で読み込めます。顧客・案件は更新版を照合し、競合時は上書きせず再読込を促します。非管理者は会員テーブルのRLSにより閲覧・操作できません。未認証ユーザーのテーブルアクセスも禁止。管理者割当はアプリから変更できません。

納品書はprivateな `delivery-documents` バケットへ保存。URLは閲覧時に60秒有効の署名URLを発行します。JPEG/PNG/WebP、10MB以内。HEICはJPEGへの変換が必要です。画像保存後のメタデータ登録と案件の「確認待ち」変更はRPCで同一トランザクション。メタデータ登録に失敗した場合は孤立画像の削除を試行します。登録済み納品書の削除権限はありません。監査履歴はDBトリガーが記録し、管理者でもアプリから上書き・削除できません。

## Vercel

GitHubリポジトリをVercelへImportし、FrameworkをNext.jsに設定。上記2つの環境変数をPreview/Productionに設定してDeployしてください。Supabase AuthのSite URL／許可するRedirect URLを実際のVercelドメインに設定します。本実装はパスワードログインで、パスワード再発行UI・招待リンクUIは未実装です。公開デプロイ・外部サービス作成はこの変更では実施していません。

受注画像のAI読み取りにOpenAI Responses APIを使います（サーバー側のみ）。`ADBLUE_OPENAI_API_KEY` と `OPENAI_OCR_MODEL` が必要です。キーを `NEXT_PUBLIC_` に置かないでください。未設定なら手入力／明示した操作サンプルが利用できます。既存DBには002の追加移行が必要です。詳細は [受注画像取込の設定手順](docs/ORDER_IMAGE_IMPORT.md) を参照してください。

## 検証

```sh
npm run typecheck
npm test
npm run build
PLAYWRIGHT_BROWSERS_PATH=/workspace/.playwright npx playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=/workspace/.playwright npm run test:e2e
# 環境にChromiumがある場合（このクラウド環境）:
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:e2e
```

`npm test` は日付・単価適用・数量候補・入力検証と、PGlite上の実SQL移行・管理者RLS・監査・納品書RPC・実績単価固定・請求ガードを検証します。PGliteのAuth／Storageスキーマはテスト用互換スタブで、実Supabase接続確認の代わりではありません。E2Eはデスクトップ／スマートフォン幅で顧客・単価履歴・LINE受注・予定・画像アップロード・保存と、電話受注を検証します。カメラの物理動作は実スマートフォンで別途確認してください。

詳細な確認済みルール・未決事項は [docs/BUSINESS_RULES.md](docs/BUSINESS_RULES.md)。
