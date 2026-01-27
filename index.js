// ============================================================
// Backend API Example - Node.js/Express with AWS S3
// ============================================================

import express from "express";
import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

// Configure AWS S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET_NAME = process.env.S3_BUCKET_NAME || "your-bucket-name";

app.get("/", (req, res) => {
  return res.status(200).json({
    status: true,
    message: "Server is running",
  });
});

/**
 * STEP 1: Initialize multipart upload
 *
 * This endpoint is called when the user starts uploading a video.
 * It creates a multipart upload in S3 and generates signed URLs for each part.
 *
 * Flow:
 * 1. Client calculates how many chunks needed (e.g., 10 chunks for a 50MB file with 5MB chunks)
 * 2. Client calls this endpoint with chunk count
 * 3. Server creates S3 multipart upload
 * 4. Server generates signed URLs for each part
 * 5. Client receives uploadId and URLs to start uploading
 */
app.post("/api/multipart-init", async (req, res) => {
  try {
    const { fileName, fileType, chunkCount } = req.body;

    // Validate input
    if (!fileName || !chunkCount || chunkCount < 1 || chunkCount > 10000) {
      return res.status(400).json({
        error: "Invalid parameters. chunkCount must be between 1 and 10000",
      });
    }

    // Generate a unique S3 key (file path in bucket)
    const fileKey = `uploads/${Date.now()}-${fileName}`;

    // Create multipart upload in S3
    const createCommand = new CreateMultipartUploadCommand({
      Bucket: BUCKET_NAME,
      Key: fileKey,
      ContentType: fileType || "video/mp4",
      // Optional: Add metadata
      Metadata: {
        originalName: fileName,
        uploadedAt: new Date().toISOString(),
      },
    });

    const multipartUpload = await s3Client.send(createCommand);
    const uploadId = multipartUpload.UploadId;

    if (!uploadId) {
      throw new Error("Failed to create multipart upload");
    }

    // Generate signed URLs for each part
    // S3 part numbers are 1-indexed
    const signedUrlPromises = [];
    for (let partNumber = 1; partNumber <= chunkCount; partNumber++) {
      const command = new UploadPartCommand({
        Bucket: BUCKET_NAME,
        Key: fileKey,
        UploadId: uploadId,
        PartNumber: partNumber,
      });

      // Generate presigned URL that expires in 1 hour
      const signedUrlPromise = getSignedUrl(s3Client, command, {
        expiresIn: 36000, // 10 hours
      });

      signedUrlPromises.push(
        signedUrlPromise.then((url) => ({
          partNumber,
          uploadUrl: url,
        })),
      );
    }

    const signedUrls = await Promise.all(signedUrlPromises);

    // Store upload metadata in your database for tracking
    // await db.uploads.create({
    //   uploadId,
    //   fileKey,
    //   fileName,
    //   totalParts: chunkCount,
    //   status: 'in_progress',
    //   createdAt: new Date(),
    // });

    res.json({
      uploadId,
      fileKey,
      signedUrls,
    });
  } catch (error) {
    console.error("Error initializing multipart upload:", error);
    res.status(500).json({ error: "Failed to initialize upload" });
  }
});

/**
 * STEP 2: Resume upload (generate fresh signed URLs)
 *
 * This endpoint is called when the app restarts and needs to resume an upload.
 * The original signed URLs have expired, so we generate new ones for remaining chunks.
 *
 * The client tells us which chunks still need uploading, and we generate fresh URLs for those.
 */
app.post("/api/multipart-resume", async (req, res) => {
  try {
    const { uploadId, chunkNumbers } = req.body;

    // Validate input
    if (!uploadId || !Array.isArray(chunkNumbers) || chunkNumbers.length === 0) {
      return res.status(400).json({ error: "Invalid parameters" });
    }

    // Retrieve upload metadata from your database
    // const upload = await db.uploads.findOne({ uploadId });
    // if (!upload) {
    //   return res.status(404).json({ error: 'Upload not found' });
    // }

    // For this example, we'll assume you stored the fileKey when creating the upload
    // In production, retrieve this from your database
    const fileKey = req.body.fileKey; // You should get this from your DB

    // Generate fresh signed URLs for the requested chunks
    const signedUrlPromises = chunkNumbers.map(async (partNumber) => {
      const command = new UploadPartCommand({
        Bucket: BUCKET_NAME,
        Key: fileKey,
        UploadId: uploadId,
        PartNumber: partNumber,
      });

      const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

      return {
        partNumber,
        uploadUrl: url,
      };
    });

    const signedUrls = await Promise.all(signedUrlPromises);

    res.json({ signedUrls });
  } catch (error) {
    console.error("Error resuming upload:", error);
    res.status(500).json({ error: "Failed to resume upload" });
  }
});

/**
 * STEP 3: Complete multipart upload
 *
 * This endpoint is called when all chunks have been uploaded.
 * The client sends us the ETags for each uploaded part.
 * We tell S3 to assemble all the parts into a single file.
 *
 * This is the final step that makes the file available in S3.
 */
app.post("/api/multipart-complete", async (req, res) => {
  try {
    const { uploadId, parts } = req.body;

    // Validate input
    if (!uploadId || !Array.isArray(parts) || parts.length === 0) {
      return res.status(400).json({ error: "Invalid parameters" });
    }

    // Retrieve upload metadata from your database
    // const upload = await db.uploads.findOne({ uploadId });
    // if (!upload) {
    //   return res.status(404).json({ error: 'Upload not found' });
    // }

    const fileKey = req.body.fileKey; // Get from your DB in production

    // Sort parts by part number (S3 requires this)
    const sortedParts = parts
      .map((p) => ({
        PartNumber: p.PartNumber,
        ETag: p.ETag,
      }))
      .sort((a, b) => a.PartNumber - b.PartNumber);

    // Complete the multipart upload in S3
    const completeCommand = new CompleteMultipartUploadCommand({
      Bucket: BUCKET_NAME,
      Key: fileKey,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: sortedParts,
      },
    });

    const result = await s3Client.send(completeCommand);

    // Update upload status in your database
    // await db.uploads.update(
    //   { uploadId },
    //   {
    //     status: 'completed',
    //     completedAt: new Date(),
    //     s3Location: result.Location,
    //   }
    // );

    res.json({
      success: true,
      location: result.Location,
      bucket: result.Bucket,
      key: result.Key,
      etag: result.ETag,
    });
  } catch (error) {
    console.error("Error completing multipart upload:", error);
    res.status(500).json({ error: "Failed to complete upload" });
  }
});

/**
 * OPTIONAL: Abort multipart upload
 *
 * This endpoint is called if the user cancels an upload.
 * It cleans up the incomplete parts in S3 to avoid storage charges.
 */
app.post("/api/multipart-abort", async (req, res) => {
  try {
    const { uploadId, fileKey } = req.body;

    if (!uploadId || !fileKey) {
      return res.status(400).json({ error: "Invalid parameters" });
    }

    // Abort the multipart upload in S3
    const abortCommand = new AbortMultipartUploadCommand({
      Bucket: BUCKET_NAME,
      Key: fileKey,
      UploadId: uploadId,
    });

    await s3Client.send(abortCommand);

    // Update status in your database
    // await db.uploads.update(
    //   { uploadId },
    //   { status: 'cancelled' }
    // );

    res.json({ success: true });
  } catch (error) {
    console.error("Error aborting multipart upload:", error);
    res.status(500).json({ error: "Failed to abort upload" });
  }
});

/**
 * OPTIONAL: Get upload status
 *
 * Endpoint to check the status of an upload.
 * Useful for showing upload history or debugging.
 */
app.get("/api/upload-status/:uploadId", async (req, res) => {
  try {
    const { uploadId } = req.params;

    // Retrieve from your database
    // const upload = await db.uploads.findOne({ uploadId });

    // For this example, return mock data
    res.json({
      uploadId,
      status: "in_progress",
      // Include other relevant info from your DB
    });
  } catch (error) {
    console.error("Error fetching upload status:", error);
    res.status(500).json({ error: "Failed to fetch upload status" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Upload API server running on port ${PORT}`);
});

// ============================================================
// Database Schema Example (for reference)
// ============================================================

/*
-- PostgreSQL schema example for tracking uploads

CREATE TABLE uploads (
  id SERIAL PRIMARY KEY,
  upload_id VARCHAR(255) UNIQUE NOT NULL,
  file_key VARCHAR(500) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_size BIGINT,
  total_parts INTEGER NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'in_progress',
  s3_location VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  user_id INTEGER REFERENCES users(id)
);

CREATE INDEX idx_upload_id ON uploads(upload_id);
CREATE INDEX idx_user_id ON uploads(user_id);
CREATE INDEX idx_status ON uploads(status);

-- Track individual part uploads (optional, for detailed monitoring)
CREATE TABLE upload_parts (
  id SERIAL PRIMARY KEY,
  upload_id VARCHAR(255) REFERENCES uploads(upload_id),
  part_number INTEGER NOT NULL,
  etag VARCHAR(255),
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(upload_id, part_number)
);
*/

// ============================================================
// Environment Variables (.env file)
// ============================================================

/*
# AWS Configuration
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key-id
AWS_SECRET_ACCESS_KEY=your-secret-access-key
S3_BUCKET_NAME=your-bucket-name

# Server Configuration
PORT=3000
NODE_ENV=production

# Database (if using)
DATABASE_URL=postgresql://user:password@localhost:5432/your_db
*/

// ============================================================
// S3 Bucket CORS Configuration
// ============================================================

/*
Your S3 bucket needs CORS configuration to allow uploads from the mobile app.

Add this CORS configuration in AWS S3 Console > Bucket > Permissions > CORS:

[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["PUT", "POST", "GET", "HEAD"],
    "AllowedOrigins": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]

The "ExposeHeaders": ["ETag"] is critical - the mobile app needs to read the ETag header
from the upload response to pass it back to your completion endpoint.
*/

export default app;
