
# Multi-Dialer Library APIs Documentation

## Overview
The Library APIs provide comprehensive functionality for managing scripts, SMS templates, email templates, and media center assets. All endpoints require authentication via Bearer Token or API Key.

---

## Authentication
All endpoints require one of the following:
- **Bearer Token**: `Authorization: Bearer <jwt_token>`
- **API Key**: `x-api-key: <user_id>`

---

## Library API Endpoints

### 1. Scripts API (`/api/library/script`)

#### Create Script
- **POST** `/api/library/script/create`
- **Description**: Create a new call script in user's library
- **Auth**: Required
- **Request Body**:
  ```json
  {
    "scriptName": "Sales Introduction",
    "scriptText": "Hello, this is...",
    "status": true
  }
  ```
- **Response**: 201 Created with script object

#### Get All Scripts (User)
- **GET** `/api/library/script`
- **Description**: Get authenticated user's scripts
- **Auth**: Required
- **Response**: 200 OK with scripts array

#### Get All Scripts (Admin)
- **GET** `/api/library/script/all`
- **Description**: Get scripts from all users
- **Auth**: Required + ADMIN/OWNER role
- **Response**: 200 OK with scripts array

#### Get Script by ID
- **GET** `/api/library/script/{id}`
- **Description**: Get specific script (must be user's)
- **Auth**: Required
- **Response**: 200 OK with script object

#### Update Script
- **PUT** `/api/library/script/{id}`
- **Description**: Update specific script (must be user's)
- **Auth**: Required
- **Request Body**: `{ scriptName, scriptText, status }`
- **Response**: 200 OK with updated script object

#### Delete Script
- **DELETE** `/api/library/script/{id}`
- **Description**: Delete specific script (must be user's)
- **Auth**: Required
- **Response**: 200 OK

---

### 2. SMS Templates API (`/api/library/sms`)

#### Create SMS Template
- **POST** `/api/library/sms/create`
- **Description**: Create a new SMS template in user's library
- **Auth**: Required
- **Request Body**:
  ```json
  {
    "templateName": "Welcome SMS",
    "content": "Hi! Welcome to our service..."
  }
  ```
- **Response**: 201 Created with SMS template object

#### Get All SMS Templates (User)
- **GET** `/api/library/sms`
- **Description**: Get authenticated user's SMS templates
- **Auth**: Required
- **Response**: 200 OK with SMS templates array

#### Get All SMS Templates (Admin)
- **GET** `/api/library/sms/all`
- **Description**: Get SMS templates from all users
- **Auth**: Required + ADMIN/OWNER role
- **Response**: 200 OK with SMS templates array

#### Get SMS Template by ID
- **GET** `/api/library/sms/{id}`
- **Description**: Get specific SMS template (must be user's)
- **Auth**: Required
- **Response**: 200 OK with SMS template object

#### Update SMS Template
- **PUT** `/api/library/sms/{id}`
- **Description**: Update specific SMS template (must be user's)
- **Auth**: Required
- **Request Body**: `{ templateName, content }`
- **Response**: 200 OK with updated SMS template object

#### Delete SMS Template
- **DELETE** `/api/library/sms/{id}`
- **Description**: Delete specific SMS template (must be user's)
- **Auth**: Required
- **Response**: 200 OK

---

### 3. Email Templates API (`/api/library/email`)

#### Create Email Template
- **POST** `/api/library/email/create`
- **Description**: Create a new email template in user's library
- **Auth**: Required
- **Request Body**:
  ```json
  {
    "templateName": "Welcome Email",
    "subject": "Welcome to our service!",
    "content": "Hi there! Welcome...",
    "status": true
  }
  ```
- **Response**: 201 Created with email template object

#### Get All Email Templates (User)
- **GET** `/api/library/email`
- **Description**: Get authenticated user's email templates
- **Auth**: Required
- **Response**: 200 OK with email templates array

#### Get All Email Templates (Admin)
- **GET** `/api/library/email/all`
- **Description**: Get email templates from all users
- **Auth**: Required + ADMIN/OWNER role
- **Response**: 200 OK with email templates array

#### Get Email Template by ID
- **GET** `/api/library/email/{id}`
- **Description**: Get specific email template (must be user's)
- **Auth**: Required
- **Response**: 200 OK with email template object

#### Update Email Template
- **PUT** `/api/library/email/{id}`
- **Description**: Update specific email template (must be user's)
- **Auth**: Required
- **Request Body**: `{ templateName, subject, content, status }`
- **Response**: 200 OK with updated email template object

#### Delete Email Template
- **DELETE** `/api/library/email/{id}`
- **Description**: Delete specific email template (must be user's)
- **Auth**: Required
- **Response**: 200 OK

---

### 4. Media Center API (`/api/library/media-center`)

#### Create Media Center Item
- **POST** `/api/library/media-center/create`
- **Description**: Upload audio/video file to media center
- **Auth**: Required
- **Content-Type**: `multipart/form-data`
- **Request Body**:
  ```json
  {
    "templateName": "Voicemail Greeting",
    "mediaType": "VOICE_MAIL|ON_HOLD|CALLBACK_MESSAGE|EMAIL_VIDEO",
    "file": <binary_file>
  }
  ```
- **Supported Types**:
  - `VOICE_MAIL`: Max 20MB, max 120 seconds
  - `ON_HOLD`: Max 750KB, max 20 seconds
  - `CALLBACK_MESSAGE`: Max 750KB, max 20 seconds
  - `EMAIL_VIDEO`: Max 20MB, unlimited duration
- **Response**: 201 Created with media center object

#### Get All Media Items (User)
- **GET** `/api/library/media-center`
- **Description**: Get authenticated user's media center items
- **Auth**: Required
- **Response**: 200 OK with media items array

#### Get All Media Items (Admin)
- **GET** `/api/library/media-center/all`
- **Description**: Get media center items from all users
- **Auth**: Required + ADMIN/OWNER role
- **Response**: 200 OK with media items array

#### Get Media Item by ID
- **GET** `/api/library/media-center/{id}`
- **Description**: Get specific media item (must be user's)
- **Auth**: Required
- **Response**: 200 OK with media item object

#### Update Media Item
- **PUT** `/api/library/media-center/{id}`
- **Description**: Update specific media item (must be user's)
- **Auth**: Required
- **Request Body**: `{ templateName, mediaType }`
- **Response**: 200 OK with updated media item object

#### Delete Media Item
- **DELETE** `/api/library/media-center/{id}`
- **Description**: Delete specific media item (must be user's)
- **Auth**: Required
- **Response**: 200 OK

---

## Common Response Format

### Success Response (200/201)
```json
{
  "success": true,
  "message": "Operation successful",
  "data": { /* resource object */ }
}
```

### Error Response (400/401/403/404/500)
```json
{
  "success": false,
  "message": "Error description",
  "errors": [ /* validation errors if 400 */ ]
}
```

---

## Access Control

### User Scopes
- **AGENT**: Can create/update/delete their own resources
- **ADMIN**: Can access all user resources + admin endpoints
- **OWNER**: Full system access

### Authorization Rules
1. Users can only access their own resources (from their Library)
2. `/all` endpoints require ADMIN or OWNER role
3. Authentication required for all endpoints
4. Unauthorized access returns 401
5. Forbidden access (wrong role/ownership) returns 403

---

## Common Error Codes

| Code | Reason |
|------|--------|
| 400 | Invalid request/validation error |
| 401 | Missing or invalid authentication |
| 403 | Insufficient permissions/role |
| 404 | Resource not found |
| 409 | Conflict (e.g., duplicate template name) |
| 500 | Server error |

---

## Swagger UI Access
- **URL**: `http://localhost:3000/api-docs`
- **Theme**: Dracula
- **Features**: Try-it-out, request inspection, response formatting

---

## Implementation Details

### Database Models
All library resources extend the `Library` model:
- `Script` (scripts)
- `SMSTemplate` (sms_templates)
- `EmailTemplate` (email_templates)
- `MediaCenter` (media_center)

### Auto-Creation
Library is automatically created when user signs up.

### Validation
All inputs validated using Zod schemas:
- `createScriptSchema`
- `createSmsSchema`
- `createEmailSchema`
- `createMediaCenterSchema`

### File Storage
Media Center files uploaded to Cloudinary (persistent cloud storage).

---

## Testing

### Using cURL
```bash
# Get user's scripts
curl -H "Authorization: Bearer <token>" http://localhost:3000/api/library/script

# Create script
curl -X POST http://localhost:3000/api/library/script/create \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"scriptName": "Test", "scriptText": "Hello"}'
```

### Using Postman
1. Open Postman
2. Go to `http://localhost:3000/api-docs`
3. Use "Try it out" button on any endpoint
4. Set Bearer Token in Authorization tab

---

## Related APIs
- **Authentication**: `/api/auth/*` (BetterAuth)
- **System Settings**: `/api/system-settings/caller-id`, `/api/system-settings/call-settings`, `/api/system-settings/misc-fields`
- **Products**: `/api/products`
