import { envConfig } from "../lib/config";
export const otpTemp = (OTP: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>OTP Verification</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f4f4f4;
        }
        .container {
            background-color: #ffffff;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .header {
            text-align: center;
            margin-bottom: 30px;
        }
        .logo {
            font-size: 24px;
            font-weight: bold;
            color: #2c3e50;
        }
        .otp-code {
            background-color: #f8f9fa;
            border: 2px dashed #007bff;
            padding: 20px;
            text-align: center;
            margin: 20px 0;
            border-radius: 8px;
        }
        .otp-number {
            font-size: 32px;
            font-weight: bold;
            color: #007bff;
            letter-spacing: 5px;
        }
        .message {
            text-align: center;
            margin: 20px 0;
        }
        .warning {
            background-color: #fff3cd;
            border: 1px solid #ffeaa7;
            padding: 15px;
            border-radius: 5px;
            margin: 20px 0;
            color: #856404;
        }
        .footer {
            text-align: center;
            margin-top: 30px;
            color: #666;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="logo">Your App Name</div>
        </div>
        
        <div class="message">
            <h2>OTP Verification</h2>
            <p>Your One-Time Password (OTP) for verification is:</p>
        </div>
        
        <div class="otp-code">
            <div class="otp-number">${OTP}</div>
        </div>
        
        <div class="message">
            <p>This OTP will expire in <strong>10 minutes</strong>.</p>
            <p>Please enter this code to complete your verification process.</p>
        </div>
        
        <div class="warning">
            <strong>Security Notice:</strong> Never share this OTP with anyone. Our team will never ask for your OTP.
        </div>
        
        <div class="footer">
            <p>If you didn't request this OTP, please ignore this email.</p>
            <p>© 2024 Your App Name. All rights reserved.</p>
        </div>
    </div>
</body>
</html>
`

export const welcomeTemp = (email: string, password: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Welcome to CallScout</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f4f4f4; }
        .container { background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { text-align: center; margin-bottom: 30px; }
        .logo { font-size: 24px; font-weight: bold; color: #2c3e50; }
        .details-box { background: #f8f9fa; border: 2px dashed #28a745; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center; }
        .message { margin: 20px 0; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
        .credential { margin: 10px 0; font-size: 18px; }
        .label { font-weight: bold; color: #555; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header"><div class="logo">CallScout</div></div>
        <div class="message">
            <h2>Welcome to CallScout!</h2>
            <p>Your account has been successfully created. Here are your login details:</p>
        </div>
        <div class="details-box">
            <div class="credential"><span class="label">Email:</span> ${email}</div>
            <div class="credential"><span class="label">Password:</span> ${password}</div>
        </div>
        <div class="message">
            <p>Please login and change your password after your first login.</p>
        </div>
        <div class="footer"><p>© 2026 CallScout. All rights reserved.</p></div>
    </div>
</body>
</html>
`

export const leadSheetEmailTemp = (contactName: string, leadSheetTitle: string, questions: { text: string, answer: any }[]) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Lead Sheet: ${leadSheetTitle}</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 700px; margin: 0 auto; padding: 20px; background-color: #f9fafb; }
        .container { background-color: #ffffff; padding: 40px; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); }
        .header { border-bottom: 2px solid #e5e7eb; margin-bottom: 30px; padding-bottom: 20px; }
        .title { font-size: 24px; font-weight: 700; color: #111827; margin: 0; }
        .subtitle { font-size: 16px; color: #6b7280; margin-top: 5px; }
        .question-block { margin-bottom: 25px; padding: 15px; background: #fdfdfd; border: 1px solid #f3f4f6; border-radius: 8px; }
        .question-text { font-weight: 600; color: #374151; margin-bottom: 8px; font-size: 15px; }
        .answer-text { color: #1f2937; background: #fff; padding: 10px; border-radius: 6px; border-left: 4px solid #3b82f6; font-size: 15px; }
        .no-answer { font-style: italic; color: #9ca3af; }
        .footer { text-align: center; margin-top: 40px; color: #9ca3af; font-size: 13px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1 class="title">${leadSheetTitle}</h1>
            <p class="subtitle">Contact: <strong>${contactName}</strong></p>
        </div>
        
        <div class="content">
            ${questions.map(q => `
                <div class="question-block">
                    <div class="question-text">${q.text}</div>
                    <div class="answer-text">
                        ${q.answer ? (Array.isArray(q.answer) ? q.answer.join(', ') : q.answer) : '<span class="no-answer">No answer provided</span>'}
                    </div>
                </div>
            `).join('')}
        </div>
        
        <div class="footer">
            <p>Sent via CallScout Dialer</p>
            <p>© 2026 All rights reserved.</p>
        </div>
    </div>
</body>
</html>
`

export const newUserSignupTemp = (userEmail: string, signupTime: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>New User Signup on CallScout</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f4f6f8; }
        .container { background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { text-align: center; border-bottom: 2px solid #28a745; margin-bottom: 20px; padding-bottom: 10px; }
        .logo { font-size: 24px; font-weight: bold; color: #2c3e50; }
        .content { margin: 20px 0; font-size: 16px; }
        .highlight { font-weight: bold; color: #28a745; }
        .footer { text-align: center; margin-top: 30px; color: #999; font-size: 12px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header"><div class="logo">CallScout</div></div>
        <div class="content">
            <h2 style="color: #2c3e50;">New User Signup Notification</h2>
            <p>Hello,</p>
            <p>A new user has signed up on <span class="highlight">CallScout</span>.</p>
            <p><strong>User Email:</strong> ${userEmail}</p>
            <p><strong>Signup Time:</strong> ${signupTime}</p>
        </div>
        <div class="footer">
            <p>© 2026 CallScout. All rights reserved.</p>
        </div>
    </div>
</body>
</html>
`

export const loginAlertTemp = (userEmail: string, loginTime: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>User Login Alert - CallScout</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f4f6f8; }
        .container { background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { text-align: center; border-bottom: 20px solid #007bff; margin-bottom: 20px; padding-bottom: 10px; border-width: 2px; }
        .logo { font-size: 24px; font-weight: bold; color: #2c3e50; }
        .content { margin: 20px 0; font-size: 16px; }
        .highlight { font-weight: bold; color: #007bff; }
        .footer { text-align: center; margin-top: 30px; color: #999; font-size: 12px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header"><div class="logo">CallScout</div></div>
        <div class="content">
            <h2 style="color: #2c3e50;">User Login Alert</h2>
            <p>Hello,</p>
            <p>A user has logged in to <span class="highlight">CallScout</span>.</p>
            <p><strong>Account:</strong> ${userEmail}</p>
            <p><strong>Login Time:</strong> ${loginTime}</p>
        </div>
        <div class="footer">
            <p>© 2026 CallScout. All rights reserved.</p>
        </div>
    </div>
</body>
</html>
`

import { sendEmail as trackedSendEmail } from "../services/email.service";

export const sendEmail = async (
    to: string,
    subject: string,
    html: string,
    tracking?: {
        userId: string;
        contactId?: string;
        leadId?: string;
        templateId?: string;
        includeUnsubscribe?: boolean;
        companyId?: string;
        replyToEmail?: string;
    }
) => {
    try {
        return await trackedSendEmail({
            to,
            from: "noreply@dialersaas.com", // Default from if not specified
            subject,
            text: "Please view this email in an HTML compatible client.",
            html,
            userId: tracking?.userId,
            contactId: tracking?.contactId,
            leadId: tracking?.leadId,
            templateId: tracking?.templateId,
            includeUnsubscribe: tracking?.includeUnsubscribe,
            companyId: tracking?.companyId,
            replyToEmail: tracking?.replyToEmail,
        });
    }
    catch (error) {
        console.log("Error sending email via utils:", error);
        return { error };
    }
}