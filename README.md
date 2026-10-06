# Fujisawa AdBlue Management

藤沢営業所専用のAdBlue受注・給液管理Webアプリ（Phase 1）。Next.js App Router / TypeScript / Supabase PostgreSQL・Auth・Storage。Vercelに配置可能です。

## 起動・デモ

Node.js 22以上（この環境では24.19.0）。

```sh
cd /workspace/fujisawa-adblue
npm ci --cache /workspace/.npm-cache
npm run dev
```

ブラウザで開くとログイン画面を表示します。「デモを開く」で土屋／佐藤を選んで操作できます。デモは本番ログインではありません。サンプルと入力をブラウザのlocalStorageに保存し、同じブラウザで両名の同一権限を確認できます。サーバー共有・端末間同期はありません。実データを入れないでください。削除する場合はブラウザのサイトデータを消してください。保存容量を超える場合はエラーになり、登録は完了しません。

### Phase 1で操作できる機能

- 未処理件数（新規・日程未定・納品書確認待ち）と今日／明日／今週の給液予定
- 顧客追加・編集・検索、単価履歴追加（税抜円/L・適用開始日、同日の訂正は新しい履歴）
- LINE本文貼付・数量候補抽出と確認、電話受注（数量・日程未定で登録可能）
- 案件詳細・日程とメモ編集・予定日での参考単価・LINE回答文作成／コピー
- スマートフォン撮影／PC画像選択、案件への納品書登録と画像確認
- 管理者別の変更履歴

依頼数量と確定給液量は別です。AI/OCR・給液実績確定・売上確定・未請求件数の算出・請求書作成は後続Phase。未請求はダッシュボードで「— / Phase 3」と明示しています。

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

将来のOpenAI API呼び出しはサーバー側のみで実行し、キーを `NEXT_PUBLIC_` に置かないでください。Phase 1でAPIキーは不要です。

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
