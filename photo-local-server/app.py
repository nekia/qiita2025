import os
import time
import logging

from flask import Flask, jsonify
from flask_cors import CORS
from google.oauth2 import service_account
from google.auth.transport.requests import Request as GoogleRequest
import requests

app = Flask(__name__)
# ローカル開発用のCORS設定
# 開発環境ではすべてのオリジンを許可（file://、localhost、127.0.0.1の任意のポートに対応）
# 本番環境では、特定のオリジンのみを許可することを推奨
# 例: CORS(app, origins=["https://your-domain.com"])
CORS(app)  # 開発環境：すべてのオリジンを許可

# ===== 設定値 =====
# Cloud Run のベース URL（例: https://photos-api-xxxxx-an.a.run.app）
CLOUD_RUN_URL = os.environ.get("CLOUD_RUN_URL", "https://<your-service>-<region>.run.app")

# サービスアカウントキー(JSON)のパス
SA_KEY_PATH = os.environ.get("SA_KEY_PATH", "/opt/kiosk/creds/sa.json")

# トークンの有効期限のうち「最低これだけ残っていてほしい」秒数
# ここでは 5 分 (300 秒) をマージンとする
TOKEN_EXP_MARGIN = 300
# ==================


# ===== IDトークンのキャッシュ用 変数 =====
_cached_token: str | None = None
_cached_expiry_ts: float = 0.0  # epoch 秒
# =====================================


def get_id_token() -> str:
    """
    Cloud Run 呼び出し用の ID トークンを取得する。
    - キャッシュ済みで有効期限が十分残っていれば再利用
    - 期限が近い／切れていれば再取得
    """
    global _cached_token, _cached_expiry_ts

    now = time.time()

    # キャッシュ済み & 有効期限まで余裕がある場合は再利用
    if _cached_token is not None and now < (_cached_expiry_ts - TOKEN_EXP_MARGIN):
        return _cached_token

    # 新しくトークンを取得
    credentials = service_account.IDTokenCredentials.from_service_account_file(
        SA_KEY_PATH,
        target_audience=CLOUD_RUN_URL,
    )
    credentials.refresh(GoogleRequest())

    _cached_token = credentials.token

    # expiry は datetime.datetime 型なので epoch に変換
    if credentials.expiry is not None:
        _cached_expiry_ts = credentials.expiry.timestamp()
    else:
        # expiry が取れないケースはほぼありませんが、念のため短めにしておく
        _cached_expiry_ts = now + 600  # 10 分

    app.logger.info(
        f"ID token refreshed. Expires at epoch={_cached_expiry_ts} (now={now})"
    )

    return _cached_token


@app.route("/api/photos", methods=["GET"])
def proxy_photos():
    """
    ラズパイのブラウザからは /api/photos にアクセスしてもらい、
    ここで Cloud Run の /api/photos にプロキシする。
    """
    try:
        id_token = get_id_token()

        headers = {
            "Authorization": f"Bearer {id_token}"
        }

        # Cloud Run 側の /api/photos を呼び出す
        resp = requests.get(
            f"{CLOUD_RUN_URL}/api/photos",
            headers=headers,
            timeout=10,
        )

        # Cloud Run 側が JSON を返す前提でそのまま中継
        # （非 JSON の場合は resp.text 等で扱いを変えてください）
        try:
            data = resp.json()
        except ValueError:
            # JSON でない場合はプレーンテキストとして包む
            data = {"raw": resp.text}

        return jsonify(data), resp.status_code

    except Exception as e:
        app.logger.exception("Error while proxying /api/photos")
        return jsonify({"error": str(e)}), 500


@app.route("/")
def health():
    """動作確認用のヘルスチェック"""
    return "Local API is running", 200


if __name__ == "__main__":
    # ログを見やすくするために簡易設定
    logging.basicConfig(level=logging.INFO)
    # ラズパイで localhost:8080 で待ち受け
    app.run(host="0.0.0.0", port=8080)
