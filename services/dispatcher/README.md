```
. ./services/dispatcher/.env
```

```
# 初回のみ
gcloud secrets create $SECRET_NAME \
--project $PROJECT_ID \
--replication-policy="automatic"
```

```
echo $API_KEY | gcloud secrets versions add $SECRET_NAME \
  --project $PROJECT_ID \
  --data-file=-
```

```
gcloud run deploy dispatcher \
--source ./services/dispatcher \
--region $REGION \
--set-env-vars FIRESTORE_PROJECT_ID=$PROJECT_ID,FIRESTORE_DATABASE_ID=$FIRESTORE_DATABASE_ID \
--update-secrets=GEMINI_API_KEY=$SECRET_NAME:latest \
--no-allow-unauthenticated
```
