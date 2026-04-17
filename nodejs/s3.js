const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

async function generateSignedImageUrl(key) {
  if (!key) {
    throw new Error("Missing S3 object key");
  }

  const command = new GetObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME,
    Key: key,
  });

  const expiresInSeconds = 259200; // 72 hours

  const url = await getSignedUrl(s3, command, {
    expiresIn: expiresInSeconds,
  });

  console.log("SIGNED URL DEBUG:", {
    key,
    bucket: process.env.S3_BUCKET_NAME,
    expiresInSeconds,
    url,
  });

  return url;
}

module.exports = {
  generateSignedImageUrl,
};
