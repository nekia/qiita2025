# Node.js ランタイムイメージ
FROM node:22-slim

# 作業ディレクトリ
WORKDIR /usr/src/app

# 依存関係を先にコピー＆インストール（キャッシュ効かせる）
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# アプリ本体コピー
COPY server.js photosClient.js ./

# Cloud Run が使うポート番号
ENV PORT=8080

# 健康チェックなどでどのポートを公開するか
EXPOSE 8080

# 起動コマンド
CMD ["npm", "start"]
