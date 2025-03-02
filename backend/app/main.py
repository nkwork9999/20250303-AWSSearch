from fastapi import FastAPI, Depends, HTTPException
import boto3
from botocore.exceptions import ClientError
from dotenv import load_dotenv
import os
from fastapi.middleware.cors import CORSMiddleware


load_dotenv()  # .envファイルを読み込む
AWS_REGION = os.getenv("AWS_REGION")
S3_BUCKET = os.getenv("S3_BUCKET")
AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY")
FILE_NAME = os.getenv("FILE_NAME")


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

session = boto3.Session(
    aws_access_key_id=AWS_ACCESS_KEY_ID,
    aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
    region_name=AWS_REGION
)

s3_client = session.client("s3")


@app.get("/presigned-url")

def get_presigned_url(key: str = FILE_NAME): 

    try:
        response = s3_client.generate_presigned_url(
            'get_object',
            Params={
                'Bucket': S3_BUCKET,
                'Key': key
            },
            ExpiresIn=3600  # URL の有効期限(秒)
        )
        print("[DEBUG] Presigned URL generated successfully.")
        return {"url": response}
    except ClientError as e:
        raise HTTPException(status_code=400, detail=str(e))


