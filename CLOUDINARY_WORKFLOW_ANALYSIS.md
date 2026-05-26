# Cloudinary Workflow Analysis - Multi-Dialer Backend

## Overview
The backend uses Cloudinary as the primary cloud storage solution for media files (audio recordings, videos, user avatars, contact imports, and call recordings).

---

## Configuration

### Environment Variables Required
```env
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

### Initialization
**Location:** `src/index.ts` (line 67)
```typescript
cloudinaryConfig();
```

**Config Function:** `src/lib/config.ts`
```typescript
export const cloudinaryConfig = () =>
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
```

---

## Upload Utilities

### 1. Generic Uploader (`src/utils/handler.ts`)
```typescript
export const cloudinaryUploader = async (filePath: string) => {
  try {
    if (!filePath) return;
    const result = await cloudinary.uploader.upload(filePath, {
      resource_type: "auto",
    });
    return result;
  } catch (error) {
    console.log("Cloudinary Upload Error:", error);
    throw error
  }
};
```

**Features:**
- Auto-detects resource type (image/video/audio)
- No folder organization
- Basic error handling
- Returns full Cloudinary response object

---

## Upload Workflows by Feature

### 1. **Audio Recordings** (`src/routes/library/recordings/service.ts`)

**Endpoint:** `POST /api/library/recordings`

**Workflow:**
1. Validate file (audio formats only: mp3, wav, m4a, mp4)
2. Check file size (max 20MB)
3. Upload to Multer temp storage (`./uploads`)
4. Upload to Cloudinary with folder: `recordings`
5. Delete local temp file
6. Save metadata to database

**Code:**
```typescript
const { v2: cloudinary } = await import("cloudinary");
const cloudResult = await cloudinary.uploader.upload(filePath, {
  resource_type: "auto",
  folder: "recordings",
});
```

**Database Schema:**
```typescript
{
  name: string,
  url: cloudResult.secure_url,
  fileSize: number,
  duration: null,
  mimeType: string,
  slot: "ON_HOLD" | "IVR" | "ANSWERING_MACHINE" | "VOICEMAIL" | "GENERAL",
  userId: string
}
```

---

### 2. **Media Center** (`src/routes/library/mediaCenter/service.ts`)

**Endpoint:** `POST /api/library/media-center`

**Media Types Supported:**
- `VOICE_MAIL` - Audio (max 120s, 20MB)
- `ON_HOLD` - Audio (max 20s, 5MB)
- `CALLBACK_MESSAGE` - Audio (max 20s, 750KB)
- `EMAIL_VIDEO` - Video (no duration limit, 20MB)

**Workflow:**
1. Validate media type and file constraints
2. Upload to Multer temp storage
3. Optionally check duration (not implemented yet)
4. Upload to Cloudinary with folder: `media-center`
5. Delete local temp file
6. Save to database with library association

**Code:**
```typescript
const resourceType = config.fileCategory === "video" ? "video" : "auto";
const { v2: cloudinary } = await import("cloudinary");

cloudinaryResult = await cloudinary.uploader.upload(filePath, {
  resource_type: resourceType,
  folder: "media-center",
});
```

**Database Schema:**
```typescript
{
  templateName: string,
  mediaType: "VOICE_MAIL" | "ON_HOLD" | "CALLBACK_MESSAGE" | "EMAIL_VIDEO",
  fileName: string,
  fileUrl: cloudResult.secure_url,
  fileSize: number,
  duration: number | null,
  fileCategory: "audio" | "video",
  libraryId: string
}
```

---

### 3. **User Avatars** (`src/routes/user/controller.ts`)

**Endpoint:** `PUT /api/user/:id`

**Workflow:**
1. Upload to Multer temp storage
2. Use generic `cloudinaryUploader` (no folder)
3. Delete local temp file
4. Update user record with avatar URL

**Code:**
```typescript
const result = await cloudinaryUploader(filePath);
fs.unlinkSync(filePath);

await updateUserInDb(id, { avatar: result.secure_url });
```

---

### 4. **Contact CSV Imports** (`src/routes/contact/service.ts`)

**Endpoint:** `POST /api/contact/import`

**Workflow:**
1. Upload CSV to Multer temp storage
2. Use generic `cloudinaryUploader`
3. Delete local temp file
4. Save import record to database
5. Process CSV asynchronously

**Code:**
```typescript
const cloudinaryResult = await cloudinaryUploader(filePath);
if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

if (!cloudinaryResult?.secure_url) {
  throwHttp(500, "Failed to upload to Cloudinary");
}

await prisma.contactImport.create({
  data: {
    fileName: file.originalname,
    fileUrl: cloudinaryResult.secure_url,
    fileSize: file.size,
    mimeType: file.mimetype,
    userId,
    status: "PENDING"
  }
});
```

---

### 5. **Call Recordings** (`src/routes/calling/services.ts`)

**Endpoint:** Webhook from Twilio (`POST /api/calling/recording-status`)

**Workflow:**
1. Receive recording URL from Twilio
2. Download recording to temp file
3. Upload to Cloudinary using generic uploader
4. Delete temp file
5. Update call record and analysis with Cloudinary URL
6. Transcribe using Groq API

**Code:**
```typescript
private async uploadRecordingToCloudinary(twilioUrl: string, callSid: string): Promise<string> {
  const tempPath = path.join(os.tmpdir(), `recording-${callSid}.mp3`);
  
  try {
    // Download from Twilio
    const response = await axios.get(twilioUrl, {
      responseType: 'stream',
      auth: {
        username: envConfig.TWILIO_ACCOUNT_SID!,
        password: envConfig.TWILIO_AUTH_TOKEN!
      }
    });
    
    const writer = fs.createWriteStream(tempPath);
    response.data.pipe(writer);
    
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
    
    // Upload to Cloudinary
    const result = await cloudinaryUploader(tempPath);
    
    // Cleanup
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    
    return result.secure_url;
  } catch (error) {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    throw error;
  }
}
```

**Database Updates:**
```typescript
await Promise.all([
  prisma.callRecord.update({
    where: { callSid: targetSid },
    data: { recordingUrl: cloudinaryUrl },
  }),
  prisma.callAnalysis.upsert({
    where: { callSid: targetSid },
    update: { recordingUrl: cloudinaryUrl },
    create: {
      callSid: targetSid,
      leadId: "",
      recordingUrl: cloudinaryUrl,
      sentiment: sentimentAnalysis?.sentiment || "",
      confidence: sentimentAnalysis?.confidence || 0,
    }
  })
]);
```

---

## Folder Structure in Cloudinary

```
cloudinary://
├── recordings/          # Audio recordings (ON_HOLD, IVR, ANSWERING_MACHINE, etc.)
├── media-center/        # Media center files (VOICE_MAIL, EMAIL_VIDEO, etc.)
└── (root)              # User avatars, contact imports, call recordings
```

---

## Error Handling Patterns

### 1. **Try-Catch with Cleanup**
```typescript
try {
  const cloudResult = await cloudinary.uploader.upload(filePath, options);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  return cloudResult;
} catch (error) {
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  throw error;
}
```

### 2. **Validation Before Upload**
```typescript
// Check file type
if (!allowedMimeTypes.includes(file.mimetype)) {
  throw { errors: [{ message: "Invalid file type", path: ["file"] }] };
}

// Check file size
if (file.size > maxSize) {
  throw { errors: [{ message: "File too large", path: ["file"] }] };
}
```

### 3. **Null Check After Upload**
```typescript
if (!cloudResult || !cloudResult.secure_url) {
  throw new Error("Failed to upload file to Cloudinary");
}
```

---

## Common Issues & Solutions

### Issue 1: Missing Cloudinary Config
**Symptom:** `Cloudinary Upload Error: Must supply api_key`

**Solution:** Ensure environment variables are set:
```env
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

### Issue 2: Temp Files Not Cleaned Up
**Symptom:** `./uploads` folder grows indefinitely

**Solution:** All upload functions include cleanup:
```typescript
if (fs.existsSync(filePath)) {
  fs.unlinkSync(filePath);
}
```

### Issue 3: Large File Uploads Timeout
**Symptom:** Upload fails for files > 10MB

**Solution:** Increase Cloudinary timeout or use chunked uploads:
```typescript
const cloudResult = await cloudinary.uploader.upload(filePath, {
  resource_type: "auto",
  timeout: 120000, // 2 minutes
});
```

### Issue 4: Wrong Resource Type
**Symptom:** Video files uploaded as "raw" instead of "video"

**Solution:** Explicitly set resource_type:
```typescript
const cloudResult = await cloudinary.uploader.upload(filePath, {
  resource_type: "video", // or "audio", "image", "raw"
  folder: "media-center",
});
```

---

## Best Practices

### 1. **Always Clean Up Temp Files**
```typescript
try {
  const result = await cloudinaryUploader(filePath);
  return result;
} finally {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}
```

### 2. **Use Folders for Organization**
```typescript
await cloudinary.uploader.upload(filePath, {
  folder: "recordings", // Organize by feature
});
```

### 3. **Validate Before Upload**
- Check file type
- Check file size
- Check file duration (for audio/video)

### 4. **Store Cloudinary URL, Not Local Path**
```typescript
// ✅ Good
data: { fileUrl: cloudResult.secure_url }

// ❌ Bad
data: { fileUrl: filePath }
```

### 5. **Use Appropriate Resource Type**
```typescript
// For videos
resource_type: "video"

// For audio
resource_type: "auto" // or "video" (audio is treated as video in Cloudinary)

// For images
resource_type: "image"
```

---

## Performance Considerations

### 1. **Parallel Uploads**
For multiple files, upload in parallel:
```typescript
const uploadPromises = files.map(file => 
  cloudinaryUploader(file.path)
);
const results = await Promise.all(uploadPromises);
```

### 2. **Streaming Large Files**
For files > 100MB, use streaming:
```typescript
const stream = cloudinary.uploader.upload_stream(
  { folder: "recordings" },
  (error, result) => {
    if (error) reject(error);
    else resolve(result);
  }
);
fs.createReadStream(filePath).pipe(stream);
```

### 3. **Lazy Loading**
Import Cloudinary only when needed:
```typescript
const { v2: cloudinary } = await import("cloudinary");
```

---

## Security Considerations

### 1. **Signed URLs**
For private content, use signed URLs:
```typescript
const signedUrl = cloudinary.url(publicId, {
  sign_url: true,
  type: "authenticated"
});
```

### 2. **Upload Presets**
Use upload presets for consistent security:
```typescript
await cloudinary.uploader.upload(filePath, {
  upload_preset: "secure_recordings"
});
```

### 3. **File Type Validation**
Always validate MIME types server-side:
```typescript
const allowedMimeTypes = ["audio/mpeg", "audio/wav"];
if (!allowedMimeTypes.includes(file.mimetype)) {
  throw new Error("Invalid file type");
}
```

---

## Monitoring & Debugging

### 1. **Enable Logging**
```typescript
console.log("[Cloudinary] Uploading:", filePath);
console.log("[Cloudinary] Result:", cloudResult.secure_url);
```

### 2. **Track Upload Metrics**
```typescript
const startTime = Date.now();
const result = await cloudinaryUploader(filePath);
const duration = Date.now() - startTime;
console.log(`[Cloudinary] Upload took ${duration}ms`);
```

### 3. **Error Tracking**
```typescript
catch (error) {
  console.error("[Cloudinary] Upload failed:", {
    file: filePath,
    error: error.message,
    stack: error.stack
  });
  throw error;
}
```

---

## Future Improvements

### 1. **Add Duration Extraction**
Implement `getFileDuration()` in media center service using `ffprobe` or `get-audio-duration`

### 2. **Add Transformation Support**
```typescript
await cloudinary.uploader.upload(filePath, {
  transformation: [
    { quality: "auto" },
    { fetch_format: "auto" }
  ]
});
```

### 3. **Add CDN Caching**
Use Cloudinary's CDN features for faster delivery

### 4. **Add Backup Strategy**
Implement periodic backups of Cloudinary assets

### 5. **Add Webhook Support**
Use Cloudinary webhooks for upload notifications

---

## Summary

**Strengths:**
- ✅ Consistent upload pattern across features
- ✅ Proper temp file cleanup
- ✅ Folder organization for recordings and media center
- ✅ File validation before upload
- ✅ Error handling with cleanup

**Weaknesses:**
- ⚠️ No duration extraction for audio/video files
- ⚠️ No signed URLs for private content
- ⚠️ No upload progress tracking
- ⚠️ No retry logic for failed uploads
- ⚠️ Mixed use of generic uploader vs. direct Cloudinary import

**Recommendations:**
1. Standardize on one upload method (either generic utility or direct import)
2. Implement duration extraction for media files
3. Add retry logic for network failures
4. Use upload presets for consistent configuration
5. Add monitoring/metrics for upload performance
