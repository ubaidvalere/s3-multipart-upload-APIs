## Video Upload Backend API

This service provides a multipart video upload flow to AWS S3 using presigned URLs.

- **Base URL (local)**: `http://localhost:3000`

---

## Health Check

- **URL**: `GET /`
- **Headers**
  - **Content-Type**: `application/json`
- **Request Body**: _None_
- **Success Response (200)**

```json
{
  "status": true,
  "message": "Server is running"
}
```

---

## 1. Initialize Multipart Upload

- **URL**: `POST /api/multipart-init`
- **Description**: Creates a multipart upload in S3 and returns presigned URLs for each part.
- **Headers**
  - **Content-Type**: `application/json`
- **Request Body**

```json
{
  "fileName": "example-video.mp4",
  "fileType": "video/mp4",
  "chunkCount": 10
}
```

- **Field Details**
  - **fileName** `string` (required): Original file name.
  - **fileType** `string` (optional): MIME type, defaults to `video/mp4` if omitted.
  - **chunkCount** `number` (required): Number of chunks (1–10000).

- **Success Response (200)**

```json
{
  "uploadId": "STRING",
  "fileKey": "uploads/1737991150000-example-video.mp4",
  "signedUrls": [
    {
      "partNumber": 1,
      "uploadUrl": "https://s3.amazonaws.com/..."
    }
  ]
}
```

- **Error Responses**
  - **400** – invalid parameters

    ```json
    { "error": "Invalid parameters. chunkCount must be between 1 and 10000" }
    ```

  - **500** – internal error

    ```json
    { "error": "Failed to initialize upload" }
    ```

---

## 2. Resume Multipart Upload (Generate Fresh URLs)

- **URL**: `POST /api/multipart-resume`
- **Description**: Generates new presigned URLs for remaining parts of an existing upload.
- **Headers**
  - **Content-Type**: `application/json`
- **Request Body**

```json
{
  "uploadId": "STRING",
  "fileKey": "uploads/1737991150000-example-video.mp4",
  "chunkNumbers": [3, 4, 5]
}
```

- **Field Details**
  - **uploadId** `string` (required): S3 multipart upload ID.
  - **fileKey** `string` (required in this example): S3 object key for the upload.
  - **chunkNumbers** `number[]` (required): Part numbers that need fresh URLs.

- **Success Response (200)**

```json
{
  "signedUrls": [
    {
      "partNumber": 3,
      "uploadUrl": "https://s3.amazonaws.com/..."
    }
  ]
}
```

- **Error Responses**
  - **400** – invalid parameters

    ```json
    { "error": "Invalid parameters" }
    ```

  - **500** – internal error

    ```json
    { "error": "Failed to resume upload" }
    ```

---

## 3. Complete Multipart Upload

- **URL**: `POST /api/multipart-complete`
- **Description**: Completes the multipart upload after all parts are uploaded.
- **Headers**
  - **Content-Type**: `application/json`
- **Request Body**

```json
{
  "uploadId": "STRING",
  "fileKey": "uploads/1737991150000-example-video.mp4",
  "parts": [
    {
      "PartNumber": 1,
      "ETag": "\"etag-from-s3-part-1\""
    },
    {
      "PartNumber": 2,
      "ETag": "\"etag-from-s3-part-2\""
    }
  ]
}
```

- **Field Details**
  - **uploadId** `string` (required): S3 multipart upload ID.
  - **fileKey** `string` (required): S3 object key for the upload.
  - **parts** `array` (required): Each item contains:
    - **PartNumber** `number`: Part number (1-indexed).
    - **ETag** `string`: ETag returned by S3 for that part.

- **Success Response (200)**

```json
{
  "success": true,
  "location": "https://your-bucket.s3.amazonaws.com/uploads/1737991150000-example-video.mp4",
  "bucket": "your-bucket-name",
  "key": "uploads/1737991150000-example-video.mp4",
  "etag": "\"final-etag\""
}
```

- **Error Responses**
  - **400** – invalid parameters

    ```json
    { "error": "Invalid parameters" }
    ```

  - **500** – internal error

    ```json
    { "error": "Failed to complete upload" }
    ```

---

## 4. Abort Multipart Upload

- **URL**: `POST /api/multipart-abort`
- **Description**: Aborts a multipart upload and cleans up parts in S3.
- **Headers**
  - **Content-Type**: `application/json`
- **Request Body**

```json
{
  "uploadId": "STRING",
  "fileKey": "uploads/1737991150000-example-video.mp4"
}
```

- **Field Details**
  - **uploadId** `string` (required): S3 multipart upload ID.
  - **fileKey** `string` (required): S3 object key for the upload.

- **Success Response (200)**

```json
{ "success": true }
```

- **Error Responses**
  - **400** – invalid parameters

    ```json
    { "error": "Invalid parameters" }
    ```

  - **500** – internal error

    ```json
    { "error": "Failed to abort upload" }
    ```

---

## 5. Get Upload Status

- **URL**: `GET /api/upload-status/:uploadId`
- **Description**: Returns status information for a given upload. Currently returns mock data; in production this should query your database.
- **Headers**
  - **Content-Type**: `application/json`
- **Path Parameters**
  - **uploadId** `string` (required): The upload ID to check.
- **Request Body**: _None_

- **Success Response (200)**

```json
{
  "uploadId": "STRING",
  "status": "in_progress"
}
```

- **Error Responses**
  - **500** – internal error

    ```json
    { "error": "Failed to fetch upload status" }
    ```

---

## Common HTTP Headers and Auth

- **Content-Type**
  - All JSON endpoints expect `Content-Type: application/json`.
- **Authentication**
  - This example has **no authentication headers**. In production, you should add your own mechanism (e.g. `Authorization: Bearer <token>`).

