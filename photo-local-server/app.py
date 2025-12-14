import os
import time
import json
import logging

from flask import Flask, jsonify, request, Response, stream_with_context
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
# Cloud Run のベース URL
PHOTO_API_URL = os.environ.get(
    "PHOTO_API_URL",
    os.environ.get("CLOUD_RUN_URL", "https://<photo-api>-<region>.run.app"),
)
KIOSK_URL = os.environ.get("KIOSK_URL", "https://<kiosk-gateway>-<region>.run.app")

# サービスアカウントキー(JSON)のパス
SA_KEY_PATH = os.environ.get("SA_KEY_PATH", "/opt/kiosk/creds/sa.json")

# トークンの有効期限のうち「最低これだけ残っていてほしい」秒数
# ここでは 5 分 (300 秒) をマージンとする
TOKEN_EXP_MARGIN = 300
# ==================


# ===== IDトークンのキャッシュ用 変数 (audience別) =====
_token_cache: dict[str, tuple[str, float]] = {}  # audience -> (token, expiry_ts)
# ====================================================


def get_id_token(audience: str) -> str:
    """
    Cloud Run 呼び出し用の ID トークンを取得する。
    - キャッシュ済みで有効期限が十分残っていれば再利用
    - 期限が近い／切れていれば再取得
    """
    now = time.time()
    cached = _token_cache.get(audience)
    if cached:
        token, exp_ts = cached
        if now < (exp_ts - TOKEN_EXP_MARGIN):
            return token

    # 新しくトークンを取得
    credentials = service_account.IDTokenCredentials.from_service_account_file(
        SA_KEY_PATH,
        target_audience=audience,
    )
    credentials.refresh(GoogleRequest())

    token = credentials.token

    # expiry は datetime.datetime 型なので epoch に変換
    if credentials.expiry is not None:
        exp_ts = credentials.expiry.timestamp()
    else:
        exp_ts = now + 600  # 10 分（fallback）

    _token_cache[audience] = (token, exp_ts)
    app.logger.info(f"ID token refreshed for {audience}. exp={exp_ts} now={now}")
    return token


@app.route("/api/photos", methods=["GET"])
def proxy_photos():
    """
    ラズパイのブラウザからは /api/photos にアクセスしてもらい、
    ここで Cloud Run の /api/photos にプロキシする。
    """
    try:
        id_token = get_id_token(PHOTO_API_URL)

        headers = {
            "Authorization": f"Bearer {id_token}"
        }

        # Cloud Run 側の /api/photos を呼び出す
        resp = requests.get(
            f"{PHOTO_API_URL}/api/photos",
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


@app.route("/sse", methods=["GET"])
def proxy_sse():
    """
    SSE を Cloud Run の /sse に透過中継する。
    ブラウザは http://localhost:8080/sse?deviceId=...&since=... に接続。
    """
    if not request.args.get("deviceId"):
        return jsonify({"error": "deviceId is required"}), 400

    def generate():
        try:
            token = get_id_token(KIOSK_URL)
            with requests.get(
                f"{KIOSK_URL}/sse",
                params=request.args,
                headers={
                    "Accept": "text/event-stream",
                    "Authorization": f"Bearer {token}",
                },
                stream=True,
                timeout=30,
            ) as r:
                for line in r.iter_lines(decode_unicode=True):
                    if line is None:
                        continue
                    # そのまま転送
                    yield line + "\n"
        except Exception as e:
            app.logger.exception("SSE proxy error")
            yield f"event: error\ndata: {json.dumps({'error': str(e)})}\n\n"

    return Response(stream_with_context(generate()), mimetype="text/event-stream")


@app.route("/")
def health():
    """動作確認用のヘルスチェック"""
    return "Local API is running", 200


if __name__ == "__main__":
    # ログを見やすくするために簡易設定
    logging.basicConfig(level=logging.INFO)
    # ラズパイで localhost:8080 で待ち受け
    app.run(host="0.0.0.0", port=8080)
