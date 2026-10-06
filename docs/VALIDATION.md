# Phase 1 検証結果（2026-10-06）

環境: Node.js 24.19.0、npm 11.9.0、Linux、リポジトリのpackage-lock.json。

- `npm ci --cache /workspace/.npm-cache --no-audit --no-fund`: 成功。
- `npm run typecheck`: 成功。
- `npm test`: 6テスト成功（DB移行/RLS/監査/価格固定/競合検出/納品書RPC/請求ガードと業務関数）。
- `npm run build`: 成功。最終E2EのwebServerでも本番ビルドを実行。
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:e2e`: 4テスト成功。PC 1440×1000、モバイル390×844。顧客追加・単価の同日改定と旧履歴保持・LINE本文候補・受注・予定・給液日の参考単価・LINE回答文のコピー・画像登録/閲覧・再読込/利用者切替・変更履歴・電話受注を操作。
- 実ブラウザによるホーム表示確認: PC/モバイルともページ例外なし、横方向のはみ出しなし。

## 検証範囲の限界

- 実SupabaseのURL・公開キーが環境にないため、本番Auth、PostgREST、Storageとの統合検証は未実施。SQLはPGliteのPostgreSQL互換実行環境で、Auth/Storageのテスト用スタブを作成して実行。
- スマートフォンの物理カメラ、Safari、実端末間同期は未検証。ブラウザE2Eでは画像ファイルアップロードを操作。
- Vercelへのデプロイ、GitHubへのpushは未実施。
- OCR、実績/売上確定、請求PDFはPhase 2・3。INOUT端数処理未確定のため請求発行を禁止する設計。

Playwright配布ブラウザのCDNはこの環境のネットワークポリシーで403となったため、既存の `/usr/bin/chromium` を使用。証明書・署名検証を無効化したダウンロードは行っていない。

## 受注画像取込追加（2026-10-06）

- 型チェック・本番ビルド成功。
- `npm test`: 12件成功。既存DBテストに002移行・確認前登録拒否・希望日分離・確認者・原画像記録・OCR利用制限を追加。OpenAI SDKの通信はテスト用fetchで模擬し、実APIではない。
- ブラウザE2E: PC/モバイル合計10件成功（既存4件＋画像取込6件）。候補選択・修正・確認チェックの再確認・原画像閲覧・手入力・新規顧客保存・8項目のAPI応答表示を検証。API成功／失敗応答はモック。
- 本番APIキー・モデル未設定のため、実OCR精度と本番Supabaseの統合は未検証。ローカルの操作サンプルは架空候補と明示。
- 001は保持し、追加移行002のみで既存DBに対応。納品書OCR・売上・請求機能は未追加。
