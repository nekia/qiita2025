#!/bin/bash

REGION=${REGION:-asia-northeast1}
PROJECT_ID=${PROJECT_ID:-line-msg-kiosk-board}
IMAGE_NAME=${IMAGE_NAME:-photo-api-mock}
PHOTOS_ALBUM_ID=${PHOTOS_ALBUM_ID:-1234567890}
GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID:-1234567890}
SECRET_NAME_GOOGLE_REFRESH_TOKEN=${SECRET_NAME_GOOGLE_REFRESH_TOKEN:-GOOGLE_REFRESH_TOKEN}
SECRET_NAME_GOOGLE_CLIENT_SECRET=${SECRET_NAME_GOOGLE_CLIENT_SECRET:-GOOGLE_CLIENT_SECRET}

gcloud builds submit --tag gcr.io/$PROJECT_ID/$IMAGE_NAME photo-api/
gcloud run deploy $IMAGE_NAME   --image gcr.io/$PROJECT_ID/$IMAGE_NAME   --platform managed   --region $REGION \
    --set-env-vars PHOTOS_ALBUM_ID=$PHOTOS_ALBUM_ID,GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID \
    --update-secrets=GOOGLE_REFRESH_TOKEN=$SECRET_NAME_GOOGLE_REFRESH_TOKEN:latest \
    --update-secrets=GOOGLE_CLIENT_SECRET=$SECRET_NAME_GOOGLE_CLIENT_SECRET:latest \
    --no-allow-unauthenticated

PHOTO_API_URL=$(gcloud run services describe $IMAGE_NAME --region $REGION --project $PROJECT_ID --format='value(status.url)')
echo "Photo API URL: $PHOTO_API_URL"